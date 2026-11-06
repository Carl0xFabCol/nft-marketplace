// Unit tests for the pure checks behind validate:integration. These always
// pass; the checks applied to the real repository live in
// *.integration.test.ts (known-failing, continue-on-error CI job).
import { describe, expect, it } from "vitest"
import type { Abi } from "viem"
import {
  checkChainId,
  checkDefaultChainIdConsistent,
  checkEventsExist,
  checkHandlerBijection,
  checkRpcChainId,
} from "../lib/integration-checks"

const abi: Abi = [
  { type: "event", name: "Sale", inputs: [], anonymous: false },
  { type: "event", name: "Paused", inputs: [], anonymous: false },
  { type: "function", name: "buy", inputs: [], outputs: [], stateMutability: "payable" },
]

describe("checkEventsExist", () => {
  it("passes when every configured event is in the ABI", () => {
    expect(checkEventsExist([{ name: "core", events: ["Sale", "Paused"] }], { core: abi })).toEqual([])
  })
  it("flags a renamed/removed event (the ABI-4 case)", () => {
    expect(checkEventsExist([{ name: "core", events: ["ContractAuthorized"] }], { core: abi })).toEqual([
      "core:ContractAuthorized is configured but does not exist in the generated ABI",
    ])
  })
  it("does not accept function names as events", () => {
    expect(checkEventsExist([{ name: "core", events: ["buy"] }], { core: abi })).toHaveLength(1)
  })
  it("flags a contract with no ABI", () => {
    expect(checkEventsExist([{ name: "x", events: [] }], {})).toHaveLength(1)
  })
})

describe("checkHandlerBijection", () => {
  const config = [{ name: "core", events: ["Sale", "Paused"] }]
  it("passes on a 1:1 mapping", () => {
    expect(
      checkHandlerBijection(config, [
        { contractName: "core", eventName: "Sale" },
        { contractName: "core", eventName: "Paused" },
      ]),
    ).toEqual([])
  })
  it("flags configured events without a handler", () => {
    expect(checkHandlerBijection(config, [{ contractName: "core", eventName: "Sale" }])).toEqual([
      "core:Paused is configured but has no handler",
    ])
  })
  it("flags handlers that are never configured", () => {
    expect(
      checkHandlerBijection(config, [
        { contractName: "core", eventName: "Sale" },
        { contractName: "core", eventName: "Paused" },
        { contractName: "core", eventName: "CollectionUnverified" },
      ]),
    ).toEqual(["core:CollectionUnverified has a handler but is not configured (unreachable)"])
  })
  it("flags duplicates", () => {
    const dup = checkHandlerBijection([{ name: "core", events: ["Sale", "Sale"] }], [
      { contractName: "core", eventName: "Sale" },
      { contractName: "core", eventName: "Sale" },
    ])
    expect(dup).toHaveLength(2)
  })
})

describe("checkChainId", () => {
  it("passes when CHAIN_ID is required and supported", () => {
    expect(checkChainId({ threw: true }, 99801, [11155111, 99801])).toEqual([])
  })
  it("flags a silent default", () => {
    expect(checkChainId({ threw: false, chainId: 11155111 }, 99801, [99801])[0]).toMatch(/silently defaults to 11155111/)
  })
  it("flags a missing or unsupported CHAIN_ID", () => {
    expect(checkChainId({ threw: true }, undefined, [99801])[0]).toMatch(/not set/)
    expect(checkChainId({ threw: true }, 1, [99801])[0]).toMatch(/not in SUPPORTED_CHAIN_IDS/)
  })
})

describe("checkDefaultChainIdConsistent", () => {
  it("passes when all defaults agree or are absent", () => {
    expect(checkDefaultChainIdConsistent({ a: 99801, b: 99801, c: undefined })).toEqual([])
  })
  it("flags disagreement", () => {
    expect(checkDefaultChainIdConsistent({ a: 99801, b: 11155111 })[0]).toMatch(/a=99801, b=11155111/)
  })
})

describe("checkRpcChainId", () => {
  it("compares the RPC chain with CHAIN_ID", () => {
    expect(checkRpcChainId(99801, 99801)).toEqual([])
    expect(checkRpcChainId(99801, 1)).toHaveLength(1)
  })
})
