# Roadmap

## Phase 0: Foundation and safety net (no behavior changes)

- Create CI in `.github/workflows` (currently empty): `forge test`, typecheck, turbo tests.
- Write `generate-abis.ts` with a `--check` mode (events-only and full bundles).
- Write `generate-addresses.ts` with the 9 rejection rules and a `--check` mode.
- Create `pnpm validate:integration` (config events vs. ABI, handlers vs. config, `CHAIN_ID`, etc.).
- Add tests 3, 4, 5, 7, and 8 from the report. They must fail at first (`ContractAuthorized`, `acceptTokenBid` arity).

## Phase 1: Recover lost work

- Review and merge `fix/bigint-precision` (commit `fc85e2b`).
- Resolve conflicts in the 9 Foundry tests in favor of `main`.
- Fix `docs/SEC01_STATUS.md`, which declares something as implemented that does not exist.
- Make the pgTAP RLS tests (764 lines) run against a disposable Postgres and disable the 22 skips.

## Phase 2: Database migrations (while there are only ~46 rows)

- ➕ Make a full backup before starting.
- Apply in this order, with human approval: M-1 (`chain_id` in bids), M-2 (composite identity for collections), M-3 (listings), M-4 (`activity.chain_id` to integer), M-6 (unique on `indexer_state`), M-7 (`buyer_wallet` in relist).
- Run tests 18, 19, and 20 (constraints, cross-chain uniqueness, round-trip over snapshot).
- Leave M-5 (RPCs with `p_chain_id`) for phase 3.
- ➕ Version the schema in the repository. Today there is no `.sql` file in `main`.

## Phase 3: Indexer

- IDX-1: remove `incrementStats` from the `TokenBidAccepted` and `CollectionBidAccepted` handlers. Sale becomes the only source of volume.
- IDX-2/3: do not advance the cursor if there are errors, make it monotonic, add confirmation lag and rollback by `last_block_hash`.
- IDX-5/ABI-4: change `ContractAuthorized` to `LaunchpadAuthorized` and add handlers for `CollectionUnverified`, `CollectionRoyaltyUpdated`, `RoyaltyOverrideCleared`, and `Withdrawal`.
- Keep `CollectionRegistrationExecuted` and `RoyaltySourceUsed` unindexed.
- IDX-6/7: add `chain_id` to bid writes and filters, and make inserts idempotent with a unique constraint on the on-chain identity. Do not derive the remaining amount from the DB state.
- Apply M-5 together with the repository change, in a coordinated way.
- IDX-9: throw an error if `blockTimestamp` is missing.
- ADDR-3: make `CHAIN_ID` mandatory and remove the fallbacks (`11155111` / `sepolia`).
- Do per-chunk checkpointing with streaming (IDX-8). It is P2, but essential if there is ever a backfill.
- Add a `prepare-deployment` that upserts `indexer_state` with `deployBlock - 1`.
- Run tests 9–16 and verify that `total_volume` still matches `getCollectionStats` (0.215 / 6).

## Phase 4: Frontend

- Regenerate the ABIs and replace the hand-pasted ones.
- ABI-1: pass `minPrice` and `minSellerProceeds` in `acceptTokenBid` and `acceptCollectionBid`.
- Product decision: define the default slippage tolerance. A bad value accepts bids at a worse price than displayed.
- Integrate `chainGuard` and use a single chain id for reads and writes.
- Filter all listings, collections, activity, and bids queries by chain.
- `getContractAddresses` must return `undefined` on unknown chains, and the UI must show "switch network".
- Regenerate Supabase types in a single place.
- Map the 27 custom errors to show readable messages to the user.
- Run test 8 (call arity) until it passes.

## Phase 5: Rehearsal on Anvil

- Test 21: deploy → configure → verify → generate addresses/ABIs → validate → seed indexer → run the indexer → compare the DB with `getCollectionStats` on-chain. Nothing moves to the next phase without this.
- ➕ Repeat the rehearsal on a public testnet with real wallets.

## Phase 6: Deployment and activation

- ➕ Confirm that the security audit report covers the exact bytecode to be deployed.
- ➕ Decide whether the final destination is Elysium (99801) or another mainnet, and define who is the owner or multisig.
- Run Deploy → Configure → VerifyDeployment (`stage=verified`).
- Regenerate `addresses.generated.ts` from the verified registry, which is the moment when the legacy stack is left behind.
- Run integration validation and tests, and seed `indexer_state` at the deployment block.
- Build and deploy the frontend. This is only allowed if steps 4–7 have passed.

## Phase 7: Operations and reconciliation

- After the first real sale and first real bid acceptance, verify that the DB matches on-chain.
- ➕ Set up monitoring and alerts: indexer lag, `errorCount > 0`, failed events, RPC errors.
- ➕ Define RPCs with fallback, rate limits, and automatic Supabase backups.
- ➕ Prepare an emergency pause (`Paused`) and incident runbook.
- ➕ Set up a periodic reconciliation job between `total_volume` and `getCollectionStats`.

## Security and cleanup (in parallel, before real users)

- Rotate the token embedded in `FAST_RPC_URL` and remove the obsolete `*_ADDRESS` entries from `foundry/.env`.
- Review readable nonces with the anon key (DB-10) and `user_wallets.supabase_password` (DB-11). The `wallet_trust_boundary` migration from the branch will likely resolve them.
- Verify that every use of `SUPABASE_SERVICE_ROLE_KEY` is protected by wallet authorization.
- Resolve the provenance of the Sepolia addresses or remove support.
- Delete the duplicate repositories in `packages/database/src/repositories/*`.
- Move admin events out of `activity.collection_address`.
- Index `LaunchPad.CollectionDeployed` (optional).
