claude: Integration Audit: Contracts ↔ Frontend ↔ Indexer ↔ Supabase

1. Executive summary

The contract architecture is sound and the shape of the integration is better than expected: the router emits almost no events, and the indexer correctly watches Core and Bids rather than the router. Address and ABI plumbing already funnels through @marketplace/contracts, with no hardcoded production addresses anywhere else in the monorepo.

The problems are concentrated in four places:

1. Two frontend code paths are hard-broken against the current contracts (acceptTokenBid, acceptCollectionBid — arity changed). Everything else the frontend calls is signature-compatible. The blast radius of the stale ABI is far narrower than the ABI drift suggests.
2. One indexer behaviour is newly wrong because of the architecture change. MarketplaceCore.executeSaleFromBid now emits Sale in addition to TokenBidAccepted/CollectionBidAccepted. Both are handled, both increment collection stats. Live data proves the legacy contracts did not emit Sale on bid acceptance, so this double-count is a regression that activates on the next deployment.
3. The indexer loses events silently. A failed handler is logged, counted, and then the cursor is advanced past it anyway. There is no reorg handling and no confirmation lag.
4. Chain identity is incomplete in the database, and collection_bids/token_bids have no chain_id column at all.

The most important discovery is not a new defect. A previous hardening pass already found most of the database and precision issues, implemented them, and the work was never merged:

▎ Branch fix/bigint-precision, commit fc85e2b (2026-10-28), 89 files, +5118/−560 — contains six SEC-01 migrations (2,254 lines of SQL), a 764-line pgTAP RLS suite, packages/shared/src/listingIdentity.ts, apps/web/lib/chainGuard.ts, and the exact wei/token-id precision fixes. git merge-base --is-ancestor fc85e2b HEAD → not an ancestor. docs/SEC01_STATUS.md sits on main describing that branch's work as "Implemented", including a migration file that does not exist in the tree.

So the single highest-leverage action is recovering an existing branch, not writing new fixes. The live database confirms none of it was applied (listings.chain_id is still nullable; collection_bids/token_bids still have no chain_id).

Verdict on the indexer: minor-to-moderate adaptation, not a redesign. The layering (providers → fetcher → registry → handlers → repositories) is correct and the dispatch key (contractName:eventName) already solves "which contract emitted this". The required changes are localized: one handler must stop double-counting, the orchestrator needs a cursor/reorg fix, and prices must stop going through Number().

The database is nearly empty — 1 collection, 1 listing, 7 NFTs, 32 activity rows, all chain_id = 99801. Migrations are therefore cheap and essentially risk-free right now. This window will not stay open.

---

2. Current architecture map

2.1 Event ownership — the critical fact

┌──────────────────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────┬─────────────────────┐
│ Contract │ Events emitted │ Must be indexed? │

│ Marketplace.sol (router) │ 1 domain event only: ComponentOwnershipTransferStarted (+ OwnershipTransferStarted/Transferred) │ No │

│ MarketplaceCore.sol │ 22 (19 domain + Ownable2Step + Pausable) │ Yes │

│ MarketplaceBids.sol │ 13 (9 domain + Ownable2Step + Pausable) │ Yes │

│ LaunchPad.sol │ 7 (CollectionDeployed, LaunchFeeUpdated, FeesWithdrawn, …) │ Optional │
├──────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┼─────────────────────┤
│ MERC721.sol (Hyperc) │ 9 (incl. ERC-721 Transfer) │ Yes, per collection │

The router is a pure forwarding facade. Indexing Core + Bids is architecturally correct and the current CONTRACTS_TO_INDEX gets this right. apps/indexer/src/config/contracts.config.ts:19-61 monitors exactly MARKETPLACE_CORE and MARKETPLACE_BIDS.

2.2 Exact event signatures (from Foundry artifacts, not source)

MarketplaceCore — I = indexed:
CollectionRegistered(address,address,uint16,bool) [I,I,.,.]
CollectionRegistrationExecuted(address,address) [I,I]
CollectionVerified(address) [I]
CollectionUnverified(address) [I]
CollectionRoyaltyUpdated(address,address,uint16) [I,I,.]
RoyaltyOverrideCleared(address) [I]
RoyaltySourceUsed(address,uint256,uint256,uint8) [I,I,.,.]
ListingCreated(address,uint256,address,uint128,uint64) [I,I,I,.,.]
ListingUpdated(address,uint256,uint128) [I,I,.]
ListingCancelled(address,uint256,address) [I,I,I]
Sale(address,uint256,address,address,uint128,uint128,uint128) [I,I,I,.,.,.,.]
MarketplaceFeeUpdated(uint16,uint16) [.,.]
FeeReceiverUpdated(address,address) [I,I]
LaunchpadAuthorized(address,bool) [I,.]
RouterUpdated(address,address) [I,I]
BidsContractUpdated(address,address) [I,I]
Withdrawal(address,uint256) [I,.]
ExcessETHSwept(address,uint256) [I,.]
Paused(address) / Unpaused(address)

MarketplaceBids:
TokenBidPlaced(address,uint256,address,uint128,uint64) [I,I,I,.,.]
TokenBidAccepted(address,uint256,address,address,uint128) [I,I,I,.,.]
TokenBidCancelled(address,uint256,address) [I,I,I]
CollectionBidPlaced(address,address,uint128,uint32,uint64) [I,I,.,.,.]
CollectionBidAccepted(address,address,address,uint256[],uint128) [I,I,I,.,.]
CollectionBidCancelled(address,address) [I,I]
MarketplaceAddressUpdated(address,address) [I,I]
Withdrawal(address,uint256) / ExcessETHSwept(address,uint256)
Paused(address) / Unpaused(address)

2.3 Operation → emitting contract

┌───────────────────────────┬────────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────────────────────┐
│ Operation │ Entry point │ State + events │
├───────────────────────────┼────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┤
│ Collection registration │ Marketplace.registerCollection (onlyOwner) → │ Core: CollectionRegistered + CollectionRegistrationExecuted (two events, │
│ (external) │ Core.registerCollectionFromRouter │ one registration) │
├───────────────────────────┼────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┤
│ Collection registration │ LaunchPad.createCollection → │ LaunchPad: CollectionDeployed; Core: CollectionRegistered only │
│ (factory) │ Core.registerCollectionFromLaunchpad │ │
├───────────────────────────┼────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┤
│ Listing create / batch │ Marketplace.createListing(Batch) → Core │ Core: ListingCreated, plus RoyaltySourceUsed from the listing-time │
│ │ │ royalty snapshot │
├───────────────────────────┼────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┤
│ Listing update │ Core.updateListingPrice │ Core: ListingUpdated + RoyaltySourceUsed (snapshot recomputed, audit │
│ │ │ H-01) │
├───────────────────────────┼────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┤
│ Listing cancel / batch / │ Core.cancelListing*, Core.cleanStaleListing │ Core: ListingCancelled │
│ stale cleanup │ │ │
├───────────────────────────┼────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┤
│ Purchase / batch purchase │ Core.buy / Core.buyBatch → \_executeSale │ Core: Sale (one per token) + RoyaltySourceUsed │
├───────────────────────────┼────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┤
│ Token bid place / batch │ Bids.placeTokenBid(Batch) │ Bids: TokenBidPlaced (one per token in batch) │
├───────────────────────────┼────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┤
│ Collection bid place │ Bids.placeCollectionBid │ Bids: CollectionBidPlaced │
├───────────────────────────┼────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┤
│ Bid cancel │ Bids.cancel*Bid* │ Bids: TokenBidCancelled / CollectionBidCancelled │
├───────────────────────────┼────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┤
│ Bid acceptance │ Bids.accept*Bid → Core.executeSaleFromBid │ Core: Sale + ListingCancelled (if listed) + RoyaltySourceUsed; Bids: │
│ │ │ TokenBidAccepted / CollectionBidAccepted │
├───────────────────────────┼────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┤
│ Bid expiration │ none — no event; bids simply stop being acceptable │ handled DB-side by cleanup*expired*\* RPCs │
├───────────────────────────┼────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┤
│ Fees / withdrawals │ Core.withdraw, Bids.withdraw, sweepExcessETH │ Core and Bids each: Withdrawal, ExcessETHSwept │
├───────────────────────────┼────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────┤
│ Royalty handling │ Core.\_getRoyalty; override only via │ Core: CollectionRoyaltyUpdated, RoyaltyOverrideCleared, │
│ │ Marketplace.updateCollectionRoyalty │ RoyaltySourceUsed │
└───────────────────────────┴────────────────────────────────────────────────────────────┴──────────────────────────────────────────────────────────────────────────┘

2.4 Changes vs. the previous architecture that affect consumers

