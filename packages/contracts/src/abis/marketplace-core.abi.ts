// ─────────────────────────────────────────────────────────────────────────────
// MarketplaceCore ABI — handles listings, sales, and collection registry.
// This contract EMITS listing and sale events that the indexer listens to.
// ─────────────────────────────────────────────────────────────────────────────

export const MarketplaceCoreABI = [
  {
    type: "constructor",
    inputs: [
      {
        name: "_marketplaceFee",
        type: "uint16",
        internalType: "uint16",
      },
      {
        name: "_feeReceiver",
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
    name: "acceptOwnership",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "authorizedContracts",
    inputs: [
      {
        name: "",
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
    name: "authorizedLaunchpads",
    inputs: [
      {
        name: "",
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
      {
        name: "buyer",
        type: "address",
        internalType: "address",
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
      {
        name: "buyer",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "payable",
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
      {
        name: "seller",
        type: "address",
        internalType: "address",
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
      {
        name: "seller",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "collections",
    inputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
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
      {
        name: "seller",
        type: "address",
        internalType: "address",
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
      {
        name: "seller",
        type: "address",
        internalType: "address",
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
    name: "executeSaleFromBid",
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
        name: "seller",
        type: "address",
        internalType: "address",
      },
      {
        name: "buyer",
        type: "address",
        internalType: "address",
      },
      {
        name: "price",
        type: "uint128",
        internalType: "uint128",
      },
    ],
    outputs: [
      {
        name: "marketplaceFeeAmount",
        type: "uint128",
        internalType: "uint128",
      },
      {
        name: "royaltyReceiver",
        type: "address",
        internalType: "address",
      },
      {
        name: "royaltyAmount",
        type: "uint256",
        internalType: "uint256",
      },
    ],
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
        name: "totalColVolume",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "totalColSales",
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
    stateMutability: "view",
  },
  {
    type: "function",
    name: "listings",
    inputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
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
        name: "",
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
    ],
    stateMutability: "view",
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
      {
        name: "creator",
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
    name: "totalPendingWithdrawals",
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
      {
        name: "sender",
        type: "address",
        internalType: "address",
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
      {
        name: "seller",
        type: "address",
        internalType: "address",
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
    type: "function",
    name: "withdrawFor",
    inputs: [
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "withdrawn",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "CollectionRegistered",
    inputs: [
      {
        name: "collection",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "owner",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "royaltyFee",
        type: "uint16",
        indexed: false,
        internalType: "uint16",
      },
      {
        name: "isVerified",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "CollectionRoyaltyUpdated",
    inputs: [
      {
        name: "collection",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "royaltyReceiver",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "royaltyFee",
        type: "uint16",
        indexed: false,
        internalType: "uint16",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "CollectionVerified",
    inputs: [
      {
        name: "collection",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ContractAuthorized",
    inputs: [
      {
        name: "contractAddr",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "authorized",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ExcessETHSwept",
    inputs: [
      {
        name: "recipient",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "FeeReceiverUpdated",
    inputs: [
      {
        name: "oldReceiver",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "newReceiver",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "LaunchpadAuthorized",
    inputs: [
      {
        name: "launchpad",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "authorized",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ListingCancelled",
    inputs: [
      {
        name: "collection",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "tokenId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "seller",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ListingCreated",
    inputs: [
      {
        name: "collection",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "tokenId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "seller",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "price",
        type: "uint128",
        indexed: false,
        internalType: "uint128",
      },
      {
        name: "expiresAt",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ListingUpdated",
    inputs: [
      {
        name: "collection",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "tokenId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "newPrice",
        type: "uint128",
        indexed: false,
        internalType: "uint128",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "MarketplaceFeeUpdated",
    inputs: [
      {
        name: "oldFee",
        type: "uint16",
        indexed: false,
        internalType: "uint16",
      },
      {
        name: "newFee",
        type: "uint16",
        indexed: false,
        internalType: "uint16",
      },
    ],
    anonymous: false,
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
    type: "event",
    name: "Paused",
    inputs: [
      {
        name: "account",
        type: "address",
        indexed: false,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Sale",
    inputs: [
      {
        name: "collection",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "tokenId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "seller",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "buyer",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "price",
        type: "uint128",
        indexed: false,
        internalType: "uint128",
      },
      {
        name: "marketplaceFeeAmount",
        type: "uint128",
        indexed: false,
        internalType: "uint128",
      },
      {
        name: "royaltyAmount",
        type: "uint128",
        indexed: false,
        internalType: "uint128",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Unpaused",
    inputs: [
      {
        name: "account",
        type: "address",
        indexed: false,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Withdrawal",
    inputs: [
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "ArrayLengthMismatch",
    inputs: [],
  },
  {
    type: "error",
    name: "CollectionAlreadyRegistered",
    inputs: [],
  },
  {
    type: "error",
    name: "CollectionNotRegistered",
    inputs: [],
  },
  {
    type: "error",
    name: "CorePaused",
    inputs: [],
  },
  {
    type: "error",
    name: "EnforcedPause",
    inputs: [],
  },
  {
    type: "error",
    name: "ExpectedPause",
    inputs: [],
  },
  {
    type: "error",
    name: "FeeTooHigh",
    inputs: [],
  },
  {
    type: "error",
    name: "InsufficientExcess",
    inputs: [],
  },
  {
    type: "error",
    name: "InsufficientValue",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidAddress",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidCollection",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidPrice",
    inputs: [],
  },
  {
    type: "error",
    name: "ListingExpired",
    inputs: [],
  },
  {
    type: "error",
    name: "ListingNotFound",
    inputs: [],
  },
  {
    type: "error",
    name: "NoWithdrawal",
    inputs: [],
  },
  {
    type: "error",
    name: "NotApproved",
    inputs: [],
  },
  {
    type: "error",
    name: "NotCollectionOwner",
    inputs: [],
  },
  {
    type: "error",
    name: "NotSeller",
    inputs: [],
  },
  {
    type: "error",
    name: "NotTokenOwner",
    inputs: [],
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
  {
    type: "error",
    name: "ReentrancyGuardReentrantCall",
    inputs: [],
  },
  {
    type: "error",
    name: "SelfPurchase",
    inputs: [],
  },
  {
    type: "error",
    name: "TransferFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "Unauthorized",
    inputs: [],
  },
] as const
