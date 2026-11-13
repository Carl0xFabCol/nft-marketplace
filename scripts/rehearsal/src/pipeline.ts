// Steps 2-4 of the rehearsal: deploy → configure → verify (real Foundry
// scripts), collections, generate addresses (all 10 rules) + ABIs + validate,
// and prepare-deployment (first real success path + its refusals).

import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { getAddress, type Address } from "viem"
import { account, artifact, copyFoundry, createLaunchpadCollection, deployContract, forgeScript, MarketplaceRouterAbi, readRecord, RPC_URL, type Addresses, type Chain, type Collections } from "./chain"
import { launch, tsxCli, type Ctx } from "./ctx"
import { scalar } from "./db"
import { REHEARSAL_CHAIN_ID } from "./guards"
import type { RunLog } from "./log"
import { metadataBase } from "./metadata"
import { run } from "./proc"

export const MARKETPLACE_FEE_BPS = 250n
/** Finding F-1 workaround for registerCollection broadcasts. */
export const REGISTER_GAS_ARGS = ["--gas-estimate-multiplier", "200"]

export async function deployStack(repoRoot: string, scratch: string, chain: Chain, log: RunLog): Promise<{ foundryDir: string; addresses: Addresses; deployBlock: bigint; record: Record<string, unknown> }> {
  const foundryDir = copyFoundry(repoRoot, path.join(scratch, "foundry"))
  log.info(`foundry project copied to ${foundryDir} (no .env, no deployments/)`)
  // Full build (forge script compiles only what the scripts import; the mock
  // collections live in test/). Same sources, byte for byte, as the repository.
  await run("forge", ["build"], { cwd: foundryDir, timeoutMs: 900_000, env: { FOUNDRY_DISABLE_NIGHTLY_WARNING: "1" } })
  // Start from a non-trivial height so "no code before deployBlock" means something.
  await chain.rpc("anvil_mine", ["0x64"])
  const fees = account("fees").address
  const deployer = account("deployer").address

  const head0 = await chain.pub.getBlockNumber()
  await forgeScript(foundryDir, "DeployMarketplace.s.sol", "DeployMarketplace", { FEE_RECEIVER: fees, MARKETPLACE_FEE: String(MARKETPLACE_FEE_BPS) }, { broadcast: true })
  let rec = readRecord(foundryDir)
  log.eq("DeployMarketplace: stage", rec.stage, "partial")
  log.eq("DeployMarketplace: configured", rec.configured, false)
  log.check("DeployMarketplace: deployBlock recorded", typeof rec.deployBlock === "number" && rec.deployBlock > 0, String(rec.deployBlock))
  for (const k of ["coreCodeHash", "bidsCodeHash", "marketplaceCodeHash", "launchpadCodeHash"]) {
    log.check(`DeployMarketplace: ${k} recorded`, typeof rec[k] === "string" && !/^0x0+$/.test(rec[k] as string), String(rec[k]))
  }

  await forgeScript(foundryDir, "ConfigureMarketplace.s.sol", "ConfigureMarketplace", {}, { broadcast: true })
  log.eq("ConfigureMarketplace leaves the record partial", readRecord(foundryDir).stage, "partial")

  await forgeScript(
    foundryDir,
    "VerifyDeployment.s.sol",
    "VerifyDeployment",
    { EXPECTED_MARKETPLACE_FEE: String(MARKETPLACE_FEE_BPS), EXPECTED_FEE_RECEIVER: fees, EXPECTED_ROUTER_OWNER: deployer },
    { broadcast: false, sigRun: true },
  )
  const partialBlock = rec.deployBlock
  rec = readRecord(foundryDir)
  log.eq("VerifyDeployment: stage", rec.stage, "verified")
  log.eq("VerifyDeployment: configured", rec.configured, true)
  log.check("VerifyDeployment: verifiedAt stamped", typeof rec.verifiedAt === "number" && rec.verifiedAt > 0, String(rec.verifiedAt))
  log.eq("VerifyDeployment preserved deployBlock", rec.deployBlock, partialBlock)
  log.check("latest.json written in the scratch deployments dir only", existsSync(path.join(foundryDir, "deployments", "latest.json")))
  log.check("the repository deployments dir has no anvil record", !existsSync(path.join(repoRoot, "packages", "contracts", "foundry", "deployments", "anvil.json")))

  const addresses: Addresses = {
    core: getAddress(rec.core as string),
    bids: getAddress(rec.bids as string),
    router: getAddress(rec.marketplace as string),
    launchpad: getAddress(rec.launchpad as string),
  }
  const deployBlock = BigInt(rec.deployBlock as number)

  // deployBlock is a lower bound that must not skip anything: no code before it,
  // and (Anvil automine) the first deployment tx lands exactly on it.
  const before = await chain.pub.getCode({ address: addresses.core, blockNumber: deployBlock - 1n })
  log.check("no Core code at deployBlock - 1", !before || before === "0x", String(before?.slice(0, 10)))
  const firstTx = firstBroadcastBlock(foundryDir, "DeployMarketplace.s.sol")
  log.check("deployBlock <= block of the first deployment tx", deployBlock <= firstTx, `deployBlock ${deployBlock}, first tx block ${firstTx}`)
  log.eq("deployBlock == first deployment tx block (Anvil automine)", deployBlock, firstTx)
  log.check("deployBlock == simulated head + 1", deployBlock === head0 + 1n, `head before deploy ${head0}`)
  return { foundryDir, addresses, deployBlock, record: rec }
}

