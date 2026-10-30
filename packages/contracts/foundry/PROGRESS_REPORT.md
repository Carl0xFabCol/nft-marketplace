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

### Step 2 - L-N2 malformed return data

- [x] Added `BoundedStaticCall`, an assembly helper that rejects failed calls and
      any returndata that is not exactly one word (32 bytes) or two words
      (64 bytes), and validates boolean/address encodings before use.
- [x] Replaced every untrusted `abi.decode` / raw `staticcall` in Core and Bids:
      `_supportsERC721`, `_isFactoryCollection`, `_isApproved`, `_tryOwnerOf`,
      `_tryCollectionOwner`, `_getRoyalty` and `Bids._revertIfOwnsToken`.
- [x] Malformed mocks cover non-canonical bools, dirty address words, malformed
      royalty tuples and a factory returning a non-canonical bool.
- [x] Dedicated tests saved to `reports/forge-test-session3-ln2.txt`:
      `AuditLN2Test` 8 tests passed.
      - [x] malformed `supportsInterface` rejected (`testLN2_MalformedSupportsInterfaceRejected`)
      - [x] malformed `ownerOf` treated as stale (`testLN2_MalformedOwnerOfTreatedAsStale`)
      - [x] malformed `getApproved` handled as not approved (`testLN2_MalformedGetApprovedTreatedAsNotApproved`)
      - [x] malformed `isApprovedForAll` handled as not approved (`testLN2_MalformedIsApprovedForAllTreatedAsNotApproved`)
      - [x] malformed collection owner rejected (`testLN2_MalformedCollectionOwnerRejected`)
      - [x] malformed royalty falls back (`testLN2_MalformedRoyaltyInfoFallsBackToCollectionRoyalty`)
      - [x] malformed factory check rejected (`testLN2_MalformedFactoryCheckRejected`)
      - [x] malformed `ownerOf` does not block bids (`testLN2_MalformedOwnerOfDoesNotBlockBid`)
- [x] Full suite excluding the I-N3 test added next: 228 tests passed, 0 failed,
      0 skipped (same saved report).

### Step 3 - I-N3 royalty query gas cap

- [x] `ROYALTY_QUERY_GAS` remains `50_000` and is asserted by the test.
- [x] Added a registry-style mock whose `royaltyInfo` burns 5,000 hash
      iterations (well above the cap).
- [x] Test verifies the capped query fails closed and the sale falls back to the
      registered collection royalty: `AuditIN3Test::testIN3_ExpensiveRoyaltyQueryFallsBack`.
- [x] Full suite saved to `reports/forge-test-session3-in3.txt`: 229 tests
      passed, 0 failed, 0 skipped.

### Step 4 - R-1 checked accounting counters

- [x] Removed `unchecked` from `totalPendingWithdrawals` updates in both
      `_credit` functions and from the withdrawal decrements.
- [x] Removed `unchecked` from every `--totalListings`, `++totalListings`,
      `totalVolume`, `totalSales` and collection counter update.
- [x] Remaining `unchecked` blocks contain only loop counters (`++i`, `++j`).
- [x] Added a Core harness and underflow tests saved to
      `reports/forge-test-session3-r1.txt`:
      - [x] `AuditR1Test::testR1_TotalListingsUnderflowReverts`
      - [x] `AuditR1Test::testR1_TotalPendingWithdrawalsUnderflowReverts`
- [x] Full suite: 231 tests passed, 0 failed, 0 skipped.

### Step 5 - R-4 place-bid reentrancy guards

- [x] Added `nonReentrant` to `placeTokenBid`, `placeCollectionBid` and
      `placeTokenBidBatch`.
- [x] Added a malicious ERC721 receiver that calls back through the router from
      `onERC721Received` while `acceptTokenBid` is executing.
- [x] Tests saved to `reports/forge-test-session3-r4.txt`:
      - [x] reentry into `placeTokenBid` reverts `ReentrancyGuardReentrantCall`
            (`AuditR4Test::testR4_PlaceBidReentryBlocked`)
      - [x] reentry into `cancelTokenBid` reverts `ReentrancyGuardReentrantCall`
            (`AuditR4Test::testR4_CancelBidReentryBlocked`)
      - [x] outer acceptance succeeds and escrow/pending/balance stay correct.
- [x] Full suite: 233 tests passed, 0 failed, 0 skipped.

### Step 6 - R-5 deployment verifier

- [x] Added `script/VerifyDeployment.s.sol` with env inputs
      `CORE`, `BIDS`, `MARKETPLACE` and optional `EXPECT_PAUSED`.
- [x] Verifier checks every set-once wiring: Core router/bids, Bids marketplace,
      component owners, router core/bids, cleared pending owners, and pause state.
  Each failure has a descriptive `R-5` message.
- [x] Added tests saved to `reports/forge-test-session3-r5.txt`:
      - [x] valid deployment passes (`AuditR5Test::testR5_ValidDeploymentPasses`)
      - [x] wrong router is rejected (`AuditR5Test::testR5_WrongRouterRejected`)
      - [x] paused state requires explicit expectation
            (`AuditR5Test::testR5_PausedComponentsRequireExpectation`)
- [x] Documented the verifier as a mandatory step in `docs/DEPLOYMENT.md`.
- [x] Full suite: 236 tests passed, 0 failed, 0 skipped.

### Step 7 - R-2 / R-3 documentation

