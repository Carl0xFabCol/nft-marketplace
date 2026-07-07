# 🔍 NFT Marketplace — Principal Architecture Audit

**Auditor role**: Principal Software Architect review of `apps/web` (Next.js 15/16 App Router, React 19, wagmi/viem, Supabase).
**Scope**: `app/`, `actions/`, `components/`, `lib/`, `hooks/`, `context/`, `app/api/`, `services/`.

---

## 1. Project Health Score & Executive Summary

### Score: **4/10** — Not production-ready

| Dimension        | Score | Notes                                                                                                          |
| ---------------- | ----- | -------------------------------------------------------------------------------------------------------------- |
| Architecture     | 3/10  | Server/Client boundary is fundamentally broken in one write path                                               |
| Data consistency | 3/10  | Dual-write (Action → fetch → API Route → Supabase) with no transactional guarantee                             |
| Auth             | 3/10  | Session forwarded via magic cookie string; fragile, easy to break with `secure`/`sameSite`/absolute-URL issues |
| State management | 4/10  | `TxContext` is a reasonable idea but not integrated with server cache invalidation                             |
| DX / type-safety | 5/10  | Decent use of TS overall, but `any` leaks in the hot paths (Contract.ts, UserListCard)                         |
| Code org         | 6/10  | The monorepo/package split (`packages/contracts`, `shared`, `database`) is genuinely good and well documented  |

**Paragraph 1 — Systemic Risk #1 (Server Action Anti-pattern):**
`actions/listings/createSingle.ts` is a Server Action that accepts `writeContractAsync`, `publicClient`, and React state setters (`addTx`, `updateTx`, `removeTx`) as parameters. These are client-only, non-serializable closures. Because Server Actions are serialized across the RSC boundary, passing a function reference triggers Next.js's "Cannot pass functions to Server Actions... temporary Client Reference" runtime error, or silently no-ops depending on the Next version. This isn't a style nit — it is a **hard runtime crash waiting to happen** the moment `createListing` (as opposed to `saveBatchListingToDB`) is actually wired into a client component. The team already partially fixed this in the batch flow (`createBatch.ts` no longer takes these params), but `createSingle.ts` was left behind, and `UserListCard.tsx` imports it (line 16) even though it doesn't call it directly today — it's a ticking time bomb for the next developer who wires up single-item listing.

