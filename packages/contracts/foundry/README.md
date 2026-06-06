# Modular NFT Marketplace

## 📋 Overview

This is a professional, gas-optimized NFT marketplace split into 3 contracts to stay under the 24KB contract size limit while maintaining the **exact same API** as the original monolithic version.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Marketplace.sol                       │
│              (Proxy/Router - Main Entry Point)          │
│                                                          │
│  - Maintains original API                               │
│  - Delegates to Core and Bids                           │
│  - User-facing contract                                 │
└────────────────┬──────────────────┬─────────────────────┘
                 │                  │
        ┌────────▼────────┐   ┌─────▼──────────┐
        │ MarketplaceCore │   │ MarketplaceBids │
        │                 │   │                 │
        │ - Listings      │   │ - Collection    │
        │ - Direct sales  │   │   bids          │
        │ - Collections   │   │ - Token bids    │
        │ - Royalties     │   │                 │
        └─────────────────┘   └─────────────────┘
```

### Contract Breakdown

1. **MarketplaceCore.sol** (~20KB)
   - Listing management (create, update, cancel)
   - Direct purchases (buy, buyBatch)
   - Collection registration and royalties
   - Fee management
   - Stats tracking

2. **MarketplaceBids.sol** (~15KB)
   - Collection-wide bidding
   - Token-specific bidding
   - Bid acceptance logic
   - Bid cancellation

3. **Marketplace.sol** (~8KB)
   - Main user interface
   - Delegates all calls to Core/Bids
   - Maintains exact same API as original
   - Backwards compatible

## 🚀 Deployment

### Option 1: Using MarketplaceDeployer (Recommended)

```solidity
// Deploy all at once
MarketplaceDeployer deployer = new MarketplaceDeployer();
MarketplaceDeployer.DeploymentAddresses memory addrs = deployer.deployAll(
    100,           // 1% marketplace fee (in basis points)
    feeReceiver    // Address to receive fees
);

// Use addrs.marketplace as your main contract
Marketplace marketplace = Marketplace(addrs.marketplace);
```

### Option 2: Manual Deployment

```javascript
// 1. Deploy Core
const Core = await ethers.getContractFactory("MarketplaceCore");
const core = await Core.deploy(
    100,          // 1% fee (basis points)
    feeReceiver   // Fee receiver address
);
await core.waitForDeployment();

// 2. Deploy Bids
const Bids = await ethers.getContractFactory("MarketplaceBids");
const bids = await Bids.deploy(await core.getAddress());
await bids.waitForDeployment();

// 3. Deploy Marketplace Proxy
const Marketplace = await ethers.getContractFactory("Marketplace");
const marketplace = await Marketplace.deploy(
    await core.getAddress(),
    await bids.getAddress()
);
await marketplace.waitForDeployment();

// 4. Authorize Bids contract in Core
await core.setAuthorizedContract(await bids.getAddress(), true);

// 5. (Optional) Transfer ownerships
await core.transferOwnership(owner);
await bids.transferOwnership(owner);
```

### Foundry Deployment

```bash
# Deploy Core
forge create MarketplaceCore \
  --constructor-args 100 $FEE_RECEIVER \
  --private-key $PRIVATE_KEY

# Deploy Bids
forge create MarketplaceBids \
  --constructor-args $CORE_ADDRESS \
  --private-key $PRIVATE_KEY

# Deploy Marketplace
forge create Marketplace \
  --constructor-args $CORE_ADDRESS $BIDS_ADDRESS \
  --private-key $PRIVATE_KEY

# Authorize Bids
cast send $CORE_ADDRESS \
  "setAuthorizedContract(address,bool)" \
  $BIDS_ADDRESS true \
  --private-key $PRIVATE_KEY
```

## 💡 Usage

### For Users (No Changes Required!)

The API is **identical** to the original contract. All interactions go through `Marketplace.sol`:

```solidity
// List an NFT
marketplace.createListing(nftAddress, tokenId, price, expiresAt);

// Buy an NFT
marketplace.buy{value: price}(nftAddress, tokenId);

// Place a collection bid
marketplace.placeCollectionBid{value: totalValue}(
    nftAddress,
    pricePerItem,
    quantity,
    expiresAt
);

