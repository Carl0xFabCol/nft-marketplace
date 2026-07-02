import type { BlockRange } from "../types/indexer.types"

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCK RANGE UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Utilities for working with block ranges: chunking, validation, archive detection.
 */
export class BlockRangeUtil {
  /**
   * Split a large block range into smaller chunks for batching.
   *
   * @param fromBlock - Starting block
   * @param toBlock - Ending block
   * @param chunkSize - Maximum blocks per chunk
   * @returns Array of block ranges
   */
  static chunk(fromBlock: bigint, toBlock: bigint, chunkSize: number): BlockRange[] {
    const ranges: BlockRange[] = []
    let currentFrom = fromBlock

    while (currentFrom <= toBlock) {
      const currentTo = currentFrom + BigInt(chunkSize) - 1n
      ranges.push({
        from: currentFrom,
        to: currentTo > toBlock ? toBlock : currentTo,
      })
      currentFrom = currentTo + 1n
    }

    return ranges
  }

  /**
   * Determine if a block range requires an archive node.
   * Typically, blocks older than ~128 blocks require archive access.
   *
   * @param range - Block range to check
   * @param currentBlock - Current blockchain head
   * @param archiveThreshold - Number of blocks before requiring archive (default: 128)
   * @returns true if range requires archive node
   */
  static requiresArchive(range: BlockRange, currentBlock: bigint, archiveThreshold: bigint = 128n): boolean {
    return currentBlock - range.to > archiveThreshold
  }

  /**
   * Validate that a block range is valid (from <= to)
   */
  static isValid(range: BlockRange): boolean {
    return range.from <= range.to
  }

  /**
   * Calculate the total number of blocks in a range
   */
  static size(range: BlockRange): bigint {
    return range.to - range.from + 1n
  }
}
