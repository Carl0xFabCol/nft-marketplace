/**
 * Generate src/addresses.generated.ts from VERIFIED deployment records
 * (INTEGRATION_AUDIT §3.3 / §8 step 4).
 *
 *   pnpm --filter @marketplace/contracts generate:addresses [--network elysium]
 *        [--rpc elysium=https://...] [--deployments-dir <dir>] [--out <file>] [--check]
 *
 * Reads foundry/deployments/<network>.json (latest.json and archive/ are never
 * consumed). Every record must pass rules 1-9 or the command exits 1 and writes
 * nothing. RPC URLs default to [rpc_endpoints] in foundry.toml.
 *
 * Phase 0: this is NOT run against the legacy stack (it would be rejected),
 * and addresses.ts is not repointed. Activation happens in Phase 6.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { createPublicClient, http, parseAbi, type Address } from "viem"
import { parseRpcEndpoints, runGenerateAddresses, type AddressGetter, type ChainReader, type RecordFile } from "./lib/addresses"

const PACKAGE_ROOT = path.resolve(__dirname, "..")
const FOUNDRY_ROOT = path.join(PACKAGE_ROOT, "foundry")

const READ_ABI = parseAbi([
  "function core() view returns (address)",
  "function bids() view returns (address)",
  "function marketplace() view returns (address)",
  "function router() view returns (address)",
  "function bidsContract() view returns (address)",
  "function OWNER_QUERY_GAS() view returns (uint256)",
])

function createViemReader(url: string): ChainReader {
  const client = createPublicClient({ transport: http(url) })
  return {
    getChainId: () => client.getChainId(),
    getCode: (address) => client.getCode({ address }),
    readAddress: (contract, fn: AddressGetter) =>
      client.readContract({ address: contract, abi: READ_ABI, functionName: fn }) as Promise<Address>,
    readUint: (contract, fn) => client.readContract({ address: contract, abi: READ_ABI, functionName: fn }),
  }
}

interface Args {
  check: boolean
  networks: string[]
  rpc: Record<string, string>
  deploymentsDir: string
  out: string
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    check: false,
    networks: [],
    rpc: {},
    deploymentsDir: path.join(FOUNDRY_ROOT, "deployments"),
    out: path.join(PACKAGE_ROOT, "src", "addresses.generated.ts"),
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${a} requires a value`)
      return v
    }
    if (a === "--check") args.check = true
    else if (a === "--network") args.networks.push(next())
    else if (a === "--rpc") {
      const [net, ...rest] = next().split("=")
      if (!net || rest.length === 0) throw new Error("--rpc expects <network>=<url>")
      args.rpc[net] = rest.join("=")
    } else if (a === "--deployments-dir") args.deploymentsDir = path.resolve(next())
    else if (a === "--out") args.out = path.resolve(next())
    else throw new Error(`unknown argument ${a}`)
  }
  return args
}

function loadRecords(dir: string, networks: string[]): RecordFile[] {
  const files =
    networks.length > 0
      ? networks.map((n) => `${n}.json`)
      : existsSync(dir)
        ? readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "latest.json")
        : []
  return files.sort().map((fileName) => {
    const file = path.join(dir, fileName)
    if (!existsSync(file)) throw new Error(`deployment record ${file} does not exist`)
    return { fileName, data: JSON.parse(readFileSync(file, "utf8")) as unknown }
  })
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv)
  const tomlPath = path.join(FOUNDRY_ROOT, "foundry.toml")
  const endpoints = { ...(existsSync(tomlPath) ? parseRpcEndpoints(readFileSync(tomlPath, "utf8")) : {}), ...args.rpc }

  const result = await runGenerateAddresses({
    records: loadRecords(args.deploymentsDir, args.networks),
    readerFor: (network) => (endpoints[network] ? createViemReader(endpoints[network]) : undefined),
    outPath: args.out,
    check: args.check,
  })

  if (result.exitCode !== 0) {
    console.error("✖ Address generation rejected. Nothing was written.")
    for (const e of result.errors) console.error(`  - ${e}`)
    return result.exitCode
  }
  console.log(args.check ? `✔ ${path.relative(PACKAGE_ROOT, args.out)} is up to date.` : `✔ wrote ${path.relative(PACKAGE_ROOT, args.out)}`)
  return 0
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    console.error(`✖ ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  },
)
