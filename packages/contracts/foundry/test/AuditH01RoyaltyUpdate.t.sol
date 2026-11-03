// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TestSetup.sol";

/// @notice H-01: a dust listing followed by a price update must not evade
///         royalties. The royalty snapshot is recomputed on price updates.
contract AuditH01RoyaltyUpdateTest is TestSetup {
    function _registerRoyaltyNft(uint16 storedRoyalty) internal {
        nftWithRoyalty.setTokenRoyalty(1, royaltyReceiverAddr, 500);
        _registerCollection(address(nftWithRoyalty), storedRoyalty, royaltyReceiverAddr);
        _mintNFTWithRoyalty(seller, 1);
        _approveOnCore(address(nftWithRoyalty), seller);
    }

    function _initialSnapshotBps() internal view returns (uint16 bps) {
        (, , , , , bps) = core.listings(address(nftWithRoyalty), 1);
    }

    function _updatedSnapshotBps() internal view returns (uint16 bps) {
        (, , , , , bps) = core.listings(address(nftWithRoyalty), 1);
    }

    function test_H01_dustThenUpdateCannotEvadeRoyalty() public {
        _registerRoyaltyNft(uint16(ROYALTY_FEE));

        vm.prank(seller);
        marketplace.createListing(address(nftWithRoyalty), 1, 1 wei, _listingExpiry());

        assertEq(_initialSnapshotBps(), 0, "dust listing floors the snapshot to zero");

        vm.prank(seller);
        marketplace.updateListingPrice(address(nftWithRoyalty), 1, 100 ether);

        uint16 updatedBps = _updatedSnapshotBps();
        assertGe(updatedBps, 1, "snapshot must be recomputed after a price update");
        assertEq(updatedBps, 500, "5% ERC-2981 royalty must be snapshotted as 500 bps");

        uint256 royaltyBefore = core.pendingWithdrawals(royaltyReceiverAddr);

        vm.prank(buyer);
        marketplace.buy{value: 100 ether}(address(nftWithRoyalty), 1);

        uint256 royaltyPaid = core.pendingWithdrawals(royaltyReceiverAddr) - royaltyBefore;
        assertGt(royaltyPaid, 0, "royalty receiver must be paid");
        assertApproxEqAbs(royaltyPaid, 5 ether, 1, "royalty must be ~5% of the sale");
    }

    function test_H01_zeroRoyaltyCollectionStaysZeroAfterUpdate() public {
        _registerCollection(address(nft), 0, address(0));
        _mintNFT(seller, 1);
        _approveOnCore(address(nft), seller);

        vm.prank(seller);
        marketplace.createListing(address(nft), 1, 1 wei, _listingExpiry());

        vm.prank(seller);
        marketplace.updateListingPrice(address(nft), 1, 100 ether);

        (, , , , , uint16 updatedBps) = core.listings(address(nft), 1);
        assertEq(updatedBps, 0, "a genuine zero-royalty collection must stay at zero");
    }
}
