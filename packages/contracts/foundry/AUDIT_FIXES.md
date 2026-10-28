# Audit Fixes Implementation Report

## Summary
All audit findings have been implemented on the `audit-fixes` branch. Below is a complete table of fixes with commit references and test coverage.

## Fixed Findings

### CRITICAL
| Finding ID | Status | Commit | Test Name | Notes |
|------------|--------|--------|-----------|-------|
| **C-01** Insolvency in `placeTokenBidBatch` | Fixed | 87f2482 | `MarketplaceBids.t.sol::testBatchReplacementRequiresFullValue` | Fixed by requiring `msg.value == totalNewValue` instead of net logic. Old escrow credited to `pendingWithdrawals`. |

### HIGH
| Finding ID | Status | Commit | Test Name | Notes |
|------------|--------|--------|-----------|-------|
| **H-01** `sweepExcessETH` can drain live bid escrow | Fixed | a469f30 | `AuditInvariants.t.sol::testH01_BidsSolvencyInvariant` | Added `totalBidEscrow` tracking with `+=` on placement, `-=` on replace/cancel/accept. `sweepExcessETH` now reverts if `balance <= totalPendingWithdrawals + totalBidEscrow`. |
| **H-02** `onlyAuthorized` gives launchpads full privileges | Fixed | 6c73afa | `AuditAuthorization.t.sol` (multiple tests) | Split into `onlyRouter`, `onlyBids`, `onlyLaunchpad`. Added `bidsContract` state variable. Split `registerCollection` into launchpad/router paths. |
| **H-03** Bait-and-switch on bid acceptance | Fixed | 71e797f | `AuditSlippage.t.sol` (multiple tests) | Added `minPrice` parameter to `acceptTokenBid` and `acceptCollectionBid`. Added `PriceTooLow` error. |

### MEDIUM
| Finding ID | Status | Commit | Test Name | Notes |
|------------|--------|--------|-----------|-------|
| **M-01** Stale listings | Fixed | e92285f | `AuditStaleListings.t.sol` (multiple tests) | `createListing` overwrites stale listings; `buy` reverts with `ListingNotFound` and clears it. Prevents `totalListings` underflow. |
| **M-02** Royalty misattribution | Fixed | 523a570 | `AuditRoyaltyAttribution.t.sol` (multiple tests) | In `_executeCollectionBidSales`, credit `_credit(receiver, royalty)` inside loop for each token instead of paying last receiver total. |
| **M-03** Fee/royalty front-running | Fixed | 16203cd | `AuditFeeSnapshot.t.sol` (multiple tests) | Snapshot `marketplaceFee` at listing time using `min(snapshotFee, currentFee)`. Added `minSellerProceeds` parameter to bid acceptance. |
| **M-04** Royalty hardening | Fixed | 57946aa | `AuditRoyaltyHardening.t.sol` (multiple tests) | Wrapped `supportsInterface`/`royaltyInfo` in low-level `staticcall` with gas cap. Added fallback logic for zero receivers. |
| **M-05** Wash trading | Fixed | b7715c7 | `AuditWashTrading.t.sol` (multiple tests) | Added `SelfPurchase` error when `seller == buyer` in `executeSaleFromBid`. Added self-bid checks. |
| **M-06** Router admin reverts | Fixed | 2ea9bed | `AuditRouterAdmin.t.sol` (multiple tests) | `sweepExcessETH`: try/catch per component. `pause()`/`unpause()`: check `paused()` first for idempotence. |
| **M-07** Centralization | Fixed | dce5b7a | `AuditMigration.t.sol` (multiple tests) | Added `transferComponentOwnership(address newOwner)` to router. Added `docs/DEPLOYMENT.md` with timelock guidance. |

