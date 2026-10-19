# Plan: Docs cleanup + test suite

## Goal
Clean up inconsistent/stale documentation and add a unit test suite to the monorepo, starting with the shared TypeScript packages. LaunchPad improvements are out of scope (lower priority).

## Current state (verified)
- Working tree is clean; latest commit `2691109 feat(contracts): deploy LaunchPad stack on Elysium and update addresses`.
- No test runner configured anywhere: no `vitest`/`jest` config, no `test` script in root or any package (`apps/web`, `apps/indexer`, `packages/{shared,database,contracts,config}`).
- Root `package.json` has `test: "turbo run test"` and `turbo.json` already declares a `test` task (dependsOn `^build`, outputs `coverage/**`).
- Docs problems:
  - Root `README.md` links to non-existent `ARCHITECTURE.md`, `CONTRACTS.md`, `INDEXER.md`, `FRONTEND.md`, `ADR-001`…`ADR-003`; only `docs/{indexer,packages,web-architecture,launchpad-system-tasks}.md` exist.
  - Root README Sepolia deployed-contracts table differs from `packages/contracts/src/addresses.ts`; `addresses.ts` defaults to Elysium (99801), not Sepolia.
  - `apps/web/README.md` is stale content for a different project ("SupNFT mint DApp", references `0xteric/SUP-NFT`, ERC-721 mint/burn, Foundry).
  - `apps/indexer/README.md` references non-existent `packages/database/migrations/`.

## Decisions
1. **Test runner: vitest** — TS-native, lightweight, ESM-friendly, works with the existing `tsx`/tsc setup. Add as devDependency at root and to packages under test.
2. **Docs approach** — repoint root README links to existing `docs/` files; fix the contracts addresses table; replace stale `apps/web/README.md`; fix indexer README migrations reference; flag ADRs as "planned, not written". Do not write new long-form docs in this cycle.
3. **Scope (phase 1)** — packages only: `@marketplace/shared`, `@marketplace/database` (client factories), `@marketplace/contracts` (addresses resolver), then `apps/indexer` utils/parsers/env. Web app (Next.js) tests deferred to phase 2.
4. **Scripts** — add `test` script to root and each tested package; wire into existing turbo `test` task.

## Tasks
### Docs cleanup
1. Root `README.md`:
   - Replace docs table links: Architecture → `docs/web-architecture.md`, Contracts → `docs/packages-architecture.md`, Indexer → `docs/indexer-architecture.md`, Frontend → `docs/web-architecture.md`; mark ADR-001/002/003 as planned.
   - Update Sepolia deployed-contracts table to match `packages/contracts/src/addresses.ts` (SEPOLIA_ADDRESSES) and note default chain is Elysium.
2. `apps/web/README.md` — replace with accurate web app README (Next.js 16, wagmi/viem, Supabase, routes, hooks, env vars).
3. `apps/indexer/README.md` — fix `packages/database/migrations/` reference (migrations are managed via Supabase dashboard, not in repo).

### Test suite
4. Add `vitest` devDependency to root `package.json` and to `packages/shared`, `packages/database`, `packages/contracts`, `apps/indexer`.
5. Add root `vitest.config.ts` (include packages + apps/indexer, exclude `node_modules`, `.next`, `dist`, `foundry`).
6. Add `test: "vitest run"` script to root and each tested package `package.json`.
7. Write initial unit tests:
   - `packages/shared`: `CHAIN_IDS`, `DEFAULT_CHAIN_ID`, `SUPPORTED_CHAIN_IDS`, `ZERO_ADDRESS`, types barrel export.
   - `packages/contracts`: `getContractAddresses` chain resolution, SEPOLIA/ELYSIUM maps, fallback warning.
   - `packages/database`: `createAnonClient` / `createServiceClient` factory behavior (mock `@supabase/supabase-js`).
   - `apps/indexer`: env config validation, utils (logger/retry/BlockRange), parsers.
8. Run `pnpm test`, `pnpm lint`, `pnpm typecheck` and confirm all green.

## Validation
- `pnpm test` exits 0 across all packages with vitest.
- `pnpm lint` and `pnpm typecheck` still pass (no regressions).
- All README links resolve to existing files; contracts table matches `addresses.ts`.

## Open questions (non-blocking)
- Web app (Next.js) unit/component tests: deferred to phase 2 (recommend).
- GitHub Actions CI workflow for `test`/`lint`/`typecheck`: roadmap item, recommend follow-up PR.