┌─────┬──────────────────────────────────────────────────────────────────────────────────────────┬──────────────────────────────────────────────┬───────────────────┐
│ # │ Change │ Consumer impact │ Confirmed? │
├─────┼──────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┼───────────────────┤
│ A-1 │ executeSaleFromBid now emits Sale │ Indexer double-counts volume/sales on bid │ Confirmed (§5, │
│ │ │ acceptance │ C-1) │
├─────┼──────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┼───────────────────┤
│ A-2 │ acceptTokenBid / acceptCollectionBid gained minPrice/minSellerProceeds slippage args │ Frontend calls fail │ Confirmed (§4, │
│ │ │ │ C-2) │
├─────┼──────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┼───────────────────┤
│ A-3 │ ContractAuthorized(address,bool) → LaunchpadAuthorized(address,bool) │ Indexer listens for a non-existent event; │ Confirmed │
│ │ │ the real one is unhandled │ │
├─────┼──────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┼───────────────────┤
│ A-4 │ registerCollection(address,uint16,address,address) on Core split into │ Core ABI obsolete; frontend unaffected (goes │ Confirmed │
│ │ registerCollectionFromRouter / registerCollectionFromLaunchpad │ via router) │ │
├─────┼──────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┼───────────────────┤
│ A-5 │ Listing struct grew from 4 to 6 fields (feeBps, royaltyBps; uint64→uint48 timestamps) │ listings() decode wrong in both ABIs │ Confirmed, not │
│ │ │ │ currently called │
├─────┼──────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┼───────────────────┤
│ │ New events: RoyaltySourceUsed, CollectionRegistrationExecuted, RouterUpdated, │ Unknown topics; decodeEventLog throws → │ Confirmed (noise, │
│ A-6 │ BidsContractUpdated, CollectionUnverified, RoyaltyOverrideCleared │ "Failed to parse event, skipping" warning │ not breakage) │
│ │ │ per sale/listing │ │
├─────┼──────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┼───────────────────┤
│ A-7 │ emergencyUpdateCollectionRoyalty, setAuthorizedContract removed │ Dead entries in both ABIs │ Confirmed │
├─────┼──────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┼───────────────────┤
│ A-8 │ LaunchPad.getCollectionsCreatedBy(address,uint256,uint256) → │ LaunchPad ABI wrong; no current caller │ Confirmed │
│ │ getCollectionsCreatedBy(address) + getCollectionsCreatedByPage(...) │ │ │
└─────┴──────────────────────────────────────────────────────────────────────────────────────────┴──────────────────────────────────────────────┴───────────────────┘

2.5 What must be monitored

┌──────────────────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Address │ Events to index │
├──────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ │ CollectionRegistered, CollectionVerified, CollectionUnverified, CollectionRoyaltyUpdated, RoyaltyOverrideCleared, ListingCreated, │
│ MARKETPLACE_CORE │ ListingUpdated, ListingCancelled, Sale, MarketplaceFeeUpdated, FeeReceiverUpdated, LaunchpadAuthorized, OwnershipTransferred, Paused, │
│ │ Unpaused │
├──────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ MARKETPLACE_BIDS │ all 6 bid events, OwnershipTransferred, Paused, Unpaused │
├──────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ LAUNCHPAD (not currently │ CollectionDeployed — optional; CollectionRegistered already covers registration, and name/symbol are fetched by RPC │
│ monitored) │ │
├──────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ each registered │ ERC-721 Transfer (already dynamic) │
│ collection │ │
├──────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ MARKETPLACE (router) │ nothing │
└──────────────────────────┴─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

Bold = currently missing. RoyaltySourceUsed and CollectionRegistrationExecuted should be explicitly excluded — the latter would double-insert a registration if ever handled.

---

3. Address inventory and problems

3.1 Inventory

┌────────────────────────────────────────────────┬────────────────────────────────────────────────────────────────────────────────┬──────────────────────────────────┐
│ Location │ Content │ State │
├────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────┤
│ packages/contracts/src/addresses.ts:19-21 │ SEPOLIA*ADDRESSES (3 addrs, no LaunchPad) │ unverified, origin unknown │
├────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────┤
│ packages/contracts/src/addresses.ts:26-29 │ ELYSIUM_ADDRESSES (4 addrs) │ legacy pre-audit stack │
├────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────┤
│ packages/contracts/src/addresses.ts:63-66 │ MARKETPLACE*/BIDS*/CORE*/LAUNCHPAD*CONTRACT_ADDRESS singletons → hardcoded to │ re-export layer │
│ │ Elysium │ │
├────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────┤
│ apps/web/lib/constants.ts:11 │ re-exports 3 of the 4 singletons │ re-export only ✓ │
├────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────┤
│ apps/web/hooks/useContractAddresses.ts │ getContractAddresses(useChainId()) │ correct pattern ✓ │
├────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────┤
│ apps/indexer/src/config/contracts.config.ts:13 │ getContractAddresses(env.chainId) │ correct pattern ✓ │
├────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────┤
│ packages/contracts/foundry/deployments/ │ only archive/ + deleted latest.json │ no live record │
├────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────┤
│ packages/contracts/foundry/.env │ CORE*/BIDS*/MARKETPLACE*/LAUNCHPAD_ADDRESS = legacy stack │ inert unless │
│ │ │ USE_ENV_ADDRESSES=true │
├────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────┤
│ broadcast/\*\*/99801/ │ 6 tracked logs with legacy addresses │ tracked build output │
├────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────┤
│ Elsewhere in monorepo │ none — only 8 test fixtures │ ✓ clean │
└────────────────────────────────────────────────┴────────────────────────────────────────────────────────────────────────────────┴──────────────────────────────────┘

3.2 Findings

ADDR-1 · HIGH · packages/contracts/src/addresses.ts:26-29
Both ELYSIUM_ADDRESSES and the archived record point at the pre-audit stack. Verified live:
cast call 0x0726b653…75be 'router()(address)' → execution reverted: Invalid call
cast call 0x0726b653…75be 'owner()(address)' → 0xabD5209…4bdb (the legacy router)
Problem: router() and bidsContract() do not exist on that build — it is ABI-incompatible with current src/. Nothing in the deployment runbook updates addresses.ts, so a successful 3-step deployment leaves the app talking to the unaudited contracts with no signal. This is the most likely way the deployment "succeeds" and is still broken.
Fix: generate addresses.ts from the verified record (§8); add a deployment step that fails if the file is stale.

ADDR-2 · MEDIUM · packages/contracts/src/addresses.ts:46-56
if (!addresses) { console.warn(...); return CONTRACT_ADDRESSES[DEFAULT_ADDRESSES_CHAIN_ID] }
Problem: an unsupported chain silently yields Elysium addresses. On mainnet or any other chain the app would construct transactions against addresses that are either dead or belong to someone else. A console.warn is not a control. addresses.test.ts:43-49 asserts this fallback, so it is deliberate — but it is the wrong default for a value that determines where funds go.
Fix: return undefined/throw; let callers render a "switch network" state.

ADDR-3 · MEDIUM · three disagreeing chain defaults

┌─────────────────────────────────────────┬────────────┐
│ Source │ Default │
├─────────────────────────────────────────┼────────────┤
│ packages/shared/src/constants.ts:16 │ 99801 │
├─────────────────────────────────────────┼────────────┤
│ packages/contracts/src/addresses.ts:39 │ 99801 │
├─────────────────────────────────────────┼────────────┤
│ apps/indexer/src/config/env.ts:71 │ 11155111 │
├─────────────────────────────────────────┼────────────┤
│ apps/indexer/src/providers/chains.ts:40 │ ?? sepolia │
└─────────────────────────────────────────┴────────────┘

Problem: an indexer started without CHAIN_ID indexes Sepolia addresses into a database whose every row is chain_id = 99801. The live .env sets CHAIN_ID=99801, so this is latent — but it is one missing env var from silent cross-chain corruption.
Mitigating control (verified): apps/indexer/src/index.ts:125-144 compares provider.getChainId() to env.chainId and refuses to start on mismatch. That catches it only if the RPC URL also disagrees.
Fix: make CHAIN_ID required; delete both fallbacks.

ADDR-4 · MEDIUM · packages/contracts/src/addresses.ts:19-21 — Sepolia addresses have no verified provenance and no LAUNCHPAD. addresses.test.ts:11-15 pins them as literals, which asserts the hardcoding rather than its correctness. Either generate them from a verified Sepolia record or remove Sepolia support.

ADDR-5 · LOW · packages/contracts/foundry/.env — four stale \*\_ADDRESS values pointing at the dead stack. Inert today; one USE_ENV_ADDRESSES=true away from redirecting every script. Remove them. (Separately: FAST_RPC_URL embeds an access token in its path — treat that line as a secret.)

3.3 Proposed design: generate-addresses from a verified record only

packages/contracts/scripts/generate-addresses.ts
input : foundry/deployments/<network>.json (one or more)
output: packages/contracts/src/addresses.generated.ts ← committed, never hand-edited

Reject, with a non-zero exit and no write, unless all hold for every record consumed:

