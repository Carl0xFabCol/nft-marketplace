/**
 * Generate src/abis/*.generated.ts from Foundry artifacts (INTEGRATION_AUDIT §4.4).
 *
 *   forge build                       (in packages/contracts/foundry)
 *   pnpm --filter @marketplace/contracts generate:abis           # write files
 *   pnpm --filter @marketplace/contracts generate:abis --check   # CI gate
 *
 * --check regenerates in memory and exits 1 if any committed file differs.
 * Phase 0: consumers still import the hand-pasted *.abi.ts files; nothing
 * imports the generated bundles yet (switching consumers is Phase 4).
 */
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { diffGenerated, generateAbiFiles } from "./lib/abi"

const PACKAGE_ROOT = path.resolve(__dirname, "..")
const FOUNDRY_ROOT = path.join(PACKAGE_ROOT, "foundry")
const OUT_DIR = path.join(FOUNDRY_ROOT, "out")
const ABIS_DIR = path.join(PACKAGE_ROOT, "src", "abis")

function main(argv: string[]): number {
  const check = argv.includes("--check")
  const generated = generateAbiFiles(FOUNDRY_ROOT, OUT_DIR)

  if (check) {
    const stale = diffGenerated(generated, ABIS_DIR)
    if (stale.length > 0) {
      console.error("✖ Generated ABIs are stale. Run `forge build && pnpm --filter @marketplace/contracts generate:abis`:")
      for (const f of stale) console.error(`  - src/abis/${f}`)
      return 1
    }
    console.log(`✔ ${generated.size} generated ABI files are up to date.`)
    return 0
  }

  mkdirSync(ABIS_DIR, { recursive: true })
  for (const [fileName, content] of generated) {
    writeFileSync(path.join(ABIS_DIR, fileName), content)
    console.log(`  wrote src/abis/${fileName}`)
  }
  return 0
}

try {
  process.exitCode = main(process.argv.slice(2))
} catch (error) {
  console.error(`✖ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
