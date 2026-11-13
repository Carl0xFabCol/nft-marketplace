import path from "node:path"
import { describe, expect, it } from "vitest"
import { productionFiles, scanProduction, scanText } from "../productionGuard"

const repoRoot = path.resolve(__dirname, "..", "..", "..", "..")

describe("the rehearsal chain never reaches production config", () => {
  it("scans a meaningful set of production files", () => {
    const files = productionFiles(repoRoot).map((f) => path.relative(repoRoot, f).split(path.sep).join("/"))
    expect(files).toContain("packages/shared/src/constants.ts")
    expect(files).toContain("packages/contracts/src/addresses.ts")
    expect(files).toContain("packages/contracts/scripts/lib/addresses.ts")
    expect(files).toContain("apps/indexer/src/config/env.ts")
    expect(files).toContain("apps/indexer/src/providers/chains.ts")
    expect(files).toContain("apps/web/lib/chains.ts")
    expect(files).toContain("apps/web/lib/chainGuard.ts")
    expect(files).toContain("packages/contracts/foundry/script/DeploymentConfig.sol")
    expect(files.some((f) => f.includes("/__tests__/") || f.endsWith(".test.ts"))).toBe(false)
  })

  it("no production file mentions 31337 or an anvil chain/network entry", () => {
    expect(scanProduction(repoRoot)).toEqual([])
  })

  // Mutation check: the scanner must catch the exact edits it guards against.
  it.each([
    ["packages/shared/src/constants.ts", "export const SUPPORTED_CHAIN_IDS: ChainId[] = [CHAIN_IDS.SEPOLIA, CHAIN_IDS.ELYSIUM, 31337]", "31337"],
    ["packages/contracts/scripts/lib/addresses.ts", "  anvil: 31337,", "31337"],
    ["packages/contracts/scripts/lib/addresses.ts", '  anvil: Number(process.env.X),', "anvil"],
    ["apps/indexer/src/providers/chains.ts", "import { anvil } from \"viem/chains\"", "anvil"],
    ["packages/contracts/foundry/script/X.sol", "uint256 constant LOCAL = 31337;", "31337"],
  ])("detects %s: %s", (file, line, rule) => {
    expect(scanText(file, `ok\n${line}\n`).map((h) => h.rule)).toContain(rule)
  })

  it("allows the pre-existing NETWORK=anvil Foundry test target in Solidity", () => {
    expect(scanText("x.sol", 'if (nameHash == keccak256(bytes("anvil"))) {')).toEqual([])
  })
})
