// ─────────────────────────────────────────────────────────────────────────────
// Marketplace ABI — the main facade contract.
// NOTE: This contract has NO events. Events come from MarketplaceCore and
// MarketplaceBids. The indexer only listens to those two contracts.
// ─────────────────────────────────────────────────────────────────────────────

export const MarketplaceABI = [
  {
    type: "constructor",
    inputs: [
      {
        name: "_core",
        type: "address",
        internalType: "address",
      },
      {
        name: "_bids",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "fallback",
    stateMutability: "payable",
  },
  {
    type: "receive",
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "BASIS_POINTS",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "MAX_MARKETPLACE_FEE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "MAX_ROYALTY_FEE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "MIN_LISTING_PRICE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint128",
        internalType: "uint128",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "acceptCollectionBid",
    inputs: [
      {
        name: "collection",
        type: "address",
        internalType: "address",
      },
      {
        name: "bidder",
        type: "address",
        internalType: "address",
      },
      {
        name: "tokenIds",
        type: "uint256[]",
        internalType: "uint256[]",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "acceptComponentOwnership",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "acceptOwnership",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "acceptTokenBid",
    inputs: [
      {
        name: "collection",
        type: "address",
        internalType: "address",
      },
      {
        name: "tokenId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "bidder",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "authorizedLaunchpads",
    inputs: [
      {
        name: "launchpad",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "bids",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IMarketplaceBids",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "buy",
    inputs: [
      {
        name: "collection",
        type: "address",
        internalType: "address",
      },
      {
        name: "tokenId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "buyBatch",
    inputs: [
      {
        name: "collection",
        type: "address",
        internalType: "address",
      },
      {
        name: "tokenIds",
        type: "uint256[]",
        internalType: "uint256[]",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "cancelCollectionBid",
    inputs: [
      {
        name: "collection",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cancelListing",
    inputs: [
      {
        name: "collection",
        type: "address",
        internalType: "address",
      },
      {
        name: "tokenId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cancelListingBatch",
    inputs: [
      {
        name: "collections_",
        type: "address[]",
        internalType: "address[]",
      },
      {
        name: "tokenIds",
        type: "uint256[]",
        internalType: "uint256[]",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cancelTokenBid",
    inputs: [
      {
        name: "collection",
        type: "address",
        internalType: "address",
      },
      {
        name: "tokenId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cancelTokenBidBatch",
    inputs: [
      {
        name: "collections_",
        type: "address[]",
        internalType: "address[]",
      },
      {
        name: "tokenIds",
        type: "uint256[]",
        internalType: "uint256[]",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "collectionBids",
    inputs: [
      {
        name: "collection",
        type: "address",
        internalType: "address",
      },
      {
        name: "bidder",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct Marketplace.CollectionBid",
        components: [
          {
            name: "bidder",
            type: "address",
            internalType: "address",
          },
          {
            name: "pricePerItem",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "quantity",
            type: "uint32",
            internalType: "uint32",
          },
          {
            name: "expiresAt",
            type: "uint64",
            internalType: "uint64",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "collections",
    inputs: [
      {
        name: "collection",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct Marketplace.CollectionInfo",
        components: [
          {
            name: "royaltyReceiver",
            type: "address",
            internalType: "address",
          },
          {
            name: "royaltyFee",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "totalVolume",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "totalSales",
            type: "uint32",
            internalType: "uint32",
          },
          {
            name: "isVerified",
            type: "bool",
            internalType: "bool",
          },
          {
            name: "exists",
            type: "bool",
            internalType: "bool",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "configureBidsMarketplace",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "core",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IMarketplaceCore",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "createListing",
    inputs: [
      {
        name: "collection",
        type: "address",
        internalType: "address",
      },
      {
        name: "tokenId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "price",
        type: "uint128",
        internalType: "uint128",
      },
      {
        name: "expiresAt",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "createListingBatch",
    inputs: [
      {
        name: "collections_",
        type: "address[]",
        internalType: "address[]",
      },
      {
        name: "tokenIds",
        type: "uint256[]",
        internalType: "uint256[]",
      },
      {
        name: "prices",
        type: "uint128[]",
        internalType: "uint128[]",
      },
      {
        name: "expiresAts",
        type: "uint64[]",
        internalType: "uint64[]",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "emergencyUpdateCollectionRoyalty",
    inputs: [
      {
        name: "collection",
        type: "address",
        internalType: "address",
      },
      {
        name: "royaltyReceiver",
        type: "address",
        internalType: "address",
      },
      {
        name: "royaltyFee",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "feeReceiver",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getCollectionStats",
    inputs: [
      {
        name: "collection",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "",
        type: "uint32",
        internalType: "uint32",
      },
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "listings",
    inputs: [
      {
        name: "collection",
        type: "address",
        internalType: "address",
      },
      {
        name: "tokenId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct Marketplace.Listing",
        components: [
          {
            name: "seller",
            type: "address",
            internalType: "address",
          },
          {
            name: "price",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "listedAt",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "expiresAt",
            type: "uint64",
            internalType: "uint64",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "marketplaceFee",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "pause",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "paused",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "pendingOwner",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "pendingWithdrawals",
    inputs: [
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "coreAmount",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "bidsAmount",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "placeCollectionBid",
    inputs: [
      {
        name: "collection",
        type: "address",
        internalType: "address",
      },
      {
        name: "pricePerItem",
        type: "uint128",
        internalType: "uint128",
      },
      {
        name: "quantity",
        type: "uint32",
        internalType: "uint32",
      },
      {
        name: "expiresAt",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "placeTokenBid",
    inputs: [
      {
        name: "collection",
        type: "address",
        internalType: "address",
      },
      {
        name: "tokenId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "price",
        type: "uint128",
        internalType: "uint128",
      },
      {
        name: "expiresAt",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "placeTokenBidBatch",
    inputs: [
      {
        name: "collection",
        type: "address",
        internalType: "address",
      },
      {
        name: "tokenIds",
        type: "uint256[]",
        internalType: "uint256[]",
      },
      {
        name: "prices",
        type: "uint128[]",
        internalType: "uint128[]",
      },
      {
        name: "expiresAts",
        type: "uint64[]",
        internalType: "uint64[]",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "registerCollection",
    inputs: [
      {
        name: "collection",
        type: "address",
        internalType: "address",
      },
      {
        name: "royaltyFee",
        type: "uint16",
        internalType: "uint16",
      },
      {
        name: "royaltyReceiver",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "renounceOwnership",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setAuthorizedContract",
    inputs: [
      {
        name: "contractAddr",
        type: "address",
        internalType: "address",
      },
      {
        name: "authorized",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setAuthorizedLaunchpad",
    inputs: [
      {
        name: "launchpad",
        type: "address",
        internalType: "address",
      },
      {
        name: "authorized",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "sweepExcessETH",
    inputs: [
      {
        name: "recipient",
        type: "address",
        internalType: "address payable",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "tokenBids",
    inputs: [
      {
        name: "collection",
        type: "address",
        internalType: "address",
      },
      {
        name: "tokenId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "bidder",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct Marketplace.TokenBid",
        components: [
          {
            name: "bidder",
            type: "address",
            internalType: "address",
          },
          {
            name: "price",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "expiresAt",
            type: "uint64",
            internalType: "uint64",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalListings",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalSales",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalVolume",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "transferOwnership",
    inputs: [
      {
        name: "newOwner",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "unpause",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "updateCollectionRoyalty",
    inputs: [
      {
        name: "collection",
        type: "address",
        internalType: "address",
      },
      {
        name: "royaltyReceiver",
        type: "address",
        internalType: "address",
      },
      {
        name: "royaltyFee",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "updateFeeReceiver",
    inputs: [
      {
        name: "newReceiver",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "updateListingPrice",
    inputs: [
      {
        name: "collection",
        type: "address",
        internalType: "address",
      },
      {
        name: "tokenId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "newPrice",
        type: "uint128",
        internalType: "uint128",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "updateMarketplaceFee",
    inputs: [
      {
        name: "newFee",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "verifyCollection",
    inputs: [
      {
        name: "collection",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdraw",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "OwnershipTransferStarted",
    inputs: [
      {
        name: "previousOwner",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "newOwner",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "OwnershipTransferred",
    inputs: [
      {
        name: "previousOwner",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "newOwner",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "OwnableInvalidOwner",
    inputs: [
      {
        name: "owner",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "OwnableUnauthorizedAccount",
    inputs: [
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
  },
] as const
