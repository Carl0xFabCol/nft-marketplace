// Run log: every step and every check is a JSON line in <scratch>/run.log.jsonl
// plus one console line, and findings are collected for the summary.

import { appendFileSync } from "node:fs"

export type FindingClass = "contract" | "indexer" | "DB" | "web" | "test-harness"

export interface Finding {
  id: string
  step: string
  observed: string
  expected: string
  cls: FindingClass
  severity: "high" | "medium" | "low" | "info"
}

export interface StepRecord {
  step: string
  status: "pass" | "fail" | "skip"
  ms: number
  detail?: string
}

export class RunLog {
  readonly steps: StepRecord[] = []
  readonly findings: Finding[] = []
  readonly checks: { step: string; name: string; ok: boolean; detail?: string }[] = []
  private current = "setup"

  constructor(private readonly path: string) {}

  private write(obj: Record<string, unknown>) {
    appendFileSync(this.path, `${JSON.stringify({ t: new Date().toISOString(), ...obj }, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}\n`)
  }

  info(message: string, data?: Record<string, unknown>) {
    console.log(`  · ${message}`)
    this.write({ kind: "info", step: this.current, message, ...data })
  }

  /** A hard assertion: records the outcome and throws on failure. */
  check(name: string, ok: boolean, detail?: string): void {
    this.checks.push({ step: this.current, name, ok, detail })
    this.write({ kind: "check", step: this.current, name, ok, detail })
    console.log(`  ${ok ? "✔" : "✖"} ${name}${detail && !ok ? ` — ${detail}` : ""}`)
    if (!ok) throw new CheckFailed(`${this.current}: ${name}${detail ? ` — ${detail}` : ""}`)
  }

  /** Equality check with both values in the failure detail (bigint-safe). */
  eq<T>(name: string, actual: T, expected: T): void {
    const a = stringify(actual)
    const e = stringify(expected)
    this.check(name, a === e, `actual ${a}, expected ${e}`)
  }

  finding(f: Omit<Finding, "step">) {
    const full = { ...f, step: this.current }
    this.findings.push(full)
    this.write({ kind: "finding", ...full })
    console.log(`  ⚠ FINDING ${f.id} [${f.cls}/${f.severity}]: ${f.observed}`)
  }

  async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const started = Date.now()
    this.current = name
    console.log(`\n▶ ${name}`)
    this.write({ kind: "step-start", step: name })
    try {
      const out = await fn()
      this.steps.push({ step: name, status: "pass", ms: Date.now() - started })
      this.write({ kind: "step-end", step: name, status: "pass", ms: Date.now() - started })
      return out
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      this.steps.push({ step: name, status: "fail", ms: Date.now() - started, detail })
      this.write({ kind: "step-end", step: name, status: "fail", ms: Date.now() - started, detail })
      throw e
    }
  }

  skip(name: string, reason: string) {
    this.steps.push({ step: name, status: "skip", ms: 0, detail: reason })
    this.write({ kind: "step-skip", step: name, reason })
    console.log(`\n▷ ${name} — SKIPPED: ${reason}`)
  }

  summary(): string {
    const lines = ["", "════════ REHEARSAL SUMMARY ════════"]
    for (const s of this.steps) lines.push(`${s.status === "pass" ? "PASS" : s.status === "fail" ? "FAIL" : "SKIP"}  ${s.step}  (${(s.ms / 1000).toFixed(1)}s)${s.detail ? `  ${s.detail.split("\n")[0]}` : ""}`)
    const failedChecks = this.checks.filter((c) => !c.ok).length
    lines.push(`checks: ${this.checks.length - failedChecks} passed, ${failedChecks} failed`)
    lines.push(`findings: ${this.findings.length}`)
    for (const f of this.findings) lines.push(`  ${f.id} [${f.cls}/${f.severity}] ${f.step}: ${f.observed} (expected: ${f.expected})`)
    return lines.join("\n")
  }
}

export class CheckFailed extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CheckFailed"
  }
}

export function stringify(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x.toString()}n` : x)) ?? String(v)
}
