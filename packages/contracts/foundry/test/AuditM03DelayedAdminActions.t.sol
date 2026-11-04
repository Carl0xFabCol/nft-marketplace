// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";
import {LaunchPad} from "../src/LaunchPad.sol";

/// @notice M-03: owner-initiated registrations and emergency royalty updates
///         must wait for the public delay before taking effect.
contract AuditM03DelayedAdminActionsTest is TestSetup {
    address internal creator = vm.addr(9);

    function test_M03_routerRegistrationCannotExecuteBeforeDelay() public {
        vm.prank(owner);
        marketplace.registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        (uint16 fee, address receiver, address pendingCreator, uint64 executableAt, bool pending) =
            core.pendingRegistrations(address(nft));
        assertTrue(pending);
        assertEq(fee, ROYALTY_FEE);
        assertEq(receiver, royaltyReceiverAddr);
        assertEq(pendingCreator, owner);
        assertEq(executableAt, uint64(block.timestamp + core.REGISTRATION_DELAY()));

        (, , , , , bool exists) = core.collections(address(nft));
        assertFalse(exists);

        vm.warp(block.timestamp + core.REGISTRATION_DELAY() - 1);
        vm.expectRevert(MarketplaceCore.RegistrationNotReady.selector);
        marketplace.executeRegisterCollection(address(nft));

        vm.warp(block.timestamp + 1);
        marketplace.executeRegisterCollection(address(nft));

        (, , , , , bool registered) = core.collections(address(nft));
        assertTrue(registered);
        (, , , , bool stillPending) = core.pendingRegistrations(address(nft));
        assertFalse(stillPending);
    }

    function test_M03_launchpadRegistrationCannotExecuteBeforeDelay() public {
        vm.prank(owner);
        LaunchPad launchPad = new LaunchPad(address(core));

        vm.prank(owner);
        launchPad.setLaunchFee(0);
        vm.prank(owner);
        marketplace.setAuthorizedLaunchpad(address(launchPad), true);

        vm.prank(creator);
        address collection = launchPad.createCollection(
            "Delayed",
            "DLY",
            uint16(ROYALTY_FEE),
            royaltyReceiverAddr,
            10,
            "ipfs://",
            0,
            0
        );

        assertFalse(core.isRegistered(collection));
        (, , , , bool pending) = core.pendingRegistrations(collection);
        assertTrue(pending);

        vm.expectRevert(MarketplaceCore.RegistrationNotReady.selector);
        marketplace.executeRegisterCollection(collection);

        vm.warp(block.timestamp + core.REGISTRATION_DELAY());
        marketplace.executeRegisterCollection(collection);
        assertTrue(core.isRegistered(collection));
    }

    function test_M03_emergencyRoyaltyUpdateCannotExecuteBeforeDelay() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(owner);
        marketplace.emergencyUpdateCollectionRoyalty(address(nft), newOwner, 1000);

        (address pendingReceiver, uint16 pendingFee, uint64 executableAt, bool pending) =
            core.pendingEmergencyRoyaltyUpdates(address(nft));
        assertTrue(pending);
        assertEq(pendingReceiver, newOwner);
        assertEq(pendingFee, 1000);
        assertEq(executableAt, uint64(block.timestamp + core.REGISTRATION_DELAY()));

        (address receiverBefore, uint16 feeBefore, , , , ) = core.collections(address(nft));
        assertEq(receiverBefore, royaltyReceiverAddr);
        assertEq(feeBefore, uint16(ROYALTY_FEE));

        vm.warp(block.timestamp + core.REGISTRATION_DELAY() - 1);
        vm.prank(owner);
        vm.expectRevert(MarketplaceCore.RoyaltyUpdateNotReady.selector);
        marketplace.executeEmergencyUpdateCollectionRoyalty(address(nft));

        vm.warp(block.timestamp + 1);
        vm.prank(owner);
        marketplace.executeEmergencyUpdateCollectionRoyalty(address(nft));

        (address receiverAfter, uint16 feeAfter, , , , ) = core.collections(address(nft));
        assertEq(receiverAfter, newOwner);
        assertEq(feeAfter, 1000);
        assertTrue(core.royaltyOverridden(address(nft)));
    }

    function test_M03_missingPendingActionsRevert() public {
        vm.expectRevert(MarketplaceCore.NoPendingRegistration.selector);
        marketplace.executeRegisterCollection(address(nft));

        vm.prank(owner);
        vm.expectRevert(MarketplaceCore.NoPendingRoyaltyUpdate.selector);
        marketplace.executeEmergencyUpdateCollectionRoyalty(address(nft));
    }

    function test_M03_emergencyUpdateIsOwnerOnly() public {
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        vm.prank(unauthorized);
        vm.expectRevert();
        marketplace.emergencyUpdateCollectionRoyalty(address(nft), newOwner, 1000);

        vm.prank(owner);
        marketplace.emergencyUpdateCollectionRoyalty(address(nft), newOwner, 1000);

        vm.warp(block.timestamp + core.REGISTRATION_DELAY());

        vm.prank(unauthorized);
        vm.expectRevert();
        marketplace.executeEmergencyUpdateCollectionRoyalty(address(nft));
    }
}
