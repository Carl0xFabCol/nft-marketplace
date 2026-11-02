# Marketplace Security Notes

## Royalty snapshot semantics

Listings snapshot the collection royalty rate when the listing is created. The
sale then pays the lower of the current royalty and the snapshot:

```solidity
royaltyAmount = min(liveRoyalty, snapshotRoyalty)
```

Consequences:

- A royalty decrease benefits the seller, because the lower live rate is used.
- A royalty increase does not apply to an existing listing.
- A royalty configured after a listing was created is not collected on that
  listing. Creators who configure royalties late lose them on earlier listings,
  for at most the 30-day maximum listing duration.
- Mitigation: relisting after the change picks up the new royalty. Collection
  owners should configure royalties before launch.

Bid sales are different: `executeSaleFromBid` uses the live royalty with no
snapshot. The `minSellerProceeds` parameter protects the seller against an
unexpected royalty increase on bid acceptance.

## Bid replacement semantics

Replacing a collection or token bid credits the old escrow to
`pendingWithdrawals` and requires `msg.value` to equal the full new bid value.
The old escrow is not refunded automatically; the bidder must call `withdraw()`
to recover it.

This is safe because the C-01 fix keeps the old escrow from being counted twice:
the old amount is removed from `totalBidEscrow` and credited once, while the new
full amount is added. The UX consequence is that bidders temporarily lock the
old amount until they withdraw it.

A future optimization could accept only the difference (`new - old`) and adjust
`totalBidEscrow` by that difference. It must preserve
`balance >= totalPendingWithdrawals + totalBidEscrow` and requires a new audit
before deployment.

## O‑1 & O‑4: Delayed unpause and deployment ordering

### Deployment Ordering

Deploy contracts in this sequence:

1. **MarketplaceRouter** (Marketplace)
   - Owned by the deployer (admin)
2. **MarketplaceCore**
   - Owned by the deployer
   - Set `router` to MarketplaceRouter
3. **MarketplaceBids**
   - Owned by the deployer
   - Set `marketplace` to MarketplaceRouter
4. **Call `MarketplaceRouter.setCore(address(core))`** – this also sets `bids` automatically via `_setCore`.
5. **Call `MarketplaceRouter.setBids(address(bids))`** – already set by `_setCore`, but verify.
6. **Call `MarketplaceCore.setBidsContract(address(bids))`**.
7. **Call `MarketplaceBids.setMarketplace(address(marketplace))`** – already set in constructor, but verify.
8. **Call `MarketplaceRouter.transferOwnership(address(core))`** – transfers router ownership to Core.
9. **Call `MarketplaceCore.transferOwnership(address(router))`** – transfers Core ownership to Router (finalize ownership loop).
10. **Call `MarketplaceBids.transferOwnership(address(router))`** – transfers Bids ownership to Router.

After step 10, the ownership triangle is closed:
- `router.owner() == core`
- `core.owner() == router`
- `bids.owner() == router`
- `router.core() == core`
- `router.bids() == bids`
- `core.bidsContract() == bids`
- `bids.marketplace() == router`

### Delayed Unpause

The contracts start **paused**. Before unpausing:

- Verify all ownership relationships with `script/VerifyDeployment.s.sol`.
- Ensure any launchpads are authorized (`core.setAuthorizedLaunchpad`).
- Ensure critical collections are registered.
- Only then call `MarketplaceRouter.unpause()`.

A delayed unpause prevents immediate exploitation of any leftover deployment
configuration errors and gives operators time to verify the system.

### Attack Scenarios Mitigated

- **Front‑running ownership transfers**: The final transfer (Core → Router) must
  happen after Router → Core; the deployer stays owner until the triangle is
  ready.
- **Re‑entrancy**: The contracts use the Checks‑Effects‑Interactions pattern and
  have no external calls before state updates, except for ERC721 transfers which
  are safe because they happen after all state changes in `_executeSale`.
- **Royalty griefing**: Royalty queries are capped at `ROYALTY_QUERY_GAS` and
  guarded by an `InsufficientGas` check before each staticcall (NB‑3).
