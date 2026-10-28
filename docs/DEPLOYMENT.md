# Deployment and ownership

## Ownership model

`Marketplace` (the router) owns `MarketplaceCore` and `MarketplaceBids`. Users,
the frontend and the indexer interact with the router; NFT approvals go to
`MarketplaceCore`.

**The router owner MUST be a multisig whose admin is an OpenZeppelin
`TimelockController`.** No timelock is implemented inside these contracts.
Every admin action (fees, receiver, launchpad allow-list, pausing, component
migration) is therefore delayed by the timelock.

Recommended topology:

1. Deploy an `Ownable2Step` multisig (e.g. Safe) as the protocol owner.
2. Deploy a `TimelockController` whose proposer/executor is the multisig and
   whose admin is the multisig (or `address(0)` after configuration).
3. Transfer router ownership to the multisig (or directly to the timelock if
   the timelock can call `acceptOwnership`).

Never leave the router owner as a single EOA in production.

## Deployment order

1. Deploy `MarketplaceCore(marketplaceFee, feeReceiver)`.
2. Deploy `MarketplaceBids(core)`.
3. Deploy `Marketplace(core, bids)` (the router).
4. `core.setAuthorizedContract(router, true)`.
5. `core.setAuthorizedContract(bids, false)` is the default; Bids is NOT a
   router. Do not authorize it.
6. `core.transferOwnership(router)` and `bids.transferOwnership(router)`.
7. `router.acceptComponentOwnership()`.
8. `router.configureBidsMarketplace()` — wires `core.setBidsContract(bids)` and
   `bids.setMarketplaceAddress(router)`.
9. Authorize launchpads with `router.setAuthorizedLaunchpad(factory, true)`.
10. Transfer router ownership to the production multisig/timelock.

## Post-deploy checks

- `core.owner() == router` and `bids.owner() == router`.
- `core.bidsContract() == bids` and `bids.marketplace() == router`.
- `core.authorizedContracts(router) == true` and
  `core.authorizedContracts(bids) == false`.
- `router.paused() == false`, `bids.paused() == false`.
- `core.feeReceiver() != address(0)` and `core.marketplaceFee() <= 1000`.
- A launchpad collection registers through
  `registerCollectionFromLaunchpad` and a non-launchpad collection through the
  router only.
- `router.owner()` is the multisig/timelock, not the deployer.
- Run a small list/buy/bid/accept/cancel/withdraw smoke test on the target chain.
- Verify the router has no `receive`/`fallback`: it must never custody ETH.
