# Phase 2 Progress Report

## Session 2

Branch: `audit-fixes-2`

A checkbox is marked `[x]` only when the named test exists and passes in the saved
`forge test` output for that commit.

### Step 0 - Mandatory verification

- [x] Baseline `forge build && forge test` saved to `reports/forge-test-start.txt`
      - `AccountingInvariantsTest::testCoreCreditUpdatesTotalPendingWithdrawals`
      - `AccountingInvariantsTest::testBidsCreditUpdatesTotalPendingWithdrawals`
      - `AccountingInvariantsTest::testWithdrawFailureReaddsToTotalPendingWithdrawals`
      - `AccountingInvariantsTest::testInvariantTotalPendingEqualsSumOfIndividualPending`
      - `AccountingInvariantsTest::testBidsInvariantBalanceGeTotalPendingPlusEscrow`
      - `AuditN01Test` (rewritten to post-fix expectations)
      - `AuditN02Test::testN02_BurnedTokenMakesListingStale`
- [x] `grep -n "totalPendingWithdrawals" src/*.sol` audited: only declaration,
      `_credit`, `_withdraw` (decrement + rollback) and `sweepExcessETH`
      contain writes.

### Scope

- [x] **N-03 tests** - royalty snapshot after listing
      - [x] increase after listing capped at snapshot (`N03_RoyaltySnapshotTest::testRoyaltyIncreaseAfterListingUsesSnapshot`)
      - [x] decrease after listing honored (`N03_RoyaltySnapshotTest::testRoyaltyDecreaseAfterListingIsHonored`)
      - [x] tiny prices never overflow fee + royalty (`N03_RoyaltySnapshotTest::testTinyPricesNeverExceedPrice`)
      - [x] fuzz price/feeBps/royaltyBps (`N03_RoyaltySnapshotTest::testFuzzFeeAndRoyaltyNeverExceedPrice`)
      - [x] storage layout: `Listing` is exactly 2 slots and `royaltyBps` is in slot 2 (`N03_RoyaltySnapshotTest::testListingStorageLayout`)

- [x] **L-N1** - SafeCast / bounds on every narrowing cast
      - [x] `expiresAt = 2**48` reverts (`LN1_CastSafetyTest::testExpiresAtAboveUint48Reverts`)
      - [x] every downcast documented in `AUDIT_FIXES.md` (section L-N1)

- [x] **L-N3** - `MAX_LISTING_DURATION = 30 days`
      - [x] zero expiry reverts for listings (`LN3_ListingDurationTest::testListingZeroExpiryReverts`)
      - [x] expiry over 30 days reverts (`LN3_ListingDurationTest::testListingBeyondMaxDurationReverts`)
      - [x] A -> B -> A resurrection fails after expiry (`LN3_ListingDurationTest::testListingResurrectionAfterExpiryFails`)

- [x] **O-2** - `cleanStaleListing` removes expired listings
      - [x] expired listing cleaned and `totalListings` exact (`O2_ExpiredCleanupTest::testExpiredListingIsCleaned`)
      - [x] live non-stale listing still reverts `InvalidCall` (`O2_ExpiredCleanupTest::testLiveListingStillReverts`)

- [x] **O-3** - `RouterUpdated` event in `setRouter`
      - [x] event emitted with old and new router (`O3_RouterUpdatedTest::testSetRouterEmitsRouterUpdated`)

### Session result

- Final raw report: `reports/forge-test-session2.txt`
- Result: 212 tests passed, 0 failed, 0 skipped.

### Out of scope this session

- L-N2, O-1, O-4, docs and final reports. Do not start.

## Session 3

### Step 0 - Baseline and reconciliation

- [x] Baseline `forge build && forge test` saved to `reports/forge-test-start-s3.txt`:
      212 tests passed, 0 failed, 0 skipped.
- [x] Session 2 child checkboxes reconciled against the saved baseline; every
      named test is present as `[PASS]`.

### Step 1 - Handler-based invariants

- [x] `[invariant]` config: `runs = 256`, `depth = 50`, `fail_on_revert = false`.
- [x] `test/InvariantsS3.t.sol` targets only `MarketplaceHandler` and exercises
      listings, updates, cancels, direct and batch buys, token/collection bids,
      accepts, withdrawals, router withdrawals, sweeps, forced ETH, stale
      cleanup, external transfers, time warps and direct-call attacks.
- [x] Invariant-only run saved to `reports/forge-test-session3-step1.txt`:
      8 invariants passed, 0 failed.
      - [x] `invariant_corePendingAccounting`
      - [x] `invariant_bidsPendingAccounting`
      - [x] `invariant_coreSolvency`
      - [x] `invariant_bidsEscrowAccounting`
      - [x] `invariant_bidsSolvency`
      - [x] `invariant_saleConservation`
      - [x] `invariant_nftOwnership`
      - [x] `invariant_totalListings`
- [x] Full suite with the new invariants: 220 tests passed, 0 failed,
      0 skipped (same saved report).
