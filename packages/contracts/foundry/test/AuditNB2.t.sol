// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";
import {LaunchPad, IMarketplaceCoreRegistry} from "../src/LaunchPad.sol";
import {Hyperc as MiColeccion} from "../src/MERC721.sol";
import {VerifyDeployment} from "../script/VerifyDeployment.s.sol";

contract MismatchedLaunchpad {
    IMarketplaceCoreRegistry public immutable core;
    mapping(address => bool) public isLaunchpadCollection;

    constructor(address _core) {
        core = IMarketplaceCoreRegistry(_core);
    }

    function createCollection(address initialOwner) external returns (address collection) {
        collection = address(
            new MiColeccion(
                "Mismatch",
                "MM",
                initialOwner,
                0,
                address(0),
                10,
                "",
                0,
                0
            )
        );
        isLaunchpadCollection[collection] = true;
        core.registerCollectionFromLaunchpad(
            collection,
            0,
            address(0),
            msg.sender
        );
    }

    function isCollection(address collection) external view returns (bool) {
        return isLaunchpadCollection[collection];
    }
}

/// @notice NB-2: LaunchPad -> Core registration and first trade end to end.
contract AuditNB2Test is TestSetup {
    LaunchPad internal launchPad;
    VerifyDeployment internal verifier;
    address internal creator = vm.addr(9);

    function setUp() public override {
        super.setUp();
        vm.deal(creator, 100 ether);

        vm.prank(owner);
        launchPad = new LaunchPad(address(core));

        vm.prank(owner);
        launchPad.setLaunchFee(0);

        vm.prank(owner);
        marketplace.setAuthorizedLaunchpad(address(launchPad), true);

        verifier = new VerifyDeployment();
    }

    function _createCollection() internal returns (MiColeccion collection) {
        vm.prank(creator);
        address deployed = launchPad.createCollection(
            "Launch Collection",
            "LC",
            uint16(ROYALTY_FEE),
            royaltyReceiverAddr,
            10,
            "ipfs://launch/",
            0,
            0
        );
        collection = MiColeccion(deployed);
    }

    function testNB2_LaunchPadEndToEnd() public {
        MiColeccion collection = _createCollection();

        assertTrue(core.isRegistered(address(collection)));
        assertTrue(core.authorizedLaunchpads(address(launchPad)));
        assertEq(address(launchPad.core()), address(core));

        (address receiver, uint16 royaltyFee, , , , bool exists) =
            core.collections(address(collection));
        assertTrue(exists);
        assertEq(receiver, royaltyReceiverAddr);
        assertEq(royaltyFee, uint16(ROYALTY_FEE));

        vm.prank(seller);
        collection.mint(seller);
        vm.prank(seller);
        collection.setApprovalForAll(address(core), true);

        vm.prank(seller);
        marketplace.createListing(
            address(collection),
            1,
            uint128(SALE_PRICE),
            _listingExpiry()
        );

        vm.prank(buyer);
        marketplace.buy{value: SALE_PRICE}(address(collection), 1);

        assertEq(collection.ownerOf(1), buyer);
        assertGt(core.pendingWithdrawals(seller), 0);

        verifier.run(
            address(core),
            address(bids),
            address(marketplace),
            address(launchPad)
        );
    }

    function testNB2_CollectionOwnerMismatchReverts() public {
        MismatchedLaunchpad mismatched = new MismatchedLaunchpad(address(core));

        vm.prank(owner);
        marketplace.setAuthorizedLaunchpad(address(mismatched), true);

        vm.prank(creator);
        vm.expectRevert(MarketplaceCore.NotCollectionOwner.selector);
        mismatched.createCollection(unauthorized);
    }

    function testNB2_VerifierRejectsUnauthorizedLaunchpad() public {
        LaunchPad unverified = new LaunchPad(address(core));

        vm.expectRevert("R-5: launchpad not authorized");
        verifier.run(
            address(core),
            address(bids),
            address(marketplace),
            address(unverified)
        );
    }
}
