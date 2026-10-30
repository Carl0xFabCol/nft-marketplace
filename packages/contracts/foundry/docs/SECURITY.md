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
