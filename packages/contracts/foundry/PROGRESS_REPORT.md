# Second-Round Audit Fixes Progress Report

## Summary
Implemented critical fixes N-01 and N-02 from the second-round audit. Work remains for N-03, L-N1 through L-N3, I-N2, and tests for previous G-series optimizations.

## Completed Fixes

### N-01 (HIGH) — Owner/multisig can steal any NFT that has an approval to Core
**Status:** Fixed
**Commit:** bd31fc1
**Tests:** `AuditN01FixedTest`
- Added `router` state variable to `MarketplaceCore` (set-once)
- Updated `onlyRouter` modifier to check `msg.sender == router` only (no owner fallback)
- Removed `authorizedContracts` and `setAuthorizedContract`
- Made `setBidsContract` set-once with `AlreadySet` error
- Made `setMarketplaceAddress` in `MarketplaceBids` set-once
- Updated router `configureBidsMarketplace()` to call `setRouter`, `setBidsContract`, `setMarketplaceAddress`
- Removed `setAuthorizedContract` from router interface and implementation

### N-02 (MEDIUM) — Stale-listing cleanup never persists
**Status:** Fixed
**Commit:** b52e6d0
**Tests:** `AuditN02FixedTest`
- Removed delete/--totalListings/emit blocks before revert in `buy` and `updateListingPrice`
- Added `_tryOwnerOf` helper using low-level staticcall to check `ownerOf` without bubbling reverts
- Added permissionless `cleanStaleListing` function that removes stale listings
- Updated `buyBatch` to check for stale listings using `_tryOwnerOf`
- Exposed `cleanStaleListing` through router interface

## Remaining Work

### N-03 (MEDIUM) — Royalty can be raised against active listings
**Todo:** 
- Add `uint16 royaltyBps` to `Listing` struct
- Update struct layout: slot 1 `address seller`; slot 2 `uint128 price, uint48 listedAt, uint48 expiresAt, uint16 feeBps, uint16 royaltyBps`
- At listing time compute royalty through `_getRoyalty` and store `royaltyBps`
- At sale use `min(currentRoyaltyAmount, price * listing.royaltyBps / BASIS_POINTS)`
- Update `listings()` getter in interface and router `Listing` struct

### LOW Severity
- **L-N1**: SafeCast for truncation (explicit bound checks)
- **L-N2**: Malformed return data protection (manual validation, low-level helpers)
- **L-N3**: Listing resurrection prevention (add `MAX_LISTING_DURATION = 30 days`, mandatory `expiresAt`)

### INFO/PROCESS
- **I-N2**: Revert G-09, add proper accounting invariants
- **I-N4**: Unified sale event for bid sales

## Testing Requirements
- Dedicated tests for G-03, G-04, G-06, G-07, G-09 (behavioral equivalence and gas assertions)
- Handler-based invariants for solvency accounting
- Fuzz tests for royalty rounding edge cases

## Breaking Changes / API Changes
**Already implemented:**
1. `listings()` returns 6 fields (`feeBps`, `royaltyBps`, `uint48` times) - **NOT YET**
2. New `cleanStaleListing` function ✓
3. New `setRouter`, removal of `setAuthorizedContract`, set-once setters ✓
4. One-shot `configureBidsMarketplace()` flow ✓
5. `MAX_BATCH_SIZE = 50` ✓
6. New `minPrice`/`minSellerProceeds` parameters on accept functions ✓
7. Router `receive()`/`fallback()` removed ✓

**Pending:**
1. Mandatory `expiresAt` for listings (max 30 days)
2. Royalty snapshot in listings
3. `Sale` event also emitted for bid sales

## Next Steps
1. Implement N-03 (royalty snapshot)
2. Implement L-N1 through L-N3 fixes
3. Create comprehensive test suite for all fixes
4. Generate final reports (`forge-test.txt`, `snapshot-diff.txt`, `coverage.txt`)
5. Update `AUDIT_FIXES.md` with complete tracking table

**Time estimate for completion:** 8-12 hours of focused work