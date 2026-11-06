# Archived deployment records

Historical records, kept for provenance. Never deleted, never read by any script.

## `elysium-2026-11-05-legacy-pre-audit.json`

The Elysium (chain 99801) deployment that was live when the deployment-script
audit was performed on 2026-11-05. **These contracts are still deployed and
still owned by `0x13F1CDc39d462A2B48c93fc4875C3F761AF26EB3`**, but they are an
older build that is **ABI-incompatible with the current `src/` contracts**:

```
cast call 0x0726b653Bf5296FBA944263FaE162B949a2F75be 'router()(address)' --rpc-url elysium
# execution reverted: Invalid call
```

`MarketplaceCore.router()` and `MarketplaceCore.bidsContract()` do not exist on
that build, so it cannot be configured, verified, or reused by the current
scripts. `VerifyDeployment` and `DeployMarketplace` both detect this and say so
explicitly rather than failing with an opaque revert.

This file was previously `deployments/latest.json`. It was moved here because
`latest.json` is now written **only** by `VerifyDeployment`, after it has
confirmed real on-chain state, and a stale `latest.json` would otherwise have
forced `ALLOW_REDEPLOY=true` on an ordinary first deployment.

If this old stack is ever to be retired on chain, do it deliberately through its
own router; nothing in this repository will touch it.