1. stage === "verified" and configured === true — the only writer of both is VerifyDeployment, which runs as a separate process against real chain state.
2. chainId present, a positive integer, and equal to the NETWORK the filename encodes.
3. core, bids, marketplace all present and non-zero; launchpad either absent or non-zero.
4. All four addresses distinct and EIP-55 checksummed.
5. Live code check against that chain's RPC: eth_getCode(addr) !== "0x" for each.
6. Live cohesion check: bids.core() == core, router.core() == core, router.bids() == bids, launchpad.core() == core.
7. Live version fingerprint: core.OWNER_QUERY_GAS() answers (absent on the legacy build — verified above). This is what distinguishes "current build" from "older deployment with the same getters".
8. eth_chainId of the RPC equals the record's chainId.
9. No two records share a chainId.

Then emit a flat, literal map plus a DEPLOYMENT_METADATA block (chainId, addresses, verifiedAt, deployer, commit SHA). Keep addresses.ts as a thin re-export of the generated file so existing imports are untouched, and have getContractAddresses return undefined for unknown chains.

A --check mode that regenerates into memory and diffs against the committed file turns this into a CI gate: the build fails if the committed addresses do not match the verified records.

---

4. ABI inventory and problems

4.1 Inventory

┌──────────────────────────────┬───────┬───────────────────────────┬────────────────────────────────────────────┐
│ File │ Lines │ Source │ Consumers │
├──────────────────────────────┼───────┼───────────────────────────┼────────────────────────────────────────────┤
│ abis/marketplace.abi.ts │ 1089 │ hand-pasted, date unknown │ web (10 hooks), not indexer │
├──────────────────────────────┼───────┼───────────────────────────┼────────────────────────────────────────────┤
│ abis/marketplace-core.abi.ts │ 1363 │ hand-pasted │ indexer (decoding), web (reads) │
├──────────────────────────────┼───────┼───────────────────────────┼────────────────────────────────────────────┤
│ abis/marketplace-bids.abi.ts │ 957 │ hand-pasted │ indexer (decoding) │
├──────────────────────────────┼───────┼───────────────────────────┼────────────────────────────────────────────┤
│ abis/launchpad.abi.ts │ 550 │ hand-pasted │ web (launchpad page) │
├──────────────────────────────┼───────┼───────────────────────────┼────────────────────────────────────────────┤
│ abis/micoleccion.abi.ts │ 1103 │ hand-pasted │ web (mint flow) │
├──────────────────────────────┼───────┼───────────────────────────┼────────────────────────────────────────────┤
│ abis/nft.abi.ts │ 73 │ hand-written minimal │ web │
├──────────────────────────────┼───────┼───────────────────────────┼────────────────────────────────────────────┤
│ abis/mock-nft.abi.ts │ 309 │ hand-pasted │ web (MockAbi) │
├──────────────────────────────┼───────┼───────────────────────────┼────────────────────────────────────────────┤
│ apps/web/lib/abi.ts │ 20 │ pure re-export ✓ │ web │
├──────────────────────────────┼───────┼───────────────────────────┼────────────────────────────────────────────┤
│ viem erc721Abi │ — │ library │ 4 web files, MetadataFetcher, orchestrator │
└──────────────────────────────┴───────┴───────────────────────────┴────────────────────────────────────────────┘

Positive findings: apps/web/lib/abi.ts is a genuine re-export with no duplication (a prior cleanup removed ~1100 duplicated lines). The four web files flagged as "local ABIs" use viem's canonical erc721Abi for standard ERC-721 calls — correct, not duplication. No consumer bypasses @marketplace/contracts.

4.2 Drift, measured artifact-vs-TypeScript

┌────────────────────┬────────────────┬─────────────────┬─────────────┬──────────────┬────────────────┐
│ ABI │ Events missing │ Events obsolete │ Fns missing │ Fns obsolete │ Errors missing │
├────────────────────┼────────────────┼─────────────────┼─────────────┼──────────────┼────────────────┤
│ MarketplaceABI │ 1 │ 0 │ 7 │ 4 │ 5 │
├────────────────────┼────────────────┼─────────────────┼─────────────┼──────────────┼────────────────┤
│ MarketplaceCoreABI │ 6 │ 1 │ 16 │ 4 │ 11 │
├────────────────────┼────────────────┼─────────────────┼─────────────┼──────────────┼────────────────┤
│ MarketplaceBidsABI │ 0 ✓ │ 0 ✓ │ 4 │ 2 │ 9 │
├────────────────────┼────────────────┼─────────────────┼─────────────┼──────────────┼────────────────┤
│ LaunchPadABI │ 0 │ 1 │ 2 │ 1 │ 1 │
├────────────────────┼────────────────┼─────────────────┼─────────────┼──────────────┼────────────────┤
│ MiColeccionABI │ 0 ✓ │ 0 ✓ │ 1 │ 2 │ 1 │
└────────────────────┴────────────────┴─────────────────┴─────────────┴──────────────┴────────────────┘

4.3 Findings

ABI-1 · CRITICAL · apps/web/hooks/useBidActions.ts:89-121 — bid acceptance is broken.
// line 93-99
const acceptTokenBid = async (collection, tokenId: number, bidder) =>
writeContractAsync({ abi: MarketplaceABI, functionName: "acceptTokenBid",
args: [collection, BigInt(tokenId), bidder] }) // 3 args
// line 110-116
args: [collection, bidder, tokenIds] // 3 args
Measured against the artifact:
DIFF acceptTokenBid ts: (address,uint256,address) now: (address,uint256,address,uint128,uint128)
DIFF acceptCollectionBid ts: (address,address,uint256[]) now: (address,address,uint256[],uint128,uint128)
Problem: the new minPrice/minSellerProceeds slippage parameters change the selector. With the stale ABI the call encodes a selector the new router does not have → fallback() → revert. Regenerate the ABI and viem rejects the 3-argument call at encode time. Accepting any bid is impossible on the new deployment until both hooks pass the two slippage bounds.
Fix: regenerate the ABI, then thread slippage values through useAcceptTokenBid/useAcceptCollectionBid from the UI (the bid price the seller saw, minus tolerance). This is a UI change, not a mechanical one — a wrong default here silently accepts a worse price than displayed.

ABI-2 · HIGH · abis/marketplace-core.abi.ts — the indexer decodes Core logs with an ABI missing 6 current events and containing 1 removed one. BatchEventFetcher.ts:199-233 calls decodeEventLog on every Core log, so unknown topics throw and are swallowed as "⚠️ Failed to parse event, skipping" — a warning per sale and per listing, because RoyaltySourceUsed fires on both. No corruption, but it masks real decode failures in the same log line.

ABI-3 · HIGH · both ABIs, listings(address,uint256)
ts : -> ((address,uint128,uint64,uint64))
now: -> ((address,uint128,uint48,uint48,uint16,uint16))
Problem: a 4-field decode of a 6-field struct. Not currently called by the frontend (not in the functionName inventory), so this is latent — but it is exactly the kind of thing that breaks the first time someone reads a listing on-chain.

ABI-4 · MEDIUM · contracts.config.ts:28 — "ContractAuthorized" is requested from Core. The event was renamed to LaunchpadAuthorized; the stale ABI still carries the old definition so nothing crashes, but the topic never matches. CoreEventHandler.ts:471-497 (ContractAuthorizedHandler) is unreachable dead code, and launchpad authorization is unindexed.

ABI-5 · MEDIUM — obsolete entries invite calls to functions that no longer exist: emergencyUpdateCollectionRoyalty, setAuthorizedContract (both ABIs), Core.registerCollection(address,uint16,address,address), Core.authorizedContracts, LaunchPad.getCollectionsCreatedBy(address,uint256,uint256), the CollectionRegisteredOnMarketplace event, Hyperc.setMaxSupply/setMintDuration.

ABI-6 · LOW — 27 custom errors across the three contracts are absent from the TS ABIs (RoyaltyExceedsPrice, InsufficientGas, BoundedStaticCallInsufficientGas, SellerProceedsTooLow, CorePaused, …). viem cannot name them, so users see raw revert data instead of a reason. MarketplaceBidsABI additionally declares three errors that no longer exist.

4.4 Proposed design: generate-abis from Foundry artifacts

packages/contracts/scripts/generate-abis.ts
input : foundry/out/<Contract>.sol/<Contract>.json (requires `forge build` first)
output: packages/contracts/src/abis/<name>.generated.ts ← committed

Mechanics: read .abi, drop constructor/fallback/receive, sort deterministically by (type, name, signature) so diffs are reviewable, emit export const XAbi = [...] as const satisfies Abi.

Per-consumer slicing — not every consumer needs every ABI:

