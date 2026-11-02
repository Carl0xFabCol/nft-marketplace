// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../src/MarketplaceCore.sol";

contract MockMalformedNFT is ERC721, Ownable {
    mapping(uint256 => address) private _tokenRoyaltyReceiver;
    mapping(uint256 => uint96) private _tokenRoyaltyFee;

    bool public malformedSupportsInterface;
    bool public malformedOwnerOf;
    bool public malformedGetApproved;
    bool public malformedIsApprovedForAll;
    bool public malformedRoyaltyInfo;
    bool public malformedRoyaltyInfoSize;
    bool public malformedOwner;
    bool public expensiveRoyaltyInfo;

    uint256 public malformedOwnerOfWord;
    uint8 public malformedOwnerOfMode;
    uint256 public expensiveRoyaltyIterations = 5_000;
    uint256 public ownerOfGasBurnIterations;
    uint8 public ownerOfRevertMode;

    error OwnerOfCustomError();

    constructor() Ownable(msg.sender) ERC721("MockMalformedNFT", "MMNFT") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    function setTokenRoyalty(uint256 tokenId, address receiver, uint96 feeNumerator) external {
        _tokenRoyaltyReceiver[tokenId] = receiver;
        _tokenRoyaltyFee[tokenId] = feeNumerator;
    }

    function setMalformedSupportsInterface(bool value) external {
        malformedSupportsInterface = value;
    }

    function setMalformedOwnerOf(bool value, uint256 word) external {
        malformedOwnerOf = value;
        malformedOwnerOfWord = word;
        malformedOwnerOfMode = 0;
    }

    function setMalformedOwnerOfMode(bool value, uint256 word, uint8 mode) external {
        malformedOwnerOf = value;
        malformedOwnerOfWord = word;
        malformedOwnerOfMode = mode;
    }

    function setMalformedGetApproved(bool value) external {
        malformedGetApproved = value;
    }

    function setMalformedIsApprovedForAll(bool value) external {
        malformedIsApprovedForAll = value;
    }

    function setMalformedRoyaltyInfo(bool value) external {
        malformedRoyaltyInfo = value;
    }

    function setMalformedRoyaltyInfoSize(bool value) external {
        malformedRoyaltyInfoSize = value;
    }

    function setMalformedOwner(bool value) external {
        malformedOwner = value;
    }

    function setOwnerOfGasBurn(uint256 iterations) external {
        ownerOfGasBurnIterations = iterations;
    }

    function setOwnerOfRevertMode(uint8 mode) external {
        ownerOfRevertMode = mode;
    }

    function setExpensiveRoyaltyInfo(bool value, uint256 iterations) external {
        expensiveRoyaltyInfo = value;
        expensiveRoyaltyIterations = iterations;
    }

    function owner() public view override returns (address) {
        if (malformedOwner) {
            assembly {
                mstore(0, or(shl(160, 1), 1))
                return(0, 0x20)
            }
        }
        return super.owner();
    }

    function ownerOf(uint256 tokenId) public view override returns (address) {
        if (malformedOwnerOf) {
            uint256 word = malformedOwnerOfWord;
            uint8 mode = malformedOwnerOfMode;
            assembly {
                mstore(0, word)
                switch mode
                case 1 {
                    return(0, 0x40)
                }
                case 2 {
                    return(0, 0x01)
                }
                default {
                    return(0, 0x20)
                }
            }
        }
        if (ownerOfRevertMode == 1) revert OwnerOfCustomError();
        if (ownerOfRevertMode == 2) {
            assembly {
                revert(0, 0)
            }
        }
        if (ownerOfGasBurnIterations != 0) {
            uint256 iterations = ownerOfGasBurnIterations;
            uint256 acc;
            for (uint256 i; i < iterations; ++i) {
                acc = uint256(keccak256(abi.encodePacked(acc, i)));
            }
            if (acc == type(uint256).max) revert();
        }
        return super.ownerOf(tokenId);
    }

    function getApproved(uint256 tokenId) public view override returns (address) {
        if (malformedGetApproved) {
            assembly {
                mstore(0, or(shl(160, 1), 1))
                return(0, 0x20)
            }
        }
        return super.getApproved(tokenId);
    }

    function isApprovedForAll(address tokenOwner, address operator) public view override returns (bool) {
        if (malformedIsApprovedForAll) {
            assembly {
                mstore(0, 2)
                return(0, 0x20)
            }
        }
        return super.isApprovedForAll(tokenOwner, operator);
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC721) returns (bool) {
        if (malformedSupportsInterface) {
            assembly {
                mstore(0, 2)
                return(0, 0x20)
            }
        }
        return interfaceId == 0x2a55205a || interfaceId == 0x2a552323 || super.supportsInterface(interfaceId);
    }

    function royaltyInfo(uint256 tokenId, uint256 salePrice) public view returns (address, uint256) {
        if (malformedRoyaltyInfoSize) {
            assembly {
                mstore(0, 1)
                return(0, 0x01)
            }
        }
        if (malformedRoyaltyInfo) {
            assembly {
                mstore(0, or(shl(160, 1), 1))
                mstore(0x20, not(0))
                return(0, 0x40)
            }
        }

        if (expensiveRoyaltyInfo) {
            uint256 iterations = expensiveRoyaltyIterations;
            uint256 acc;
            for (uint256 i; i < iterations; ++i) {
                acc = uint256(keccak256(abi.encodePacked(acc, i)));
            }
            if (acc == type(uint256).max) return (address(0xdead), 1);
            return (address(0xbeef), 1);
        }

        address receiver = _tokenRoyaltyReceiver[tokenId];
        uint96 fee = _tokenRoyaltyFee[tokenId];
        if (receiver == address(0) || fee == 0) return (address(0), 0);
        return (receiver, (salePrice * fee) / 10_000);
    }
}

contract MockMalformedFactory {
    bool public malformedIsCollection;

    function setMalformedIsCollection(bool value) external {
        malformedIsCollection = value;
    }

    function isCollection(address) external view returns (bool) {
        if (malformedIsCollection) {
            assembly {
                mstore(0, 2)
                return(0, 0x20)
            }
        }
        return true;
    }

    function register(
        address core,
        address collection,
        uint16 royaltyFee,
        address royaltyReceiver,
        address creator
    ) external {
        MarketplaceCore(payable(core)).registerCollectionFromLaunchpad(
            collection,
            royaltyFee,
            royaltyReceiver,
            creator
        );
    }
}
