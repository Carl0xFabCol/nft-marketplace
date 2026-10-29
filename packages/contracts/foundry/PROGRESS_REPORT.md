# Phase 2 / Session 2 Progress Report

Branch: `audit-fixes-2`

A checkbox is marked `[x]` only when the named test exists and passes in the saved
`forge test` output for that commit.

## Step 0 - Mandatory verification

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

## Scope

- [ ] **N-03 tests** - royalty snapshot after listing
      - [ ] increase after listing capped at snapshot (`N03_RoyaltySnapshotTest::testRoyaltyIncreaseAfterListingUsesSnapshot`)
      - [ ] decrease after listing honored (`N03_RoyaltySnapshotTest::testRoyaltyDecreaseAfterListingIsHonored`)
      - [ ] tiny prices never overflow fee + royalty (`N03_RoyaltySnapshotTest::testTinyPricesNeverExceedPrice`)
      - [ ] fuzz price/feeBps/royaltyBps (`N03_RoyaltySnapshotTest::testFuzzFeeAndRoyaltyNeverExceedPrice`)
      - [ ] storage layout: `Listing` is exactly 2 slots and `royaltyBps` is in slot 2 (`N03_RoyaltySnapshotTest::testListingStorageLayout`)

- [ ] **L-N1** - SafeCast / bounds on every narrowing cast
      - [ ] `expiresAt = 2**48` reverts (`LN1_CastSafetyTest::testExpiresAtAboveUint48Reverts`)
      - [ ] every downcast documented in `AUDIT_FIXES.md`

- [ ] **L-N3** - `MAX_LISTING_DURATION = 30 days`
      - [ ] zero expiry reverts for listings (`LN3_ListingDurationTest::testListingZeroExpiryReverts`)
      - [ ] expiry over 30 days reverts (`LN3_ListingDurationTest::testListingBeyondMaxDurationReverts`)
      - [ ] A -> B -> A resurrection fails after expiry (`LN3_ListingDurationTest::testListingResurrectionAfterExpiryFails`)

- [ ] **O-2** - `cleanStaleListing` removes expired listings
      - [ ] expired listing cleaned and `totalListings` exact (`O2_ExpiredCleanupTest::testExpiredListingIsCleaned`)
      - [ ] live non-stale listing still reverts `InvalidCall` (`O2_ExpiredCleanupTest::testLiveListingStillReverts`)

- [ ] **O-3** - `RouterUpdated` event in `setRouter`
      - [ ] event emitted with old and new router (`O3_RouterUpdatedTest::testSetRouterEmitsRouterUpdated`)

## Out of scope this session

- L-N2, O-1, O-4, docs and final reports. Do not start.
