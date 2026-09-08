// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/ArcEscrow.sol";
import "./mocks/MockERC20.sol";

contract ArcEscrowTest is Test {
    ArcEscrow escrow;
    MockERC20 usdc;

    address client = address(0xC1);
    address freelancer = address(0xF1);

    uint256 constant AMOUNT = 1000e6;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC");
        escrow = new ArcEscrow(address(usdc));

        usdc.mint(client, AMOUNT);
        vm.prank(client);
        usdc.approve(address(escrow), AMOUNT);
    }

    function _createFundedEscrow() internal returns (uint256 id) {
        vm.prank(client);
        id = escrow.createEscrow(freelancer, AMOUNT, "Build a website");
    }

    // ─── The actual bug: refund after Submitted ───────────────────────────

    function test_RefundBlockedAfterSubmission() public {
        uint256 id = _createFundedEscrow();

        vm.prank(freelancer);
        escrow.submitWork(id);

        // This is exactly the exploit the fix closes: a client could
        // previously submit-then-refund themselves, taking funds back after
        // the freelancer already delivered the work.
        vm.prank(client);
        vm.expectRevert("Cannot refund after work is submitted");
        escrow.refund(id);
    }

    function test_RefundWorksBeforeSubmission() public {
        uint256 id = _createFundedEscrow();

        uint256 balBefore = usdc.balanceOf(client);
        vm.prank(client);
        escrow.refund(id);

        assertEq(usdc.balanceOf(client), balBefore + AMOUNT, "client should get funds back");
        (, , , , ArcEscrow.Status status, , ) = escrow.getEscrow(id);
        assertEq(uint256(status), uint256(ArcEscrow.Status.Refunded));
    }

    function test_FreelancerCanStillClaimAfterTimeoutIfClientGhosts() public {
        uint256 id = _createFundedEscrow();

        vm.prank(freelancer);
        escrow.submitWork(id);

        // Client does nothing. Fast-forward past the 7-day window.
        vm.warp(block.timestamp + 7 days + 1);

        uint256 balBefore = usdc.balanceOf(freelancer);
        vm.prank(freelancer);
        escrow.claimAfterTimeout(id);

        assertEq(usdc.balanceOf(freelancer), balBefore + AMOUNT);
    }

    function test_ClaimAfterTimeoutRevertsBeforeDeadline() public {
        uint256 id = _createFundedEscrow();
        vm.prank(freelancer);
        escrow.submitWork(id);

        vm.prank(freelancer);
        vm.expectRevert("Timeout not reached yet");
        escrow.claimAfterTimeout(id);
    }

    // ─── Happy path ────────────────────────────────────────────────────────

    function test_FullHappyPath_ClientReleases() public {
        uint256 id = _createFundedEscrow();

        vm.prank(freelancer);
        escrow.submitWork(id);

        uint256 balBefore = usdc.balanceOf(freelancer);
        vm.prank(client);
        escrow.releaseFunds(id);

        assertEq(usdc.balanceOf(freelancer), balBefore + AMOUNT);
        (, , , , ArcEscrow.Status status, , ) = escrow.getEscrow(id);
        assertEq(uint256(status), uint256(ArcEscrow.Status.Completed));
    }

    // ─── Access control ────────────────────────────────────────────────────

    function test_OnlyClientCanRefund() public {
        uint256 id = _createFundedEscrow();
        vm.prank(freelancer);
        vm.expectRevert("Only client can refund");
        escrow.refund(id);
    }

    function test_OnlyFreelancerCanSubmit() public {
        uint256 id = _createFundedEscrow();
        vm.prank(client);
        vm.expectRevert("Only freelancer can submit");
        escrow.submitWork(id);
    }

    function test_OnlyClientCanRelease() public {
        uint256 id = _createFundedEscrow();
        vm.prank(freelancer);
        escrow.submitWork(id);
        vm.prank(freelancer);
        vm.expectRevert("Only client can release");
        escrow.releaseFunds(id);
    }

    function test_CannotEscrowToSelf() public {
        vm.prank(client);
        vm.expectRevert("Cannot escrow to yourself");
        escrow.createEscrow(client, AMOUNT, "Nope");
    }

    // ─── pause() scope ──────────────────────────────────────────────────────

    function test_PauseOnlyBlocksNewEscrows() public {
        uint256 id = _createFundedEscrow();

        escrow.pause(); // default owner is address(this) — the test contract

        // Existing escrow keeps working while paused.
        vm.prank(freelancer);
        escrow.submitWork(id);
        vm.prank(client);
        escrow.releaseFunds(id);

        // But a brand new one is blocked.
        vm.prank(client);
        vm.expectRevert("New escrows are paused");
        escrow.createEscrow(freelancer, AMOUNT, "Blocked");
    }
}
