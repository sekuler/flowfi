// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

// v2 changes from the original ArcSwap (audit findings addressed):
// 1. swapUsdcToEurc/swapEurcToUsdc now take a minAmountOut parameter — a
//    caller can no longer be silently rate-changed against between quoting
//    and execution.
// 2. Added pause()/unpause() — an emergency stop for swaps if a bug or
//    exploit is discovered, without needing to drain liquidity as the only
//    "emergency" tool.
// 3. withdrawLiquidity now emits a LiquidityWithdrawn event — on-chain
//    withdrawals by the owner are now publicly observable.
// 4. Added transferOwnership() with a two-step accept flow, so a lost/
//    compromised owner key isn't a permanent dead end and a typo'd address
//    can't accidentally become the new owner.
// 5. Added a nonReentrant guard on the swap functions as defense-in-depth.
//
// v5 changes from v2 (security review, second pass):
// 6. withdrawLiquidity now only accepts USDC or EURC — previously any
//    token address, so the owner could withdraw anything this contract
//    happened to hold.
// 7. setRate can now only move the rate by 10% per call — previously any
//    value > 0 was accepted in one shot, so a fat-finger or malicious
//    call could set an absurd rate before anyone noticed.
//
// Still true of this design (unchanged, documented for transparency): the
// exchange rate is owner-set, not oracle-derived. This is a fixed-rate demo
// pool, not a price-discovery AMM — pair this contract with real oracle
// pricing before any mainnet or real-funds use.
contract ArcSwap {
    address public owner;
    address public pendingOwner;
    IERC20 public immutable usdc;
    IERC20 public immutable eurc;

    uint256 public usdcToEurcRate;
    bool public paused;

    uint256 private locked; // reentrancy guard: 0 = unlocked, 1 = locked

    event Swapped(address indexed user, bool usdcToEurc, uint256 amountIn, uint256 amountOut);
    event RateUpdated(uint256 oldRate, uint256 newRate);
    event LiquidityAdded(address indexed provider, uint256 usdcAmount, uint256 eurcAmount);
    event LiquidityWithdrawn(address indexed owner, address indexed token, uint256 amount);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event OwnershipTransferStarted(address indexed currentOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Swaps are paused");
        _;
    }

    modifier nonReentrant() {
        require(locked == 0, "Reentrancy blocked");
        locked = 1;
        _;
        locked = 0;
    }

    constructor(address _usdc, address _eurc, uint256 _initialRate) {
        owner = msg.sender;
        usdc = IERC20(_usdc);
        eurc = IERC20(_eurc);
        usdcToEurcRate = _initialRate;
    }

    // v5 fix (security review): setRate previously accepted any value > 0 —
    // a single call (fat-finger or malicious) could set an absurd rate and
    // let anyone drain the pool at that price before it's noticed. A single
    // update can now move the rate by at most 10% — enough for the owner to
    // track real EUR/USD movement over time, not enough for one call to do
    // real damage. To move further, call setRate() again after the first
    // update lands.
    uint256 constant MAX_RATE_CHANGE_BPS = 1000; // 10%, in basis points (10000 = 100%)

    function setRate(uint256 newRate) external onlyOwner {
        require(newRate > 0, "Invalid rate");
        uint256 current = usdcToEurcRate;
        if (current > 0) {
            uint256 maxDelta = (current * MAX_RATE_CHANGE_BPS) / 10000;
            require(
                newRate >= current - maxDelta && newRate <= current + maxDelta,
                "Rate change exceeds 10% limit per call"
            );
        }
        emit RateUpdated(current, newRate);
        usdcToEurcRate = newRate;
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    // Two-step ownership transfer: current owner nominates a successor, and
    // that successor must actively accept before control moves. This
    // prevents a single mistyped address from permanently locking the
    // contract out of anyone's control.
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Not pending owner");
        address previousOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previousOwner, owner);
    }

    function addLiquidity(uint256 usdcAmount, uint256 eurcAmount) external onlyOwner {
        if (usdcAmount > 0) {
            require(usdc.transferFrom(msg.sender, address(this), usdcAmount), "USDC transfer failed");
        }
        if (eurcAmount > 0) {
            require(eurc.transferFrom(msg.sender, address(this), eurcAmount), "EURC transfer failed");
        }
        emit LiquidityAdded(msg.sender, usdcAmount, eurcAmount);
    }

    // v5 fix (security review): withdrawLiquidity previously accepted ANY
    // token address — the owner could withdraw any ERC20 this contract
    // happened to hold, not just the two it's actually meant to custody.
    // Restricted to USDC/EURC only.
    function withdrawLiquidity(address token, uint256 amount) external onlyOwner {
        require(token == address(usdc) || token == address(eurc), "Can only withdraw USDC or EURC");
        require(IERC20(token).transfer(owner, amount), "Withdraw failed");
        emit LiquidityWithdrawn(owner, token, amount);
    }

    function swapUsdcToEurc(uint256 amountIn, uint256 minAmountOut) external whenNotPaused nonReentrant {
        require(amountIn > 0, "Amount must be > 0");
        uint256 amountOut = (amountIn * usdcToEurcRate) / 1e6;
        require(amountOut >= minAmountOut, "Slippage too high");
        require(eurc.balanceOf(address(this)) >= amountOut, "Insufficient EURC liquidity");

        require(usdc.transferFrom(msg.sender, address(this), amountIn), "USDC transfer failed");
        require(eurc.transfer(msg.sender, amountOut), "EURC transfer failed");

        emit Swapped(msg.sender, true, amountIn, amountOut);
    }

    function swapEurcToUsdc(uint256 amountIn, uint256 minAmountOut) external whenNotPaused nonReentrant {
        require(amountIn > 0, "Amount must be > 0");
        uint256 amountOut = (amountIn * 1e6) / usdcToEurcRate;
        require(amountOut >= minAmountOut, "Slippage too high");
        require(usdc.balanceOf(address(this)) >= amountOut, "Insufficient USDC liquidity");

        require(eurc.transferFrom(msg.sender, address(this), amountIn), "EURC transfer failed");
        require(usdc.transfer(msg.sender, amountOut), "USDC transfer failed");

        emit Swapped(msg.sender, false, amountIn, amountOut);
    }

    function getEurcOut(uint256 usdcIn) external view returns (uint256) {
        return (usdcIn * usdcToEurcRate) / 1e6;
    }

    function getUsdcOut(uint256 eurcIn) external view returns (uint256) {
        return (eurcIn * 1e6) / usdcToEurcRate;
    }

    function getLiquidity() external view returns (uint256 usdcBalance, uint256 eurcBalance) {
        return (usdc.balanceOf(address(this)), eurc.balanceOf(address(this)));
    }
}
