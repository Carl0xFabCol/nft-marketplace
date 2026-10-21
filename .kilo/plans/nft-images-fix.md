# Plan: Fix NFT images not showing in frontend

## Goal
Ensure NFT images display correctly across the frontend by (a) fixing the detail page to resolve IPFS URLs and fall back to `token_uri`, and (b) backfilling `image_url` in the DB for NFTs that have `token_uri` but no `image_url`.

## Root causes (verified from code)

1. **`NftDetail.tsx` (`apps/web/app/collection/[colAddress]/[tokenId]/page.tsx` + `apps/web/components/features/nft/NftDetail.tsx`)** uses `nft.image_url` directly in a raw `` tag with no IPFS gateway resolution and no fallback to `token_uri`. If `image_url` is `null` (only `token_uri` is set) or an IPFS URI, the image is broken/shows placeholder.

2. **`image_url` may be `null` in the `nfts` table** even when `token_uri` contains `ipfs://bafy.../2`. This happens when the indexer's `MetadataFetcher.fetchMetadata()` failed at index time (IPFS gateway down, invalid JSON, 20s timeout). The `TransferHandler` mints the NFT row but with `imageUrl: null`.

3. **`NftCard.tsx`** (collections/user pages) uses `<IpfsImage>` which correctly resolves IPFS URLs — but only works if `image_url` is populated. If null, shows "No image".

## Data model
- `nfts.token_uri`: raw IPFS URI, e.g. `ipfs://bafybeigs5lojzzear4gyuizxgmdabdam7jftguarspv4rcxw665pkioxdy/2`
- `nfts.image_url`: resolved gateway URL, e.g. `https://gateway.pinata.cloud/ipfs/bafy...` (may be null)
- `nfts.metadata`: full metadata JSON (may contain `image` field)

## Tasks

### 1. Frontend: Fix `NftDetail.tsx` to use `IpfsImage` + `token_uri` fallback
**File**: `apps/web/components/features/nft/NftDetail.tsx`

- Replace the raw `<img src={nft.image_url || "/placeholder-nft.png"}>` with `<IpfsImage src={nft.image_url}>`.
- Add a helper that derives an image URL from `nft.token_uri` when `image_url` is null: replace `ipfs://` with `https://gateway.pinata.cloud/ipfs/` (reusing `getIpfsPath`/`resolveIpfsUrl` from `@/lib/resolveIPFS`).
- Pass the derived URL as `src` to `IpfsImage` when `image_url` is null.
- Keep `/placeholder-nft.png` as final fallback only when neither field has data.

### 2. Frontend: Fix `page.tsx` OpenGraph image
**File**: `apps/web/app/collection/[colAddress]/[tokenId]/page.tsx`

- Line 48: `images: [nftData?.image_url || "/default-nft.png"]` — apply the same IPFS resolution + `token_uri` fallback so OG images work.

### 3. Indexer: Backfill script for missing `image_url`
**New file**: `apps/indexer/src/scripts/backfill-image-urls.ts`

- Query `nfts` table where `image_url IS NULL AND token_uri IS NOT NULL`.
- For each NFT, call `metadataFetcher.getNFTData(collectionAddress, tokenId)` to re-fetch metadata and extract `imageUrl`.
- Upsert the resolved `image_url` into the `nfts` table.
- Add concurrency control (batch processing) and logging.
- Add a CLI entry so it can be run manually (`pnpm backfill:image-urls`).

### 4. Indexer: Ensure `TransferHandler` populates `image_url` on late-discovered NFTs
**File**: `apps/indexer/src/persistence/NFTRepository.ts`

- The `updateOwner()` fallback INSERT (already implemented in prior commit) sets `image_url: null` when inserting a new NFT row from a transfer.
- Enhance: when inserting a new NFT row from a transfer and `image_url` would be null, fetch metadata via `MetadataFetcher` to populate `image_url` and `token_uri` at insert time.
- Requires passing `MetadataFetcher` into `TransferHandler` (constructor injection) — matches the pattern already used by `CoreEventHandler`/`BidsEventHandler`.

### 5. Tests
- Add test for `NftDetail` image derivation logic (unit test for the helper that resolves `token_uri` → image URL).
- Add test for backfill script (mock Supabase + MetadataFetcher).
- Run `pnpm test` across all packages — target: all green.

## Validation
- Open NFT detail page for an NFT whose `token_uri` is `ipfs://...` and `image_url` is null → image should load via gateway.
- Open collection page → `NftCard` images should load (already works via `IpfsImage` if `image_url` populated).
- Run backfill script against a local/dev Supabase → verify `image_url` populated for previously-null rows.
- `pnpm test` → 30+ tests pass.
- `pnpm typecheck` on `apps/web` and `apps/indexer` → no new errors.

## Open questions (to resolve before implementation)
1. Should the frontend cache resolved IPFS image URLs in the DB, or resolve on every render? (Recommend: resolve on render via `IpfsImage`, which already has gateway failover.)
2. Which IPFS gateway should the frontend use? `resolveIpfsUrl` already uses `NEXT_PUBLIC_PINATA_GATEWAY` with fallbacks to `gateway.pinata.cloud` and `dweb.link`.