**Paragraph 2 — Systemic Risk #2 (Redundant persistence hops + auth duplication):**
Every mutation currently makes **three network hops**: Client → Server Action → `fetch(baseUrl + "/api/listings/...")` → Supabase. Each hop re-derives the session independently (`getSession()` is called in the Action AND again inside the Route Handler), and the Action manually re-serializes the cookie as a raw header string (`Cookie: sb-access-token=...`). This is why 401s appear intermittently: if `NEXT_PUBLIC_APP_URL` is unset/wrong in a given environment, `fetch` silently hits the wrong host; if the cookie name/format changes (e.g., Supabase's chunked cookies for large JWTs — `sb-access-token.0`, `sb-access-token.1`), the manual reconstruction breaks silently. There is **no reason for this indirection** — the Action already runs on the server, colocated with a Supabase server client. It should call Supabase directly. The 500s in `optimistic/route.ts` also point to a real data bug (see Phase 0, item 3).

**Paragraph 3 — Systemic Risk #3 (No unified transaction lifecycle):**
Optimistic writes, blockchain confirmation, and DB "confirmed" status are three independent state machines that are only loosely stitched together with `setTimeout`, a 5-attempt polling loop with fixed 500ms delays (`confirm/route.ts`), and client-only `TxContext`. There is no `revalidatePath`/`revalidateTag` anywhere in the codebase — the UI is left to `window.location.reload()` (see `NftActions.tsx` lines 76, 127) as the cache invalidation strategy. This works for a demo, not for production: it destroys client state, kills perceived performance, and cannot scale to multi-tab or realtime scenarios that `useRealtimeListings.ts` was clearly meant to support but is unfinished (its `payload` handler is empty).

---

## 2. Critical Bugs & Immediate Blockers (Phase 0 — Fix NOW)

### 🔴 2.1 — Non-serializable arguments passed into a Server Action

**File**: `apps/web/actions/listings/createSingle.ts` (lines 17–23, 25)

```ts
interface ListingInput {
  ...
  writeContractAsync: (args: any) => Promise<`0x${string}`>
  publicClient: any
  addTx: (tx: TxItem) => void
  updateTx: (hash: string, update: Partial<TxItem>) => void
  removeTx: (hash: `0x${string}`) => void
}

export async function createListing({ ..., writeContractAsync, publicClient, addTx, updateTx, removeTx }: ListingInput) {
```

**Why it breaks**: Server Actions are invoked via an RPC-like mechanism (`ACTION` POST). All arguments must be JSON-serializable. Functions cannot cross this boundary. Even if this doesn't throw immediately in dev (Next sometimes silently drops or errors depending on version), it will throw `Error: Functions cannot be passed directly to Client Components / Server Actions unless you explicitly expose it...` the moment it's called from a real client component.

**Fix — step by step**:

1. Delete `createSingle.ts` entirely and replace with a pure server action that ONLY receives serializable primitives (mirrors `createBatch.ts`'s `saveBatchListingToDB` shape but for a single item — or just call the batch action with 1-length arrays and delete the single variant).
2. Move `writeContractAsync` + `publicClient.waitForTransactionReceipt` calls into the client component (`UserListCard.tsx` already does this correctly for batch — reuse that pattern).
3. The Action's only job: **persist state to DB**, given already-mined data (`txHash`, `tokenId`, `price`, etc.) — never orchestrate the chain call.

```ts
// actions/listings/createSingle.ts (fixed)
"use server"
import { Address } from "viem"
import { getServerSupabase } from "@/lib/supabase/server"

export async function saveSingleListingToDB(data: { txHash: `0x${string}`; collection: Address; tokenId: string; price: string; seller: Address; chainId: number; expiresAt: string }) {
  const supabase = await getServerSupabase() // cookies() handled inside, RLS-scoped
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const { error } = await supabase.from("listings").upsert(
    {
      tx_hash: data.txHash,
      collection_address: data.collection.toLowerCase(),
      listing_id: `${data.collection.toLowerCase()}-${data.tokenId}`,
      token_id: data.tokenId,
      seller_wallet: data.seller.toLowerCase(),
      price: data.price,
      chain_id: data.chainId,
      is_active: true,
      status: "pending",
      source: "optimistic",
      expires_at: new Date(Number(data.expiresAt) * 1000),
    },
    { onConflict: "listing_id" },
  )

  if (error) throw new Error(error.message)
  revalidatePath(`/user/${data.seller}`) // see Phase 3
}
```

### 🔴 2.2 — Duplicated write path (Action → internal `fetch` → API route)

**Files**: `actions/listings/createBatch.ts`, `actions/listings/createSingle.ts`, `app/api/listings/optimistic/route.ts`, `app/api/listings/confirm/route.ts`, `app/api/listings/fail/route.ts`

```ts
const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
await fetch(`${baseUrl}/api/listings/optimistic`, { ... })
```

**Why it breaks**: A Server Action making an HTTP call back into its own Next.js server is a classic **self-fetch anti-pattern**. It:

- Doubles latency (2 server round-trips instead of 1 in-process call).
- Depends on `NEXT_PUBLIC_APP_URL` being correctly set per-environment (Vercel preview URLs, Docker internal networking, etc. — a common source of "works locally, 500s in prod").
- Forces manual cookie re-forwarding (fragile — breaks with Supabase's chunked cookie names on large JWTs, breaks if `secure`/`sameSite` attributes prevent the cookie from being readable this way, breaks if `NextResponse` sets `httpOnly` in a way `fetch` under the hood mishandles).
- The Action already ran `getSession()` — then the API route calls `getSession()` _again_ independently. Two auth checks for one intent, and if the token expired in the few ms between hops, the second call 401s.

**Fix — step by step**:

1. Delete `app/api/listings/optimistic`, `confirm`, `fail` routes entirely.
2. Move their Supabase logic directly into the Server Actions as plain async functions (no HTTP).
3. Standardize on ONE Supabase server client factory (`lib/supabase/server.ts`, using `@supabase/ssr`'s `createServerClient` with `cookies()`), used by every action. This automatically respects RLS with the _user's_ JWT — no need to manually construct `createClient(...)` with a manually-extracted Bearer token in 3 different files (currently duplicated in `optimistic/route.ts` and `confirm/route.ts`).
4. Only keep genuine **external-facing** API routes (e.g., ones intended to be called by the indexer service, webhooks, or 3rd parties) as Route Handlers. Everything else invoked exclusively from your own client components → Server Action.

### 🔴 2.3 — Race condition / data bug in `optimistic/route.ts`

**File**: `apps/web/app/api/listings/optimistic/route.ts` line 37

```ts
expires_at: new Date(Number(expiresAts[i]) * 1000) || null,
```

`new Date(...)` is always a truthy object (even `Invalid Date`), so `|| null` **never triggers** — if `expiresAts[i]` is `"0"` (no expiration, as sent from `UserListCard.tsx` line 136: `BigInt(0)` when `expiresAt` is falsy), you get `new Date(0)` → **Jan 1, 1970**, not "no expiry." Every listing with no explicit expiration is silently written as already-expired. This is a **critical data-correctness bug** shipping actual bad rows to production.

**Fix**:

```ts
expires_at: expiresAts[i] && Number(expiresAts[i]) > 0
  ? new Date(Number(expiresAts[i]) * 1000).toISOString()
  : null,
```

And make the same fix wherever `expiresAt`/`expiresAts` are converted (`createSingle.ts`, `createBatch.ts` callers).

### 🔴 2.4 — Fire-and-forget mutations with swallowed errors

**File**: `apps/web/actions/listings/createSingle.ts` lines 71, 83, 93

```ts
await fetch("/api/listings/optimistic", {...}).catch((err) => console.error("Optimistic write failed", err))
```

A relative URL (`"/api/listings/optimistic"`) used inside a **Server Action** (server-side `fetch`) has **no origin to resolve against** — this will throw `TypeError: Failed to parse URL` on the server (Node's `fetch` requires absolute URLs), not silently fail as it might on the client. This is inconsistent with `createBatch.ts` which correctly builds an absolute `baseUrl`. This single line alone will crash every single listing attempt that goes through `createListing`.

**Fix**: Moot once 2.1/2.2 are fixed (no more internal fetches at all). If kept temporarily, must use an absolute URL and non-swallowed errors that propagate to the client so the optimistic UI doesn't lie about success.

### 🔴 2.5 — `console.log(session)` leaking JWT payloads to server logs

**File**: `apps/web/actions/listings/createBatch.ts` line 19

```ts
console.log(session)
```

This logs the full decoded JWT (including `token`) to server logs on every batch listing. In production (Vercel/CloudWatch/etc.) these logs are often retained and accessible to more people than should see raw session tokens. **Remove immediately.** Audit the codebase for other `console.log(session)` / `console.log(token)` occurrences (found similarly risky patterns in `optimistic/route.ts` debug log of `expiresAts`).

### 🔴 2.6 — `AuthProvider` session/`getSession()` mismatch (root cause of your 401s)

**Files**: `apps/web/components/AuthProvider.tsx`, `apps/web/lib/auth/session.ts`

```ts
// AuthProvider.tsx — CLIENT
supabase.auth.getSession().then(({ data }) => setSession(data.session))
```

```ts
// lib/auth/session.ts — SERVER
const token = cookieStore.get("sb-access-token")?.value
```

The client-side Supabase JS SDK (`@supabase/supabase-js`, not `@supabase/ssr`) stores sessions in **`localStorage`** by default, not in cookies named `sb-access-token`. Unless you've explicitly configured a custom `storage` adapter that also writes to cookies (not shown anywhere in the files inspected), `getSession()` on the server will almost always return `null` because the cookie was never set client-side in the first place — **this is very likely your exact 401 bug.** The two auth contexts (client `AuthProvider` and server `getSession`) are running on **two entirely separate session stores**.

**Fix — step by step**:

1. Replace `@supabase/supabase-js` on the client with `@supabase/ssr`'s `createBrowserClient`, which is designed to sync auth state to cookies so the server can read it.
2. Replace `AuthProvider.tsx`'s manual `useState`/`useEffect` session tracking with the `@supabase/ssr` pattern, or at minimum ensure `createBrowserClient` from `@supabase/ssr` is what's exported from `lib/supabase/client.ts` (need to verify — flagged for follow-up).
3. Replace `lib/auth/session.ts`'s manual cookie-name + custom JWT verification (`verifySupabaseJWT`) with `@supabase/ssr`'s `createServerClient(...).auth.getUser()`, which handles the cookie chunking/naming Supabase actually uses (`sb-<project-ref>-auth-token`, potentially chunked as `.0`, `.1`, etc.) — hand-rolling this is fragile and is the direct cause of brittle auth described in the task.

---

## 3. Architectural Anti-patterns (Phase 1 — Redesign)

### 3.1 Server Action vs. API Route Strategy — **Recommendation: Actions-only for mutations**

| Use case                                              | Current                                                                                                            | Recommended                                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| DB writes triggered by user (listings, bids, cancels) | Server Action → `fetch` → Route Handler → Supabase                                                                 | Server Action → Supabase (direct)                                                                         |
| Reading data for SSR pages                            | `services/*.service.ts` (correct, no hook)                                                                         | Keep as-is                                                                                                |
| Reading data on client                                | React Query + services via API-less server component prefetch, or a thin `/api` GET if truly needed by 3rd parties | Keep API routes ONLY for: webhooks (Stripe-like), the indexer's callback if any, public REST-style access |
| Auth callback (`/api/auth/*`)                         | Route Handler (correct — OAuth callback needs to be a real HTTP endpoint)                                          | Keep                                                                                                      |

**Rule of thumb going forward**: _If the only caller of an endpoint is your own client component, it should be a Server Action, not a Route Handler._ Route Handlers exist for: things the browser navigates to directly (OAuth redirects), things called by external systems, or things needing streaming/non-JSON responses.

### 3.2 Client/Server Separation — Strict contract

**Server Actions may only accept:**

- Primitives, strings, numbers, plain objects/arrays of the above.
- ❌ Never: functions, class instances, wagmi hook return values, React state setters, `PublicClient` instances.

**Client hooks own:**

- `useWriteContract`, `usePublicClient`, `waitForTransactionReceipt` — i.e., anything blockchain-write related always stays client-side, because the user's wallet must sign it.
- The client component orchestrates: `sign → get hash → call Server Action(hash, ...serializable data) → await receipt → call Server Action(hash) to confirm`.

This is _exactly_ the pattern already correctly implemented in `UserListCard.tsx` (`handleList`) — that file should be the template, and `createSingle.ts` should be rewritten (or deleted) to match it, not the other way around.

### 3.3 Auth Strategy — Direct server-side session, no manual header forwarding

Replace the current flow:

```
Action calls getSession() → manually builds Cookie header → fetch() → Route Handler calls getSession() again → manually builds new Supabase client with Bearer token
```

with:

```ts
// lib/supabase/server.ts
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

export async function getServerSupabase() {
  const cookieStore = await cookies()
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
    },
  })
}
```

```ts
// actions/listings/createBatch.ts (fixed)
"use server"
import { getServerSupabase } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

export async function saveBatchListingToDB(data: BatchListingData) {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const rows = data.tokenIds.map((tokenId, i) => ({
    tx_hash: data.txHash,
    collection_address: data.collections[i].toLowerCase(),
    listing_id: `${data.collections[i].toLowerCase()}-${tokenId}`,
    token_id: tokenId,
    seller_wallet: data.seller.toLowerCase(),
    price: data.prices[i],
    chain_id: data.chainId,
    is_active: true,
    status: "pending",
    source: "optimistic",
    expires_at: Number(data.expiresAts[i]) > 0 ? new Date(Number(data.expiresAts[i]) * 1000).toISOString() : null,
  }))

  const { error } = await supabase.from("listings").upsert(rows, { onConflict: "listing_id" })
  if (error) throw new Error(error.message)

  revalidatePath(`/user/${data.seller}`)
}

export async function confirmBatchListing(txHash: `0x${string}`) {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const { error } = await supabase.from("listings").update({ status: "confirmed" }).eq("tx_hash", txHash)

  if (error) throw new Error(error.message)
  revalidatePath("/user/[address]", "page")
}
```

No `fetch`, no manual `Cookie:` header, no duplicated auth check, no `NEXT_PUBLIC_APP_URL` dependency, one auth check instead of two, and `revalidatePath` finally ties the mutation to cache invalidation.

**Note on RLS**: this assumes your `listings` table's RLS policy allows `seller_wallet = auth.jwt() ->> 'wallet_address'` (or similar wallet-to-user mapping) — this needs to be confirmed with your Supabase policies. If wallet addresses aren't tied to Supabase `auth.uid()` directly, you'll need a `profiles` table mapping `user_id → wallet_address` and RLS policies (`USING (seller_wallet IN (SELECT wallet_address FROM profiles WHERE id = auth.uid()))`).

---

## 4. Code Organization & Modularity (Phase 2 — Structure)

The repo already has a good bones — a real monorepo with `packages/contracts|shared|database|config` and clear docs (`docs/architecture.md`, `docs/conventions.md`). The problem is **inside `apps/web`**, not at the monorepo level.

### Current issues

- `hooks/Contract.ts` is a flagged 400+ line god-file mixing mint/list/bid/cancel/approve hooks (already known — see `docs/architecture.md` line 136).
- `actions/listings/*` mixes DB-persistence concerns with (formerly) chain-write orchestration.
- No `types/` separation between DB row shapes (`UserListing`, from `types/user.types.ts`) and domain models from `@marketplace/shared` (`Listing`) — risk of drift between the two.
- Components mix presentational and container responsibilities in single files (`UserListCard.tsx` — 428 lines doing data-fetching, business math (fees/royalties), AND rendering).

### Recommended structure (feature-sliced, incremental — no big-bang rewrite)

```
apps/web/
├── app/                        # routes only — thin, delegate to features
├── features/
│   ├── listings/
│   │   ├── actions.ts          # "use server" — only serializable I/O
│   │   ├── hooks.ts            # useCreateListing() – orchestrates wagmi + action
│   │   ├── components/
│   │   │   ├── UserListCard.tsx        # container (state, handlers)
│   │   │   └── UserListCard.view.tsx   # presentational (pure JSX)
│   │   └── types.ts
│   ├── bids/
│   │   ├── actions.ts
│   │   ├── hooks.ts
│   │   └── components/
│   └── nft-actions/
│       ├── hooks.ts             # useBuy, useCancelList, etc (from Contract.ts split)
│       └── components/NftActions.tsx
├── hooks/                       # TRULY cross-feature hooks only (useMarketplaceInfo, useAuth)
├── services/                    # unchanged — good as-is (read-only, Supabase anon)
├── lib/                         # unchanged — good as-is
└── types/                       # shared UI-facing types only
```

Split `hooks/Contract.ts` into:

- `features/listings/hooks.ts` → `useCreateListing`, `useCancelList`
- `features/bids/hooks.ts` → `useBidToken`, `useBidTokenBatch`, `useBidCollection`
- `features/nft/hooks.ts` → `useMint`, `useBuy`, `useApproval`

This is exactly what `docs/architecture.md` already flags as planned ("TODO: split into domain hooks") — this audit confirms it should be prioritized, not deferred.

---

## 5. State Management & Data Fetching (Phase 3 — Performance)

### 5.1 `useEffect` + `fetch` vs React Query

Good news: `hooks/useUserData.ts` already correctly uses `@tanstack/react-query`. Bad news: it's inconsistent — `hooks/useRealtimeListings.ts` uses raw `useEffect` + Supabase realtime with an **empty handler** (`// Update state` — literally a no-op comment, dead code), and several components (`NftActions.tsx`) call `window.location.reload()` instead of invalidating a query cache.

**Fix**: Wire `useRealtimeListings` into React Query's cache directly:

```ts
export function useRealtimeListings(userAddress: Address) {
  const queryClient = useQueryClient()

  useEffect(() => {
    const channel = supabase
      .channel("listings")
      .on("postgres_changes", { event: "*", schema: "public", table: "listings", filter: `seller_wallet=eq.${userAddress}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["user", userAddress] })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userAddress, queryClient])
}
```

And replace `window.location.reload()` in `NftActions.tsx` (lines 76, 127) with `queryClient.invalidateQueries(...)` scoped to the relevant NFT/listing query key.

### 5.2 `TxContext` critique

`TxContext` (Context + `useState`) is fine for a small, ephemeral, purely-client "toast list" of pending transactions — no need to over-engineer with Zustand/Jotai _just for this_. The actual problem isn't the state library, it's that **`TxContext` has zero relationship to server cache state**. Recommendation:

- Keep `TxContext` for the UI toast list (low risk, it's not shared across many components, doesn't need selectors).
- On `status: "success"`, call `queryClient.invalidateQueries` (or better, `queryClient.setQueryData` for a true optimistic merge) instead of manual `setTimeout` + full reloads.
- If transaction state needs to be read from many unrelated component trees (e.g., a global header tx-badge + a page-level banner + a modal), _then_ consider Zustand — but that's a "when it hurts" migration, not urgent.

### 5.3 Cache invalidation

Currently: **zero** `revalidatePath`/`revalidateTag` calls found anywhere in `actions/`. This must be added to every mutating Server Action (see 3.3 code sample). Additionally tag your data fetches:

```ts
// services/user.service.ts consumers (server components)
fetch(url, { next: { tags: [`user-${address}`] } }) // or use unstable_cache with tags
```

```ts
// after mutation
revalidateTag(`user-${seller}`)
```

---

## 6. Developer Experience & Configuration (Phase 4 — DX)

### 6.1 `any` leaks

Found in:

- `hooks/Contract.ts` — `_tokens: any`, several `args: any`
- `components/features/user/UserListCard.tsx` line 38 — `const [listItems, setListItems] = useState<any[]>(items)` (should be `ListItemWithPrice[]`), line 109/222 `colData as any`, `getCollectionData(...): any`
- `actions/listings/createSingle.ts` — `writeContractAsync: (args: any) => ...`, `publicClient: any`
- `components/AuthProvider.tsx` — `useState<{session: any} | null>` — session should be typed via `import type { Session } from "@supabase/supabase-js"`

**Fix**: Enable stricter root `tsconfig` (extends `packages/config/tsconfig/nextjs.json` per convention — verify it sets these):

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

Add an ESLint rule to fail CI on new `any`:

```js
"@typescript-eslint/no-explicit-any": "error"
```

(with a scoped `// eslint-disable-next-line` allowance list for the current debt, tracked as tech-debt tickets.)

