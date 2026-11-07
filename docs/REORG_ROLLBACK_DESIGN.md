# Reorg handling: what is implemented, and the rollback design (IDX-3)

Status, 2026-11-07, Phase 3B: **detection is implemented, automatic rollback is not.**

## 1. What runs today

Two layers protect the indexer against reorgs:

1. **Confirmation lag (Phase 3A).** The indexer only indexes up to `head - CONFIRMATIONS` (default 12). A reorg shallower than the lag never reaches the database.
2. **Detection and halt (Phase 3B).**
   - Each global checkpoint writes `indexer_state.last_block` and `last_block_hash` (the hash of that block) in one UPDATE. The migration is `20261028091500`, the code `IndexerStateRepository.updateLastBlock`.
   - At the start of every run the orchestrator reads the canonical hash at `last_block`. If it differs from the stored one, the stored block was orphaned by a reorg deeper than the lag. The orchestrator then:
     - logs `alert: "REORG_DETECTED"` at level `fatal`, with the block, both hashes and `consecutiveFailedRuns`;
     - fetches, dispatches and writes **nothing**;
     - does the same on every following run, until an operator acts.
   - A NULL hash (a legacy row, or a row just seeded by `prepare-deployment`) is accepted. The next checkpoint fills it.

Limits of detection:
- Only the global cursor (Core and Bids) is checked. Collection cursors (`contract_indexer_state`) use the same checkpoint targets but store no hash.
- The checkpoint hash is read just after processing a chunk. A fork switch between fetching a chunk's logs and reading the hash, inside the confirmation window, can go unnoticed. The lag is the protection for that window.
- Only a reorg that replaces `last_block` itself is detected. A reorg that ends below `last_block` changes the hash at `last_block` too, because hashes chain. So in practice every reorg at or below the cursor is detected.

## 2. Why rollback is not automatic

Rolling back means undoing every write derived from the orphaned blocks `(F, last_block]`, where F is the fork point. The schema cannot do that safely today:

| Derived state | Problem |
| --- | --- |
| `activity` | No `block_number` column. Orphaned rows can be found only by `tx_hash`, and a tx can be re-included in a different block on the new fork. |
| `collections.total_volume/total_sales` | Additive (`indexer_record_sale`). Undoing it needs the exact set of orphaned SALE rows (see above). |
| `listings`, `nfts.owner_wallet` | Last-writer state with no history: the pre-fork value is lost. |
| `token_bids`, `collection_bids`, `collection_bid_fills` | Rows carry `block_number` since `20261028091400`, so orphaned placements and fills **are** identifiable. But closing a slot overwrote `is_active`/`updated_at` on older rows without history. |
| `collections` (verify, royalty) | Last-writer state with no history. |

An automatic rollback that deletes some of this and leaves the rest would produce a state that matches neither fork. Halting is the safe default.

## 3. Rollback design (open; proposed for a later phase)

**Schema prerequisites (one migration):**
1. Add `block_number bigint` to `activity`, and backfill it where possible. The indexer writes it from `ParsedEvent.blockNumber` for every row. `indexer_record_sale` gains `p_block_number`.
2. Add a `reorg_log` table: `(chain_id, detected_at, fork_block, orphaned_from, orphaned_to, stored_hash, canonical_hash, status)`.
3. Optionally, `indexer_block_hashes (chain_id, block_number, hash)` for the last N checkpoints. This lets the fork point be found by a backwards walk without an archive node.

**Procedure (`rollback-reorg` script, indexer stopped, one transaction where possible):**
1. **Find the fork point F.** Walk back from `last_block` over the stored checkpoint hashes, or binary-search with `getBlockHash`, until stored = canonical.
2. **Delete orphaned event rows**, `block_number > F` on this chain: `activity`, `collection_bid_fills`, and bid placements (`token_bids`/`collection_bids` with `block_number > F`).
3. **Recompute derived state from the remaining events**, never by undoing increments:
   - `total_volume`/`total_sales` = `sum`/`count` over SALE activity per (chain, collection). This is also the Phase 7 reconciliation query.
   - The bid `quantity`/`is_active` of each affected slot: `placed_quantity - Σ fills`, active only if it is the latest placement and no later close event remains. That needs the close events, which are already in `activity` (`*_BID_CANCELLED`/`*_ACCEPTED` with `block_number`).
   - `listings`, `nfts.owner_wallet` and `collections` flags for every token or collection touched in `(F, last]`: re-derive from the remaining activity, or re-read the chain (`ownerOf`, Core listing getters) at F.
4. **Set the cursors** `indexer_state.last_block = F`, `last_block_hash = hash(F)`, and `contract_indexer_state.last_block = least(last_block, F)`. Write `reorg_log`.
5. **Restart.** The indexer re-indexes `(F, head - lag]` on the canonical fork. Every write is idempotent on the event identity, so overlaps are safe.

**Tests to add with it:**
- a fork fixture (blocks 100–110 on fork A, then 106–112 on fork B), run through memoryDb and localdb;
- assert the DB equals a fresh run over fork B only (row-for-row, stats exact).

## 4. Operator procedure until rollback exists

When `REORG_DETECTED` fires:
1. **Leave the indexer running.** It is not writing anything. Alternatively, stop it.
2. Record the block and both hashes from the log. Find the fork point F with a block explorer or RPC (the highest block whose hash both sources agree on).
3. Inspect what was indexed in `(F, last_block]`. Today that is activity with `created_at` at or after the timestamp of block F+1, and bids with `block_number > F`.
4. Choose one of two options:
   - **Small and understood** (typical on a testnet). Delete the orphaned bid rows and fills (`block_number > F`). Delete the orphaned activity rows by `tx_hash` (check each one against the canonical chain). Recompute the affected collections' `total_volume`/`total_sales` from SALE activity. Then set the cursor: `prepare-deployment --force` is **not** appropriate, because it requires a fresh deployment record. Instead run, as service role:
     `update indexer_state set last_block = F, last_block_hash = null where chain_id = <id>;`
   - **Large or unclear.** Restore the latest backup taken before F, set the cursor to the backup's `last_block`, and let the indexer re-index.
5. Restart and watch for `consecutiveFailedRuns` returning to 0.
