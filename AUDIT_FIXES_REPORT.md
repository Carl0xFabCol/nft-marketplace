# Pre-Testnet Security Audit Fixes

Branch: `fix/audit-critical`
Package: `packages/contracts/foundry`
Compiler: Solidity 0.8.24 / Foundry
Verification: `forge build` passes; `forge test` passes with **298 tests**.

## Scope

Implemented the requested pre-testnet fixes only:

| Phase | Finding | Status |
|---|---|---|
| 0 | Compile blocker + L-01 bounded staticcall gas check | Fixed |
| 1 | H-01 royalty snapshot after `updateListingPrice` | Fixed |
| 2 | M-04 Core royalty override vs ERC-2981 | Fixed |
| 3 | M-03 delayed owner registrations and emergency royalty changes | Fixed |

Out of scope items (M-01, M-02, L-02..L-06, I-01..I-08 except the compile-required
I-02 path) were not modified.

## Phase 0 - compile blocker and L-01

- Added the missing `_staticcallBounded2` implementation returning `(bool,uint256,uint256)`.
  It requires exactly `0x40` return bytes and fails closed with `(false,0,0)`.
- Added `_requireBoundedGas` and the `BoundedStaticCallInsufficientGas` / `InsufficientGas`
  gas pre-check for both bounded staticcall helpers.
- `foundry.toml`: `evm_version = "cancun"` is required by OpenZeppelin 5.5.0
  (`mcopy`); `via_ir = false` because `via_ir = true` fails MarketplaceCore with a
  Yul stack exception.
- Compile-only repairs needed to make the audit suite runnable:
  - `MiColeccion` -> `Hyperc` import alias in tests/scripts.
  - Restored the LaunchPad `getCollectionsCreatedBy(address,uint256,uint256)`
    overload used by `AuditPagination.t.sol`.
  - Refactored LaunchPad deployment into a `DeployParams` struct.
  - Split oversized `InvariantsS3` helpers to remove stack-too-deep errors.
  - Test setups set `launchFee = 0` before creating collections.

## Phase 1 - H-01 royalty snapshot refresh

`MarketplaceCore.updateListingPrice` now recomputes `listing.royaltyBps` using the
same `_royaltyBpsFor` helper used by `_createListing`. This closes the
1-wei-listing path where a later price update retained a near-zero royalty
snapshot. The sale-path cap
`if (royaltyAmount > snapshotRoyalty) royaltyAmount = snapshotRoyalty;`
remains intact.

Regression tests: `test/AuditH01RoyaltyUpdate.t.sol`

- `test_H01_dustThenUpdateCannotEvadeRoyalty`
- `test_H01_zeroRoyaltyCollectionStaysZeroAfterUpdate`

## Phase 2 - M-04 royalty source precedence

Design: **Core override wins when explicitly set.**

- Added `mapping(address => bool) public royaltyOverridden`.
- `updateCollectionRoyalty` and successful emergency updates set the override.
- `_getRoyalty` uses Core override values first when `royaltyOverridden` is true;
  otherwise it uses the defensively-bounded ERC-2981 query and falls back to Core
  registration values on revert/malformed/out-of-range responses.
- Added `clearRoyaltyOverride(address)` (owner-only) so governance can restore
  ERC-2981 precedence.
- Added events `RoyaltySourceUsed(collection, tokenId, price, source)` and
  `RoyaltyOverrideCleared(collection)`, plus enum `RoyaltySource { ERC2981, Override }`.
- Router exposes `clearRoyaltyOverride`, `royaltyOverridden`, and the new
  pending/propose/execute views and wrappers.

Note: `_getRoyalty` and `_royaltyBpsFor` were changed from `view` to non-view
because Solidity forbids emitting `RoyaltySourceUsed` from a view function. This
has no external ABI impact; callers are already state-changing sale/listing
paths.

Regression tests: `test/AuditM04RoyaltyOverride.t.sol`

- `test_M04_overrideWinsOverERC2981`
- `test_M04_fallbackStillUsesERC2981WhenNotOverridden`
- `test_M04_clearOverrideRestoresERC2981`
- `test_M04_royaltyInfoRevertStillFallsBack`

## Phase 3 - M-03 delayed owner actions

`REGISTRATION_DELAY = 48 hours`.

### Registration

Both external-router registration and LaunchPad registration now use a
propose/execute flow keyed by collection:

- Propose validates the collection, royalty values, creator ownership and
  LaunchPad factory provenance, then stores `PendingRegistration` and emits
  `CollectionRegistrationProposed`.
- `executeRegisterCollection(collection)` is permissionless after the delay.
  It checks `block.timestamp >= executableAt`, re-validates the collection,
  deletes the pending record before effects, stores the collection and emits
  `CollectionRegistrationExecuted`.
- Legacy names `registerCollectionFromRouter` and
  `registerCollectionFromLaunchpad` remain, but now only schedule the delayed
  proposal. They cannot bypass the delay.
- Router exposes `proposeRegisterCollection`, `executeRegisterCollection` and
  `pendingRegistrations`.

### Emergency royalty update

- `emergencyUpdateCollectionRoyalty` remains as a legacy scheduling alias.
- `proposeEmergencyUpdateCollectionRoyalty` stores `PendingRoyaltyUpdate` and
  emits `EmergencyRoyaltyUpdateProposed`.
- `executeEmergencyUpdateCollectionRoyalty` is owner-only, checks the delay,
  deletes before effects, updates Core royalty values, sets the M-04 override,
  and emits both `CollectionRoyaltyUpdated` and
  `EmergencyRoyaltyUpdateExecuted`.
- Router exposes matching propose/execute/view wrappers.

### Errors and views

