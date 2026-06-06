# 🚀 Deployment Guide - Modular Marketplace

## Quick Start

### 1️⃣ Setup

```bash
# Clone your project
cd your-marketplace-project

# Copy contracts to src/
cp MarketplaceCore.sol src/
cp MarketplaceBids.sol src/
cp Marketplace.sol src/

# Copy deployment script
cp DeployMarketplace.s.sol script/

# Copy configuration
cp foundry.toml .

# Setup environment
cp .env.example .env
# Edit .env with your values
```

### 2️⃣ Configure Environment

Edit `.env`:
```bash
PRIVATE_KEY=your_private_key_without_0x
FEE_RECEIVER=0xYourFeeReceiverAddress  # Optional, defaults to deployer
MARKETPLACE_FEE=100                      # 100 = 1%, Optional
ETHERSCAN_API_KEY=your_etherscan_api_key
```

### 3️⃣ Deploy

```bash
# Test deployment (dry run)
forge script script/DeployMarketplace.s.sol:DeployMarketplace \
  --rpc-url sepolia \
  -vvvv

# Deploy and verify
forge script script/DeployMarketplace.s.sol:DeployMarketplace \
  --rpc-url sepolia \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY

# Or use environment variable for RPC
forge script script/DeployMarketplace.s.sol:DeployMarketplace \
  --rpc-url $SEPOLIA_RPC_URL \
  --broadcast \
  --verify
```

## 📋 Project Structure

```
your-project/
├── src/
│   ├── MarketplaceCore.sol     # Core functionality
│   ├── MarketplaceBids.sol     # Bidding system
│   └── Marketplace.sol         # Main proxy
├── script/
│   └── DeployMarketplace.s.sol # Deployment script
├── deployments/
│   └── latest.json             # Auto-generated addresses
├── foundry.toml                # Configuration
└── .env                        # Environment variables
```

## 🔧 Foundry.toml Configuration

The `foundry.toml` includes critical settings:

```toml
[profile.default]
solc_version = "0.8.24"
optimizer = true
optimizer_runs = 200
via_ir = true  # ← CRITICAL: Solves "Stack too deep" errors
```

## 📊 Expected Gas Costs (Sepolia)

| Operation | Gas Cost |
|-----------|----------|
| Deploy Core | ~3,500,000 |
| Deploy Bids | ~2,800,000 |
| Deploy Marketplace | ~1,200,000 |
| Authorize Bids | ~50,000 |
| **Total** | **~7,550,000** |

At 1 gwei: ~0.00755 ETH (~$20-30 on mainnet at current prices)

## ✅ Post-Deployment Checklist

After deployment, the script automatically:
- ✅ Deploys all 3 contracts
- ✅ Authorizes Bids in Core
- ✅ Saves addresses to `deployments/latest.json`
- ✅ Displays deployment summary

**Manual steps:**

1. **Verify contracts on Etherscan** (done automatically with `--verify` flag)
2. **Update your frontend** with new Marketplace address
3. **Test basic functionality**:
   ```bash
   # Register a collection
   cast send $MARKETPLACE_ADDRESS \
     "registerCollection(address,uint16)" \
     $NFT_ADDRESS 500 \
     --private-key $PRIVATE_KEY
   ```

## 🎯 Important Addresses

After deployment, you'll have:

```
MarketplaceCore    = 0x... ← Users approve this for NFT transfers
MarketplaceBids    = 0x... ← Internal use only
Marketplace (Main) = 0x... ← Users interact with this
```

**For frontend integration:**
- Use **Marketplace** address for all user interactions
- Users must approve **MarketplaceCore** for NFT transfers

## 🧪 Testing Deployment

```bash
# Test on Sepolia testnet first!
export PRIVATE_KEY="your_testnet_key"
export FEE_RECEIVER="your_test_address"

forge script script/DeployMarketplace.s.sol:DeployMarketplace \
  --rpc-url sepolia \
  --broadcast

# Verify addresses
cat deployments/latest.json
```

## 🔍 Verification

If auto-verification fails:

```bash
# Manually verify Core
forge verify-contract \
  $CORE_ADDRESS \
  src/MarketplaceCore.sol:MarketplaceCore \
  --chain sepolia \
  --constructor-args $(cast abi-encode "constructor(uint16,address)" 100 $FEE_RECEIVER)

# Manually verify Bids
forge verify-contract \
  $BIDS_ADDRESS \
  src/MarketplaceBids.sol:MarketplaceBids \
  --chain sepolia \
  --constructor-args $(cast abi-encode "constructor(address)" $CORE_ADDRESS)

# Manually verify Marketplace
forge verify-contract \
  $MARKETPLACE_ADDRESS \
  src/Marketplace.sol:Marketplace \
  --chain sepolia \
  --constructor-args $(cast abi-encode "constructor(address,address)" $CORE_ADDRESS $BIDS_ADDRESS)
```

## 🚨 Troubleshooting

### Error: "Stack too deep"
**Solution:** Ensure `via_ir = true` in `foundry.toml`

### Error: "Contract too large"
**Solution:** Lower `optimizer_runs` in `foundry.toml`:
```toml
optimizer_runs = 200  # Try 150 if still too large
```

### Error: "Insufficient funds"
**Solution:** Fund your deployer wallet with more ETH

### Error: "Nonce too low/high"
**Solution:** Clear pending transactions or wait, then retry

### Verification fails
**Solution:** Use manual verification commands above

## 🔐 Security Checklist

Before mainnet deployment:

- [ ] Audit contracts (recommended for production)
- [ ] Test on testnet thoroughly
- [ ] Verify all contracts on Etherscan
- [ ] Set correct fee receiver address
- [ ] Set appropriate marketplace fee (max 1%)
- [ ] Backup deployment addresses securely
- [ ] Test emergency pause functionality
- [ ] Document admin procedures

## 📞 Support Commands

```bash
# Check contract size
forge build --sizes

# Run tests
forge test -vvv

# Check gas usage
forge test --gas-report

# Simulate deployment
forge script script/DeployMarketplace.s.sol:DeployMarketplace \
  --rpc-url sepolia

# Check balance
cast balance $YOUR_ADDRESS --rpc-url sepolia
```

## 🎓 Next Steps

1. **Update Frontend**: Replace contract address with new Marketplace address
2. **Test Thoroughly**: Run through all user flows on testnet
3. **Monitor**: Watch for any issues post-deployment
4. **Document**: Update your API docs with new addresses

## 📝 Deployment Log Example

```bash
✅ Deploying Marketplace contracts...
✅ MarketplaceCore deployed at: 0x1234...
✅ MarketplaceBids deployed at: 0x5678...
✅ Marketplace Proxy deployed at: 0xABCD...
✅ Bids contract authorized
✅ Addresses saved to: deployments/latest.json

=================================
DEPLOYMENT SUMMARY
=================================
MarketplaceCore: 0x1234...
MarketplaceBids: 0x5678...
Marketplace (Main): 0xABCD...

IMPORTANT:
- Users should interact with: 0xABCD...
- NFT approvals should be set for: 0x1234...
=================================
```

## 🔄 Upgrade Strategy

Since these contracts are not upgradeable, for major changes:

1. Deploy new versions
2. Pause old contracts
3. Migrate users to new contracts
4. Keep old contracts active for existing listings/bids

Consider implementing a migration tool for users to transfer their active listings.
