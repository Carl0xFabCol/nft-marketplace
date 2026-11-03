# Ghost / Unused Code Cleanup Report

Branch: `chore/ghost-code-cleanup`
Starting commit: `49d053c` (`main`)
Scope: `apps/*`, `packages/*`, Docker/CI/config references, monorepo-wide grep + import-graph analysis.

Method for every candidate:
1. Repo-wide search (imports, `require`, dynamic `import()`, string paths, package scripts, Dockerfiles, compose, docs, tsconfig, CI).
2. Reachability graph from real entry points (Next.js app-router files, `proxy.ts`, indexer `src/index.ts`, package scripts, tests).
3. Only deleted when zero live references were found. Doubtful items were kept and are listed under **Manual review**.

---

## Phase 1 — Shared packages

Packages audited: `packages/config`, `packages/shared`, `packages/database`, `packages/contracts` (TS side).
Consumers confirmed: web uses `@marketplace/shared` + `@marketplace/contracts`; indexer uses `@marketplace/shared` + `@marketplace/database` + `@marketplace/contracts`; all packages' `tsconfig.json` extend `packages/config/tsconfig/*`.

| File | Reason | References found | Action |
|---|---|---|---|
| `packages/config/eslint/base.js` | ESLint preset never used; web ships its own `eslint.config.mjs`, indexer has no lint task | 0 | deleted |
| `packages/config/eslint/next.js` | Same as above; requires `next/core-web-vitals` but no consumer | 0 | deleted |
| `packages/config/package.json` | Removed exports for the two deleted presets | consumers use `./tsconfig/*` only | modified |

No whole package was deleted: `config` (tsconfig base/nextjs/node), `shared`, and `database` all have live consumers.
Directory `packages/config/eslint/` was removed after deleting its only contents.

**Phase 1 checks**
- `pnpm --filter @marketplace/shared test` → green (4 tests)
- `pnpm --filter @marketplace/database test` → green (2 tests)
- `pnpm --filter @marketplace/web typecheck` → green
- `pnpm --filter @marketplace/web lint` → green
- `pnpm --filter @marketplace/database typecheck` → **red pre-existing** (missing `@marketplace/shared` dependency link + Supabase client generic mismatch; same before cleanup)

Commit: `1bf5817 chore(shared): remove unused files`

---

## Phase 2 — Indexer (`apps/indexer`)

| File | Reason | References found | Action |
|---|---|---|---|
| `apps/indexer/src/contracts.ts` | Legacy re-export shim kept only until consumers migrated; all consumers already import `@marketplace/contracts` | 0 | deleted |
| `apps/indexer/src/etherscan.ts` | `getDeploymentBlock*` never imported anywhere; no dynamic reference | 0 | deleted |
| `apps/indexer/src/fetchers/index.ts` | Barrel export never imported | 0 | deleted |
| `apps/indexer/src/handlers/index.ts` | Barrel export never imported | 0 | deleted |
| `apps/indexer/src/parsers/IEventParser.ts` | Interface with no implementations or consumers; emptied `parsers/` removed | 0 | deleted |
| `apps/indexer/src/persistence/IRepository.ts` | Interface only re-exported by the unused persistence barrel | 0 direct | deleted |
| `apps/indexer/src/persistence/index.ts` | Barrel export never imported | 0 | deleted |
| `apps/indexer/src/providers/index.ts` | Barrel export never imported | 0 | deleted |
| `apps/indexer/src/providers/test-provider.ts` | Ad-hoc provider smoke script; not in `package.json`, no import/dynamic reference | 0 | deleted |

Dependencies removed from `apps/indexer/package.json`:

| Dependency | Evidence |
|---|---|
| `alchemy-sdk` | 0 imports in `src/` (only README/env examples mention Alchemy URLs) |
| `ts-node` | 0 uses; all scripts/dev use `tsx` |

All other dependencies have live imports (`dotenv`, `p-map`, `pino`, `pino-pretty`, `viem`, `@supabase/supabase-js`; `pino-pretty` is loaded by pino transport at runtime).

**Phase 2 checks**
- `pnpm --filter @marketplace/indexer test` → green (6 files / 28 tests)
- `pnpm --filter @marketplace/indexer exec tsc --noEmit` → **red pre-existing** errors in `packages/database` and `ox` typings; no errors in `apps/indexer/src`, no new errors caused by deletions
- No build script exists in the indexer package (pre-existing; see manual review)

Commit: `c6dbd2e chore(indexer): remove unused files`

---

## Phase 3 — Web frontend (`apps/web`)

