// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "./TestSetup.sol";

/// @notice Handler exercising every Bids entrypoint that touches escrow.
///         Used by the H-01 solvency invariant.
contract BidsHandler is Test {
    TestSetup internal immutable setup;
    Marketplace internal immutable marketplace;
    MarketplaceBids internal immutable bids;
    MockNFT internal immutable nft;

    address[3] internal bidders;

    mapping(uint256 => bool) internal minted;

    constructor(TestSetup _setup) {
        setup = _setup;
        marketplace = _setup.marketplace();
        bids = _setup.bids();
        nft = _setup.nft();
        bidders[0] = _setup.bidder();
        bidders[1] = address(uint160(uint256(keccak256("bidder-1"))));
        bidders[2] = address(uint160(uint256(keccak256("bidder-2"))));
        vm.deal(bidders[1], 1_000 ether);
        vm.deal(bidders[2], 1_000 ether);
    }

    function _bidder(uint256 seed) internal view returns (address) {
        return bidders[seed % 3];
    }

    function _ensureToken(uint256 tokenId, address to) internal {
        if (!minted[tokenId]) {
            nft.mint(to, tokenId);
            minted[tokenId] = true;
        }
        vm.prank(to);
        nft.setApprovalForAll(address(setup.core()), true);
    }

    function placeCollectionBid(uint256 bidderSeed, uint128 price, uint32 quantity) external {
        address b = _bidder(bidderSeed);
        uint128 p = uint128(bound(price, 1, 5 ether));
        uint32 q = uint32(bound(quantity, 1, 3));
        uint256 value = uint256(p) * q;
        vm.deal(b, value);
        vm.prank(b);
        try marketplace.placeCollectionBid{value: value}(address(nft), p, q, 0) {} catch {}
    }

    function placeTokenBid(uint256 bidderSeed, uint256 tokenId, uint128 price) external {
        address b = _bidder(bidderSeed);
        uint128 p = uint128(bound(price, 1, 5 ether));
        vm.deal(b, p);
        vm.prank(b);
        try marketplace.placeTokenBid{value: p}(address(nft), bound(tokenId, 1, 20), p, 0) {} catch {}
    }

    function placeTokenBidBatch(uint256 bidderSeed, uint256 tokenSeed, uint128 priceSeed) external {
        address b = _bidder(bidderSeed);
        uint256[] memory ids = new uint256[](2);
        uint128[] memory prices = new uint128[](2);
        uint64[] memory expiries = new uint64[](2);

        ids[0] = bound(tokenSeed, 1, 20);
        ids[1] = ids[0] == 20 ? 1 : ids[0] + 1;
        prices[0] = uint128(bound(priceSeed, 1, 5 ether));
        prices[1] = uint128(bound(priceSeed / 2, 1, 5 ether));

        uint256 value = uint256(prices[0]) + prices[1];
        vm.deal(b, value);
        vm.prank(b);
        try marketplace.placeTokenBidBatch{value: value}(address(nft), ids, prices, expiries) {} catch {}
    }

    function cancelCollectionBid(uint256 bidderSeed) external {
        address b = _bidder(bidderSeed);
        vm.prank(b);
        try marketplace.cancelCollectionBid(address(nft)) {} catch {}
    }

    function cancelTokenBid(uint256 bidderSeed, uint256 tokenId) external {
        address b = _bidder(bidderSeed);
        vm.prank(b);
        try marketplace.cancelTokenBid(address(nft), bound(tokenId, 1, 20)) {} catch {}
    }

    function acceptCollectionBid(uint256 bidderSeed, uint256 tokenId, uint256 sellerSeed) external {
        address b = _bidder(bidderSeed);
        address seller = _bidder(sellerSeed);
        uint256 id = bound(tokenId, 1, 20);
        _ensureToken(id, seller);

        uint256[] memory ids = new uint256[](1);
        ids[0] = id;

        vm.prank(seller);
        try marketplace.acceptCollectionBid(address(nft), b, ids) {} catch {}
    }

    function acceptTokenBid(uint256 bidderSeed, uint256 tokenId, uint256 sellerSeed) external {
        address b = _bidder(bidderSeed);
        address seller = _bidder(sellerSeed);
        uint256 id = bound(tokenId, 1, 20);
        _ensureToken(id, seller);

        vm.prank(seller);
        try marketplace.acceptTokenBid(address(nft), id, b) {} catch {}
    }

    function withdraw(uint256 accountSeed) external {
        address account = _bidder(accountSeed);
        vm.prank(account);
        try marketplace.withdraw() {} catch {}
    }

    function sweep() external {
        vm.prank(setup.owner());
        try marketplace.sweepExcessETH(payable(setup.owner())) {} catch {}
    }
}

contract BidsSolvencyInvariantTest is TestSetup {
    BidsHandler internal handler;

    function setUp() public override {
        super.setUp();
        _registerCollection(address(nft), uint16(ROYALTY_FEE), royaltyReceiverAddr);

        handler = new BidsHandler(this);
        targetContract(address(handler));
    }

    /// @notice H-01: the Bids contract must always be able to honour every
    ///         pending withdrawal and every live bid escrow.
    function invariant_solvency() public view {
        assertGe(
            address(bids).balance,
            bids.totalPendingWithdrawals() + bids.totalBidEscrow(),
            "bids insolvent"
        );
    }
}
