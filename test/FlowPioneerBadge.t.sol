// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/FlowPioneerBadge.sol";

contract FlowPioneerBadgeTest is Test {
    FlowPioneerBadge badge;
    uint256 signerKey = 0xA11CE;
    address signerAddr;
    address alice = address(0xA1);
    address bob = address(0xB0B);

    function setUp() public {
        signerAddr = vm.addr(signerKey);
        badge = new FlowPioneerBadge(signerAddr, "https://flowfi.finance/badge/flow-pioneer.json");
    }

    function _sig(uint256 key, address to) internal view returns (bytes memory) {
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", badge.mintDigest(to)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, ethHash);
        return abi.encodePacked(r, s, v);
    }

    function test_mintWithValidSignature() public {
        bytes memory sig = _sig(signerKey, alice);
        vm.prank(alice);
        uint256 id = badge.mint(sig);
        assertEq(id, 1);
        assertEq(badge.ownerOf(1), alice);
        assertEq(badge.balanceOf(alice), 1);
        assertEq(badge.badgeOf(alice), 1);
        assertEq(badge.totalSupply(), 1);
        assertTrue(badge.locked(1));
        assertEq(badge.tokenURI(1), "https://flowfi.finance/badge/flow-pioneer.json");
    }

    function test_onlyOnePerWallet() public {
        bytes memory sig = _sig(signerKey, alice);
        vm.prank(alice);
        badge.mint(sig);
        vm.prank(alice);
        vm.expectRevert(FlowPioneerBadge.AlreadyMinted.selector);
        badge.mint(sig);
    }

    function test_signatureIsBoundToWallet() public {
        bytes memory aliceSig = _sig(signerKey, alice);
        vm.prank(bob);
        vm.expectRevert(FlowPioneerBadge.BadSignature.selector);
        badge.mint(aliceSig);
    }

    function test_wrongSignerRejected() public {
        bytes memory sig = _sig(0xBAD, alice);
        vm.prank(alice);
        vm.expectRevert(FlowPioneerBadge.BadSignature.selector);
        badge.mint(sig);
    }

    function test_garbageSignatureRejected() public {
        vm.prank(alice);
        vm.expectRevert(FlowPioneerBadge.BadSignature.selector);
        badge.mint(hex"1234");
    }

    function test_signatureBoundToContract() public {
        FlowPioneerBadge other = new FlowPioneerBadge(signerAddr, "");
        bytes memory sigForOther;
        {
            bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", other.mintDigest(alice)));
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, ethHash);
            sigForOther = abi.encodePacked(r, s, v);
        }
        vm.prank(alice);
        vm.expectRevert(FlowPioneerBadge.BadSignature.selector);
        badge.mint(sigForOther);
    }

    function test_soulbound() public {
        bytes memory sig = _sig(signerKey, alice);
        vm.prank(alice);
        badge.mint(sig);
        vm.startPrank(alice);
        vm.expectRevert(FlowPioneerBadge.Soulbound.selector);
        badge.transferFrom(alice, bob, 1);
        vm.expectRevert(FlowPioneerBadge.Soulbound.selector);
        badge.safeTransferFrom(alice, bob, 1);
        vm.expectRevert(FlowPioneerBadge.Soulbound.selector);
        badge.approve(bob, 1);
        vm.expectRevert(FlowPioneerBadge.Soulbound.selector);
        badge.setApprovalForAll(bob, true);
        vm.stopPrank();
        assertEq(badge.ownerOf(1), alice);
    }

    function test_pause() public {
        badge.setPaused(true);
        bytes memory sig = _sig(signerKey, alice);
        vm.prank(alice);
        vm.expectRevert(FlowPioneerBadge.MintPaused.selector);
        badge.mint(sig);
        badge.setPaused(false);
        vm.prank(alice);
        badge.mint(sig);
    }

    function test_onlyOwnerAdmin() public {
        vm.startPrank(alice);
        vm.expectRevert(FlowPioneerBadge.NotOwner.selector);
        badge.setSigner(alice);
        vm.expectRevert(FlowPioneerBadge.NotOwner.selector);
        badge.setPaused(true);
        vm.expectRevert(FlowPioneerBadge.NotOwner.selector);
        badge.setTokenURI("x");
        vm.expectRevert(FlowPioneerBadge.NotOwner.selector);
        badge.transferOwnership(alice);
        vm.stopPrank();
    }

    function test_signerRotation() public {
        uint256 newKey = 0xB0B0;
        badge.setSigner(vm.addr(newKey));
        bytes memory oldSig = _sig(signerKey, alice);
        vm.prank(alice);
        vm.expectRevert(FlowPioneerBadge.BadSignature.selector);
        badge.mint(oldSig);
        bytes memory newSig = _sig(newKey, alice);
        vm.prank(alice);
        badge.mint(newSig);
    }

    function test_twoStepOwnership() public {
        badge.transferOwnership(bob);
        assertEq(badge.owner(), address(this));
        vm.prank(alice);
        vm.expectRevert(FlowPioneerBadge.NotOwner.selector);
        badge.acceptOwnership();
        vm.prank(bob);
        badge.acceptOwnership();
        assertEq(badge.owner(), bob);
    }

    function test_nonexistentToken() public {
        vm.expectRevert(FlowPioneerBadge.NonexistentToken.selector);
        badge.ownerOf(5);
        vm.expectRevert(FlowPioneerBadge.NonexistentToken.selector);
        badge.tokenURI(5);
    }

    function test_interfaces() public view {
        assertTrue(badge.supportsInterface(0x80ac58cd));
        assertTrue(badge.supportsInterface(0x5b5e139f));
        assertTrue(badge.supportsInterface(0xb45a3c0e));
        assertFalse(badge.supportsInterface(0xffffffff));
    }

    function test_sequentialIds() public {
        bytes memory aliceSig = _sig(signerKey, alice);
        bytes memory bobSig = _sig(signerKey, bob);
        vm.prank(alice);
        badge.mint(aliceSig);
        vm.prank(bob);
        uint256 id = badge.mint(bobSig);
        assertEq(id, 2);
        assertEq(badge.totalSupply(), 2);
    }
}
