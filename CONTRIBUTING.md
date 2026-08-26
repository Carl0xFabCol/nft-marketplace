# Contributing to Marketplace

Thank you for your interest in contributing! This document outlines the process
for getting started and the conventions we follow.

---

## Quick Start

```bash
# 1. Fork + clone your fork
git clone https://github.com/<your-username>/marketplace.git
cd marketplace

# 2. Install dependencies
pnpm install

# 3. Set up environment variables
cp apps/web/.env.example apps/web/.env
cp apps/indexer/.env.example apps/indexer/.env

# 4. Start development servers
pnpm dev        # All apps
# or individually:
pnpm dev:web
pnpm dev:indexer

# 5. Run Foundry (if you have it installed)
cd packages/contracts/foundry
forge build
forge test -vvv
```

---

## Repository Structure

```
apps/
├── web/           # Next.js 16 frontend (App Router)
└── indexer/       # Viem-based blockchain indexer

packages/
├── config/        # Shared tsconfig + ESLint configs
├── contracts/     # ABIs, addresses, and Foundry contracts
├── database/      # Supabase client factories + typed repositories
└── shared/        # Domain types + universal constants
```

**Rule of thumb**: New code goes in `packages/` if it's shared across apps,
or in `apps/<app>/` if it's app-specific.

---

## Development Conventions

### Monorepo

- **pnpm workspaces** — all dependencies installed at root, shared packages
  linked automatically via `@marketplace/*`
- **Turborepo** — `pnpm dev` runs all apps in parallel with hot reload
- Run `pnpm build` before opening a PR to ensure all packages compile

### Shared Packages

1. **Domain types** → `packages/shared/src/types/`
   - If you add a new DB column or domain field, update the type here first
2. **ABIs / addresses** → `packages/contracts/src/`
   - Never hardcode contract addresses — import from `@marketplace/contracts`
3. **Repository methods** → `packages/database/src/repositories/`
   - Add new query methods here, not in service classes

### Code Style

- **TypeScript strict mode** is required (`tsconfig.base.json` has `"strict": true`)
- **ESLint + Prettier** — run `pnpm lint` and `pnpm format` before committing
- **Import style**: use package names, not relative paths for cross-package imports
  ```typescript
  // ✅ Good
  import { Collection } from "@marketplace/shared"

  // ❌ Bad
  import { Collection } from "../../../../shared/src/types/collection"
  ```

---

## Smart Contracts

### Foundry Setup

If you don't have Foundry installed:
```bash
curl -L https://foundry.par Detroit.sh | bash
foundryup
```

### Building & Testing

```bash
cd packages/contracts/foundry

# Compile
forge build

# Run all tests (verbose)
forge test -vvv

# Run with gas reporting
forge test --gas-report

# Run specific test
forge test -m testEndToEnd_ListAndBuy

# Format
forge fmt
forge fmt --check  # in CI
```

### Adding a New Contract

1. Create the Solidity file in `packages/contracts/foundry/src/`
2. Add the ABI to `packages/contracts/src/abis/`
3. Add the address to `packages/contracts/src/addresses.ts`
4. Update the constructor in `packages/contracts/foundry/test/TestSetup.sol`
5. Add tests in a new `test/` file

### Adding a New Event Handler (Indexer)

1. Add the event name to `apps/indexer/src/config/contracts.config.ts`
2. Create a handler class in `apps/indexer/src/handlers/`
3. Register it in the factory function (`createCoreEventHandlers` or `createBidsEventHandlers`)
4. Add DB schema migration if a new table/column is needed

---

## Frontend

### Component Structure

```
components/
├── features/       # Feature-organized (nft/, collection/, user/)
├── ui/             # Reusable primitives (Modal, Button, etc.)
└── <shared>.tsx    # AuthProvider, ConnectWallet, Header
```

### Hooks

All blockchain interactions go through custom hooks in `hooks/`:

```typescript
export function useBuy() {
  const { writeContractAsync } = useWriteContract()

  const buy = async (collection, tokenId, value) => {
    return await writeContractAsync({
      address: MARKETPLACE_CONTRACT_ADDRESS,
      abi: MarketplaceABI,
      functionName: "buy",
      args: [collection, tokenId],
      value,
    })
  }

  return { buy }
}
```

### Optimistic Updates

When writing to the blockchain:
1. **Immediately upsert** a pending row into Supabase (`status: "pending"`, `source: "optimistic"`)
2. Send the transaction via `wagmi`
3. The indexer will later detect the confirmed event and update the row

This ensures the UI responds instantly. See `docs/adr/003-optimistic-ui.md`
for the full pattern.

---

## Environment Setup

### Root `.env` files

Each app has its own `.env` file. Templates:

- `apps/web/.env.example`
- `apps/indexer/.env.example`

### Required Environment Variables

#### apps/web/.env

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<walletconnect-project-id>
```

#### apps/indexer/.env

```env
FAST_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<key>
ARCHIVE_RPC_URL=https://eth-sepolia.archive.alchemy.com/v2/<key>
FALLBACK_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
ETHERSCAN_API_KEY=<optional>
```

---

## CI/CD

We use GitHub Actions for testing and linting. See `.github/workflows/` for
details. The CI pipeline should run:

1. `pnpm install`
2. `pnpm build`
3. `pnpm lint`
4. `pnpm typecheck`
5. `forge test` (contracts)
6. `pnpm test` (web)

---

## Pull Request Process

1. **Fork** the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes following the conventions above
4. Run `pnpm lint` and `pnpm format` to fix formatting
5. Add or update tests as needed
6. Run `pnpm build` and `forge test -vvv` to verify everything compiles
7. Commit with a clear message: `feat: add collection page filter`
8. Push to your fork and open a PR

### PR Checklist

- [ ] Code follows existing style and conventions
- [ ] TypeScript compiles without errors (`pnpm typecheck`)
- [ ] ESLint passes (`pnpm lint`)
- [ ] All Foundry tests pass (`forge test -vvv`)
- [ ] Tests added for new contract functions
- [ ] README/docs updated if there are user-facing changes
- [ ] Environment variable changes documented
- [ ] No hardcoded secrets or API keys

---

## Issue Templates

When opening an issue, please include as much detail as possible:

- **Bug report**: What you did, what you expected, what happened, your
  environment (browser, wallet, network)
- **Feature request**: What feature you want, why you need it, and any
  alternatives you considered
- **Question**: Any question about the codebase, architecture, or how to
  contribute

---

## Getting Help

If you get stuck:

1. Read the docs in `docs/` — especially `docs/ARCHITECTURE.md`
2. Check existing issues and discussions on GitHub
3. Ask in the project's Discord/Gitter (link in README)
4. Ping `@carl0xfabcol` on Twitter

---

**License**: MIT — see [LICENSE](LICENSE)