┌─────────────────────────────────┬─────────────────────────────────────────────┬─────────────────────────────────────┐
│ Bundle │ Contents │ Consumer │
├─────────────────────────────────┼─────────────────────────────────────────────┼─────────────────────────────────────┤
│ abis/events │ events only, Core + Bids + ERC-721 Transfer │ indexer — it never calls a function │
├─────────────────────────────────┼─────────────────────────────────────────────┼─────────────────────────────────────┤
│ abis/full │ complete ABIs incl. functions and errors │ web │
├─────────────────────────────────┼─────────────────────────────────────────────┼─────────────────────────────────────┤
│ abis/launchpad, abis/collection │ per-feature │ web, lazily │
└─────────────────────────────────┴─────────────────────────────────────────────┴─────────────────────────────────────┘

This matters concretely: the indexer currently ships 1363 lines of Core function definitions it never uses, and the web ships Core/Bids ABIs it mostly does not call. Slicing also makes ABI-2 structurally impossible — an events-only bundle regenerated from artifacts cannot omit an event.

Guardrails:

- --check mode diffs regenerated output against committed files → CI gate.
- A build-time assertion that every event name in CONTRACTS_TO_INDEX.events exists in the generated bundle. ABI-4 would have failed this immediately.
- Stamp the generated header with the artifact's metadata.solc version and source hash.

---

5. Indexer compatibility findings

Traced every indexed event end to end: Solidity → ABI → contracts.config.ts → BatchEventFetcher.decodeEventLog → HandlerRegistry.dispatch → handler → repository → PostgREST.

5.1 Confirmed defects

IDX-1 · CRITICAL · double-counted volume and sales on bid acceptance
MarketplaceCore.sol:443 (inside executeSaleFromBid) and MarketplaceBids.sol:205,359:
solidity
// Core.executeSaleFromBid — called by Bids on every acceptance
emit Sale(collection, tokenId, seller, buyer, price, marketplaceFeeAmount, royaltyAmount);
// Bids.acceptTokenBid / acceptCollectionBid
emit TokenBidAccepted(...); emit CollectionBidAccepted(...);
Both are indexed, and both increment stats:
CoreEventHandler.ts:363 await this.collectionsRepo.incrementStats(collection, Number(price) / 1e18, 1)
BidsEventHandler.ts:226 await this.collectionsRepo.incrementStats(collection, Number(totalPrice) / 1e18, tokenIds.length)
BidsEventHandler.ts:368 await this.collectionsRepo.incrementStats(collection, Number(price) / 1e18, 1)
Evidence that this is a new regression: the live database contains zero SALE activity rows and six bid acceptances. Summing their activity prices — 1e16 + 5e15 + 4 × 5e16 = 2.15e17 — matches both collections.total_volume = 0.215 and the on-chain legacy getCollectionStats → (215000000000000000, 6, false, true) exactly. The legacy contracts did not emit Sale on acceptance, so the double path never fired. On the new deployment the same six acceptances would yield total_volume = 0.43, total_sales = 12.
Fix: Sale is the single authoritative source of volume/sales — it is emitted on every ownership change for value, from both the buy path and the bid path. Remove incrementStats from both bid-accepted handlers. Keep their activity rows and bid-lifecycle updates.

IDX-2 · CRITICAL · cursor advances past failed events → permanent silent loss
IndexerOrchestrator.ts:226-257:
for (const event of events) {
try { await this.handlerRegistry.dispatch(event); successCount++ }
catch (error) { errorCount++; logger.error(...) /_ Continue processing other events _/ }
}
...
await this.stateRepo.updateLastBlock(this.config.chainId, Number(toBlock)) // unconditional
HandlerRegistry.dispatch re-throws (line 88) specifically so "upper layers decide crash vs. skip" — the orchestrator chooses skip, then checkpoints anyway.
Problem: one transient Supabase error drops a Sale or ListingCreated forever. No retry, no dead-letter, and errorCount is only logged. This is the worst defect in the indexer because the damage is invisible.
Fix: if errorCount > 0, do not advance the cursor; advance only to the highest fully-processed block. Add a failed_events table or per-event retry with backoff.

IDX-3 · HIGH · no reorg handling, zero confirmation lag
IndexerOrchestrator.ts:169-178: toBlock = await provider.getBlockNumber() — indexed to the chain head with no safety margin, no blockHash recorded, no rollback. Compounded by providerPool.executeWithFallback: different providers return different heights, so updateLastBlock can move the cursor backwards, re-processing a range. Activity is idempotent, but insertTokenBid/insertCollectionBid are plain inserts and incrementStats is additive — re-processing duplicates bids and inflates volume.
Fix: subtract a confirmation lag; clamp the cursor monotonically (newLast = max(oldLast, toBlock)); persist last_block_hash and roll back when the stored hash no longer matches.

IDX-4 · HIGH · wei → Number() precision loss
CoreEventHandler.ts:212 (price: Number(price)), :258 (Number(newPrice)), BidsEventHandler.ts:143,300, ListingsRepository.ts:24,68, BidsRepository.ts:50,154.
Problem: uint128 wei exceeds Number.MAX_SAFE_INTEGER (2^53 ≈ 9.0e15). 1234567890123456789n → 1234567890123456800. Core.buy requires msg.value == listing.price exactly, so a rounded DB price makes the purchase revert — the listing becomes unbuyable through the UI.
Proof inside this repo: two writers target the same numeric column with different fidelity.
apps/web/actions/listings/createBatch.ts:58 price: prices[index] // decimal string → exact
apps/indexer/.../ListingsRepository.ts:40 price: params.price // JS number → lossy
activity.price is text and holds "1000000000000000000" exactly; listings.price is numeric fed from a double. Currently masked because every test value is a round power of ten (1e18, 1e16, 5e15), all of which happen to be exactly representable.
Fix: carry wei as strings end to end. This is already implemented on fix/bigint-precision.

IDX-5 · HIGH · missing event listeners

┌────────────────────────────────┬──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Event │ Consequence │
├────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ CollectionUnverified │ collections.is_verified can be set true but never back to false — a revoked verification badge persists indefinitely │
├────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ LaunchpadAuthorized │ launchpad authorization changes invisible │
├────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ CollectionRoyaltyUpdated │ collections.royalty_fee never updates after an owner override; the UI shows the registration-time fallback │
├────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ RoyaltyOverrideCleared │ same, in reverse │
├────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Withdrawal (Core + Bids) │ seller proceeds and pending balances untracked │
├────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ CollectionDeployed (LaunchPad) │ LaunchPad not monitored at all │
└────────────────────────────────┴──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

CollectionVerified is handled (CoreEventHandler.ts:157-176) — the asymmetry makes verification a one-way latch. That is a confirmed integrity bug, not a gap in coverage.

IDX-6 · HIGH · bid writes have no chain_id
BidsRepository.ts:51-59, 155-163 insert into collection_bids/token_bids with no chain_id, and every filter (lines 29-31, 97-98, 116-117, 139-141, 181-183) omits it. The columns do not exist (§6). Consequences:

- deactivateCollectionBid(collection, bidder) deactivates that bidder's bid on every chain.
- getActiveCollectionBid(...).single() (line 77) throws if two chains both have an active bid for the same (collection, bidder) → returns null → the partial-fill branch at BidsEventHandler.ts:193 is skipped entirely and quantity never decrements.

IDX-7 · MEDIUM · non-idempotent bid processing
insertCollectionBid/insertTokenBid are plain inserts — reprocessing a block duplicates rows. Worse, BidsEventHandler.ts:191-203 derives remaining quantity from database state:
const existingBid = await this.bidsRepo.getActiveCollectionBid(...)
const remainingQuantity = existingBid.quantity - tokenIds.length
Reprocessing decrements twice; a missed event leaves it permanently wrong. On-chain, collectionBids[collection][bidder] is a single slot with an authoritative quantity — the DB should mirror that identity with a unique constraint and read remaining quantity from the chain or recompute from the event stream, not from its own prior row.

IDX-8 · MEDIUM · backfill cannot checkpoint
Live state: indexer_state.last_block = 16,454,480; Elysium head = 24,721,526 → a 8.27 million block gap. BatchEventFetcher.fetchEventsForContracts chunks the whole range (BLOCK_SIZE=100000 from .env → ~83 chunks), accumulates every event in memory (allEvents.flat(), line 92), and returns only after all chunks complete. The cursor is written once, at the very end. If any chunk throws, runSingleIteration re-throws and the next poll restarts the entire range from scratch — it can never converge.
Fix: checkpoint per chunk; stream handling instead of accumulating. For the new deployment, seed indexer_state.last_block to the deployment block so the gap is zero (that is step 8 of §8).

IDX-9 · MEDIUM · blockTimestamp works on Elysium by luck
BatchEventFetcher.ts:216: blockTimestamp: Number(rawEvent.blockTimestamp || 0). eth_getLogs does not include a timestamp in the standard JSON-RPC response. Verified:

- Elysium does return it — log keys include blockTimestamp — and viem preserves it (viem/utils/formatters/log.js: blockTimestamp: log.blockTimestamp ? BigInt(log.blockTimestamp) : …). Live activity.created_at values are correct (2026-10-24T19:11:16+00:00).
- On an RPC that omits it: Number(undefined || 0) → 0 → every created_at becomes 1970-01-01, silently.
  Fix: throw if blockTimestamp is absent, or fall back to a cached getBlock(blockNumber).timestamp.