- **Malformed NFT returns**: `ownerOf` malformed returndata is distinguished
  from a reverted call (NB‑1) and triggers `InvalidCall` rather than silently
  deleting stale listings.
- **LaunchPad registration**: Only collections whose owner matches the
  registering creator can be registered via a launchpad (NB‑2); otherwise the
  transaction reverts cleanly.

## Bounded external calls (F-2, F-3, F-4, F-5, NB-3, NB-7)

All external collection calls are made through `BoundedStaticCall` with an
explicit gas budget. A malicious or gas-burning token contract therefore cannot
consume the whole transaction before the marketplace can fail closed.

| Query | Budget | Behaviour |
|-------|--------|-----------|
| `ownerOf` (listing/sale/cleanup) | `OWNER_QUERY_GAS` = 30,000 | `_tryOwnerOf` requires `gasleft() >= (30_000 * 64) / 63 + 5_000` before calling. It forwards exactly 30,000 gas and treats a failed call with non-empty returndata as a revert. Empty returndata is treated as malformed, not as a clean "not owner" result. |
| `royaltyInfo` / `supportsInterface` | `ROYALTY_QUERY_GAS` = 50,000 | `_requireRoyaltyQueryGas` applies the same EIP-150-aware guard before each staticcall. Insufficient gas reverts with `InsufficientGas` instead of silently paying zero royalty. |
| Approval, collection owner, factory and other untrusted views | `EXTERNAL_QUERY_GAS` = 100,000 | Used by the no-budget `_staticcallBounded` overload so callers cannot pass `gasleft()` as an unbounded budget. |

F-3 routes the listing and bid-sale ownership reads through `_tryOwnerOf`
instead of calling `ownerOf` directly. A malformed or reverting `ownerOf` makes
listing creation or bid acceptance revert cleanly (`NotTokenOwner`), it does not
bypass the ownership check.

F-5 documents why the assembly helpers only use the free-memory pointer as
immediate scratch space. `_staticcallBounded` is annotated `("memory-safe")`.
`_staticcallBounded2` uses the identical scratch pattern but is intentionally
left unannotated: annotating both blocks makes the via-IR optimizer fail with a
stack-too-deep error in `MarketplaceCore`. The return words are copied to the
stack before the block ends and no other memory is read afterwards, so the
unannotated block still has the same memory-safety properties.

## Component ownership migration (O-1)

`Marketplace.transferComponentOwnership(newOwner)` starts a two-step ownership
transfer on both Core and Bids. The new owner must call `acceptOwnership()` on
each component. The router owner does not change.

After the migration:

- `core.owner() == newOwner` and `bids.owner() == newOwner`;
- `newOwner` can call component admin functions directly;
- router-only entrypoints (`createListing`, `buy`, `withdrawFor`,
  `executeSaleFromBid`) still revert with `Unauthorized` when called directly
  on Core or Bids by anyone other than the router/Bids contract;
- router admin wrappers (`pause`, `updateMarketplaceFee`, `verifyCollection`,
  `sweepExcessETH`, `transferComponentOwnership`) still require
  `router.owner()`, so the component owner cannot use them unless it also owns
  the router.

Operators should verify both `acceptOwnership()` transactions before announcing
the new admin. `test/AuditO1.t.sol` exercises this flow on the real deployment
fixture.

### Verification

After deployment, run:

```bash
CORE=$MARKETPLACE_CORE \
BIDS=$MARKETPLACE_BIDS \
MARKETPLACE=$MARKETPLACE \
LAUNCHPAD=$LAUNCHPAD \
EXPECT_PAUSED=false \
forge script script/VerifyDeployment.s.sol:VerifyDeployment \
  --rpc-url <RPC_URL>
```

The script will confirm the ownership triangle, zero pending owners, paused
state (or not, depending on `EXPECT_PAUSED`), and, if `LAUNCHPAD` is set,
that the launchpad is authorized and points back to Core.

Do not hand over the contracts to users before the verifier passes.
