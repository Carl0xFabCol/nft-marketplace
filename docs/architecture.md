# Architecture

## Monorepo Layout

```
marketplace/                        ← pnpm workspace root
├── apps/
│   ├── web/                        ← Next.js 16 frontend
│   └── indexer/                    ← Viem-based blockchain event indexer
├── packages/
│   ├── contracts/                  ← SINGLE SOURCE OF TRUTH for ABIs & addresses
│   ├── shared/                     ← Domain types + universal constants
│   ├── database/                   ← Supabase client factory + typed repositories
│   └── config/                     ← Shared tsconfig presets + ESLint configs
├── docs/
├── turbo.json                      ← Turborepo pipeline
├── pnpm-workspace.yaml             ← Workspace root (the ONLY workspace file)
└── tsconfig.base.json              ← Root path aliases (@marketplace/*)
```

## Package Dependency Graph

```
apps/web  ──depends on──▶  packages/contracts
apps/web  ──depends on──▶  packages/shared
apps/web  ──depends on──▶  (Supabase JS SDK directly — no packages/database)

apps/indexer  ──depends on──▶  packages/contracts
apps/indexer  ──depends on──▶  packages/shared
apps/indexer  ──depends on──▶  packages/database  (service-role client)

packages/database  ──depends on──▶  packages/shared  (domain types)
packages/contracts ──no internal deps──
packages/shared    ──no internal deps──
packages/config    ──no internal deps──
```

apps/web uses the Supabase JS anon-key client directly (server-side via `@supabase/ssr`)
and does NOT import `packages/database` to avoid shipping the service-role key to the browser.

## packages/contracts

Single source of truth for:

- All contract ABIs (split by contract: `marketplace-core`, `marketplace-bids`, `nft`, `mock-nft`)
- Deployed contract addresses per network

### Exports

```ts
import { MarketplaceCoreABI, MarketplaceBidsABI, nftAbi, MockNFTAbi } from "@marketplace/contracts"
import { CORE_CONTRACT_ADDRESS, BIDS_CONTRACT_ADDRESS, MARKETPLACE_CONTRACT_ADDRESS } from "@marketplace/contracts"
```

## packages/shared

Universal constants and domain TypeScript types used by every package and app.

### Exports

```ts
import { CHAIN_IDS, DEFAULT_CHAIN_ID, ZERO_ADDRESS } from "@marketplace/shared"
import type { NFT, Listing, Bid, Collection, Activity } from "@marketplace/shared"
```

### Key constants

| Constant            | Value               | Description                                  |
| ------------------- | ------------------- | -------------------------------------------- |
| `CHAIN_IDS.SEPOLIA` | `11155111`          | Sepolia testnet ID — only place to change it |
| `DEFAULT_CHAIN_ID`  | `CHAIN_IDS.SEPOLIA` | Default chain for queries                    |
| `ZERO_ADDRESS`      | `"0x000...000"`     | EVM zero address                             |

## packages/database

Node-only (server-side) Supabase abstraction.

- `createServiceClient()` — creates a Supabase client using the service-role key
- Typed repositories: `ListingsRepo`, `CollectionsRepo`, `ActivityRepo`
- **Never import this from apps/web** — the service-role key must not reach the browser.

## packages/config

Shared tooling configuration:

- `tsconfig/base.json` — strict TypeScript base
- `tsconfig/nextjs.json` — Next.js preset (extends base)
- `tsconfig/node.json` — Node.js preset (extends base)
- `eslint/base.js` — base ESLint rules
- `eslint/next.js` — Next.js ESLint rules

## apps/web

Next.js 16 (App Router) marketplace frontend.

### Key directories

```
apps/web/
├── app/                  ← Next.js App Router pages & layouts
├── components/           ← React components
├── hooks/                ← React Query + Wagmi hooks
│   └── Contract.ts       ← Wagmi write hooks (TODO: split into domain files)
├── services/             ← Supabase read services (anon key)
│   ├── nft.service.ts
│   ├── collections.service.ts
│   └── user.service.ts
├── lib/
│   ├── abi.ts            ← Re-export shim → @marketplace/contracts
│   ├── constants.ts      ← Re-exports addresses + UI-layer types
│   └── supabase/         ← Browser + server Supabase clients (anon key)
└── types/                ← Web-specific types (user.types.ts)
```

### lib/abi.ts

This file previously contained ~1100 lines of duplicated ABI definitions.
It is now a thin re-export shim. **Do not add ABI definitions here.**

### lib/constants.ts

Contract addresses are re-exported from `@marketplace/contracts`.
**Do not hardcode addresses here.**

## apps/indexer

Node.js process that listens to Sepolia events using Viem's `getContractEvents`.

- Polls in a loop, storing last indexed block in `indexer_state` table
- Uses `packages/database` (service-role key) for all DB writes
- Uses `packages/contracts` for ABIs and addresses
- Uses `packages/shared` for `CHAIN_IDS.SEPOLIA` (no hardcoded `11155111`)

### Known limitations

- `hooks/Contract.ts` in apps/web is a 700+ line god-file — **planned for decomposition** into domain hooks (`useListingHooks`, `useBidHooks`, `useApprovalHooks`)
- The indexer runs as a simple polling loop — a queue-based architecture (e.g. BullMQ) is planned for production
- No test coverage yet

## Adding a New Chain

1. Add the chain ID to `packages/shared/src/constants.ts` → `CHAIN_IDS`
2. Add deployed contract addresses to `packages/contracts/src/addresses.ts`
3. Update `apps/indexer/src/indexer.ts` to accept a `chain` env variable
4. Update `apps/web` chain config in providers

## Environment Variables

| Variable                        | Where        | Required |
| ------------------------------- | ------------ | -------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | apps/web     | ✅       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | apps/web     | ✅       |
| `SUPABASE_SERVICE_KEY`          | apps/indexer | ✅       |
| `RPC_URL`                       | apps/indexer | ✅       |
| `ETHERSCAN_API_KEY`             | apps/indexer | optional |
