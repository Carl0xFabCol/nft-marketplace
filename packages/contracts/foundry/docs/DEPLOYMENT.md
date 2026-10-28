# Marketplace Deployment Guide

## Security Considerations

### Router Ownership
The router (`Marketplace.sol`) owner has significant control over the system:
- Can pause/unpause the entire marketplace
- Can sweep excess ETH from components
- Can transfer component ownership
- Can update fee receiver

**Recommended:** Deploy the router with a multisig (e.g., Gnosis Safe) controlled by 3-of-5 signers. Place the multisig behind an OpenZeppelin `TimelockController` with a 3-day delay for administrative actions.

## Deployment Order

### 1. Deploy Core Components
```bash
# 1. Deploy MarketplaceCore
MARKETPLACE_CORE=$(forge create MarketplaceCore --constructor-args <fee_receiver> <initial_fee_bps>)

# 2. Deploy MarketplaceBids with Core address
MARKETPLACE_BIDS=$(forge create MarketplaceBids --constructor-args $MARKETPLACE_CORE)

# 3. Set bids contract reference in Core
cast send $MARKETPLACE_CORE "setBidsContract(address)" $MARKETPLACE_BIDS
```

### 2. Deploy Router
```bash
# 4. Deploy Marketplace (Router)
MARKETPLACE=$(forge create Marketplace --constructor-args $MARKETPLACE_CORE $MARKETPLACE_BIDS)
```

### 3. Transfer Ownerships
```bash
# 5. Transfer Core ownership to Router
cast send $MARKETPLACE_CORE "transferOwnership(address)" $MARKETPLACE

# 6. Transfer Bids ownership to Router  
cast send $MARKETPLACE_BIDS "transferOwnership(address)" $MARKETPLACE

# 7. Accept ownership on Router
cast send $MARKETPLACE "acceptComponentOwnership()"

# 8. Configure bids marketplace address
cast send $MARKETPLACE "configureBidsMarketplace()"
```

### 4. Verify Setup
```bash
# Verify ownership
cast call $MARKETPLACE_CORE "owner()"                    # Should return $MARKETPLACE
cast call $MARKETPLACE_BIDS "owner()"                    # Should return $MARKETPLACE
cast call $MARKETPLACE_BIDS "marketplace()"              # Should return $MARKETPLACE

# Verify component references
cast call $MARKETPLACE "core()"                          # Should return $MARKETPLACE_CORE
cast call $MARKETPLACE "bids()"                         # Should return $MARKETPLACE_BIDS
```

## Post-Deployment Checks

### Functionality Tests
1. **Collection Registration**
   ```bash
   # Register a test collection via router
   cast send $MARKETPLACE "registerCollection(address,address,uint16)" \
     <collection_address> <royalty_receiver> <royalty_fee_bps>
   ```

2. **Listing Creation**
   ```bash
   # Create a test listing
   cast send $MARKETPLACE "createListing(address,uint256,uint128,uint64,address)" \
     <collection> <token_id> <price> <expiry> <seller> --value <price>
   ```

3. **Bid Placement**
   ```bash
   # Place a test bid
   cast send $MARKETPLACE "placeTokenBid(address,uint256,uint128,uint64)" \
     <collection> <token_id> <price> <expiry> --value <price>
   ```

### Security Verification
1. **Renounce Ownership Protection**
   ```bash
   # Should revert on all contracts
   cast send $MARKETPLACE "renounceOwnership()" && echo "FAIL" || echo "PASS"
   cast send $MARKETPLACE_CORE "renounceOwnership()" && echo "FAIL" || echo "PASS"
   cast send $MARKETPLACE_BIDS "renounceOwnership()" && echo "FAIL" || echo "PASS"
   ```

2. **Router ETH Reception**
   ```bash
   # Router should not accept ETH directly
   cast send $MARKETPLACE --value 0.1ether && echo "FAIL" || echo "PASS"
   ```

3. **Authorization Checks**
   ```bash
   # Verify onlyRouter modifier works on Core functions
   # These should revert when called directly
   cast send $MARKETPLACE_CORE "createListing(...)" && echo "FAIL" || echo "PASS"
   ```

## Emergency Procedures

### Pausing the Marketplace
```bash
# Pause entire system
cast send $MARKETPLACE "pause()"

# Verify paused state
cast call $MARKETPLACE_CORE "paused()"      # Should return true
cast call $MARKETPLACE_BIDS "paused()"     # Should return true
```

### Sweeping Excess ETH
```bash
# Check excess before sweeping
cast call $MARKETPLACE_CORE "excessETH()"
cast call $MARKETPLACE_BIDS "excessETH()"

# Sweep all excess
cast send $MARKETPLACE "sweepExcessETH(address)" <recipient>
```

### Ownership Migration
```bash
# Transfer to new owner (requires timelock)
cast send $MARKETPLACE "transferComponentOwnership(address)" <new_owner_address>

# New owner must accept on each component
cast send $MARKETPLACE_CORE "acceptOwnership()" --from <new_owner>
cast send $MARKETPLACE_BIDS "acceptOwnership()" --from <new_owner>
```

## Monitoring Recommendations

### Key Metrics
1. `MarketplaceBids.totalBidEscrow` vs contract balance
2. `MarketplaceBids.totalPendingWithdrawals`
3. Failed transactions due to custom errors
4. Collection registration events

### Alert Conditions
- `totalBidEscrow > address(bids).balance` (H-01 violation)
- High volume of `SelfPurchase` errors (wash trading)
- Unusual royalty receiver changes
- Multiple failed `renounceOwnership` attempts

## Version Information
- Solidity: 0.8.24 (pinned)
- OpenZeppelin: v5.0.0
- Audit Fixes Branch: `audit-fixes`
- Last Commit: See `AUDIT_FIXES.md` for complete list