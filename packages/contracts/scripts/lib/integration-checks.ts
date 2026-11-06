import type { Abi } from "viem"

// ─────────────────────────────────────────────────────────────────────────────
// Pure checks behind `pnpm validate:integration` (INTEGRATION_AUDIT §8 step 6).
// Each returns a list of problems; an empty list means the check passed.
// Data gathering (importing the indexer config, handlers, env loader) lives in
// the callers so these stay side-effect free and unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

export interface IndexedContract {
  /** Contract name as used by the indexer ("core", "bids", "nft"). */
  readonly name: string
  readonly events: readonly string[]
}

export interface HandlerKey {
  readonly contractName: string
  readonly eventName: string
}

function eventNames(abi: Abi): Set<string> {
  return new Set(abi.filter((item) => item.type === "event").map((item) => ("name" in item ? item.name : "")))
}

/** (a) Every configured event exists in the generated events ABI for that contract. */
export function checkEventsExist(config: readonly IndexedContract[], eventsAbiByContract: Readonly<Record<string, Abi>>): string[] {
  const problems: string[] = []
  for (const contract of config) {
    const abi = eventsAbiByContract[contract.name]
    if (!abi) {
      problems.push(`${contract.name}: no generated events ABI for this contract`)
      continue
    }
    const known = eventNames(abi)
    for (const event of contract.events) {
      if (!known.has(event)) problems.push(`${contract.name}:${event} is configured but does not exist in the generated ABI`)
    }
  }
  return problems
}

/** (b) Registered handlers and configured events are 1:1. */
export function checkHandlerBijection(config: readonly IndexedContract[], handlers: readonly HandlerKey[]): string[] {
  const problems: string[] = []
  const configured = new Set<string>()
  for (const contract of config) {
    for (const event of contract.events) {
      const key = `${contract.name}:${event}`
      if (configured.has(key)) problems.push(`${key} is configured more than once`)
      configured.add(key)
    }
  }
  const handled = new Set<string>()
  for (const h of handlers) {
    const key = `${h.contractName}:${h.eventName}`
    if (handled.has(key)) problems.push(`${key} has more than one handler`)
    handled.add(key)
  }
  for (const key of configured) if (!handled.has(key)) problems.push(`${key} is configured but has no handler`)
  for (const key of handled) if (!configured.has(key)) problems.push(`${key} has a handler but is not configured (unreachable)`)
  return problems
}

export type UnsetChainIdOutcome = { readonly threw: true } | { readonly threw: false; readonly chainId: number }

/** (c) CHAIN_ID must be required (no silent default) and must be a supported chain. */
export function checkChainId(
  whenUnset: UnsetChainIdOutcome,
  chainId: number | undefined,
  supported: readonly number[],
): string[] {
  const problems: string[] = []
  if (!whenUnset.threw) {
    problems.push(`indexer env loader does not require CHAIN_ID: it silently defaults to ${whenUnset.chainId}`)
  }
  if (chainId === undefined || !Number.isSafeInteger(chainId)) {
    problems.push("CHAIN_ID is not set (pass --chain-id or set CHAIN_ID)")
  } else if (!supported.includes(chainId)) {
    problems.push(`CHAIN_ID ${chainId} is not in SUPPORTED_CHAIN_IDS (${supported.join(", ")})`)
  }
  return problems
}

/** (d) Live: the RPC serves the chain the indexer is configured for. */
export function checkRpcChainId(expected: number, actual: number): string[] {
  return actual === expected ? [] : [`RPC eth_chainId ${actual} does not match CHAIN_ID ${expected}`]
}

/**
 * (f) Every package that defines a default chain agrees on it. A source whose
 * value is undefined has no default (e.g. CHAIN_ID is required) and is skipped.
 */
export function checkDefaultChainIdConsistent(defaults: Readonly<Record<string, number | undefined>>): string[] {
  const present = Object.entries(defaults).filter((e): e is [string, number] => e[1] !== undefined)
  const distinct = new Set(present.map(([, v]) => v))
  if (distinct.size <= 1) return []
  return [`default chain ids disagree: ${present.map(([k, v]) => `${k}=${v}`).join(", ")}`]
}