| File | Reason | References found | Action |
|---|---|---|---|
| `apps/web/types/collection.types.ts` | Orphan duplicate `Collection` type; superseded by `types/user.types.ts` and `@marketplace/shared` | 0 | deleted |
| `apps/web/public/next.svg` | Default Create-Next-App asset, never referenced | 0 | deleted |
| `apps/web/public/vercel.svg` | Default Create-Next-App asset, never referenced | 0 | deleted |
| `apps/web/public/window.svg` | Default Create-Next-App asset, never referenced | 0 | deleted |
| `apps/web/.turbo/turbo-build.log` | Tracked build artifact, not source | n/a (generated) | deleted |

Kept assets (live references):
- `public/phantom.png` → `app/WalletOptions.tsx`
- `public/metamask.png` → `app/WalletOptions.tsx`
- `public/Hyperliquid_Blob_Green.svg` → `components/ui/HypeIcon.tsx`
- `app/favicon.ico` → Next.js app-router convention + `proxy.ts` matcher

No orphan routes/components/hooks were found by the reachability analysis (Next app-router files treated as roots; `next/dynamic` and `import()` resolved).

Env check: every variable in `.env.example` is read (`NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_PINATA_GATEWAY*`); no unused documented vars.

**Phase 3 checks**
- `pnpm --filter @marketplace/web typecheck` → green
- `pnpm --filter @marketplace/web lint` → green
- `pnpm --filter @marketplace/web build` → green

Commit: `273d31b chore(web): remove unused files`

---

## Phase 4 — Smart contracts (`packages/contracts`)

| File | Reason | References found | Action |
|---|---|---|---|
| `packages/contracts/abi/Marketplace.json` | Duplicate ABI copy; canonical ABIs are `src/abis/*.ts` | 0 | deleted |
| `packages/contracts/abi/MarketplaceBids.json` | Duplicate ABI copy | 0 | deleted |
| `packages/contracts/abi/MarketplaceCore.json` | Duplicate ABI copy | 0 | deleted |
| `packages/contracts/foundry/MarketplaceABI.json` | Not valid JSON (cast table dump), never referenced | 0 | deleted |
| `packages/contracts/foundry/MarketplaceBidsABI.json` | Not valid JSON (cast table dump), never referenced | 0 | deleted |
| `packages/contracts/foundry/MarketplaceCoreABI.json` | Not valid JSON (cast table dump), never referenced | 0 | deleted |
| `packages/contracts/foundry/script/AuthorizeMarketplace.s.sol.bak` | Backup of superseded script (renamed to `.bak` in `bd31fc1`, never compiled) | 0 | deleted |
| `packages/contracts/foundry/script/DeployMarketplace.s.sol.bak` | Backup of superseded Sepolia deploy script; docs use `forge create`, not this script | 0 | deleted |
| `packages/contracts/foundry/script/DeployOnELysium.s.sol.bak` | Backup of superseded Elysium deploy script | 0 | deleted |

Removed empty directory `packages/contracts/abi/`.

Contracts verified as live (not deleted):
- `MarketplaceCore.sol`, `MarketplaceBids.sol`, `Marketplace.sol`, `LaunchPad.sol`, `MERC721.sol` — used by scripts/tests/deployments/indexer config.
- `BoundedStaticCall.sol` — inherited by `MarketplaceCore` and `MarketplaceBids`.
- All test mocks (`MockNFT`, `MockNFTNonERC721`, `MockNFTWithRoyalty`, `MockRevertingNFT`, `MockRevertingRoyaltyNFT`, `MockMalformedReturn`) are imported by `TestSetup.sol` or audit tests.

Live references that prevented deletion (verification catch):
- `packages/contracts/src/abis/nft.abi.ts` and `mock-nft.abi.ts` are re-exported by `apps/web/lib/abi.ts` (`nftAbi`, `MockNFTAbi as MockAbi`). They were briefly removed and immediately restored when `web typecheck` flagged the live reference.

**Phase 4 checks**
- `pnpm --filter @marketplace/contracts test` → green (7 tests)
- `pnpm --filter @marketplace/contracts typecheck` → green
- `forge build` → **red pre-existing**: `Declaration "MiColeccion" not found in "src/MERC721.sol"` (`MERC721.sol` declares `Hyperc`; tests/scripts import `MiColeccion`)
- `forge test` → **red pre-existing**, same compile error
- Reproduced the same `forge build` failure on a clean worktree at pre-cleanup HEAD, proving it is not caused by this cleanup
- `pnpm --filter @marketplace/web build` after restoring the ABIs → green

Commit: `1219efc chore(contracts): remove unused files`

---

## Docker / Compose

| File | Action | Reason |
|---|---|---|
| `docker-compose.yml` | kept | Used for local stack; references both Dockerfiles |
| `apps/web/Dockerfile` | kept | Referenced by `docker-compose.yml` (`web`) |
| `apps/indexer/Dockerfile` | kept | Referenced by `docker-compose.yml` (`indexer`, `indexer-elysium`) |

No Dockerfiles or compose files were deleted.

---

## Dependencies removed