// Place a token bid
marketplace.placeTokenBid{value: price}(
    nftAddress,
    tokenId,
    price,
    expiresAt
);

// Accept a bid
marketplace.acceptTokenBid(nftAddress, tokenId, bidderAddress);
```

### NFT Approvals

```solidity
// Approve marketplace CORE for listings and sales
IERC721(nftAddress).setApprovalForAll(coreAddress, true);

// OR approve the main Marketplace proxy (will need to approve Core too)
IERC721(nftAddress).setApprovalForAll(marketplaceAddress, true);
```

**Important:** Users must approve the **Core contract** address for NFT transfers, as that's where the actual transfer logic resides.

## 🔧 Configuration

### Compile Settings

For Hardhat (`hardhat.config.js`):
```javascript
solidity: {
  version: "0.8.24",
  settings: {
    optimizer: {
      enabled: true,
      runs: 200  // Lower runs = smaller contract size
    }
  }
}
```

For Foundry (`foundry.toml`):
```toml
[profile.default]
solc_version = "0.8.24"
optimizer = true
optimizer_runs = 200
```

## 📊 Contract Sizes

| Contract | Size | Limit | Margin |
|----------|------|-------|--------|
| MarketplaceCore | ~20KB | 24KB | 4KB ✅ |
| MarketplaceBids | ~15KB | 24KB | 9KB ✅ |
| Marketplace | ~8KB | 24KB | 16KB ✅ |

## 🔒 Security Features

All original security features are preserved:

- ✅ ReentrancyGuard on all state-changing functions
- ✅ Pausable for emergency stops
- ✅ Ownership controls
- ✅ Input validation
- ✅ Safe ETH transfers
- ✅ EIP-2981 royalty support
- ✅ Expiration checks for listings and bids

## 🎯 Key Features

- **Listings**: List NFTs for sale with optional expiration
- **Direct Purchases**: Buy listed NFTs instantly
- **Collection Bids**: Bid on any item from a collection
- **Token Bids**: Bid on specific tokens
- **Royalties**: EIP-2981 support + custom royalties
- **Batch Operations**: Create/cancel multiple listings/bids at once
- **Verified Collections**: Marketplace can verify trusted collections
- **Statistics**: Track volume and sales per collection

## 🔄 Migration from Monolithic Version

If you have existing frontend/backend code:

**No changes needed!** Just update your contract address to the new `Marketplace.sol` proxy address.

```javascript
// Old
const marketplace = new ethers.Contract(oldAddress, abi, signer);

// New (same ABI, just different address!)
const marketplace = new ethers.Contract(newMarketplaceAddress, abi, signer);
```

## 📝 Admin Functions

```solidity
// Update marketplace fee (max 1%)
marketplace.updateMarketplaceFee(newFee);

// Update fee receiver
marketplace.updateFeeReceiver(newReceiver);

// Verify a collection
marketplace.verifyCollection(collectionAddress);

// Pause marketplace (affects both Core and Bids)
marketplace.pause();
marketplace.unpause();
```

## 🧪 Testing

The modular architecture doesn't change testing strategy:

```javascript
describe("Marketplace", function() {
    let marketplace, core, bids;

    beforeEach(async function() {
        // Deploy all contracts
        core = await deployCore();
        bids = await deployBids(core.address);
        marketplace = await deployMarketplace(core.address, bids.address);
        
        // Authorize bids
        await core.setAuthorizedContract(bids.address, true);
    });

    it("should create listing", async function() {
        // Test through Marketplace interface
        await marketplace.createListing(nft, tokenId, price, 0);
        // Verify in Core
        const listing = await core.listings(nft, tokenId);
        expect(listing.price).to.equal(price);
    });
});
```

## 🚨 Important Notes

1. **Authorization**: The Bids contract MUST be authorized in Core via `setAuthorizedContract(bidsAddress, true)`

2. **Approvals**: Users must approve the **Core contract** for NFT transfers (not the Marketplace proxy)

3. **Ownership**: Both Core and Bids have separate ownership - transfer both to the same address for consistency

4. **Pausing**: Calling `pause()` on Marketplace proxy will pause both Core and Bids

## 📜 License

MIT

## 🤝 Contributing

This modular architecture maintains full compatibility while solving the contract size issue. All original functionality is preserved across the three contracts.