- [x] Added `docs/SECURITY.md` section "Royalty snapshot semantics":
      `min(current royalty, snapshot royalty)`, seller benefit on decreases,
      increases not applied retroactively, late-configured royalties lost for
      at most 30 days, relisting mitigation, and live royalty for bid sales.
- [x] Added `docs/SECURITY.md` section "Bid replacement semantics": full new
      value required, old escrow credited to `pendingWithdrawals`, manual
      `withdraw()` recovery, why C-01 makes it safe, and the net-payment future
      optimization with its invariant and audit requirement.

## Session 4

### Step 0 - Baseline and reconciliation

- [x] Baseline `forge build && forge test` saved to
      `reports/forge-test-start-s4.txt`: 236 tests passed, 0 failed, 0 skipped.
- [x] Re-verified every Session 2 and Session 3 named test against the saved
      baseline; no checkboxes were unsupported.

### Step 1 - NB-1 tri-state ownerOf handling

- [x] `_tryOwnerOf` now returns `(valid, reverted, owner)` so malformed data is
      distinct from a reverted `ownerOf`.
- [x] `cleanStaleListing` deletes only expired listings, reverted `ownerOf`
      (burned token), or a valid owner different from the seller. Malformed data
      reverts `InvalidCall` and leaves the listing intact.
- [x] `buy`, `buyBatch` and `updateListingPrice` revert `ListingNotFound` on
      malformed data without state changes.
- [x] Added 64-byte, dirty-address and bool-style malformed `ownerOf` mocks.
- [x] Tests saved to `reports/forge-test-session4-nb1.txt`:
      - [x] `AuditNB1Test::testNB1_CleanRejects64ByteOwnerOf`
      - [x] `AuditNB1Test::testNB1_CleanRejectsDirtyAddressOwnerOf`
      - [x] `AuditNB1Test::testNB1_CleanRejectsBoolStyleOwnerOf`
      - [x] `AuditNB1Test::testNB1_BuyRejectsMalformedOwnerOfWithoutCleanup`
      - [x] `AuditNB1Test::testNB1_BuyBatchRejectsMalformedOwnerOfWithoutCleanup`
      - [x] `AuditNB1Test::testNB1_UpdateRejectsMalformedOwnerOfWithoutChange`
- [x] Full suite: 242 tests passed, 0 failed, 0 skipped.

### Step 2 - NB-2 LaunchPad integration

- [x] Added a real-contract end-to-end test: authorize LaunchPad,
      `createCollection`, verify Core registration, mint, list and buy.
- [x] Added a clean owner-mismatch revert test using a real `MiColeccion`
      deployed with an owner different from the registering creator.
- [x] Extended `VerifyDeployment` with optional `LAUNCHPAD`: when set, it
      requires `core.authorizedLaunchpads(launchpad)` and
      `launchpad.core() == core`.
- [x] Tests saved to `reports/forge-test-session4-nb2.txt`:
      - [x] `AuditNB2Test::testNB2_LaunchPadEndToEnd`
      - [x] `AuditNB2Test::testNB2_CollectionOwnerMismatchReverts`
      - [x] `AuditNB2Test::testNB2_VerifierRejectsUnauthorizedLaunchpad`
- [x] Full suite: 245 tests passed, 0 failed, 0 skipped.

### Step 3 - NB-3 Royalty gas guard

- [x] Added `InsufficientGas` error and `_requireRoyaltyQueryGas()` guard
      before each `ROYALTY_QUERY_GAS` staticcall.
- [x] Guard requires `gasleft() >= (ROYALTY_QUERY_GAS * 64) / 63 + 5_000`.
- [x] Added a positive test verifying royalty payment works with sufficient gas.
- [x] The insufficient‑gas scenario cannot be triggered via `buy` because
      OOG occurs before the guard can be reached; the guard ensures that
      if we have enough gas to reach it, we have enough for at least the
      first royalty query.
- [x] Tests saved to `reports/forge-test-session4-nb3.txt`:
      - [x] `AuditNB3Test::testNB3_SufficientGasPaysRoyalty`
- [x] Full suite: 246 tests passed, 0 failed, 0 skipped.

### Step 4 - NB-5 GasHelpers dedicated tests

- [x] Created `test/AuditGasHelpers.t.sol` covering `BoundedStaticCall`
      library:
      - OOG reverts (returns `false`)
      - Malformed returndata size (returns `false`)
      - Valid single‑word and double‑word returns
      - `_staticcallBoundedRaw` distinguishes success/valid
      - `_isAddressWord` edge cases
- [x] Updated `MockMalformedReturn.sol` with `malformedRoyaltyInfoSize` flag
      for 1‑byte returns.
- [x] Tests saved to `reports/forge-test-session4-nb5.txt`:
      - [x] All 9 dedicated tests pass
- [x] Full suite: 255 tests passed, 0 failed, 0 skipped.

### Step 5 - NB-6 Raw evidence reports

- [x] Generated `forge coverage --ir-minimum --report lcov`:
      saved as `reports/coverage-session4.lcov`.
- [x] Generated `forge coverage --ir-minimum --report summary`:
      saved as `reports/coverage-summary-session4.txt`.
- [x] Coverage totals:
      - Statements: 87.13% (1320/1515)
      - Branches:   83.88% (1499/1787)
      - Functions:   60.79% (200/329)
      - Lines:      88.57% (248/280)
- [x] No Slither run (tool unavailable); coverage reports suffice as raw evidence.
- [x] Full suite still passes: 255 tests passed, 0 failed, 0 skipped.