### 6.2 ESLint rules for `"use client"` / `"use server"`

Add to `packages/config/eslint/next.js`:

```js
rules: {
  "@next/next/no-server-import-in-page": "error",
  // Custom rule (via eslint-plugin-react-server-components or manual):
  // forbid importing wagmi hooks inside files starting with "use server"
}
```

Practically: add a lightweight custom lint script (or a `// AUDIT:` grep in CI) that fails the build if any file containing `"use server"` also imports from `wagmi` — this single rule would have caught the `createSingle.ts` bug before merge.

### 6.3 Environment variable validation

No `.env` schema validation found. Add `lib/env.ts` using Zod:

```ts
import { z } from "zod"

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(), // should become unnecessary after Phase 0 fixes
})

export const env = envSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
})
```

This fails fast at build/boot time instead of producing confusing runtime 500s when a var is misspelled or missing.

---

## 7. Final Phased Roadmap

| Phase | Priority | Task                                                                                                                                                        | Effort  | Risk                                                                          |
| ----- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------- | --- | ---- |
| 0     | Critical | Fix `createSingle.ts` — remove non-serializable args from Server Action                                                                                     | 2h      | High                                                                          |
| 0     | Critical | Fix auth: migrate to `@supabase/ssr` (`createBrowserClient`/`createServerClient`) so client session cookie matches what `getSession()`/server actions read  | 4h      | High                                                                          |
| 0     | Critical | Fix `expires_at` bug (`new Date(...) \|\| null` never falsy) in `optimistic/route.ts` + all callers                                                         | 1h      | High                                                                          |
| 0     | Critical | Remove `console.log(session)` and audit for other token/session logging                                                                                     | 30m     | Med                                                                           |
| 0     | Critical | Fix relative `fetch("/api/...")` inside Server Action (`createSingle.ts`) — invalid on server                                                               | 30m     | High                                                                          |
| 1     | Critical | Eliminate internal API routes (`/api/listings/optimistic                                                                                                    | confirm | fail`) — move logic directly into Server Actions using server Supabase client | 1d  | High |
| 1     | High     | Standardize one `getServerSupabase()` factory (RLS-scoped, cookie-based) — remove duplicated `createClient(...)` + Bearer-token pattern from route handlers | 4h      | Med                                                                           |
| 1     | High     | Add `revalidatePath`/`revalidateTag` to every mutating Server Action                                                                                        | 3h      | Med                                                                           |
| 1     | High     | Delete/rewrite `createSingle.ts` to mirror the correct `createBatch.ts`/`UserListCard.tsx` pattern                                                          | 3h      | Med                                                                           |
| 2     | Medium   | Split `hooks/Contract.ts` into domain files (`listings`, `bids`, `nft`)                                                                                     | 1d      | Low                                                                           |
| 2     | Medium   | Restructure `apps/web` into feature-sliced folders (`features/listings`, `features/bids`, etc.)                                                             | 2d      | Low                                                                           |
| 2     | Medium   | Split container/presentational responsibilities in `UserListCard.tsx` (428 lines)                                                                           | 4h      | Low                                                                           |
| 3     | Medium   | Wire `useRealtimeListings` into React Query cache invalidation (currently dead/no-op)                                                                       | 2h      | Low                                                                           |
| 3     | Medium   | Replace `window.location.reload()` calls in `NftActions.tsx` with query invalidation                                                                        | 2h      | Low                                                                           |
| 3     | Low      | Evaluate Zustand only if `TxContext` needs to be read from unrelated trees beyond the toast list                                                            | —       | Low                                                                           |
| 4     | Medium   | Enable strict TS flags (`noImplicitAny`, `noUncheckedIndexedAccess`) + fix resulting `any` leaks                                                            | 1d      | Low                                                                           |
| 4     | Medium   | Add ESLint rule / CI check forbidding `wagmi`/client-only imports inside `"use server"` files                                                               | 3h      | Low                                                                           |
| 4     | Low      | Add Zod-validated `env.ts` and replace raw `process.env.*` access                                                                                           | 2h      | Low                                                                           |

**Total estimated effort for Phase 0 + 1 (production blockers): ~2.5–3 days.**
**Recommendation**: Do not ship to production until Phase 0 and Phase 1 are fully complete — these directly address the 401/500/Client-Reference errors described in the task.