| Area | Dependency | Evidence |
|---|---|---|
| `apps/indexer` | `alchemy-sdk` | 0 imports |
| `apps/indexer` | `ts-node` | 0 uses (runtime scripts use `tsx`) |

Total dependencies removed: **2**.

No dependencies were removed from `packages/*` or `apps/web`: all declared packages have live imports (verified per dependency).

---

## Manual review (kept due to doubt)

| Item | Reason for doubt |
|---|---|
| `packages/shared/src/types/bid.ts`, `nft.ts` and exports `TokenBid`, `CollectionBid`, `CollectionTopBid`, `Collection24hStats`, `CollectionStats`, `EnrichedNFT`, `ActiveListing`, `TopBid`, `ActivityEventType` | No current external consumer, but they form the shared domain-type public API and are re-exported from the package root; removing them is an API change rather than a pure ghost-file deletion |
| `packages/config` subpath exports `@marketplace/shared/types`, `@marketplace/contracts/abis`, `@marketplace/contracts/addresses`, `@marketplace/database/client`, `@marketplace/database/repositories` | No direct subpath consumer today, but the underlying files are live via root barrels; exports may be used by external/private tooling |
| `tsconfig.base.json` (repo root) | Duplicate of `packages/config/tsconfig/base.json` and not extended by any tsconfig, but named in `CONTRIBUTING.md`; kept to avoid breaking documented convention |
| `packages/contracts/foundry/script/TestBroadcast.s.sol` | No references, but a hand-invoked `forge script` utility; kept for manual operator use |
| `packages/contracts/foundry/script/TestDeploy.s.sol` | Scratch deploy script; no code references, but has historical `broadcast/TestDeploy.s.sol/*` records |
| `packages/contracts/foundry/.prettierrc` | No prettier dependency/tooling in repo; could be used by editor tooling |
| `packages/contracts/foundry/.github/workflows/test.yml` | Nested workflow does not run from a package subdirectory on GitHub, but removing CI intent needs an owner decision |
| `packages/contracts/foundry/deployments/latest.json` and `broadcast/**` | Historical deployment records; not code, kept as on-chain history |
| `apps/indexer/src/config/env.ts` `ETHERSCAN_API_KEY` | After deleting `etherscan.ts`, the value is loaded but no consumer uses it; removing an env contract needs an ops decision |
| `apps/indexer/Dockerfile` | Pre-existing packaging issues: calls `pnpm --filter @marketplace/indexer build` (no build script) and copies `packages/config/tsconfig/package.json` (does not exist). Not caused by cleanup; fixing touches build/deploy config |
| `apps/web/Dockerfile` | Pre-existing: copies `packages/config/tsconfig/package.json`, which does not exist |
| `PROGRESS_REPORT.md`, `packages/contracts/foundry/PROGRESS_REPORT.md`, `AUDIT_FIXES.md`, `.kilo/plans/*` | Historical/planning docs, not executable code |

---

## Pre-existing failures (not introduced by this cleanup)

These were present before the branch and are documented so the final state is not misrepresented:

1. `pnpm --filter @marketplace/database typecheck` fails:
   - `@marketplace/shared` is imported but not declared as a dependency of `packages/database`
   - `@supabase/supabase-js` generic mismatch in `packages/database/src/client.ts`
2. `pnpm --filter @marketplace/indexer exec tsc --noEmit` fails on the same `packages/database` errors plus `ox` typings (ES2021 lib / DOM types); no errors in indexer source.
3. `forge build` / `forge test` fail because `packages/contracts/foundry/src/MERC721.sol` declares `contract Hyperc` while tests/scripts import `MiColeccion`. Reproduced on a clean pre-cleanup worktree.
4. Indexer package has `start: node dist/index.js` but no `build` script, and the Dockerfile invokes that missing script.

Fixing any of the above requires touching live business/deployment code, which is outside the "ghost files only" scope.

---

## Summary

| Metric | Count |
|---|---|
| Files deleted | **25** |
| Directories removed | 3 (`packages/config/eslint`, `apps/indexer/src/parsers`, `packages/contracts/abi`) |
| Dependencies removed | **2** (`alchemy-sdk`, `ts-node`) |
| Areas committed | **4** (shared, indexer, web, contracts) |
| Additional report commit | 1 (`docs(cleanup)`) |
| Dockerfiles / compose deleted | 0 |
| Referenced files deleted | 0 (one attempted ABI deletion was reverted after verification) |

Commits:
- `1bf5817 chore(shared): remove unused files`
- `c6dbd2e chore(indexer): remove unused files`
- `273d31b chore(web): remove unused files`
- `1219efc chore(contracts): remove unused files`

Post-cleanup green checks: web build/lint/typecheck, shared test/typecheck, database test, contracts test/typecheck, indexer test.
Blocked (pre-existing, independently reproduced): database/indexer `tsc`, Foundry build/test.
