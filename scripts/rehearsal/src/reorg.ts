// Parameters for Anvil's `anvil_reorg(depth, txs)`.
//
// The replacement fork must carry a transaction. Without one, Anvil re-mines
// empty blocks whose parent, timestamp and (empty) contents are identical to the
// originals when they were mined in the same second, so every hash is identical
// and no reorg takes place (Phase 5 run, block 268: 0xf462…2e1b before and after).

import type { Address } from "viem"

export type AnvilReorgParams = [number, [{ from: Address; to: Address; value: `0x${string}` }, number][]]

/**
 * `depth` replaces the blocks (head-depth, head]. It must reach below the
 * stored cursor, or the cursor block is not part of the reorg.
 */
export function anvilReorgParams(head: bigint, cursorBlock: bigint, from: Address): AnvilReorgParams {
  if (cursorBlock > head) throw new Error(`cursor ${cursorBlock} is above head ${head}`)
  const depth = Number(head - cursorBlock) + 3
  // A 1-wei self-transfer in the first replacement block: it changes that
  // block's transactions root, and therefore every hash from there to the head.
  return [depth, [[{ from, to: from, value: "0x1" }, 0]]]
}
