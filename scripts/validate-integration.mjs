#!/usr/bin/env node
// pnpm validate:integration [--chain-id <id>] [--live]
//
// Runs the integration checks of INTEGRATION_AUDIT §8 step 6:
//   apps/indexer      (a) events exist in generated ABI, (b) handler/config 1:1,
//                     (c) CHAIN_ID required + supported, (f) default chain ids agree,
//                     (d) RPC eth_chainId == CHAIN_ID  [--live only; off in CI]
//   packages/contracts  test #8 frontend call-shape against the generated ABI
//
// Never reads .env files. --live needs CHAIN_ID and FAST_RPC_URL exported in
// the shell. Some checks are KNOWN-FAILING in Phase 0; see
// docs/PRODUCTION_PLAN.md ("Known-failing tests").
import { spawnSync } from "node:child_process"

const args = process.argv.slice(2)
const env = { ...process.env }

for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === "--live") env.VALIDATE_LIVE = "1"
  else if (a === "--chain-id") {
    const v = args[++i]
    if (!v) {
      console.error("--chain-id requires a value")
      process.exit(2)
    }
    env.CHAIN_ID = v
  } else {
    console.error(`unknown argument ${a}`)
    process.exit(2)
  }
}
if (!env.VALIDATE_LIVE) delete env.VALIDATE_LIVE

const suites = [
  { name: "indexer config/handlers/chain id", filter: "@marketplace/indexer" },
  { name: "frontend call-shape (test #8)", filter: "@marketplace/contracts" },
]

let failed = 0
for (const suite of suites) {
  console.log(`\n▶ validate:integration: ${suite.name}`)
  const result = spawnSync(
    "pnpm",
    ["--filter", suite.filter, "exec", "vitest", "run", "--config", "vitest.integration.config.ts"],
    { stdio: "inherit", env, shell: process.platform === "win32" },
  )
  if (result.status !== 0) failed++
}

if (failed > 0) {
  console.error(`\n✖ validate:integration: ${failed}/${suites.length} suite(s) failed`)
  process.exit(1)
}
console.log("\n✔ validate:integration passed")
