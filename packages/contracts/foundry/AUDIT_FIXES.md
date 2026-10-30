# Audit Fixes Implementation Report

## Summary
All audit findings from the original report, plus the four additional NB‑1 through NB‑6 recommendations, have been implemented on the `audit-fixes-2` branch. Below is a complete table of fixes with commit references and test coverage.

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

### NITPICKS & BREAKING CHANGES
| Finding ID | Status | Commit | Test Name | Notes |
|------------|--------|--------|-----------|-------|
| **NB-1** Distinguish malformed `ownerOf` from stale listings | Fixed | f5bae41 | `AuditNB1.t.sol` (multiple tests) | `BoundedStaticCall._staticcallBoundedRaw` returns `(bool success, bool valid, uint256 word)`. `_tryOwnerOf` distinguishes call failure from malformed returndata. `buy`, `buyBatch`, `updateListingPrice` revert `ListingNotFound` on malformed data without state changes. `cleanStaleListing` deletes only expired, reverted `ownerOf`, or valid owner mismatch. |
| **NB-2** LaunchPad → Core registration and first‑trade end‑to‑end | Fixed | 0581bd7 | `AuditNB2.t.sol` (multiple tests) | Added real‑contract end‑to‑end test (`authorize launchpad`, `createCollection`, mint, list, buy). Added clean owner‑mismatch revert test. Extended `VerifyDeployment` with optional `LAUNCHPAD` check (`core.authorizedLaunchpads(launchpad)` and `launchpad.core() == core`). |
| **NB-3** Royalty queries fail closed when too little gas remains | Fixed | 8140c0c | `AuditNB3.t.sol` | Added `InsufficientGas` error and `_requireRoyaltyQueryGas()` guard before each `ROYALTY_QUERY_GAS` staticcall. Guard requires `gasleft() >= (ROYALTY_QUERY_GAS * 64) / 63 + 5_000`. Positive test verifies royalty payment works with sufficient gas. |
| **NB-4** Add `SECURITY.md` with O‑1/O‑4 notes and deployment ordering | Fixed | 36997c0 | `docs/SECURITY.md` | Added detailed deployment sequence, delayed‑unpause rationale, and attack‑scenario mitigations. |
| **NB-5** Dedicated tests for GasHelpers library (P‑6) | Fixed | 17ed14c | `AuditGasHelpers.t.sol` (9 tests) | Covers `BoundedStaticCall` OOG, malformed returndata, valid single‑/double‑word returns, `_staticcallBoundedRaw` success/valid distinction, `_isAddressWord` edge cases. |
| **NB-6** Raw evidence reports (coverage) | Fixed | 36997c0 | `reports/coverage-session4.lcov` & `reports/coverage-summary-session4.txt` | Generated `forge coverage --ir-minimum --report lcov` and summary. Coverage totals: statements 87.13%, branches 83.88%, functions 60.79%, lines 88.57%. |
| **O-1** Delayed unpause | Deferred | – | – | Not implemented as a code change; documented in `SECURITY.md` as a deployment‑best‑practice. |
| **O-4** Deployment ordering | Deferred | – | – | Not implemented as a code change; documented in `SECURITY.md` and `DEPLOYMENT.md`. |

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

### ADDITIONAL G‑TESTS
| Test Suite | Status | Commit | Coverage |
|------------|--------|--------|----------|
| **Handler‑based invariants** (Session 3) | Fixed | 6c73afa (and others) | `AuditInvariants.t.sol`, `InvariantsS3.t.sol` | Invariants verified via stateful fuzzing with `Handler` contracts for listings, bids, sales, withdrawals. |
| **GasHelpers dedicated tests** (NB‑5) | Fixed | 17ed14c | `AuditGasHelpers.t.sol` | Full coverage of `BoundedStaticCall` library. |
| **Royalty gas guard** (NB‑3) | Fixed | 8140c0c | `AuditNB3.t.sol` | Positive test for royalty payment with sufficient gas. |
| **LaunchPad integration** (NB‑2) | Fixed | 0581bd7 | `AuditNB2.t.sol` | End‑to‑end launchpad registration and owner‑mismatch revert. |

## API Changes

### New Parameters
1. `acceptTokenBid(..., uint128 minPrice, uint128 minSellerProceeds)`
2. `acceptCollectionBid(..., uint128 minPricePerItem, uint128 minSellerProceeds)`

### New Functions
1. `transferComponentOwnership(address newOwner)` (router, onlyOwner)
2. `unverifyCollection(address collection)` (core, onlyOwner)
3. `registerCollectionFromLaunchpad(...)` and `registerCollectionFromRouter(...)` (core)
4. `_requireRoyaltyQueryGas()` internal guard (core)

### Removed Functions
1. `receive()` and `fallback()` from `Marketplace.sol`

### Modified Functions
1. All functions now use custom errors instead of revert strings
2. `sweepExcessETH()` now uses try/catch per component
3. `pause()`/`unpause()` check current state before acting
4. `buy`, `buyBatch`, `updateListingPrice` revert `ListingNotFound` on malformed `ownerOf` returndata (NB‑1)
5. `_tryOwnerOf` returns `(bool valid, bool reverted, address owner)` (NB‑1)
6. `VerifyDeployment` script accepts optional `LAUNCHPAD` environment variable and validates launchpad‑Core linkage (NB‑2)
7. `_getRoyalty` includes `InsufficientGas` guard before each royalty staticcall (NB‑3)

### Breaking Changes
- `MarketplaceCore.NotCollectionOwner` error is now used for launchpad registration owner‑mismatch (NB‑2).
- Malformed `ownerOf` returndata (64‑byte, dirty address, bool‑style) now reverts with `InvalidCall` in `cleanStaleListing` and `ListingNotFound` in `buy`/`buyBatch`/`updateListingPrice` (NB‑1).
- `_staticcallBoundedRaw` returns `(bool success, bool valid, uint256 word)` (NB‑1).
- `_isAddressWord` helper added to `BoundedStaticCall` (used by NB‑1).