IDX-10 · MEDIUM · admin events overload collection_address
CoreEventHandler.ts:391,422,455,488,507,524 and BidsEventHandler.ts:421,438 write collection_address: CORE_CONTRACT_ADDRESS / BIDS_CONTRACT_ADDRESS for MARKETPLACE_FEE_UPDATED, PAUSED, etc. activity.collection_address has no FK so it does not break, but token_bids/collection_bids/nfts do FK to collections.contract_address, and any future FK on activity would reject these rows. Queries filtering activity by collection will surface marketplace-admin events as collection activity.

IDX-11 · MEDIUM · duplicate repository layer
packages/database/src/repositories/{listings,collections,activity}.repo.ts reimplement the indexer's repositories with the same defects (listings.repo.ts:71 → onConflict: "listing_id"; collections.repo.ts:106 → onConflict: "contract_address"). The indexer imports only createServiceClient from that package (apps/indexer/src/supabase.ts:2) and uses its own src/persistence/\*. Nothing consumes the duplicates except their own tests. Two copies of the same bug means a fix lands in one and not the other.

IDX-12 · LOW — CollectionRegistrationExecuted must stay unindexed: the router registration path emits it alongside CollectionRegistered (MarketplaceCore.sol:509 and :525), so handling both would double-insert every externally registered collection.

5.2 Verified correct — do not change

┌───────────────────────────────┬────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Behaviour │ Evidence │
├───────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Indexes Core + Bids, not the │ contracts.config.ts:19-61; the router emits one non-domain event │
│ router │ │
├───────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Per-contract event dispatch │ HandlerRegistry.getKey → "core:Paused" ≠ "bids:Paused"; both handled separately │
├───────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Activity idempotency │ ActivityRepository.ts:47 → onConflict: "tx_hash,log_index", ignoreDuplicates: true; zero duplicate (tx_hash, log_index) pairs in │
│ │ live data │
├───────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ NFT identity is chain-scoped │ NFTRepository.ts:41 → onConflict: "collection_address,token_id,chain_id" │
├───────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ TransferHandler │ stateless, idempotent, handles mint/burn/transfer and back-fills a missed mint (TransferHandler.ts:86-101) │
├───────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ RPC chain validation at │ index.ts:125-144 refuses to start if provider.getChainId() !== env.chainId │
│ startup │ │
├───────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Chunking is gap-free │ BlockRangeUtil.chunk(minFromBlock, toBlock, batchSize) covers the full range, so advancing to toBlock is consistent with what was │
│ │ fetched │
├───────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ contract_indexer_state │ onConflict: "contract_address,chain_id" has demonstrably succeeded — the live row's last_block (16,454,480) advanced to match │
│ composite key │ indexer_state, which is impossible if the unique index were missing (Postgres 42P10). Not a bug. │
├───────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Batch events handled │ buyBatch → one Sale per token; placeTokenBidBatch → one TokenBidPlaced per token (MarketplaceBids.sol:322); CollectionBidAccepted │
│ correctly │ carries tokenIds[] and the handler loops (BidsEventHandler.ts:206-210) │
├───────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Bid/listing expiry │ handled DB-side by cleanup_expired_listings, cleanup_expired_token_bids, cleanup_expired_collection_bids, expire_stale_records — │
│ │ correct, since expiry emits no event │
└───────────────────────────────┴────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

5.3 State that cannot be reconstructed from indexed events

┌────────────────────────────────────┬───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ State │ Why │
├────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ collections.total_volume / │ additive RPC with no idempotency key; any replay or double-path inflates it permanently. Should be derived (sum/count over │
│ total_sales │ SALE activity) or reconciled against Core.getCollectionStats │
├────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ collection_bids.quantity │ derived from prior DB state (IDX-7), not from the chain │
├────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ collections.royalty_fee │ CollectionRoyaltyUpdated unindexed; and the registered value is only a fallback — Core.\_getRoyalty prefers ERC-2981 unless │
│ │ royaltyOverridden is set, which the DB does not model at all │
├────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ collections.floor_price │ update_collection_floor_price RPC exists but no handler calls it │
├────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Seller proceeds / pending │ Withdrawal unindexed │
│ withdrawals │ │
├────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ nfts.owner_wallet after a missed │ self-healing via TransferHandler, but only on the next transfer │
│ Transfer │ │
└────────────────────────────────────┴───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

Verdict: adaptation, not redesign. IDX-1 is a three-line deletion. IDX-2/IDX-3 are confined to runSingleIteration. IDX-4 exists on an unmerged branch. IDX-5 is five new handler classes following the existing pattern. IDX-6 needs the migration. The architecture is fine.

---

6. Database compatibility findings

Method note: find . -name "\*.sql" returns nothing on main — the schema is not version-controlled. All schema facts below come from read-only PostgREST OpenAPI introspection plus read-only row sampling.

6.1 Live schema

12 relations: activity, collections, listings, nfts, token_bids, collection_bids, nfts_market_view, indexer_state, contract_indexer_state, profiles, nonces, user_wallets.

Thirteen RPCs; chain-awareness is inconsistent:
get*collection_nft_stats(p_chain_id, p_collection_address) ← chain-aware
get_collections_by_holders(p_chain_id, p_limit) ← chain-aware
increment_collection_stats(p_collection_address, p_sales, p_volume) ← NOT
get_collection_stats(p_collection_address) ← NOT
update_collection_floor_price(p_collection_address) ← NOT
get_top_collections(p_limit, p_order_by) ← NOT
cleanup_expired*{listings,token_bids,collection_bids}() ← NOT

Live data: 1 collection, 1 listing, 7 NFTs, 32 activity rows, 2 collection bids, ≥3 token bids. All chain_id = 99801.

6.2 Findings

DB-1 · HIGH · collection_bids, token_bids — no chain_id column
Confirmed in both the OpenAPI definition and sampled rows. collection_bids has 10 columns, token_bids 10; neither includes chain_id, while collections, listings, nfts all do (and activity has one, as text).
Problem: bid identity cannot be expressed. Two chains' bids share rows; deactivate\* crosses chains; getActiveCollectionBid(...).single() throws once a second chain has data. nfts_market_view.best_token_bid / best_collection_bid join chain-less bids onto chain-scoped NFTs, so the view can show a Sepolia bid on an Elysium NFT.
Also: the web cannot filter by chain here even if it wanted to — nft.service.ts:47,303,335, user.service.ts:120,130,145,147, app/collection/[colAddress]/page.tsx:20 all query bids with no chain predicate.

DB-2 · HIGH · collections identity excludes chain_id
collections.chain_id is integer NOT NULL, but uniqueness is on contract_address alone. Proof: nfts.collection_address, token_bids.collection_address and collection_bids.collection_address all carry <fk table='collections' column='contract_address'/>, and a Postgres FK requires a UNIQUE on the referenced column. Matched by CollectionsRepository.ts:46 → onConflict: "contract_address".
Problem: the same collection address cannot exist on two chains — a realistic scenario for deterministically deployed collections. updateVerificationStatus (line 65), updateIndexerBlock (line 77) and increment_collection_stats all filter by address only, so they mutate the wrong chain's row. Independently identified as SEC-01 P1.7.

DB-3 · HIGH · listings identity excludes chain_id
listings.chain_id is integer and nullable. Uniqueness is on listing_id alone — proven by two independent onConflict: "listing_id" upserts that work in production (ListingsRepository.ts:50, createBatch.ts:68); a missing index would fail with 42P10. And listing_id is chain-less by construction:
CoreEventHandler.ts:208 listingId: `${collection.toLowerCase()}-${tokenId}`
createBatch.ts:55 listing_id: `${collections[index].toLowerCase()}-${tokenId}`
Live row: "0xa28c62e3970f72153c5a76fd5624807262376b92-1".
Problem: a Sepolia listing for the same (collection, tokenId) overwrites the Elysium row, flipping chain_id, status and source. updatePrice (line 71) and deactivate (line 93) filter on listing_id only → they mutate the wrong chain. The frontend can trigger this: createBatch.ts writes optimistic listings with the same chain-less key.

DB-4 · MEDIUM · activity.chain_id is text with default 11155111
Live value: the string "99801", while listings/nfts/collections hold integer 99801, indexer_state.chain_id is numeric, and contract_indexer_state.chain_id is integer. Four types for one logical column, and the default points at the wrong network. ActivityRepository.ts:35 writes a JS number; Postgres coerces it. Works, but joins and comparisons across tables are text-vs-integer.

DB-5 · MEDIUM · increment_collection_stats takes no p_chain_id
Confirmed from the RPC signature. Combined with DB-2, collection stats are not chain-separable. Also receives Number(price) / 1e18 — a float — so numeric aggregates accumulate binary rounding error.