function firstBroadcastBlock(foundryDir: string, script: string): bigint {
  const file = path.join(foundryDir, "broadcast", script, String(REHEARSAL_CHAIN_ID), "run-latest.json")
  const json = JSON.parse(readFileSync(file, "utf8")) as { receipts: { blockNumber: string }[] }
  return json.receipts.map((r) => BigInt(r.blockNumber)).reduce((a, b) => (b < a ? b : a))
}

export async function deployCollections(foundryDir: string, chain: Chain, addresses: Addresses, log: RunLog, anvilLog: string): Promise<Collections> {
  const creator = account("creator").address
  const royalty = account("royalty").address
  const A = await deployContract(chain, "creator", artifact(foundryDir, "MERC721.sol", "Hyperc"), ["Rehearsal A", "RA", creator, 500, royalty, 1000n, metadataBase("a"), 0n, 0n])
  const B = await deployContract(chain, "creator", artifact(foundryDir, "MockNFT.t.sol", "MockNFT"))
  const D = await deployContract(chain, "creator", artifact(foundryDir, "MockNFT.t.sol", "MockNFT"))
  const register = (collection: Address, fee: number, extraArgs: string[] = REGISTER_GAS_ARGS) =>
    forgeScript(foundryDir, "RegisterCollection.s.sol", "RegisterCollection", { COLLECTION_ADDRESS: collection, ROYALTY_FEE: String(fee), ROYALTY_RECEIVER: royalty }, { broadcast: true, extraArgs })

  // Finding F-1, reproduced on every run: with forge's default gas estimate
  // (simulated gas USED x 130%) the registerCollection broadcast reverts with
  // BoundedStaticCallInsufficientGas, because Core's bounded staticcalls require
  // gasleft() >= 100_000*64/63 + 5_000 regardless of what they consume.
  const defaultRun = await register(A, 300, []).then(
    () => "succeeded",
    (e: unknown) => (e instanceof Error ? e.message : String(e)),
  )
  const reproduced = defaultRun !== "succeeded" && readFileSync(anvilLog, "utf8").includes("custom error 0xd0f2e27c")
  log.check("F-1 reproduction: RegisterCollection with default gas estimation reverts on-chain (BoundedStaticCallInsufficientGas 0xd0f2e27c)", reproduced, defaultRun.slice(0, 300))
  log.finding({
    id: "F-1",
    cls: "contract",
    severity: "medium",
    observed: "deploy tooling (scripts/runbook, not contract source): forge script RegisterCollection --broadcast with forge's default gas estimate reverts on-chain with BoundedStaticCallInsufficientGas: forge sets the tx gas limit to ~1.3x the simulated gas used (125115), below Core's bounded-staticcall floor (gasleft >= ~106.6k inside Core). CreateHypurr.s.sol calls the same function. Wallets using eth_estimateGas (binary search) are not affected.",
    expected: "registration succeeds; DEPLOYMENT.md now requires --gas-estimate-multiplier 200 (Phase 6 requirement), which the rehearsal uses below",
  })
  await register(A, 300)
  await register(B, 200)
  await register(D, 0)
  const C = await createLaunchpadCollection(chain, addresses.launchpad, metadataBase("c"))
  for (const [name, c] of Object.entries({ A, B, C, D })) {
    const [, , , exists] = (await chain.pub.readContract({ address: addresses.router, abi: MarketplaceRouterAbi, functionName: "getCollectionStats", args: [c] })) as readonly [bigint, number, boolean, boolean]
    log.check(`collection ${name} registered (${c})`, exists)
  }
  return { A, B, C, D }
}

