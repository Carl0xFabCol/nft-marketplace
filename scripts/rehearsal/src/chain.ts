// Anvil + the real Foundry deployment scripts, run from a scratch copy of the
// foundry project so that (1) forge's automatic .env loading finds no .env and
// (2) deployments/<network>.json and latest.json land outside the repository.

import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  type Abi,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { foundry } from "viem/chains"
import { HypercAbi, LaunchPadAbi, MarketplaceRouterAbi } from "@marketplace/contracts/abis/web"
import { ANVIL_ACCOUNTS, REHEARSAL_CHAIN_ID, REHEARSAL_NETWORK, requireLoopbackUrl } from "./guards"
import { run, spawnBackground, waitFor, type Background } from "./proc"

export const ANVIL_PORT = 18545
export const RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`

/** Fixed roles (Anvil accounts). */
export const ROLES = {
  deployer: 0, // router owner, registers collections, admin ops
  creator: 1, // owns Hyperc collection A, creates LaunchPad collection C
  alice: 2, // seller
  bob: 3, // buyer / bidder
  carol: 4, // bidder
  dave: 5, // seller / bidder
  royalty: 6, // royalty receiver of every collection
  fees: 7, // marketplace fee receiver
} as const
export type Role = keyof typeof ROLES

export function account(role: Role): Account {
  return privateKeyToAccount(ANVIL_ACCOUNTS[ROLES[role]].privateKey)
}

export interface Chain {
  anvil: Background
  pub: PublicClient
  wallet: (role: Role) => WalletClient
  rpc(method: string, params?: unknown[]): Promise<unknown>
}

export async function startAnvil(logPath: string): Promise<Chain> {
  requireLoopbackUrl("RPC_URL", RPC_URL)
  const anvil = spawnBackground(
    "anvil",
    ["--host", "127.0.0.1", "--port", String(ANVIL_PORT), "--chain-id", String(REHEARSAL_CHAIN_ID), "--accounts", "10", "--balance", "100000"],
    { logPath },
  )
  // cacheTime 0: viem caches getBlockNumber for ~4 s by default, and a stale
  // head made the driver over-mine (and mis-target the reorg fork point).
  const pub = createPublicClient({ chain: foundry, transport: http(RPC_URL), cacheTime: 0 }) as PublicClient
  await waitFor("anvil eth_chainId", async () => (await pub.getChainId()) === REHEARSAL_CHAIN_ID, { timeoutMs: 30_000 })
  const wallets = new Map<Role, WalletClient>()
  return {
    anvil,
    pub,
    wallet(role) {
      let w = wallets.get(role)
      if (!w) {
        w = createWalletClient({ chain: foundry, transport: http(RPC_URL), account: account(role) })
        wallets.set(role, w)
      }
      return w
    },
    async rpc(method, params = []) {
      const res = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })
      const body = (await res.json()) as { result?: unknown; error?: { message: string } }
      if (body.error) throw new Error(`${method}: ${body.error.message}`)
      return body.result
    },
  }
}

/** Copies the foundry project WITHOUT .env, broadcast/, cache/, out/ or deployments/. */
export function copyFoundry(repoRoot: string, dest: string): string {
  const src = path.join(repoRoot, "packages", "contracts", "foundry")
  mkdirSync(dest, { recursive: true })
  for (const entry of ["src", "script", "test", "lib", "foundry.toml"]) {
    cpSync(path.join(src, entry), path.join(dest, entry), { recursive: true })
  }
  mkdirSync(path.join(dest, "deployments"), { recursive: true })
  // forge loads .env from the working directory upwards: there must be none.
  let dir = dest
  for (;;) {
    if (existsSync(path.join(dir, ".env"))) throw new Error(`a .env exists at ${dir}; refusing to run forge there`)
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return dest
}

export interface ForgeEnv {
  [k: string]: string | undefined
}

/** `forge script` in the scratch copy. Only loopback RPC; Anvil key 0 only. */
export async function forgeScript(foundryDir: string, file: string, contract: string, env: ForgeEnv, opts: { broadcast: boolean; sigRun?: boolean; extraArgs?: string[] }): Promise<string> {
  const args = ["script", `script/${file}:${contract}`, "--rpc-url", RPC_URL]
  if (opts.sigRun) args.push("--sig", "run()")
  if (opts.broadcast) args.push("--broadcast", "--slow")
  if (opts.extraArgs) args.push(...opts.extraArgs)
  const r = await run("forge", args, {
    cwd: foundryDir,
    timeoutMs: 900_000,
    env: {
      NETWORK: REHEARSAL_NETWORK,
      PRIVATE_KEY: ANVIL_ACCOUNTS[ROLES.deployer].privateKey,
      DEPLOYMENTS_DIR: "deployments",
      FOUNDRY_DISABLE_NIGHTLY_WARNING: "1",
      ...env,
    },
  })
  return r.stdout
}

export function readRecord(foundryDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(foundryDir, "deployments", `${REHEARSAL_NETWORK}.json`), "utf8")) as Record<string, unknown>
}

export function artifact(foundryDir: string, file: string, name: string): { abi: Abi; bytecode: Hex } {
  const json = JSON.parse(readFileSync(path.join(foundryDir, "out", file, `${name}.json`), "utf8")) as { abi: Abi; bytecode: { object: Hex } }
  return { abi: json.abi, bytecode: json.bytecode.object }
}

export interface Addresses {
  core: Address
  bids: Address
  router: Address
  launchpad: Address
}

export interface Collections {
  /** Hyperc, ERC-2981 500 bps → royalty account; registered via RegisterCollection.s.sol with a 300 bps fallback. */
  A: Address
  /** MockNFT (no ERC-2981); registered with a 200 bps stored royalty → royalty account. */
  B: Address
  /** LaunchPad.createCollection (Hyperc, 750 bps ERC-2981). */
  C: Address
  /** MockNFT registered with a 0 bps royalty: no royalty at all. */
  D: Address
}

/** Sends a tx and waits for its receipt; throws with the decoded revert on failure. */
export async function send(chain: Chain, role: Role, req: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint }) {
  const wallet = chain.wallet(role)
  const { request } = await chain.pub.simulateContract({ ...req, account: wallet.account! } as Parameters<PublicClient["simulateContract"]>[0])
  const hash = await wallet.writeContract(request as Parameters<WalletClient["writeContract"]>[0])
  const receipt = await chain.pub.waitForTransactionReceipt({ hash })
  if (receipt.status !== "success") throw new Error(`${req.functionName} reverted on-chain (tx ${hash})`)
  return receipt
}

export async function deployContract(chain: Chain, role: Role, art: { abi: Abi; bytecode: Hex }, args: readonly unknown[] = []): Promise<Address> {
  const wallet = chain.wallet(role)
  const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode, args, account: wallet.account!, chain: foundry })
  const receipt = await chain.pub.waitForTransactionReceipt({ hash })
  if (!receipt.contractAddress) throw new Error("deployment produced no contract address")
  return receipt.contractAddress
}

export async function createLaunchpadCollection(chain: Chain, launchpad: Address, baseUri: string): Promise<Address> {
  const fee = (await chain.pub.readContract({ address: launchpad, abi: LaunchPadAbi, functionName: "launchFee" })) as bigint
  const receipt = await send(chain, "creator", {
    address: launchpad,
    abi: LaunchPadAbi,
    functionName: "createCollection",
    args: ["Rehearsal Launch", "RLAUNCH", 750, account("royalty").address, 1000n, baseUri, 0n, 0n],
    value: fee,
  })
  const [ev] = parseEventLogs({ abi: LaunchPadAbi, logs: receipt.logs, eventName: "CollectionDeployed" })
  if (!ev) throw new Error("CollectionDeployed not emitted")
  return (ev.args as { collection: Address }).collection
}

export { HypercAbi, LaunchPadAbi, MarketplaceRouterAbi }