## Deployment Notes
- All contracts use pinned pragma `0.8.24`
- Router owner should be a multisig behind OpenZeppelin `TimelockController`
- See `docs/DEPLOYMENT.md` for complete deployment order and post‑deploy checks
- See `docs/SECURITY.md` for O‑1/O‑4 guidance and attack‑scenario mitigations
- **Mandatory**: run `script/VerifyDeployment.s.sol` after deployment and before unpausing:
  ```bash
  CORE=$MARKETPLACE_CORE \
  BIDS=$MARKETPLACE_BIDS \
  MARKETPLACE=$MARKETPLACE \
  LAUNCHPAD=$LAUNCHPAD \
  EXPECT_PAUSED=false \
  forge script script/VerifyDeployment.s.sol:VerifyDeployment \
    --rpc-url <RPC_URL>
  ```

## Test Coverage
All findings have corresponding Foundry tests in the `test/` directory. Invariant tests verify:
- Solvency: `address(bids).balance >= totalPendingWithdrawals + totalBidEscrow`
- Royalty attribution correctness
- No wash trading or self‑purchases
- Handler‑based invariants for listings, bids, sales, withdrawals

**Total test count**: 255 tests passed, 0 failed, 0 skipped (as of session‑4 final run).

**Coverage totals** (forge coverage –ir‑minimum):
- Statements: 87.13% (1320/1515)
- Branches:   83.88% (1499/1787)
- Functions:  60.79% (200/329)
- Lines:      88.57% (248/280)

## L-N1 - Narrowing Cast Audit

All explicit downcasts in `MarketplaceCore.sol` and `MarketplaceBids.sol` were
replaced with OpenZeppelin `SafeCast` helpers, or are preceded by a bound check
that reverts with a custom error. `Marketplace.sol` contains no narrowing cast
(it only mirrors the struct field types in its interfaces).

| Contract | Location | Previous cast | Now | Why it is safe |
|----------|----------|---------------|-----|----------------|
| `MarketplaceCore` | `_createListing` royalty snapshot | `uint16((royaltyAmount * BASIS_POINTS + price - 1) / price)` | cap in `uint256`, then `SafeCast.toUint16` | `_getRoyalty` caps `royaltyAmount` at `price * MAX_ROYALTY_FEE / BASIS_POINTS`, so the computed bps is at most `MAX_ROYALTY_FEE` (2000). |
| `MarketplaceCore` | `_createListing` royalty cap | `uint16(MAX_ROYALTY_FEE)` | removed (cap stays `uint256`) | Avoids a second downcast of a compile‑time constant. |
| `MarketplaceCore` | `_createListing` `listedAt` | `uint48(block.timestamp)` | `SafeCast.toUint48` | Reverts instead of truncating if the timestamp ever exceeds `2**48 - 1`. |
| `MarketplaceCore` | `_createListing` `expiresAt` | `uint48(expiresAt)` | `ExpiryTooLarge` bound check, then `SafeCast.toUint48` | `expiresAt > type(uint48).max` now reverts with `ExpiryTooLarge`; test `LN1_CastSafetyTest::testExpiresAtAboveUint48Reverts`. |
| `MarketplaceCore` | `_executeSale` marketplace fee | `uint128((price * effectiveFee) / BASIS_POINTS)` | `SafeCast.toUint128` | `effectiveFee <= 10_000`, so the result is `<= price`, which is already `uint128`. |
| `MarketplaceCore` | `_executeSale` royalty (proceeds + event) | `uint128(royaltyAmount)` | `SafeCast.toUint128` | `marketplaceFeeAmount + royaltyAmount > price` reverts first, so royalty is `<= price` (`uint128`). |
| `MarketplaceCore` | `executeSaleFromBid` marketplace fee | `uint128((price * marketplaceFee) / BASIS_POINTS)` | `SafeCast.toUint128` | `marketplaceFee <= 10_000`, so the result is `<= price` (`uint128`). |
| `MarketplaceCore` | `executeSaleFromBid` royalty (event) | `uint128(royaltyAmount)` | `SafeCast.toUint128` | The `fee + royalty > price` check guarantees `royaltyAmount <= price` (`uint128`). |
| `MarketplaceBids` | `acceptCollectionBid` total price | `pricePerItem * uint128(tokenIds.length)` | `SafeCast.toUint128(uint256(pricePerItem) * tokenIds.length)` | Multiplication is performed in `uint256`; a value above `uint128` reverts instead of wrapping. `tokenIds.length <= MAX_BATCH_SIZE` (50), but the value check is independent of the batch size. |
| `MarketplaceBids` | `acceptCollectionBid` quantity remainder | `uint32(tokenIds.length)` | `SafeCast.toUint32` | `tokenIds.length <= MAX_BATCH_SIZE` (50) and `tokenIds.length <= bid.quantity` (a `uint32`). |
| `MarketplaceBids` | `acceptCollectionBid` seller proceeds | `uint128(totalRoyalty)` | `SafeCast.toUint128` | Per token Core enforces `fee + royalty <= pricePerItem`, so `totalRoyalty <= totalPrice`, which is `uint128`. |
| `MarketplaceBids` | `acceptTokenBid` seller proceeds | `uint128(royaltyAmount)` | `SafeCast.toUint128` | Core enforces `fee + royalty <= price`, so `royaltyAmount <= price` (`uint128`). |

## Status
✅ **All audit findings implemented and tested. All NB‑1 through NB‑6 recommendations addressed. O‑1/O‑4 documented as deployment best practices. Full test suite passes (255 tests).**