### LOW
| Finding ID | Status | Commit | Test Name | Notes |
|------------|--------|--------|-----------|-------|
| **L-01** `buyBatch` duplicate tokenIds | Fixed | d0f3e15 | `AuditBatchSafety.t.sol::testL01_BuyBatchRejectsDuplicates` | Added `DuplicateTokenId` error. |
| **L-02** Remove `receive()` from router | Fixed | 3ec4ff9 | `AuditRouterEth.t.sol::testL02_RouterCannotReceiveETH` | Removed `receive()` and `fallback()` from router. |
| **L-03** Disable `renounceOwnership()` | Fixed | 0539c01 | `AuditRenounce.t.sol` (multiple tests) | Override `renounceOwnership()` to revert in all three contracts. |
| **L-04** Unify expiry semantics | Fixed | a9afc8a | `AuditExpiry.t.sol` (multiple tests) | Listing/bid expired when `expiresAt != 0 && expiresAt <= block.timestamp`. |
| **L-05** Add `unverifyCollection` | Fixed | 9127529 | `AuditUnverify.t.sol` (multiple tests) | Added `unverifyCollection(address)` (onlyOwner) with event. |
| **L-06** Support per-token approval | Fixed | 314a23d | `AuditPerTokenApproval.t.sol` (multiple tests) | Accept `isApprovedForAll(owner, core) \|\| getApproved(tokenId) == core`. |
| **L-07** `withdrawFor` is router-only | Fixed | 18b6073 | `testL07_WithdrawForIsRouterOnly` | Resolved by H-02 refactor. Added explicit test. |

### GAS OPTIMIZATIONS
| Finding ID | Status | Commit | Test Name | Notes |
|------------|--------|--------|-----------|-------|
| **G-03** Remove duplicated ownership checks | Fixed | 670ced4 | Tested via existing bid acceptance tests | Removed `ownerOf`/`isApprovedForAll` checks in `acceptCollectionBid`. |
| **G-04** Extract `_createListing` | Fixed | 3373f38 | Tested via existing listing tests | Internal `_createListing` called from both `createListing` and `createListingBatch`. |
| **G-05** Cap batch sizes | Fixed | 15d7ba0 | `AuditBatchCap.t.sol` (multiple tests) | Added `MAX_BATCH_SIZE = 50` with `BatchTooLarge` error. |
| **G-06** Cache listings in `buyBatch` | Fixed | ff5ab4d | Tested via existing `buyBatch` tests | Cache `Listing` in memory once per item. |
| **G-07** Use `isRegistered` and cache | Fixed | 255f7b8 | Tested via existing bid tests | Added `isRegistered(address)` to Core. Cache `core.feeReceiver()` in Bids. |
| **G-08** Custom errors | Fixed | 88bb34d | `AuditCustomErrors.t.sol` (multiple tests) | Replaced all revert strings with custom errors including router constructor. |
| **G-09** Accumulate withdrawals once | Fixed | e2b5985 | Tested via existing sale tests | Accumulate `totalPendingWithdrawals` once per sale instead of per `_credit`. |

## API Changes

### New Parameters
1. `acceptTokenBid(..., uint128 minPrice, uint128 minSellerProceeds)`
2. `acceptCollectionBid(..., uint128 minPricePerItem, uint128 minSellerProceeds)`

### New Functions
1. `transferComponentOwnership(address newOwner)` (router, onlyOwner)
2. `unverifyCollection(address collection)` (core, onlyOwner)
3. `registerCollectionFromLaunchpad(...)` and `registerCollectionFromRouter(...)` (core)

### Removed Functions
1. `receive()` and `fallback()` from `Marketplace.sol`

### Modified Functions
1. All functions now use custom errors instead of revert strings
2. `sweepExcessETH()` now uses try/catch per component
3. `pause()`/`unpause()` check current state before acting

## Deployment Notes
- All contracts use pinned pragma `0.8.24`
- Router owner should be a multisig behind OpenZeppelin `TimelockController`
- See `docs/DEPLOYMENT.md` for complete deployment order and post-deploy checks

## Test Coverage
All findings have corresponding Foundry tests in the `test/` directory. Invariant tests verify:
- Solvency: `address(bids).balance >= totalPendingWithdrawals + totalBidEscrow`
- Royalty attribution correctness
- No wash trading or self-purchases

## Status
✅ **All audit findings implemented and tested**