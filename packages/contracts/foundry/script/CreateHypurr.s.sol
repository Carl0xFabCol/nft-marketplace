// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/MERC721.sol";
import "../src/Marketplace.sol";

contract CreateHypurr is Script {
    address constant DEFAULT_OWNER = 0x14730853915F8C5cF9C647DbC3Ee7EBb9fE67294;
    string constant NAME = "Hypurr Testnet";
    string constant SYMBOL = "Hypurr";
    string constant BASE_URI = "ipfs://bafybeigs5lojzzear4gyuizxgmdabdam7jftguarspv4rcxw665pkioxdy/";
    uint16 constant ROYALTY_FEE = 100;
    uint256 constant MAX_SUPPLY = 10_000;
    uint256 constant MINT_PRICE = 0.01 ether;

    function run() external {
        require(block.chainid == 99801, "Wrong network: expected Elysium");

        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address payable marketplaceAddress = payable(vm.envAddress("MARKETPLACE_ADDRESS"));
        address owner = vm.envOr("HYPURR_OWNER", DEFAULT_OWNER);
        bool mintOne = vm.envOr("HYPURR_MINT_ONE", true);

        vm.startBroadcast(deployerPrivateKey);

        MiColeccion collection = new MiColeccion(
            NAME,
            SYMBOL,
            owner,
            ROYALTY_FEE,
            owner,
            MAX_SUPPLY,
            BASE_URI,
            MINT_PRICE,
            0
        );

        Marketplace(marketplaceAddress).registerCollection(address(collection), ROYALTY_FEE, owner);

        if (mintOne) {
            collection.mint{value: MINT_PRICE}(owner);
        }

        vm.stopBroadcast();

        console.log("Hypurr collection:", address(collection));
        console.log("Owner:", collection.owner());
        console.log("Max supply:", collection.maxSupply());
        console.log("Mint price:", collection.mintPrice());
        console.log("Mint ends at:", collection.mintEndsAt());
        console.log("Next token id:", collection.getNextTokenId());
    }
}
