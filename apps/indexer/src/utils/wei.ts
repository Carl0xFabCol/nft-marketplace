// ═══════════════════════════════════════════════════════════════════════════════
// WEI HELPERS (IDX-4)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Wei amounts are uint128/uint256 and routinely exceed Number.MAX_SAFE_INTEGER
// (2^53). They are carried as bigint inside the indexer and leave it only as
// exact decimal strings, which PostgREST casts into numeric columns without
// loss. Never pass wei through Number().

/** Exact base-10 string of a non-negative integer wei amount, for numeric(78,0) / text columns. */
export function toWeiString(value: bigint): string {
  if (typeof value !== "bigint") {
    throw new TypeError(`wei amount must be a bigint, got ${typeof value}`)
  }
  if (value < 0n) {
    throw new RangeError(`wei amount must be non-negative, got ${value}`)
  }
  return value.toString()
}

