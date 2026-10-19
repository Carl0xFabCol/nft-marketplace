# @marketplace/web — Next.js Marketplace Frontend

The user-facing marketplace. Reads marketplace data from Supabase (populated by `apps/indexer`) for fast reads, and writes to smart contracts via wagmi/viem. Built with Next.js 16 App Router.

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Web3**: Wagmi, Viem, React Query
- **Database**: Supabase (PostgreSQL + Realtime)
- **Styling**: Tailwind CSS
- **Language**: TypeScript
- **Auth**: JWT-based wallet authentication (`/api/auth/nonce`, `/api/auth/login`)

## Routes

| Route | Description |
|-------|-------------|
| `/` | Home — top collections by volume |
| `/collections` | Collections listing |
| `/collection/[colAddress]` | Collection detail |
| `/collection/[colAddress]/[tokenId]` | NFT detail |
| `/user/[userAddress]` | User profile / dashboard |
| `/launchpad` | Collection registration UI |

## Key files

- `app/layout.tsx` — root layout with providers
- `app/providers.tsx` — Wagmi, QueryClient, Auth providers
- `hooks/` — contract reads/writes and realtime subscriptions
- `services/` — Supabase data-fetching layer
- `actions/listings/` — server actions for optimistic listing creation
- `lib/supabase/` — Supabase client factory (browser/server/admin)

## Environment variables (`apps/web/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Public anon key for browser client |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Admin key for server-side operations |

## Scripts

- `pnpm dev` — dev server
- `pnpm build` — production build
- `pnpm start` — start production server
- `pnpm lint` — ESLint
- `pnpm typecheck` — TypeScript check
- `pnpm update-types` — regenerate Supabase types
