// Reconciliation CLI (seed of the Phase 7 job):
//
//   SUPABASE_SERVICE_ROLE_KEY=… pnpm --filter @marketplace/rehearsal reconcile -- \
//     --chain-id <id> --rpc <url> --supabase-url <url> \
//     --core <addr> --bids <addr> --router <addr> --from-block <deployBlock> [--at-block <n>] [--allow-remote]
//
// Read-only on both sides (eth_call/eth_getLogs, PostgREST selects). The key is
// taken from the shell environment only; no .env is read. Exit 0 = DB == chain,
// 1 = mismatches (printed), 2 = usage error. Non-loopback endpoints are refused
// unless --allow-remote (Phase 7, by the operator; never used in Phase 5).

import { createClient } from "@supabase/supabase-js"
import { createPublicClient, getAddress, http, type PublicClient } from "viem"
import { isLoopbackUrl } from "./guards"
import { formatReport, reconcile } from "./reconcile"

function args(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  const a = argv.filter((x) => x !== "--")
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith("--")) throw new Error(`unexpected ${a[i]}`)
    const key = a[i].slice(2)
    if (key === "allow-remote") out[key] = "1"
    else out[key] = a[++i] ?? ""
  }
  return out
}

async function main(): Promise<number> {
  const o = args(process.argv.slice(2))
  for (const k of ["chain-id", "rpc", "supabase-url", "core", "bids", "router", "from-block"]) if (!o[k]) throw new Error(`--${k} is required`)
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY must be set in the shell (no .env is read)")
  if (!o["allow-remote"] && (!isLoopbackUrl(o.rpc) || !isLoopbackUrl(o["supabase-url"]))) {
    throw new Error("non-loopback RPC/Supabase URL refused (pass --allow-remote deliberately, Phase 7 only)")
  }
  const report = await reconcile({
    chainId: Number(o["chain-id"]),
    pub: createPublicClient({ transport: http(o.rpc), cacheTime: 0 }) as PublicClient,
    db: createClient(o["supabase-url"], key, { auth: { persistSession: false, autoRefreshToken: false } }),
    core: getAddress(o.core),
    bids: getAddress(o.bids),
    router: getAddress(o.router),
    fromBlock: BigInt(o["from-block"]),
    atBlock: o["at-block"] ? BigInt(o["at-block"]) : undefined,
  })
  console.log(formatReport(report))
  return report.mismatches.length === 0 ? 0 : 1
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (e: unknown) => {
    console.error(`✖ ${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 2
  },
)
