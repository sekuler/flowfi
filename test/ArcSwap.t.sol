// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/ArcSwap.sol";
import "./mocks/MockERC20.sol";

contract ArcSwapTest is Test {
    ArcSwap swapContract;
    MockERC20 usdc;
    MockERC20 eurc;
    MockERC20 randomToken; // NOT usdc/eurc — used to prove withdrawLiquidity rejects it

    address user = address(0xA1);
    uint256 constant INITIAL_RATE = 866930; // ~0.87 EURC per USDC, 1e6 scale

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC");
        eurc = new MockERC20("Euro Coin", "EURC");
        randomToken = new MockERC20("Random", "RND");

        swapContract = new ArcSwap(address(usdc), address(eurc), INITIAL_RATE);

        // Seed the pool with liquidity (test contract is the owner by default).
        usdc.mint(address(this), 10_000e6);
        eurc.mint(address(this), 10_000e6);
        usdc.approve(address(swapContract), 10_000e6);
        eurc.approve(address(swapContract), 10_000e6);
        swapContract.addLiquidity(10_000e6, 10_000e6);

        usdc.mint(user, 1_000e6);
        vm.prank(user);
        usdc.approve(address(swapContract), type(uint256).max);
    }

    // ─── withdrawLiquidity token restriction (the actual bug) ─────────────

    function test_WithdrawLiquidity_RejectsArbitraryToken() public {
        randomToken.mint(address(swapContract), 500e18);

        vm.expectRevert("Can only withdraw USDC or EURC");
        swapContract.withdrawLiquidity(address(randomToken), 500e18);
    }

    function test_WithdrawLiquidity_AllowsUsdc() public {
        uint256 balBefore = usdc.balanceOf(address(this));
        swapContract.withdrawLiquidity(address(usdc), 1_000e6);
        assertEq(usdc.balanceOf(address(this)), balBefore + 1_000e6);
    }

    function test_WithdrawLiquidity_AllowsEurc() public {
        uint256 balBefore = eurc.balanceOf(address(this));
        swapContract.withdrawLiquidity(address(eurc), 1_000e6);
        assertEq(eurc.balanceOf(address(this)), balBefore + 1_000e6);
    }

    function test_WithdrawLiquidity_OnlyOwner() public {
        vm.prank(user);
        vm.expectRevert("Not owner");
        swapContract.withdrawLiquidity(address(usdc), 1);
    }

    // ─── setRate 10% cap (the other actual bug) ────────────────────────────

    function test_SetRate_RejectsMoreThan10PercentIncrease() public {
        uint256 tooHigh = INITIAL_RATE + (INITIAL_RATE * 11 / 100); // +11%
        vm.expectRevert("Rate change exceeds 10% limit per call");
        swapContract.setRate(tooHigh);
    }

    function test_SetRate_RejectsMoreThan10PercentDecrease() public {
        uint256 tooLow = INITIAL_RATE - (INITIAL_RATE * 11 / 100); // -11%
        vm.expectRevert("Rate change exceeds 10% limit per call");
        swapContract.setRate(tooLow);
    }

    function test_SetRate_Allows10PercentIncrease() public {
        uint256 newRate = INITIAL_RATE + (INITIAL_RATE * 10 / 100);
        swapContract.setRate(newRate);
        assertEq(swapContract.usdcToEurcRate(), newRate);
    }

    function test_SetRate_CanReachFarValueViaMultipleCalls() public {
        // Proves the owner can still get anywhere over time — the cap is
        // per-call, not a permanent ceiling.
        uint256 rate = INITIAL_RATE;
        for (uint256 i = 0; i < 5; i++) {
            rate = rate + (rate * 10 / 100);
            swapContract.setRate(rate);
        }
        assertEq(swapContract.usdcToEurcRate(), rate);
        assertGt(rate, INITIAL_RATE * 15 / 10); // moved well past +50% cumulatively
    }

    function test_SetRate_RejectsZero() public {
        vm.expectRevert("Invalid rate");
        swapContract.setRate(0);
    }

    function test_SetRate_OnlyOwner() public {
        vm.prank(user);
        vm.expectRevert("Not owner");
        swapContract.setRate(INITIAL_RATE + 1);
    }

    // ─── Happy path + existing protections still work ──────────────────────

    function test_SwapUsdcToEurc_HappyPath() public {
        uint256 amountIn = 100e6;
        uint256 expectedOut = (amountIn * INITIAL_RATE) / 1e6;

        vm.prank(user);
        swapContract.swapUsdcToEurc(amountIn, expectedOut);

        assertEq(eurc.balanceOf(user), expectedOut);
    }

    function test_SwapRevertsWhenPaused() public {
        swapContract.pause();
        vm.prank(user);
        vm.expectRevert("Swaps are paused");
        swapContract.swapUsdcToEurc(100e6, 0);
    }

    function test_SwapRevertsOnSlippage() public {
        uint256 amountIn = 100e6;
        uint256 actualOut = (amountIn * INITIAL_RATE) / 1e6;
        vm.prank(user);
        vm.expectRevert("Slippage too high");
        swapContract.swapUsdcToEurc(amountIn, actualOut + 1); // demand more than possible
    }

    function test_TwoStepOwnershipTransfer() public {
        address newOwner = address(0xB2);
        swapContract.transferOwnership(newOwner);
        assertEq(swapContract.owner(), address(this)); // unchanged until accepted

        vm.prank(newOwner);
        swapContract.acceptOwnership();
        assertEq(swapContract.owner(), newOwner);
    }
}