DB-6 · MEDIUM · indexer_state has no unique constraint on chain_id
PK is id (bigint); chain_id is numeric NOT NULL but not unique. getState uses .eq("chain_id", …).single() → throws on a duplicate; updateLastBlock would update all matching rows. One live row (id=3). Low likelihood, trivial to prevent.

DB-7 · MEDIUM · no bootstrap path for a new deployment
IndexerOrchestrator.ts:122-126: if getState returns no row it logs "No indexer state found for chain" and returns — forever. There is no insert path. After the redeploy, indexer_state.last_block must be set to the new deployment block by an out-of-band step, or the indexer will either do nothing or attempt an 8M-block backfill it cannot complete (IDX-8).

DB-8 · MEDIUM · apps/web/lib/supabase/types.ts is hand-maintained and wrong
activity, token_bids, collection_bids Row types all omit chain_id. For the bids tables that matches reality; for activity it does not — the live column exists, so user.service.ts:246's .eq("chain_id", DEFAULT_CHAIN) is an untyped query that happens to work. Conversely, lines 263-273 declare composite FKs on ["collection_address","token_id","chain_id"] that the live schema does not have. packages/database/package.json:15 has a generate-types script writing to packages/database/src/types.ts — a file that does not exist. The types describe neither the live schema nor the local one.

DB-9 · MEDIUM · web read/write chain split-brain
useContractAddresses() resolves addresses from useChainId() (the connected wallet), while reads use a module constant:
nft.service.ts:112,119,211,220 .eq("chain_id", DEFAULT_CHAIN)
user.service.ts:37,246 .eq("chain_id", DEFAULT_CHAIN)
Problem: a wallet on Sepolia reads Elysium data and writes to Sepolia contracts. Additionally, listings is never chain-filtered in any of its 8 query sites, and collections is unfiltered at nft.service.ts:49, ColInfo.tsx:23 and app/collection/[colAddress]/page.tsx:27. Already documented as SEC-01 P0.1; the fix (apps/web/lib/chainGuard.ts) exists only on the unmerged branch.

DB-10 · MEDIUM, security · nonces is readable by the anon key
Anon GET /rest/v1/nonces?limit=1 → 200, 1 row. app/api/auth/nonce/route.ts:15 inserts the nonce; app/api/auth/login/route.ts:27 consumes it. A nonce that any client can enumerate before use weakens the challenge-response property it exists to provide. Worth confirming against the intended SEC-01 trust boundary.

DB-11 · MEDIUM, security · user_wallets.supabase_password
A column literally named supabase_password, text NOT NULL, exposed through PostgREST. RLS does block anon (200, 0 rows), as it does for indexer_state and contract_indexer_state. Still: storing a password in an application table is the kind of thing 20261028090000_sec01_wallet_trust_boundary.sql (556 lines, unmerged) appears designed to address.

DB-12 · LOW · SUPABASE*SERVICE_ROLE_KEY in apps/web/.env — not NEXT_PUBLIC*, so not bundled, but it means web server actions can bypass RLS entirely. Verify every use is behind requireWalletMatch-style authorization (createBatch.ts:46 does this correctly).

DB-13 · LOW · activity conflict target omits chain_id — onConflict: "tx_hash,log_index". Across EIP-155 chains, transaction hashes do not collide, so this is safe in practice and the live data shows zero duplicates. No change needed.

6.3 Compatibility with SEC-01

SEC-01 is documented but not in the tree and not applied to the database.

┌────────────────────────────────────────────────────────────────────────────────────────────┬───────────────────────────────────────────────────────────────────────┐
│ Claim in docs/SEC01_STATUS.md │ Reality │
├────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────┤
│ "packages/database/migrations/20261028090500_sec01_listing_chain_identity.sql" │ absent from main; present on fc85e2b (450 lines) │
├────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────┤
│ "Drops single-column listing_id uniqueness; adds UNIQUE (chain_id, collection_address, │ onConflict: "listing_id" works in production → the single-column │
│ token_id)" │ unique is still there │
├────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────┤
│ "Sets listings.chain_id NOT NULL" │ OpenAPI shows chain_id not in required → still nullable │
├────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────┤
│ "Indexer upserts on chain_id,collection_address,token_id" │ ListingsRepository.ts:50 → onConflict: "listing_id" │
├────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────┤
│ "Listing.chain_id non-null" │ packages/shared/src/types/listing.ts:10 → chain_id: number | null │
├────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────────────┤
│ "Shared canonicalization" (listingIdentity.ts) │ absent; exists on fc85e2b │
└────────────────────────────────────────────────────────────────────────────────────────────┴───────────────────────────────────────────────────────────────────────┘

The six migrations on that branch:
20261028090000_sec01_wallet_trust_boundary.sql 556 lines
20261028090100_sec01_wallet_uniqueness.sql 194
20261028090200_sec01_listing_batch_atomicity.sql 341
20261028090300_sec01_user_wallet_one_to_one.sql 71
20261028090400_sec01_security_definer_hardening.sql 188
20261028090500_sec01_listing_chain_identity.sql 450
packages/database/tests/sec01_rls_privileges.test.sql 764
…chain_identity.sql:205-222 contains exactly the DDL this audit independently concluded is needed:
alter table public.listings add constraint sec01_listings_chain_identity_key
unique (chain_id, collection_address, token_id);
alter table public.listings add constraint sec01_listings_chain_id_positive ...
alter table public.listings alter column chain_id set not null;
Recommendation: review and merge fix/bigint-precision rather than reimplementing. Note it also touches 9 Foundry test files, which have since been restructured on main — expect conflicts there and resolve in favour of main.

---

7. Required database migrations

Each is justified by a confirmed integrity issue above. The database currently holds 1 collection, 1 listing, 7 NFTs, 32 activity rows and ~5 bids, all on chain 99801 — so backfills are trivial and every one of these is safely reversible today.

┌─────┬──────────────────────────────────────────────────────────────────────────────────┬────────────────────────┬──────────────────────────────────────────────────┐
│ # │ Change │ Justifies │ Data impact │
├─────┼──────────────────────────────────────────────────────────────────────────────────┼────────────────────────┼──────────────────────────────────────────────────┤
│ M-1 │ collection*bids/token_bids: add chain_id integer, backfill 99801, set NOT NULL │ DB-1, IDX-6 │ 5 rows; unambiguous since all data is Elysium │
├─────┼──────────────────────────────────────────────────────────────────────────────────┼────────────────────────┼──────────────────────────────────────────────────┤
│ │ collections: add UNIQUE (chain_id, contract_address); repoint the three FKs from │ │ │
│ M-2 │ nfts/token_bids/collection_bids to the composite; drop UNIQUE │ DB-2 │ 1 collection, 7+5 children │
│ │ (contract_address) │ │ │
├─────┼──────────────────────────────────────────────────────────────────────────────────┼────────────────────────┼──────────────────────────────────────────────────┤
│ │ listings: chain_id NOT NULL + UNIQUE (chain_id, collection_address, token_id); │ │ 1 row. Ships as │
│ M-3 │ drop single-column listing_id uniqueness; keep listing_id as a derived, │ DB-3 │ …090500_sec01_listing_chain_identity.sql │
│ │ non-unique display value │ │ │
├─────┼──────────────────────────────────────────────────────────────────────────────────┼────────────────────────┼──────────────────────────────────────────────────┤
│ M-4 │ activity.chain_id: text → integer; drop the 11155111 default or set it to the │ DB-4 │ 32 rows, all "99801" → cast is lossless │
│ │ deployment chain │ │ │
├─────┼──────────────────────────────────────────────────────────────────────────────────┼────────────────────────┼──────────────────────────────────────────────────┤
│ │ increment_collection_stats: add p_chain_id integer; scope the UPDATE by │ │ │
│ M-5 │ (chain_id, contract_address). Same for get_collection_stats, │ DB-5, IDX-1 │ function signatures only — requires coordinated │
│ │ update_collection_floor_price, get_top_collections, and the three │ │ deploy with the indexer │
│ │ cleanup_expired*\* │ │ │
├─────┼──────────────────────────────────────────────────────────────────────────────────┼────────────────────────┼──────────────────────────────────────────────────┤
│ M-6 │ indexer_state: UNIQUE (chain_id) │ DB-6 │ 1 row │
├─────┼──────────────────────────────────────────────────────────────────────────────────┼────────────────────────┼──────────────────────────────────────────────────┤
│ │ listings: set buyer_wallet = NULL on relist, in both the upsert and the RPC │ SEC-01 P1.6 (verified │ │
│ M-7 │ conflict path │ reproducible on that │ 1 row │
│ │ │ branch) │ │
└─────┴──────────────────────────────────────────────────────────────────────────────────┴────────────────────────┴──────────────────────────────────────────────────┘

Deliberately excluded — architectural improvements, not necessary fixes:

- activity.chain_id in the conflict target (DB-13): (tx_hash, log_index) is sufficient.
- contract_indexer_state: the composite unique already exists (proven in §5.2).
- nfts: identity is already (collection_address, token_id, chain_id).
- Replacing additive collections.total_volume with a derived view: the right design, but the double-count (IDX-1) is fixed in the handler, and a reconciliation job is a separate decision.
- An activity.collection_address FK (IDX-10): would require relocating admin events first.
- Anything about user_wallets.supabase_password or nonces RLS: real concerns, but they belong to the SEC-01 trust-boundary review, not to contract integration.

---

8. Proposed automated deployment workflow

8.1 Pipeline

┌─ 1. DEPLOY ────────────────────────────────────────────────────────────┐
│ NETWORK=<net> forge script DeployMarketplace --rpc-url <net> --slow │
│ --broadcast │
│ → deployments/<net>.json stage=partial, configured=false │
└────────────────────────────────────────────────────────────────────────┘
┌─ 2. CONFIGURE ─────────────────────────────────────────────────────────┐
│ NETWORK=<net> forge script ConfigureMarketplace … --slow --broadcast │
│ → ownership handshake, set-once wiring, launchpad authorization │
│ → writes NO record │
└────────────────────────────────────────────────────────────────────────┘
┌─ 3. VERIFY ── the only gate that matters ──────────────────────────────┐
│ NETWORK=<net> forge script VerifyDeployment --sig "run()" --rpc-url … │
│ → reads real chain state; on success: stage=verified, configured=true │
│ ─── EVERYTHING DOWNSTREAM REFUSES TO RUN WITHOUT stage=verified ─── │
└────────────────────────────────────────────────────────────────────────┘
┌─ 4. GENERATE ADDRESSES ────────────────────────────────────────────────┐
│ pnpm --filter @marketplace/contracts generate:addresses --network <net>│
│ → src/addresses.generated.ts (9 rejection rules from §3.3) │
└────────────────────────────────────────────────────────────────────────┘
┌─ 5. GENERATE ABIs ─────────────────────────────────────────────────────┐
│ forge build && pnpm --filter @marketplace/contracts generate:abis │
│ → src/abis/\*.generated.ts (events-only + full bundles, §4.4) │
└────────────────────────────────────────────────────────────────────────┘
┌─ 6. VALIDATE CONFIG ───────────────────────────────────────────────────┐
│ pnpm validate:integration ← new, fails the build │
│ a. every name in CONTRACTS_TO_INDEX.events exists in the ABI │
│ b. every handler registered in HandlerRegistry has a config entry, │
│ and every config entry has a handler ← catches ABI-4 │
│ c. indexer CHAIN_ID is set, is in SUPPORTED_CHAIN_IDS, and matches │
│ the verified record │
│ d. eth_chainId(indexer RPC) == record chainId │
│ e. generated address/ABI files are byte-identical to committed (--check)│
│ f. no DEFAULT_CHAIN_ID disagreement across the three packages │
└────────────────────────────────────────────────────────────────────────┘
┌─ 7. TYPECHECK + TEST ──────────────────────────────────────────────────┐
│ forge test · turbo run typecheck test │
└────────────────────────────────────────────────────────────────────────┘
┌─ 8. PREPARE INDEXER ───────────────────────────────────────────────────┐
│ pnpm --filter @marketplace/indexer prepare-deployment --network <net> │
│ · require stage=verified │
│ · UPSERT indexer_state (chain_id, last_block = deployBlock - 1) │
│ · seed contract_indexer_state for known collections │
│ · refuse to lower an existing last_block without --force │
│ → fixes DB-7 and avoids the 8M-block backfill (IDX-8) │
└────────────────────────────────────────────────────────────────────────┘
┌─ 9. DATABASE MIGRATIONS ── separately controlled, human-gated ─────────┐
│ Never in the same automated run. Explicit approval, backup first. │
│ Order: M-1 → M-2 → M-3 → M-4 → M-6 → M-7 → M-5(last, needs code) │
└────────────────────────────────────────────────────────────────────────┘
┌─ 10. BUILD + DEPLOY FRONTEND ──────────────────────────────────────────┐
│ turbo run build → deploy. Blocked unless 4-7 all passed. │
└────────────────────────────────────────────────────────────────────────┘

8.2 How "never activate an unverified deployment" is enforced

The property already exists in the contract scripts and only needs to be propagated: VerifyDeployment is the sole writer of stage: "verified" and configured: true, and it runs as its own process against real chain state. Steps 4, 5 and 8 each independently re-read the record and exit non-zero unless stage === "verified" && configured === true. Step 6e makes a stale committed addresses.ts a build failure. Step 10 depends on 4-7. There is no path where a partial record reaches the frontend or the
indexer.
One addition is needed: step 4 must also run the version fingerprint (core.OWNER_QUERY_GAS()), because the legacy Elysium Core answers owner(), marketplaceFee(), MAX_MARKETPLACE_FEE() and feeReceiver() — four of the six selectors the current reuse probe checks. Presence-of-getters is not a version check.

8.3 Multi-network without mixing

Addresses — one record per network (deployments/<network>.json), one entry per chainId in the generated map, and getContractAddresses(chainId) returns undefined for anything unknown instead of falling back (ADDR-2). The generator rejects two records claiming the same chainId.

ABIs — contract code is network-independent, so ABIs are not per-network. Generate once from foundry/out and stamp the solc version and source hash in the header. Deploying different bytecode to different networks is the real hazard; catch it by recording the artifact hash in the deployment record at step 1 and asserting it matches at step 4.

Indexer — one process per chain, which the code already assumes (env.ts:67-71). Keep the startup getChainId() check (index.ts:125-144), make CHAIN_ID required, and remove chains.ts:40's ?? sepolia. indexer_state and contract_indexer_state are already keyed by chain_id.

Database — after M-1..M-4, every on-chain entity is keyed by chain_id and the chain-less cross-contamination paths are closed structurally rather than by convention.

Frontend — a single chainGuard (as on the unmerged branch): one resolved chain id drives reads, realtime, pagination and writes, and writes are rejected when the wallet chain differs from the data chain.

---

9. Prioritized implementation plan

P0 — blocks the Elysium deployment from being usable

┌──────┬───────────────────────────────────────────────────────────────────────────────────────────────────────┬─────────────┬───────────────────────────────────────┐
│ # │ Action │ Finding │ Effort │
├──────┼───────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────────┼───────────────────────────────────────┤
│ P0-1 │ Regenerate ABIs from foundry/out (ABI generator, step 5) │ ABI-1..6 │ S │
├──────┼───────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────────┼───────────────────────────────────────┤
│ P0-2 │ Thread minPrice/minSellerProceeds through useAcceptTokenBid/useAcceptCollectionBid │ ABI-1 │ M — needs a UI decision on slippage │
│ │ │ │ tolerance │
├──────┼───────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────────┼───────────────────────────────────────┤
│ P0-3 │ Remove incrementStats from both bid-accepted handlers; Sale becomes the only volume source │ IDX-1 │ S │
├──────┼───────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────────┼───────────────────────────────────────┤
│ P0-4 │ Do not advance the cursor when errorCount > 0; clamp monotonically │ IDX-2, │ S │
│ │ │ IDX-3 │ │
├──────┼───────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────────┼───────────────────────────────────────┤
│ P0-5 │ Replace "ContractAuthorized" with "LaunchpadAuthorized"; add CollectionUnverified and │ IDX-5, │ S │
│ │ CollectionRoyaltyUpdated handlers │ ABI-4 │ │
├──────┼───────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────────┼───────────────────────────────────────┤
│ P0-6 │ Generate addresses.ts from the verified record; make the stale-file check a build gate │ ADDR-1 │ M │
├──────┼───────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────────┼───────────────────────────────────────┤
│ P0-7 │ Seed indexer_state.last_block to the new deployment block (step 8) │ DB-7, IDX-8 │ S │
├──────┼───────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────────┼───────────────────────────────────────┤
│ P0-8 │ Make CHAIN_ID required; delete the 11155111 and ?? sepolia fallbacks │ ADDR-3 │ S │
└──────┴───────────────────────────────────────────────────────────────────────────────────────────────────────┴─────────────┴───────────────────────────────────────┘

P1 — data integrity; do before real users

┌──────┬──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┬──────────────────────┐
│ # │ Action │ Finding │
├──────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────┤
│ P1-1 │ Review and merge fix/bigint-precision — carries IDX-4, the SEC-01 migrations, listingIdentity.ts, chainGuard.ts. Expect conflicts in │ IDX-4, DB-3, DB-9, │
│ │ the 9 Foundry test files; resolve toward main. │ SEC-01 │
├──────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────┤
│ P1-2 │ Apply M-1..M-4, M-6, M-7 through the controlled process │ DB-1..DB-4, DB-6 │
├──────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────┤
│ P1-3 │ Add chain_id to all bid writes and filters │ IDX-6 │
├──────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────┤
│ P1-4 │ Make bid writes idempotent (unique on on-chain bid identity) and stop deriving remaining quantity from DB state │ IDX-7 │
├──────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────┤
│ P1-5 │ Add p_chain_id to increment_collection_stats and the other five chain-less RPCs (M-5), coordinated with the indexer │ DB-5 │
├──────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────┤
│ P1-6 │ Confirmation lag + last_block_hash rollback │ IDX-3 │
├──────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────┤
│ P1-7 │ Chain-filter every listings/collections/activity query in apps/web; single resolved chain id for reads and writes │ DB-9 │
└──────┴──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┴──────────────────────┘

