// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title FlowFiMultiSend
/// @notice Sends an ERC-20 token from the caller to many recipients in one transaction.
/// @dev Design for minimal trust:
///      - Tokens move directly from msg.sender to each recipient; this contract never holds funds.
///      - It can only move the caller's own tokens (transferFrom(msg.sender, ...)).
///      - No owner, no admin, no upgrades, no fees, no payable functions.
contract FlowFiMultiSend {
    using SafeERC20 for IERC20;

    /// @notice Maximum recipients per call, to keep transactions within gas limits.
    uint256 public constant MAX_RECIPIENTS = 200;

    error EmptyBatch();
    error LengthMismatch();
    error TooManyRecipients();
    error ZeroAddress();
    error ZeroAmount();

    event MultiSent(address indexed sender, address indexed token, uint256 recipients, uint256 total);

    /// @notice Send `amounts[i]` of `token` from the caller to `recipients[i]`.
    /// @dev The caller must first approve this contract for at least the total amount.
    function multiSend(IERC20 token, address[] calldata recipients, uint256[] calldata amounts) external {
        uint256 n = recipients.length;
        if (n == 0) revert EmptyBatch();
        if (n != amounts.length) revert LengthMismatch();
        if (n > MAX_RECIPIENTS) revert TooManyRecipients();

        uint256 total = 0;
        for (uint256 i = 0; i < n; ++i) {
            address to = recipients[i];
            uint256 amount = amounts[i];
            if (to == address(0)) revert ZeroAddress();
            if (amount == 0) revert ZeroAmount();
            total += amount;
            token.safeTransferFrom(msg.sender, to, amount);
        }

        emit MultiSent(msg.sender, address(token), n, total);
    }
}