- `NoPendingRegistration`, `RegistrationNotReady`, `NoPendingRoyaltyUpdate`,
  `RoyaltyUpdateNotReady`.
- `pendingRegistrations(address)` and `pendingEmergencyRoyaltyUpdates(address)`.

Regression tests: `test/AuditM03DelayedAdminActions.t.sol`

- `test_M03_routerRegistrationCannotExecuteBeforeDelay`
- `test_M03_launchpadRegistrationCannotExecuteBeforeDelay`
- `test_M03_emergencyRoyaltyUpdateCannotExecuteBeforeDelay`
- `test_M03_missingPendingActionsRevert`
- `test_M03_emergencyUpdateIsOwnerOnly`

### onlyOwner inventory and protections

| Contract / function | Handling | Rationale |
|---|---|---|
| `Marketplace.registerCollection` | Delayed alias | Registration changes marketplace trust surface |
| `Marketplace.proposeRegisterCollection` | Delayed proposal | Publicly observable before effect |
| `Marketplace.executeRegisterCollection` | Permissionless execute | Anyone may finalize after the delay |
| `Marketplace.emergencyUpdateCollectionRoyalty` | Delayed alias | Cannot bypass the emergency delay |
| `Marketplace.proposeEmergencyUpdateCollectionRoyalty` | Delayed proposal | Publicly observable before effect |
| `Marketplace.executeEmergencyUpdateCollectionRoyalty` | Delayed, owner-only | Role-specific admin recovery |
| `Marketplace.clearRoyaltyOverride` | Immediate | Restores collection ERC-2981; no fund movement |
| `Marketplace.verifyCollection` / `unverifyCollection` | Immediate | Metadata only |
| `Marketplace.updateMarketplaceFee` / `updateFeeReceiver` | Immediate | Deployment guidance: put the owner behind a timelock/multisig |
| `Marketplace.setAuthorizedLaunchpad` | Immediate | Admin allow-list; no asset movement |
| `Marketplace.pause` / `unpause` | Immediate | Incident response must not wait 48h |
| `Marketplace.configureBidsMarketplace` | Immediate | One-time wiring |
| `Marketplace.acceptComponentOwnership` / `transferComponentOwnership` | Immediate | Deployment/ownership setup |
| `Marketplace.sweepExcessETH` | Immediate | Receives only excess ETH above accounted balances |
| `MarketplaceCore.emergencyUpdateCollectionRoyalty` / propose / execute | Delayed (see above) | Same protection at Core layer |
| `MarketplaceCore.clearRoyaltyOverride` | Immediate | Restores ERC-2981 precedence |
| `MarketplaceCore.verifyCollection` / `unverifyCollection` | Immediate | Metadata only |
| `MarketplaceCore.updateMarketplaceFee` / `updateFeeReceiver` | Immediate | Deployment guidance: timelock/multisig |
| `MarketplaceCore.setRouter` / `setBidsContract` | Immediate, one-time | Cannot be changed once set |
| `MarketplaceCore.setAuthorizedLaunchpad` | Immediate | Admin allow-list |
| `MarketplaceCore.pause` / `unpause` | Immediate | Incident response |
| `MarketplaceCore.sweepExcessETH` | Immediate | Excess-only recovery |
| `LaunchPad.setLaunchFee` | Immediate | Deployment guidance: timelock/multisig |
| `LaunchPad.withdrawFees` | Immediate | Owner withdraws accrued launch fees |
| `LaunchPad.pause` / `unpause` | Immediate | Incident response |
| `MarketplaceBids.pause` / `unpause` | Immediate | Incident response |
| `MarketplaceBids.setMarketplaceAddress` | Immediate | One-time wiring |
| `MarketplaceBids.sweepExcessETH` | Immediate | Excess-only recovery |

Fee and fee-receiver changes remain immediate in code. Pre-testnet deployment
guidance is to place the owner role behind a timelock/multisig; the audit did not
request a storage/ABI change for fee delays.

## ABI and storage additions

Append-only storage additions (no existing slot reordering):

- `royaltyOverridden`
- `pendingRegistrations`
- `pendingEmergencyRoyaltyUpdates`

ABI additions:

- `clearRoyaltyOverride(address)`
- `royaltyOverridden(address)`
- `proposeRegisterCollection(address,uint16,address)`
- `executeRegisterCollection(address)`
- `pendingRegistrations(address)`
- `proposeEmergencyUpdateCollectionRoyalty(address,address,uint16)`
- `executeEmergencyUpdateCollectionRoyalty(address)`
- `pendingEmergencyRoyaltyUpdates(address)`
- Core propose/execute registration variants
- Events: `RoyaltySourceUsed`, `RoyaltyOverrideCleared`,
  `CollectionRegistrationProposed`, `CollectionRegistrationExecuted`,
  `EmergencyRoyaltyUpdateProposed`, `EmergencyRoyaltyUpdateExecuted`

## Combined integration test

`test/AuditIntegrationH01M04.t.sol`:
`test_integration_H01_and_M04_combined` exercises Hyperc ERC-2981 at 5%, a Core
override to 3%, a 1-wei listing, a price update to 100 ether, and a buy. It
asserts the listing snapshot is 3%, the ERC-2981 receiver/registration receiver
receive nothing, and seller + marketplace fee + royalty equal exactly 100 ether.

## Commit sequence

1. `fix(audit-blocker): add missing _staticcallBounded2 + gasleft pre-check (L-01)`
2. `fix(audit-H01): recompute royalty snapshot on updateListingPrice`
3. `fix(audit-M04): make Core royalty override ERC-2981 when explicitly set`
4. `fix(audit-M03): add delay to registerCollection and emergency royalty updates`
