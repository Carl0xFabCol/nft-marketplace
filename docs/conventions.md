# Conventions

## Package Naming

All internal packages are scoped under `@marketplace/`:

| Package name             | Location              |
| ------------------------ | --------------------- |
| `@marketplace/contracts` | `packages/contracts/` |
| `@marketplace/shared`    | `packages/shared/`    |
| `@marketplace/database`  | `packages/database/`  |
| `@marketplace/config`    | `packages/config/`    |
| `@marketplace/web`       | `apps/web/`           |
| `@marketplace/indexer`   | `apps/indexer/`       |

## Rule: Never Hardcode Chain IDs or Addresses

All chain IDs and contract addresses must be imported from their package — never written as literals.

```ts
// ✅ Correct
import { CHAIN_IDS, DEFAULT_CHAIN_ID } from "@marketplace/shared"
import { CORE_CONTRACT_ADDRESS } from "@marketplace/contracts"

// ❌ Wrong — will fail code review
const chainId = 11155111
const coreAddress = "0xAbc..."
```

The only place `11155111` is allowed to appear is `packages/shared/src/constants.ts`.

## Rule: ABI Definitions Belong in packages/contracts

Never copy-paste ABI arrays into `apps/web` or `apps/indexer`. Extend the existing files in `packages/contracts/src/abis/`.

```ts
// ✅ Correct
import { MarketplaceCoreABI } from "@marketplace/contracts"

// ❌ Wrong
const MY_ABI = [{ name: "foo", type: "function", ... }]
```

## Rule: Service-Role Key Must Not Reach the Browser

`packages/database` uses the service-role key and must only be imported by server-side code:

- `apps/indexer` ✅
- Next.js Route Handlers / Server Actions ✅
- Browser-side React components / hooks ❌
- `apps/web/services/*.service.ts` — these use the **anon** client from `lib/supabase/client.ts` ✅

## TypeScript: Extend from Shared Configs

Every new `tsconfig.json` must extend one of the presets in `packages/config/tsconfig/`:

```json
// Next.js app
{ "extends": "../../packages/config/tsconfig/nextjs.json" }

// Node.js service
{ "extends": "../../packages/config/tsconfig/node.json" }
```

## Imports: Path Aliases

Use `@marketplace/*` for cross-package imports:

```ts
import { CHAIN_IDS } from "@marketplace/shared"
import { nftAbi } from "@marketplace/contracts"
```

Use `@/*` for intra-app imports within `apps/web`:

```ts
import { supabase } from "@/lib/supabase/client"
import type { UserData } from "@/types/user.types"
```

## Naming: Services vs Hooks

| Layer        | Location                         | Responsibility                                         |
| ------------ | -------------------------------- | ------------------------------------------------------ |
| **Services** | `apps/web/services/*.service.ts` | Supabase read queries (pure async functions, no React) |
| **Hooks**    | `apps/web/hooks/`                | React Query wrappers + Wagmi write hooks               |

Services must not reference React or any hook. Hooks must not directly call `supabase` — they delegate to services.

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(indexer): add CollectionBidAccepted handler
fix(contracts): correct MarketplaceCoreABI event signature
chore(packages): bump @supabase/supabase-js to 2.90
refactor(web): split hooks/Contract.ts into domain hook files
```

## Adding a New Contract Event

1. Update the ABI in `packages/contracts/src/abis/`
2. Add a handler in `apps/indexer/src/indexer.ts` → `eventHandlers`
3. Add the event name to `CONTRACTS_TO_INDEX` for the correct contract
4. If it affects DB shape: add a migration and update the relevant repository in `packages/database/src/repositories/`

## Adding a New Chain

1. `packages/shared/src/constants.ts` → add to `CHAIN_IDS`
2. `packages/contracts/src/addresses.ts` → add addresses for the new chain
3. `apps/indexer/src/indexer.ts` → parameterise the chain from an env variable
4. `apps/web` → update the Wagmi chain config in providers

## ZERO_ADDRESS

Always import `ZERO_ADDRESS` from `@marketplace/shared`. Do not use string literals.

```ts
import { ZERO_ADDRESS } from "@marketplace/shared"
query.neq("owner_wallet", ZERO_ADDRESS)
```
