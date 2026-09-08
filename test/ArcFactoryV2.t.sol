// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/ArcFactoryV2_v4.sol";
import "./mocks/MockERC20.sol";
import "./mocks/MockFeeOnTransferERC20.sol";
import "./mocks/MockUSDT.sol";

contract ArcFactoryV2Test is Test {
    ArcFactoryV2 factory;
    MockERC20 tokenA;
    MockERC20 tokenB;

    address lp1 = address(0xA1);
    address lp2 = address(0xA2);
    address trader = address(0xA3);

    function setUp() public {
        factory = new ArcFactoryV2();
        tokenA = new MockERC20("Token A", "TKA");
        tokenB = new MockERC20("Token B", "TKB");
    }

    function _dl() internal view returns (uint256) {
        return block.timestamp + 1200;
    }

    // ─── Fee-on-transfer: the actual bug ───────────────────────────────────

    function test_FeeOnTransfer_ReservesMatchActualBalance() public {
        MockFeeOnTransferERC20 fotToken = new MockFeeOnTransferERC20("Fee Token", "FOT");
        address pool = factory.createPool(address(fotToken), address(tokenB));
        ArcPool p = ArcPool(pool);

        fotToken.mint(lp1, 1000e18);
        tokenB.mint(lp1, 1000e18);
        vm.startPrank(lp1);
        fotToken.approve(pool, 1000e18);
        tokenB.approve(pool, 1000e18);
        // Requests 1000 FOT in, but the token burns 5% — pool actually
        // receives 950. Old code would have credited reserveA as if the
        // full 1000 arrived; that's exactly the bug this proves is fixed.
        p.addLiquidity(1000e18, 1000e18, _dl());
        vm.stopPrank();

        (uint256 reserveA, uint256 reserveB) = p.getReserves();
        uint256 actualBalanceA = fotToken.balanceOf(pool);

        assertEq(reserveA, actualBalanceA, "reserveA must equal real balance, not nominal amount");
        assertEq(reserveA, 950e18, "should reflect the 5% fee actually taken");
        assertEq(reserveB, 1000e18, "tokenB has no fee, so full amount lands");
    }

    function test_FeeOnTransfer_SwapUsesActualReceivedAmount() public {
        MockFeeOnTransferERC20 fotToken = new MockFeeOnTransferERC20("Fee Token", "FOT");
        address pool = factory.createPool(address(fotToken), address(tokenB));
        ArcPool p = ArcPool(pool);

        // Seed pool with plain (non-fee) initial liquidity so reserves start clean.
        fotToken.mint(lp1, 10_000e18);
        tokenB.mint(lp1, 10_000e18);
        vm.startPrank(lp1);
        fotToken.approve(pool, 10_000e18);
        tokenB.approve(pool, 10_000e18);
        p.addLiquidity(10_000e18, 10_000e18, _dl());
        vm.stopPrank();

        (uint256 reserveABefore, ) = p.getReserves();

        fotToken.mint(trader, 100e18);
        vm.startPrank(trader);
        fotToken.approve(pool, 100e18);
        // aToB = true means tokenIn is fotToken. Nominal amountIn=100, but
        // only 95 actually arrives after the 5% burn.
        p.swap(true, 100e18, 0, _dl());
        vm.stopPrank();

        (uint256 reserveAAfter, ) = p.getReserves();
        assertEq(reserveAAfter - reserveABefore, 95e18, "reserve should grow by the ACTUAL amount received, not nominal 100");
    }

    // ─── sync() ─────────────────────────────────────────────────────────────

    function test_Sync_PullsReservesDownToRealBalance() public {
        address pool = factory.createPool(address(tokenA), address(tokenB));
        ArcPool p = ArcPool(pool);

        tokenA.mint(lp1, 1000e18);
        tokenB.mint(lp1, 1000e18);
        vm.startPrank(lp1);
        tokenA.approve(pool, 1000e18);
        tokenB.approve(pool, 1000e18);
        p.addLiquidity(1000e18, 1000e18, _dl());
        vm.stopPrank();

        // Simulate a rebase-style balance drop: the pool's real tokenA
        // balance shrinks with NO transfer at all (impossible for a normal
        // ERC20 to cause via this test's mock, so we forge it directly by
        // having the pool "lose" tokens — the cleanest way to simulate this
        // is minting negative isn't possible, so instead we prank the pool
        // to send some away, mimicking any external balance-reducing event).
        vm.prank(pool);
        tokenA.transfer(address(0xdead), 100e18);

        (uint256 reserveABefore, ) = p.getReserves();
        assertEq(reserveABefore, 1000e18, "reserve still shows the old, now-stale amount");

        p.sync();

        (uint256 reserveAAfter, ) = p.getReserves();
        assertEq(reserveAAfter, 900e18, "sync() should pull the reserve down to the real balance");
    }

    function test_Sync_NeverRaisesReserves() public {
        address pool = factory.createPool(address(tokenA), address(tokenB));
        ArcPool p = ArcPool(pool);

        tokenA.mint(lp1, 1000e18);
        tokenB.mint(lp1, 1000e18);
        vm.startPrank(lp1);
        tokenA.approve(pool, 1000e18);
        tokenB.approve(pool, 1000e18);
        p.addLiquidity(1000e18, 1000e18, _dl());
        vm.stopPrank();

        // Someone donates tokens directly to the pool (bypassing addLiquidity).
        tokenA.mint(pool, 500e18);

        p.sync();

        (uint256 reserveA, ) = p.getReserves();
        // Must stay at 1000, NOT jump to 1500 — otherwise a donation could
        // be used to manipulate share pricing.
        assertEq(reserveA, 1000e18, "sync() must never raise reserves above what was already recorded");
    }

    function test_Sync_CallableByAnyone() public {
        address pool = factory.createPool(address(tokenA), address(tokenB));
        ArcPool p = ArcPool(pool);
        // Doesn't revert when called by a random, unrelated address.
        vm.prank(address(0xdeadbeef));
        p.sync();
    }

    // ─── SafeERC20 / USDT compatibility ─────────────────────────────────────

    function test_USDT_AddLiquidityWorksDespiteNoBoolReturn() public {
        MockUSDT usdt = new MockUSDT();
        address pool = factory.createPool(address(usdt), address(tokenB));
        ArcPool p = ArcPool(pool);

        usdt.mint(lp1, 1000e6);
        tokenB.mint(lp1, 1000e18);
        vm.startPrank(lp1);
        usdt.approve(pool, 1000e6);
        tokenB.approve(pool, 1000e18);
        // A plain IERC20-interface call would revert here trying to decode
        // USDT's empty return data. This must succeed.
        p.addLiquidity(1000e6, 1000e18, _dl());
        vm.stopPrank();

        (uint256 reserveA, ) = p.getReserves();
        assertEq(reserveA, 1000e6);
    }

    function test_USDT_SwapAndRemoveLiquidityAlsoWork() public {
        MockUSDT usdt = new MockUSDT();
        address pool = factory.createPool(address(usdt), address(tokenB));
        ArcPool p = ArcPool(pool);

        usdt.mint(lp1, 10_000e6);
        tokenB.mint(lp1, 10_000e18);
        vm.startPrank(lp1);
        usdt.approve(pool, 10_000e6);
        tokenB.approve(pool, 10_000e18);
        p.addLiquidity(10_000e6, 10_000e18, _dl());

        uint256 shareBal = p.shares(lp1);
        p.removeLiquidity(shareBal / 2, _dl());
        vm.stopPrank();

        usdt.mint(trader, 100e6);
        vm.startPrank(trader);
        usdt.approve(pool, 100e6);
        p.swap(true, 100e6, 0, _dl());
        vm.stopPrank();

        assertGt(tokenB.balanceOf(trader), 0, "trader should have received tokenB from the swap");
    }

    // ─── deadline ───────────────────────────────────────────────────────────

    function test_Swap_RevertsIfDeadlinePassed() public {
        address pool = factory.createPool(address(tokenA), address(tokenB));
        ArcPool p = ArcPool(pool);

        tokenA.mint(lp1, 1000e18);
        tokenB.mint(lp1, 1000e18);
        vm.startPrank(lp1);
        tokenA.approve(pool, 1000e18);
        tokenB.approve(pool, 1000e18);
        p.addLiquidity(1000e18, 1000e18, _dl());
        vm.stopPrank();

        tokenA.mint(trader, 10e18);
        vm.startPrank(trader);
        tokenA.approve(pool, 10e18);
        vm.expectRevert("Transaction expired");
        p.swap(true, 10e18, 0, block.timestamp - 1); // deadline already passed
        vm.stopPrank();
    }

    function test_AddLiquidity_RevertsIfDeadlinePassed() public {
        address pool = factory.createPool(address(tokenA), address(tokenB));
        ArcPool p = ArcPool(pool);

        tokenA.mint(lp1, 1000e18);
        tokenB.mint(lp1, 1000e18);
        vm.startPrank(lp1);
        tokenA.approve(pool, 1000e18);
        tokenB.approve(pool, 1000e18);
        vm.expectRevert("Transaction expired");
        p.addLiquidity(1000e18, 1000e18, block.timestamp - 1);
        vm.stopPrank();
    }

    // ─── Still-standing protections (regression coverage) ──────────────────

    function test_MinimumSharesLockedOnFirstDeposit() public {
        address pool = factory.createPool(address(tokenA), address(tokenB));
        ArcPool p = ArcPool(pool);

        tokenA.mint(lp1, 1000e18);
        tokenB.mint(lp1, 1000e18);
        vm.startPrank(lp1);
        tokenA.approve(pool, 1000e18);
        tokenB.approve(pool, 1000e18);
        p.addLiquidity(1000e18, 1000e18, _dl());
        vm.stopPrank();

        assertEq(p.shares(address(0)), 1000, "MINIMUM_SHARES should be locked to the zero address");
    }

    function test_CannotCreateDuplicatePool() public {
        factory.createPool(address(tokenA), address(tokenB));
        vm.expectRevert("Pool already exists");
        factory.createPool(address(tokenA), address(tokenB));
    }

    // ─── onlyOwner on createPool (the v4 fix) ──────────────────────────────

    function test_CreatePool_RejectsNonOwner() public {
        vm.prank(trader); // trader is not the owner (test contract is)
        vm.expectRevert("Not owner");
        factory.createPool(address(tokenA), address(tokenB));
    }

    function test_CreatePool_OwnerStillWorks() public {
        // test contract deployed the factory, so it's the owner by default
        address pool = factory.createPool(address(tokenA), address(tokenB));
        assertTrue(pool != address(0));
    }

    function test_TwoStepOwnershipTransfer() public {
        address newOwner = address(0xB2);
        factory.transferOwnership(newOwner);
        assertEq(factory.owner(), address(this)); // unchanged until accepted

        vm.prank(newOwner);
        factory.acceptOwnership();
        assertEq(factory.owner(), newOwner);

        // Old owner can no longer create pools.
        vm.expectRevert("Not owner");
        factory.createPool(address(tokenA), address(tokenB));

        // New owner can.
        vm.prank(newOwner);
        address pool = factory.createPool(address(tokenA), address(tokenB));
        assertTrue(pool != address(0));
    }

    function test_OnlyOwnerCanTransferOwnership() public {
        vm.prank(trader);
        vm.expectRevert("Not owner");
        factory.transferOwnership(trader);
    }

    function test_OnlyPendingOwnerCanAccept() public {
        factory.transferOwnership(address(0xB2));
        vm.prank(trader); // not the pending owner
        vm.expectRevert("Not pending owner");
        factory.acceptOwnership();
    }

    function test_HappyPath_AddSwapRemove() public {
        address pool = factory.createPool(address(tokenA), address(tokenB));
        ArcPool p = ArcPool(pool);

        tokenA.mint(lp1, 10_000e18);
        tokenB.mint(lp1, 10_000e18);
        vm.startPrank(lp1);
        tokenA.approve(pool, 10_000e18);
        tokenB.approve(pool, 10_000e18);
        p.addLiquidity(10_000e18, 10_000e18, _dl());
        vm.stopPrank();

        tokenA.mint(trader, 100e18);
        vm.startPrank(trader);
        tokenA.approve(pool, 100e18);
        uint256 out = p.swap(true, 100e18, 0, _dl());
        assertGt(out, 0);
        vm.stopPrank();

        vm.startPrank(lp1);
        uint256 shareBal = p.shares(lp1);
        (uint256 outA, uint256 outB) = p.removeLiquidity(shareBal, _dl());
        vm.stopPrank();
        assertGt(outA, 0);
        assertGt(outB, 0);
    }
}
