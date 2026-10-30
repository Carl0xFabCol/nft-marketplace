// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";

interface IVerifyCore {
    function router() external view returns (address);
    function bidsContract() external view returns (address);
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
    function paused() external view returns (bool);
}

interface IVerifyBids {
    function marketplace() external view returns (address);
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
    function paused() external view returns (bool);
}

interface IVerifyRouter {
    function core() external view returns (address);
    function bids() external view returns (address);
}

contract VerifyDeployment is Script {
    function run() external view {
        address coreAddr = vm.envAddress("CORE");
        address bidsAddr = vm.envAddress("BIDS");
        address routerAddr = vm.envAddress("MARKETPLACE");
        bool expectPaused = vm.envOr("EXPECT_PAUSED", false);

        _verify(coreAddr, bidsAddr, routerAddr, expectPaused);
    }

    function run(
        address coreAddr,
        address bidsAddr,
        address routerAddr
    ) external view {
        _verify(coreAddr, bidsAddr, routerAddr, false);
    }

    function run(
        address coreAddr,
        address bidsAddr,
        address routerAddr,
        bool expectPaused
    ) external view {
        _verify(coreAddr, bidsAddr, routerAddr, expectPaused);
    }

    function _verify(
        address coreAddr,
        address bidsAddr,
        address routerAddr,
        bool expectPaused
    ) internal view {
        IVerifyCore core = IVerifyCore(coreAddr);
        IVerifyBids bids = IVerifyBids(bidsAddr);
        IVerifyRouter router = IVerifyRouter(routerAddr);

        require(core.router() == routerAddr, "R-5: core.router mismatch");
        require(core.bidsContract() == bidsAddr, "R-5: core.bidsContract mismatch");
        require(bids.marketplace() == routerAddr, "R-5: bids.marketplace mismatch");
        require(core.owner() == routerAddr, "R-5: core.owner mismatch");
        require(bids.owner() == routerAddr, "R-5: bids.owner mismatch");
        require(router.core() == coreAddr, "R-5: router.core mismatch");
        require(router.bids() == bidsAddr, "R-5: router.bids mismatch");
        require(core.pendingOwner() == address(0), "R-5: core pending owner not cleared");
        require(bids.pendingOwner() == address(0), "R-5: bids pending owner not cleared");

        if (expectPaused) {
            require(core.paused() && bids.paused(), "R-5: components not paused");
        } else {
            require(!core.paused(), "R-5: core is paused");
            require(!bids.paused(), "R-5: bids is paused");
        }
    }
}
