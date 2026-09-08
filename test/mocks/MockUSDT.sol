// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// Mimics real mainnet USDT: transfer/transferFrom return NOTHING (not even
// `bool`). Calling this through a strict `returns (bool)` IERC20 interface
// reverts while ABI-decoding the empty return data — this is exactly the
// compatibility problem SafeERC20 exists to solve.
contract MockUSDT {
    string public name = "Tether (mock, non-standard)";
    string public symbol = "USDT";
    uint8 public decimals = 6;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    // No return value at all — this is the whole point of this mock.
    function transfer(address to, uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }

    function transferFrom(address from, address to, uint256 amount) external {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}