P2 — reliability and hygiene

┌───────┬────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┬─────────┐
│ # │ Action │ Finding │
├───────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
│ P2-1 │ Per-chunk checkpointing + streaming in BatchEventFetcher │ IDX-8 │
├───────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
│ P2-2 │ Throw on missing blockTimestamp instead of defaulting to 0 │ IDX-9 │
├───────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
│ P2-3 │ getContractAddresses returns undefined for unknown chains │ ADDR-2 │
├───────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
│ P2-4 │ Delete packages/database/src/repositories/_ or make the indexer consume them │ IDX-11 │
├───────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
│ P2-5 │ Regenerate Supabase types into one canonical location; stop hand-maintaining apps/web/lib/supabase/types.ts │ DB-8 │
├───────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
│ P2-6 │ Move admin events off activity.collection_address to a dedicated column │ IDX-10 │
├───────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
│ P2-7 │ Add CI (.github/workflows is empty): forge test, typecheck, test, --check on both generators, validate:integration │ — │
├───────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
│ P2-8 │ Index LaunchPad.CollectionDeployed; add Withdrawal handlers │ IDX-5 │
├───────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
│ P2-9 │ Resolve Sepolia address provenance or drop Sepolia │ ADDR-4 │
├───────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼─────────┤
│ P2-10 │ Remove stale _\_ADDRESS from foundry/.env; rotate the token embedded in FAST_RPC_URL │ ADDR-5 │
└───────┴────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┴─────────┘

P3 — separate security track (not contract-integration)

nonces anon readability (DB-10), user_wallets.supabase_password (DB-11), service-role key in apps/web/.env (DB-12). These belong to the SEC-01 wallet trust boundary review; the 556-line …wallet_trust_boundary.sql and the 764-line pgTAP RLS suite on fix/bigint-precision appear to address them.

---

10. Tests required to establish confidence

Contract-level (Foundry)

1. test_BidAcceptanceEmitsExactlyOneSale — expectEmit on Core.Sale and Bids.TokenBidAccepted in one acceptTokenBid; assert Core.getCollectionStats advanced by exactly one sale. This is the test whose absence let IDX-1 through.
2. test_CollectionBidAcceptanceEmitsNSalesForNTokens — the tokenIds[] fan-out versus the single CollectionBidAccepted.
3. test_EventSignaturesAreStable — assert topic0 for all 28 indexed events against committed constants, so a future rename is a failing test rather than a silently dead listener.
4. test_RouterEmitsNoDomainEvents — pins the architectural assumption the indexer relies on.

ABI / address generation

5. Generator --check in CI — committed \*.generated.ts must be byte-identical to a fresh regeneration.
6. Reject-partial-record suite — one case per §3.3 rule: stage=partial, wrong chainId, zero address, no code at an address, failing cohesion check, legacy build (fingerprint absent), duplicate chainId. Nine negative tests; each must exit non-zero and write nothing.
7. Config-coverage test — every CONTRACTS_TO_INDEX.events entry resolves in the generated ABI, and the handler set is bijective with it. Catches ABI-4 and IDX-5 permanently.
8. Frontend call-shape test — for every functionName in apps/web, assert encodeFunctionData(generatedAbi, fn, args) succeeds with the arity the hook actually passes. This is the test that would have caught ABI-1.

Indexer

9. test_CursorDoesNotAdvanceOnHandlerFailure — inject a failing handler; assert indexer_state.last_block is unchanged. (IDX-2)
10. test_CursorIsMonotonic — a provider returning a lower head must not rewind the cursor. (IDX-3)
11. test_ReplayIsIdempotent — process the same block range twice; assert row counts, collections.total_volume and total_sales are identical. Covers IDX-1, IDX-3, IDX-7 at once.
12. test_WeiPrecisionRoundTrip — 1234567890123456789n → DB → read back as the exact same bigint. (IDX-4)
13. test_MissingBlockTimestampThrows — a log without blockTimestamp must fail loudly, not write 1970. (IDX-9)
14. test_PartialCollectionBidFillFromEventsOnly — remaining quantity derived without reading prior DB state. (IDX-7)
15. test_CrossChainBidsAreIsolated — two chains, same (collection, bidder); cancelling on one must not touch the other, and getActiveCollectionBid must not throw. (IDX-6, DB-1) — fails until M-1.
16. test_CollectionUnverifiedClearsFlag — verify then unverify; assert is_verified = false. (IDX-5)

Database

17. Recover and run packages/database/tests/sec01_rls_privileges.test_sql (764 lines, pgTAP, on the unmerged branch) against a disposable Postgres. Per docs/SEC01_STATUS.md:214, 22 RLS tests were skipped for lack of a live environment — they should be unskipped.
18. Constraint-assertion tests — for each of M-1..M-7, a pgTAP test asserting the constraint exists with the intended columns, plus a negative test proving the duplicate it forbids is actually rejected.
19. Cross-chain uniqueness test — insert the same (collection_address, token_id) for chains 99801 and 11155111 into listings, nfts, token_bids, collection_bids; all four must coexist. Fails today for three of them.
20. Migration round-trip on a snapshot — restore the current 46-row dataset, apply M-1..M-7, assert row counts and every chain_id = 99801.

End-to-end

21. Anvil pipeline rehearsal — deploy → configure → verify → generate addresses → generate ABIs → validate:integration → seed indexer state → run the indexer → assert the DB matches on-chain getCollectionStats exactly. This single test exercises steps 1-8 on a throwaway chain and is the cheapest way to gain confidence in the whole pipeline.

---

Implementation sequence

Ordered to minimize breaking changes and preserve data. The database is nearly empty right now — do the schema work while that is still true.

Stage 0 — establish the baseline (no behaviour change).
Build the ABI and address generators with --check modes and validate:integration, but keep the current legacy addresses as the committed output. Add CI. Add tests 3, 4, 5, 7, 8. Expect tests 7 and 8 to fail immediately on ContractAuthorized and on acceptTokenBid arity — that failing state is the point: it converts two silent defects into gates.

Stage 1 — recover the lost work.
Review fix/bigint-precision (fc85e2b) against current main. Rebase, resolving the 9 Foundry test-file conflicts toward main (contract tests have since been restructured). Merge the TypeScript, SQL and test content. Then correct docs/SEC01_STATUS.md, which currently asserts as implemented a state that does not exist — it is actively misleading.

Stage 2 — migrate the database while it holds 46 rows.
Through the controlled process, backup first: M-1 → M-2 → M-3 → M-4 → M-6 → M-7. Backfills are unambiguous because every row is chain_id = 99801. Run tests 18, 19, 20. Hold M-5 (RPC signatures) for Stage 3 — it needs a coordinated code deploy.

Stage 3 — fix the indexer, before any new deployment.
P0-3 (double-count), P0-4 (cursor), P0-5 (event coverage), P1-3 (bid chain_id), P1-4 (bid idempotency), then M-5 together with the matching repository change. Tests 9-16. Verify against the existing Elysium data by reconciling collections.total_volume with on-chain getCollectionStats — they match today (0.215 / 6) and must still match after.

Stage 4 — fix the frontend, before any new deployment.
P0-2 (slippage args — the one item needing a product decision, since a careless default silently accepts a worse price than displayed) and P1-7 (chain-consistent reads and writes, using the recovered chainGuard). Run test 8 to green.

Stage 5 — rehearse.
Test 21 on Anvil: the full ten-step pipeline against a throwaway chain. Nothing below passes until this does.

Stage 6 — deploy to Elysium and activate.
Steps 1-3 (the contract runbook). Then step 4 regenerates addresses.ts from the now-verified record — the first moment ELYSIUM_ADDRESSES stops pointing at the legacy stack. Steps 5-7. Step 8 seeds indexer_state.last_block to the deployment block, so the indexer starts at zero lag instead of attempting the 8.27M-block backfill. Step 10 builds and deploys the frontend.

Stage 7 — reconcile and clean up.
Confirm DB stats match on-chain after the first real sale and the first real bid acceptance. Then P2 (reliability, hygiene) and P3 (the separate SEC-01 security track).

What this ordering buys you. The legacy Elysium stack stays live and untouched throughout — addresses.ts is only repointed at Stage 6, so the application keeps working on the old contracts until the new ones are verified and every consumer has been adapted. The schema migrations land while there are 46 rows to migrate. And the two confirmed hard breaks (bid acceptance in the UI, volume double-counting in the indexer) are both fixed before the deployment that would otherwise expose them.