/** generate-addresses through launch.ts on the VERIFIED record, then negative probes. */
export async function generateAddresses(c: Pick<Ctx, "scratch" | "stack" | "addressesFile" | "deploymentsDir" | "addresses" | "log">): Promise<void> {
  const { log } = c
  const args = (dir: string, out: string, rpc = RPC_URL) => ["--network", "anvil", "--deployments-dir", dir, "--rpc", `anvil=${rpc}`, "--out", out]

  const ok = await launch(c, "generate-addresses", args(c.deploymentsDir, c.addressesFile), { allowFail: true })
  log.check("generate-addresses accepts the verified record (rules 1-10)", ok.code === 0, ok.stderr || ok.stdout)
  const generated = readFileSync(c.addressesFile, "utf8")
  log.check("generated map has 31337 → the verified Core", generated.includes(`MARKETPLACE_CORE: "${c.addresses.core}"`))
  log.check("generated map has the verified router and launchpad", generated.includes(`MARKETPLACE: "${c.addresses.router}"`) && generated.includes(`LAUNCHPAD: "${c.addresses.launchpad}"`))
  log.check("DEPLOYMENT_METADATA carries deployBlock", /deployBlock: \d+,/.test(generated))

  const check = await launch(c, "generate-addresses", [...args(c.deploymentsDir, c.addressesFile), "--check"], { allowFail: true })
  log.check("generate-addresses --check is clean on its own output", check.code === 0, check.stderr)

  // Negative probes on scratch copies: each must exit 1 and write nothing.
  const probe = async (name: string, mutate: (rec: Record<string, unknown>) => void, rpc = RPC_URL, expect: RegExp) => {
    const dir = path.join(c.scratch, `probe-${name}`)
    rmSync(dir, { recursive: true, force: true })
    cpSync(c.deploymentsDir, dir, { recursive: true })
    const file = path.join(dir, "anvil.json")
    const rec = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
    mutate(rec)
    writeFileSync(file, JSON.stringify(rec, null, 2))
    const out = path.join(dir, "should-not-exist.ts")
    const r = await launch(c, "generate-addresses", args(dir, out, rpc), { allowFail: true })
    log.check(`probe ${name}: exit 1, nothing written, ${expect}`, r.code === 1 && !existsSync(out) && expect.test(r.stderr), `exit ${r.code}; ${r.stderr.split("\n").slice(0, 4).join(" | ")}`)
  }
  await probe("partial", (r) => ((r.stage = "partial"), (r.configured = false)), RPC_URL, /\[rule 1\]/)
  await probe("hash", (r) => (r.bidsCodeHash = `0x${"ab".repeat(32)}`), RPC_URL, /\[rule 10\].*bidsCodeHash/)
  await probe("no-deploy-block", (r) => (r.deployBlock = 0), RPC_URL, /\[rule 10\].*deployBlock/)
  await probe("dead-rpc", () => {}, "http://127.0.0.1:1", /\[rule 8\]/)
  await probe("mixed", (r) => (r.bids = r.launchpad), RPC_URL, /\[rule 4\]/)
}

