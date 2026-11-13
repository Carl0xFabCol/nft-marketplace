// Child-process helpers for the rehearsal. No shell is ever used (arguments
// are passed as an array), and the environment of every child is built
// explicitly from a small allow-list plus the caller's values: the parent's
// environment is never forwarded wholesale.

import { spawn, type ChildProcess } from "node:child_process"
import { createWriteStream, type WriteStream } from "node:fs"

export interface RunOptions {
  cwd?: string
  /** Complete environment for the child (merged onto baseEnv()). */
  env?: Record<string, string | undefined>
  input?: Buffer | string
  timeoutMs?: number
  /** Return non-zero exits instead of throwing. */
  allowFail?: boolean
}

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/** Variables a child genuinely needs to start on Windows/Linux. Nothing else is inherited. */
const INHERITED = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "ComSpec", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "DOCKER_HOST", "LANG", "TERM"]

export function baseEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of INHERITED) {
    const v = process.env[k]
    if (v !== undefined) out[k] = v
  }
  // Foundry/vite/pino colour codes make logs harder to grep.
  out.NO_COLOR = "1"
  out.FORCE_COLOR = "0"
  return out
}

function childEnv(extra?: Record<string, string | undefined>): Record<string, string> {
  const env = baseEnv()
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (v === undefined) delete env[k]
    else env[k] = v
  }
  return env
}

export class CommandError extends Error {
  constructor(
    readonly command: string,
    readonly result: RunResult,
  ) {
    super(`${command} exited ${result.code}\n--- stdout (tail) ---\n${tail(result.stdout)}\n--- stderr (tail) ---\n${tail(result.stderr)}`)
    this.name = "CommandError"
  }
}

export function tail(text: string, lines = 40): string {
  return text.split(/\r?\n/).slice(-lines).join("\n")
}

export function run(cmd: string, args: readonly string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...args], { cwd: opts.cwd, env: childEnv(opts.env), shell: false, windowsHide: true })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on("data", (d: Buffer) => out.push(d))
    child.stderr.on("data", (d: Buffer) => err.push(d))
    let timer: NodeJS.Timeout | undefined
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        child.kill("SIGKILL")
        reject(new Error(`${cmd} ${args.join(" ")} timed out after ${opts.timeoutMs} ms`))
      }, opts.timeoutMs)
    }
    child.on("error", (e) => {
      if (timer) clearTimeout(timer)
      reject(e)
    })
    child.on("close", (code) => {
      if (timer) clearTimeout(timer)
      const result = { code: code ?? -1, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") }
      if (result.code !== 0 && !opts.allowFail) reject(new CommandError(`${cmd} ${args[0] ?? ""}`, result))
      else resolve(result)
    })
    if (opts.input !== undefined) child.stdin.end(opts.input)
    else child.stdin.end()
  })
}

export interface Background {
  child: ChildProcess
  logPath: string
  /** Resolves when the process exits. */
  exited: Promise<number | null>
  stop(signal?: NodeJS.Signals): Promise<void>
}

/** Long-running child (Anvil, indexer, metadata server) with stdout+stderr appended to a log file. */
export function spawnBackground(cmd: string, args: readonly string[], opts: { cwd?: string; env?: Record<string, string | undefined>; logPath: string }): Background {
  const log: WriteStream = createWriteStream(opts.logPath, { flags: "a" })
  const child = spawn(cmd, [...args], { cwd: opts.cwd, env: childEnv(opts.env), shell: false, windowsHide: true })
  child.stdout?.pipe(log, { end: false })
  child.stderr?.pipe(log, { end: false })
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)))
  return {
    child,
    logPath: opts.logPath,
    exited,
    async stop(signal: NodeJS.Signals = "SIGTERM") {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal)
        const timeout = new Promise<null>((r) => setTimeout(() => r(null), 10_000))
        if ((await Promise.race([exited, timeout])) === null && child.exitCode === null) child.kill("SIGKILL")
        await Promise.race([exited, new Promise((r) => setTimeout(r, 5_000))])
      }
      log.end()
    },
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Polls `fn` until it returns a truthy value or the deadline passes. */
export async function waitFor<T>(what: string, fn: () => Promise<T | undefined | null | false>, opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<T> {
  const deadline = Date.now() + (opts.timeoutMs ?? 60_000)
  let last: unknown
  while (Date.now() < deadline) {
    try {
      const v = await fn()
      if (v) return v
    } catch (e) {
      last = e
    }
    await sleep(opts.intervalMs ?? 250)
  }
  throw new Error(`timed out waiting for ${what}${last ? `: ${last instanceof Error ? last.message : String(last)}` : ""}`)
}
