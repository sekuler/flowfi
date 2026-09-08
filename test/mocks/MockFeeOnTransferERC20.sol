// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./MockERC20.sol";

// Burns 5% of every transfer — the recipient always receives less than the
// nominal amount. Used to prove reserves track what was actually received,
// not what was nominally sent.
contract MockFeeOnTransferERC20 is MockERC20 {
    uint256 public constant FEE_BPS = 500; // 5%

    constructor(string memory _name, string memory _symbol) MockERC20(_name, _symbol) {}

    function transfer(address to, uint256 amount) external override returns (bool) {
        uint256 fee = (amount * FEE_BPS) / 10000;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += (amount - fee);
        totalSupply -= fee;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        allowance[from][msg.sender] -= amount;
        uint256 fee = (amount * FEE_BPS) / 10000;
        balanceOf[from] -= amount;
        balanceOf[to] += (amount - fee);
        totalSupply -= fee;
        return true;
    }
}
