// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/ArcTokenFactoryV2.sol";
// ArcPool from ArcLaunchPoolFactory.sol, not ArcFactoryV2_v4.sol — its
// addLiquidity has the 5-argument signature (amountADesired, amountBDesired,
// amountAMin, amountBMin, deadline) that ArcTokenFactoryV2.lockLaunchLiquidity()
// actually calls. v4's ArcPool only has the older 3-argument version — using
// it here would test against an interface this contract doesn't really use.
// Named import — only pulls in ArcPool, not this file's own IERC20/
// SafeERC20/IArcTokenFactory interfaces, which would otherwise collide
// with the separately-declared (but same-named) IERC20 already imported
// from ArcTokenFactoryV2.sol above. Both contracts define their own
// minimal IERC20 independently — harmless normally, but a real compile
// error once both files land in the same compilation unit like this one.
import { ArcPool } from "../contracts/ArcLaunchPoolFactory.sol";
import "./mocks/MockERC20.sol";

contract ArcTokenFactoryV2Test is Test {
    ArcTokenFactoryV2 factory;
    MockERC20 usdc;
    ArcPool pool;
    address creator = address(0xC1);
    address buyer = address(0xB2);
    address launchedToken;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC");
        factory = new ArcTokenFactoryV2(address(usdc));

        vm.prank(creator);
        launchedToken = factory.launchToken("Test Token", "TEST", 1_000_000e18);

        pool = new ArcPool(launchedToken, address(usdc));
    }

    // ─── launchToken ─────────────────────────────────────────────────────

    function test_LaunchToken_MintsFullSupplyToCreator() public {
        assertEq(LaunchedToken(launchedToken).balanceOf(creator), 1_000_000e18);
        assertEq(LaunchedToken(launchedToken).totalSupply(), 1_000_000e18);
    }

    function test_LaunchToken_RevertsOnZeroSupply() public {
        vm.expectRevert("Supply must be > 0");
        factory.launchToken("Bad", "BAD", 0);
    }

    function test_LaunchToken_RecordsLaunchedAt() public {
        assertEq(factory.launchedAt(launchedToken), block.timestamp);
    }

    function test_LaunchToken_AppendsToAllTokens() public {
        assertEq(factory.allTokensLength(), 1);
        assertEq(factory.allTokens(0), launchedToken);
    }

    // ─── lockLaunchLiquidity ─────────────────────────────────────────────

    function test_LockLaunchLiquidity_HappyPath() public {
        usdc.mint(creator, 1_000e6);
        vm.startPrank(creator);
        LaunchedToken(launchedToken).approve(address(factory), 1_000_000e18);
        usdc.approve(address(factory), 1_000e6);
        factory.lockLaunchLiquidity(launchedToken, address(pool), 1_000_000e18, 1_000e6, block.timestamp + 1 hours);
        vm.stopPrank();

        assertEq(factory.tokenPool(launchedToken), address(pool));
        assertGt(pool.totalShares(), 0);
        // The factory holds all minted shares EXCEPT the MINIMUM_SHARES
        // (1000 units) that ArcPool permanently burns to address(0) on the
        // very first deposit — a standard anti-first-depositor-
        // manipulation safeguard, not something specific to launches. No
        // removeLiquidity function exists anywhere in this contract, which
        // is what actually makes the factory's own share of it a lock
        // (structural, not a revocable flag).
        assertEq(pool.shares(address(factory)), pool.totalShares() - 1000);
    }

    function test_LockLaunchLiquidity_RevertsIfAlreadyLocked() public {
        usdc.mint(creator, 2_000e6);
        vm.startPrank(creator);
        LaunchedToken(launchedToken).approve(address(factory), type(uint256).max);
        usdc.approve(address(factory), type(uint256).max);
        factory.lockLaunchLiquidity(launchedToken, address(pool), 500_000e18, 500e6, block.timestamp + 1 hours);

        vm.expectRevert("Already locked for this token");
        factory.lockLaunchLiquidity(launchedToken, address(pool), 100_000e18, 100e6, block.timestamp + 1 hours);
        vm.stopPrank();
    }

    function test_LockLaunchLiquidity_RevertsForUnknownToken() public {
        vm.expectRevert("Not a token launched here");
        factory.lockLaunchLiquidity(address(0xDEAD), address(pool), 1, 1, block.timestamp + 1 hours);
    }

    function test_LockLaunchLiquidity_RevertsIfPoolIsWrongPair() public {
        MockERC20 otherToken = new MockERC20("Other", "OTH");
        ArcPool wrongPool = new ArcPool(address(otherToken), address(usdc));

        usdc.mint(creator, 1_000e6);
        vm.startPrank(creator);
        LaunchedToken(launchedToken).approve(address(factory), 1_000_000e18);
        usdc.approve(address(factory), 1_000e6);
        vm.expectRevert("Pool is not for this token/USDC pair");
        factory.lockLaunchLiquidity(launchedToken, address(wrongPool), 1_000_000e18, 1_000e6, block.timestamp + 1 hours);
        vm.stopPrank();
    }

    function test_LockLaunchLiquidity_RevertsIfDeadlinePassed() public {
        vm.warp(1_000); // give ourselves room to move the clock backward relative to the deadline below
        usdc.mint(creator, 1_000e6);
        vm.startPrank(creator);
        LaunchedToken(launchedToken).approve(address(factory), 1_000_000e18);
        usdc.approve(address(factory), 1_000e6);
        vm.expectRevert("Transaction expired");
        factory.lockLaunchLiquidity(launchedToken, address(pool), 1_000_000e18, 1_000e6, block.timestamp - 1);
        vm.stopPrank();
    }

    function test_LockLaunchLiquidity_RevertsIfPoolAlreadyHasLiquidity() public {
        // Someone else seeds the pool first (e.g. through the normal
        // curated-pool flow) — lockLaunchLiquidity is first-deposit-only.
        address other = address(0xAAAA);
        vm.prank(creator);
        LaunchedToken(launchedToken).transfer(other, 100_000e18);
        usdc.mint(other, 100e6);

        vm.startPrank(other);
        LaunchedToken(launchedToken).approve(address(pool), 100_000e18);
        usdc.approve(address(pool), 100e6);
        pool.addLiquidity(100_000e18, 100e6, 0, 0, block.timestamp + 1 hours);
        vm.stopPrank();

        usdc.mint(creator, 1_000e6);
        vm.startPrank(creator);
        LaunchedToken(launchedToken).approve(address(factory), 1_000_000e18);
        usdc.approve(address(factory), 1_000e6);
        vm.expectRevert("Pool already has liquidity, launch-lock path is first-deposit only");
        factory.lockLaunchLiquidity(launchedToken, address(pool), 1_000_000e18, 1_000e6, block.timestamp + 1 hours);
        vm.stopPrank();
    }

    // ─── buyDuringLaunch ────────────────────────────────────────────────

    function _lockDefaultLiquidity() internal {
        usdc.mint(creator, 10_000e6);
        vm.startPrank(creator);
        LaunchedToken(launchedToken).approve(address(factory), 1_000_000e18);
        usdc.approve(address(factory), 10_000e6);
        factory.lockLaunchLiquidity(launchedToken, address(pool), 1_000_000e18, 10_000e6, block.timestamp + 1 hours);
        vm.stopPrank();
    }

    function test_BuyDuringLaunch_RevertsIfNoPoolLocked() public {
        vm.prank(creator);
        address freshToken = factory.launchToken("Fresh", "FRESH", 1_000e18);

        usdc.mint(buyer, 10e6);
        vm.startPrank(buyer);
        usdc.approve(address(factory), 10e6);
        vm.expectRevert("Liquidity not locked yet for this token");
        factory.buyDuringLaunch(freshToken, 10e6, 0, block.timestamp + 1 hours);
        vm.stopPrank();
    }

    function test_BuyDuringLaunch_HappyPathWithinCap() public {
        _lockDefaultLiquidity();
        // Pool is 1,000,000 token : 10,000 USDC. Anti-snipe cap is 2% of
        // supply = 20,000e18 tokens/wallet during the window. 20 USDC in a
        // 10,000 USDC pool is a tiny trade (~0.2% of pool depth) — should
        // land nowhere near the cap even before accounting for slippage.
        usdc.mint(buyer, 20e6);
        vm.startPrank(buyer);
        usdc.approve(address(factory), 20e6);
        uint256 out = factory.buyDuringLaunch(launchedToken, 20e6, 0, block.timestamp + 1 hours);
        vm.stopPrank();

        assertGt(out, 0);
        assertLt(out, 20_000e18); // under the anti-snipe cap
        assertEq(LaunchedToken(launchedToken).balanceOf(buyer), out);
    }

    function test_BuyDuringLaunch_RevertsOverAntiSnipeCap() public {
        _lockDefaultLiquidity();
        // Buying with half the pool's entire USDC side in one shot — even
        // with heavy constant-product slippage working against the buyer,
        // this pulls far more than 2% of the 1,000,000-token supply.
        usdc.mint(buyer, 5_000e6);
        vm.startPrank(buyer);
        usdc.approve(address(factory), 5_000e6);
        vm.expectRevert("Anti-snipe cap exceeded for this wallet");
        factory.buyDuringLaunch(launchedToken, 5_000e6, 0, block.timestamp + 1 hours);
        vm.stopPrank();
    }

    function test_BuyDuringLaunch_CapNoLongerAppliesAfterWindow() public {
        _lockDefaultLiquidity();
        vm.warp(block.timestamp + 21 seconds); // past the 20s anti-snipe window

        usdc.mint(buyer, 5_000e6);
        vm.startPrank(buyer);
        usdc.approve(address(factory), 5_000e6);
        uint256 out = factory.buyDuringLaunch(launchedToken, 5_000e6, 0, block.timestamp + 1 hours);
        vm.stopPrank();

        // Same trade that reverted inside the window above now succeeds —
        // proves the cap is time-scoped, not a blanket limit.
        assertGt(out, 0);
    }

    function test_BuyDuringLaunch_RevertsIfDeadlinePassed() public {
        _lockDefaultLiquidity();
        vm.warp(1_000);
        usdc.mint(buyer, 20e6);
        vm.startPrank(buyer);
        usdc.approve(address(factory), 20e6);
        vm.expectRevert("Transaction expired");
        factory.buyDuringLaunch(launchedToken, 20e6, 0, block.timestamp - 1);
        vm.stopPrank();
    }
}