/** generate:abis:check and validate:integration, run exactly as a developer would (no .env). */
export async function abisAndValidate(c: Pick<Ctx, "repoRoot" | "log" | "scratch">): Promise<void> {
  const { log, repoRoot } = c
  const abis = await run(process.execPath, [tsxCli(), "scripts/generate-abis.ts", "--check"], { cwd: path.join(repoRoot, "packages", "contracts"), allowFail: true })
  log.check("generate:abis:check is up to date", abis.code === 0, abis.stdout + abis.stderr)

  const validate = (extra: string[], env: Record<string, string> = {}) =>
    run(process.execPath, [path.join(repoRoot, "scripts", "validate-integration.mjs"), ...extra], { cwd: repoRoot, allowFail: true, timeoutMs: 600_000, env })
  const offline = await validate(["--chain-id", "99801"])
  log.check("validate:integration --chain-id 99801 passes", offline.code === 0, tailOf(offline.stdout))

  // --live against Anvil. The suite loads the indexer's PRODUCTION contract
  // config at import, which has (correctly) no 31337 addresses, so the whole
  // file fails before (d) runs. This is by design and is recorded, not
  // weakened: the eth_chainId == CHAIN_ID property is proven in the rehearsal
  // by generator rule 8 (above) and by the indexer's own startup check (step 5).
  const live = await validate(["--live", "--chain-id", String(REHEARSAL_CHAIN_ID)], { FAST_RPC_URL: RPC_URL })
  const out = live.stdout + live.stderr
  writeFileSync(path.join(c.scratch, "validate-live-31337.log"), out)
  log.check(
    "validate --live 31337 refuses the non-production chain at import (No contract addresses configured for chainId 31337)",
    live.code !== 0 && /No contract addresses configured for chainId 31337/.test(out),
    "see validate-live-31337.log",
  )
  log.check("validate --live 31337: the frontend call-shape suite (#8) still passes", /✓[^\r\n]*frontend-call-shape/.test(out), "see validate-live-31337.log")
  log.finding({
    id: "F-2",
    cls: "test-harness",
    severity: "info",
    observed: "validate:integration --live cannot target a non-production chain: integration.integration.test.ts imports the indexer contract config, which throws for a chain without production addresses, so (d) never runs for 31337",
    expected: "by design; (d)'s property is covered in the rehearsal by generate-addresses rule 8 and the indexer's startup eth_chainId check",
  })
}

function tailOf(s: string) {
  return s.split(/\r?\n/).slice(-15).join("\n")
}

/** prepare-deployment: success path, idempotence, refusal to lower, --force. */
export async function prepareDeployment(c: Pick<Ctx, "scratch" | "stack" | "addressesFile" | "deploymentsDir" | "deployBlock" | "log">): Promise<void> {
  const { log } = c
  const args = ["--network", "anvil", "--deployments-dir", c.deploymentsDir]
  const cursor = async () => scalar(`select coalesce(last_block::text,'null') || '|' || coalesce(last_block_hash,'null') from public.indexer_state where chain_id = ${REHEARSAL_CHAIN_ID}`)
  const expected = `${c.deployBlock - 1n}|null`

  log.eq("no indexer_state row for 31337 before prepare", await cursor(), "")
  const first = await launch(c, "prepare-deployment", args, { allowFail: true })
  log.check("prepare-deployment succeeds on the verified record", first.code === 0, first.stderr || first.stdout)
  log.check("it took deployBlock from the record (no --deploy-block passed)", first.stdout.includes(`deployBlock ${c.deployBlock}`), first.stdout)
  log.eq("indexer_state = deployBlock - 1, hash NULL", await cursor(), expected)

  const again = await launch(c, "prepare-deployment", args, { allowFail: true })
  log.check("a second run is a no-op", again.code === 0 && /unchanged/.test(again.stdout), again.stdout)
  log.eq("cursor unchanged after the no-op", await cursor(), expected)

  const disagree = await launch(c, "prepare-deployment", [...args, "--deploy-block", String(c.deployBlock + 5n)], { allowFail: true })
  log.check("--deploy-block disagreeing with the record is refused", disagree.code === 1 && /disagrees with the record/.test(disagree.stderr), disagree.stderr)

  const raised = c.deployBlock + 100n
  await scalar(`update public.indexer_state set last_block = ${raised} where chain_id = ${REHEARSAL_CHAIN_ID} returning 1`)
  const refuse = await launch(c, "prepare-deployment", args, { allowFail: true })
  log.check("refuses to lower an existing last_block without --force (exit 1)", refuse.code === 1 && /refusing to lower/.test(refuse.stderr), `exit ${refuse.code}: ${refuse.stderr}`)
  log.eq("cursor untouched by the refusal", await cursor(), `${raised}|null`)

  const force = await launch(c, "prepare-deployment", [...args, "--force"], { allowFail: true })
  log.check("--force lowers it", force.code === 0, force.stderr)
  log.eq("cursor back at deployBlock - 1", await cursor(), expected)
}
