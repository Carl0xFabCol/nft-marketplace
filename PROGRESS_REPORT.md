# Progress Report - Second-Round Audit Fixes

## Completed
1. **I-N2**: Revert G-09 and implement proper accounting invariants
   - Updated `_credit` in both Core and Bids to update `totalPendingWithdrawals`
   - Removed manual `totalPendingWithdrawals += ...` outside `_credit`
   - Tests verify invariants hold

2. **I-N4**: Unified Sale event for bid sales
   - Added `Sale` event emission in `executeSaleFromBid`
   - Tests verify event emission for token and collection bids

3. **N-03**: Royalty snapshot in listings (partial)
   - Added `uint16 royaltyBps` to `Listing` struct
   - Updated `_createListing` to compute and store royalty snapshot
   - Updated `_executeSale` to cap royalty at snapshot value
   - Updated interface and router structs
   - Fixed breaking changes in tests

## Remaining Work
1. **N-03**: Complete tests for royalty snapshot
   - Test royalty increase after listing (capped at snapshot)
   - Test royalty decrease after listing (honored)
   - Test tiny prices (1, 3 wei) never produce `fee + royalty > price`
   - Fuzz tests for `price`, `feeBps`, `royaltyBps`

2. **L-N1**: SafeCast for truncation
   - Replace every narrowing cast with OpenZeppelin `SafeCast` or bound check
   - Audit every explicit downcast in three contracts
   - Test: `expiresAt = 2**48` reverts

3. **L-N3**: Listing resurrection prevention
   - Add `MAX_LISTING_DURATION = 30 days`
   - Require `expiresAt != 0 && expiresAt > block.timestamp && expiresAt <= block.timestamp + MAX_LISTING_DURATION`
   - Tests: zero expiry reverts; over 30 days reverts; resurrection no longer works

4. **O-2**: `cleanStaleListing` also cleans expired listings
   - Update to clean `expiresAt != 0 && expiresAt <= block.timestamp`
   - Tests: expired listing cleaned; live non-stale listing reverts

5. **O-3**: Emit `RouterUpdated` event in `setRouter`
   - Add event emission
   - Test the event

6. **L-N2**: Malformed return data protection
   - Implement `_staticcallBounded` helper in assembly
   - Replace every `abi.decode` of untrusted returndata with manual validation
   - Apply to: `_getRoyalty`, `_supportsERC721`, `_tryCollectionOwner`, `_isFactoryCollection`, `_isApproved`, `_tryOwnerOf`, `Bids._revertIfOwnsToken`
   - Tests with malicious mocks

7. **I-N3**: Keep `ROYALTY_QUERY_GAS = 50_000` with test
   - Add test with registry-style mock needing ~80k gas

8. **O-1**: Document `transferComponentOwnership` behavior
   - Update documentation in `docs/DEPLOYMENT.md` and `docs/SECURITY.md`
   - Add tests for post-migration behavior

9. **O-4**: Router `withdraw()` reverts if both components return false
   - Update router `withdraw()` to revert `NoWithdrawal`
   - Test it

10. **Documentation updates**
    - Update `docs/DEPLOYMENT.md` with deployment flow
    - Update `docs/SECURITY.md` with security considerations
    - Update `AUDIT_FIXES.md` with complete tracking table

11. **Comprehensive test suite**
    - Dedicated tests for previous round's G-03, G-04, G-06, G-07, G-09
    - Handler-based invariants for solvency accounting
    - Fuzz tests

12. **Final reports**
    - `forge-test.txt` (`forge test -vvv`)
    - `snapshot-diff.txt` (`forge snapshot --diff`)
    - `coverage.txt` (`forge coverage --report summary`)
    - `slither.txt` (`slither .`)

## Next Steps
1. Complete N-03 tests
2. Implement L-N1 through L-N3 fixes
3. Implement remaining O-series fixes
4. Create comprehensive test suite
5. Generate final reports
6. Update documentation