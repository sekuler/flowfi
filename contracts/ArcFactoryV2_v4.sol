// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

// Handles both standard ERC20s (which return a bool from transfer/transferFrom)
// and non-standard ones like real USDT (which return nothing at all). Calling
// a token like that through a strict `returns (bool)` interface reverts while
// decoding the empty return data, even though the transfer itself succeeded —
// meaning a factory using the plain interface literally cannot pair with
// those tokens at all. A low-level call sidesteps that: success is read from
// the call itself, and a bool is only decoded if the token actually returned
// one.
library SafeERC20 {
    function safeTransfer(IERC20 token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: transfer failed");
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: transferFrom failed");
    }
}

// v2 changes from the original ArcPool/ArcFactoryV2 (audit findings addressed):
// 1. Restored the MINIMUM_SHARES lock on first liquidity deposit — this was
//    present in the original ArcFactory (V1) but had been dropped here,
//    reopening the classic first-depositor pool-inflation attack.
// 2. Added a nonReentrant guard on addLiquidity/removeLiquidity/swap. This
//    factory is permissionless — anyone can pair ANY ERC20 token, including
//    a malicious one with reentrant transfer hooks — so, unlike ArcSwap or
//    ArcAMM (which only ever touch trusted USDC/EURC), external calls here
//    genuinely need a reentrancy guard, not just careful ordering.
//
// v3 changes (security review, second pass):
// 3. Reserves are now derived from balanceOf() deltas around each transfer,
//    not the nominal amount the caller requested. A fee-on-transfer token
//    delivers less than requested — the old code credited the full nominal
//    amount anyway, permanently overstating reserves versus the contract's
//    real balance. This didn't just misprice trades; a large enough drift
//    could make removeLiquidity/swap try to pay out more than the contract
//    actually holds, reverting and stranding funds for everyone in the pool.
// 4. Added a deadline parameter to addLiquidity/removeLiquidity/swap — a
//    transaction sitting in the mempool can no longer execute much later
//    than the caller intended.
// 5. Switched every transfer/transferFrom to SafeERC20 (above) — a
//    non-standard token (USDT-style, no return value) no longer makes every
//    call to this pool revert outright.
// 6. Added sync() — anyone can call it to reconcile recorded reserves down
//    to the pool's actual token balance. It can only ever correct DOWNWARD
//    (reserves are clamped to min(recorded, actual), never raised), so it
//    can't be used to donate tokens and mint undervalued shares. This is
//    what actually protects the pool against a token whose balance can
//    drop with no transfer at all (a rebase token, or an unusual fee/burn
//    mechanic no one anticipated when the pool was created): without it,
//    that kind of drift could let removeLiquidity/swap try to pay out more
//    than the pool holds, reverting and stranding every LP permanently.
//    With it, anyone — not just the pool creator — can pull reserves back
//    in line with reality at any time, so the pool degrades to "reserves
//    reflect whatever we can prove we hold" instead of getting stuck. This
//    doesn't make rebase-token pricing exact between rebases (no generic
//    ERC20-level mechanism can promise that — a rebase can happen between
//    any two transactions, same limitation as Uniswap V2), but it means
//    this contract can never become permanently insolvent because of one.
contract ArcPool {
    using SafeERC20 for IERC20;

    address public immutable tokenA;
    address public immutable tokenB;
    address public immutable factory;

    uint256 public reserveA;
    uint256 public reserveB;
    uint256 public totalShares;
    mapping(address => uint256) public shares;

    uint256 constant FEE_BPS = 30; // 0.3%
    uint256 constant BPS_DENOM = 10000;
    uint256 constant MINIMUM_SHARES = 1000;

    uint256 private locked; // reentrancy guard: 0 = unlocked, 1 = locked

    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 sharesMinted);
    event LiquidityRemoved(address indexed provider, uint256 amountA, uint256 amountB, uint256 sharesBurned);
    event Swap(address indexed trader, bool aToB, uint256 amountIn, uint256 amountOut);
    event Synced(uint256 reserveA, uint256 reserveB);

    modifier nonReentrant() {
        require(locked == 0, "Reentrancy blocked");
        locked = 1;
        _;
        locked = 0;
    }

    constructor(address _tokenA, address _tokenB) {
        tokenA = _tokenA;
        tokenB = _tokenB;
        factory = msg.sender;
    }

    function addLiquidity(uint256 amountA, uint256 amountB, uint256 deadline) external nonReentrant returns (uint256 mintedShares) {
        require(block.timestamp <= deadline, "Transaction expired");
        require(amountA > 0 && amountB > 0, "Amounts must be > 0");

        uint256 balanceABefore = IERC20(tokenA).balanceOf(address(this));
        uint256 balanceBBefore = IERC20(tokenB).balanceOf(address(this));
        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountB);
        uint256 actualA = IERC20(tokenA).balanceOf(address(this)) - balanceABefore;
        uint256 actualB = IERC20(tokenB).balanceOf(address(this)) - balanceBBefore;
        require(actualA > 0 && actualB > 0, "No tokens received");

        if (totalShares == 0) {
            mintedShares = sqrt(actualA * actualB);
            require(mintedShares > MINIMUM_SHARES, "Initial liquidity too small");
            mintedShares -= MINIMUM_SHARES;
            shares[address(0)] += MINIMUM_SHARES;
            totalShares += MINIMUM_SHARES;
        } else {
            uint256 shareA = (actualA * totalShares) / reserveA;
            uint256 shareB = (actualB * totalShares) / reserveB;
            mintedShares = shareA < shareB ? shareA : shareB;
            require(mintedShares > 0, "Insufficient liquidity minted");
        }

        reserveA += actualA;
        reserveB += actualB;
        shares[msg.sender] += mintedShares;
        totalShares += mintedShares;

        emit LiquidityAdded(msg.sender, actualA, actualB, mintedShares);
    }

    function removeLiquidity(uint256 shareAmount, uint256 deadline) external nonReentrant returns (uint256 amountA, uint256 amountB) {
        require(block.timestamp <= deadline, "Transaction expired");
        require(shareAmount > 0 && shareAmount <= shares[msg.sender], "Invalid share amount");

        amountA = (shareAmount * reserveA) / totalShares;
        amountB = (shareAmount * reserveB) / totalShares;
        require(amountA > 0 && amountB > 0, "Insufficient reserves");

        shares[msg.sender] -= shareAmount;
        totalShares -= shareAmount;
        reserveA -= amountA;
        reserveB -= amountB;

        IERC20(tokenA).safeTransfer(msg.sender, amountA);
        IERC20(tokenB).safeTransfer(msg.sender, amountB);

        emit LiquidityRemoved(msg.sender, amountA, amountB, shareAmount);
    }

    // Constant product swap: (x + dx*0.997) * (y - dy) = x * y
    function swap(bool aToB, uint256 amountIn, uint256 minAmountOut, uint256 deadline) external nonReentrant returns (uint256 amountOut) {
        require(block.timestamp <= deadline, "Transaction expired");
        require(amountIn > 0, "Amount must be > 0");
        require(reserveA > 0 && reserveB > 0, "No liquidity");

        if (aToB) {
            uint256 balanceBefore = IERC20(tokenA).balanceOf(address(this));
            IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountIn);
            uint256 actualIn = IERC20(tokenA).balanceOf(address(this)) - balanceBefore;

            uint256 amountInWithFee = actualIn * (BPS_DENOM - FEE_BPS);
            uint256 numerator = amountInWithFee * reserveB;
            uint256 denominator = (reserveA * BPS_DENOM) + amountInWithFee;
            amountOut = numerator / denominator;
            require(amountOut >= minAmountOut, "Slippage too high");
            require(amountOut < reserveB, "Insufficient pool liquidity");

            reserveA += actualIn;
            reserveB -= amountOut;

            IERC20(tokenB).safeTransfer(msg.sender, amountOut);
        } else {
            uint256 balanceBefore = IERC20(tokenB).balanceOf(address(this));
            IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountIn);
            uint256 actualIn = IERC20(tokenB).balanceOf(address(this)) - balanceBefore;

            uint256 amountInWithFee = actualIn * (BPS_DENOM - FEE_BPS);
            uint256 numerator = amountInWithFee * reserveA;
            uint256 denominator = (reserveB * BPS_DENOM) + amountInWithFee;
            amountOut = numerator / denominator;
            require(amountOut >= minAmountOut, "Slippage too high");
            require(amountOut < reserveA, "Insufficient pool liquidity");

            reserveB += actualIn;
            reserveA -= amountOut;

            IERC20(tokenA).safeTransfer(msg.sender, amountOut);
        }

        emit Swap(msg.sender, aToB, amountIn, amountOut);
    }

    // Anyone can call this to pull recorded reserves back down to the pool's
    // real balance. Can only ever lower reserves, never raise them — see the
    // v3 changelog above for why this matters.
    function sync() external nonReentrant {
        uint256 actualA = IERC20(tokenA).balanceOf(address(this));
        uint256 actualB = IERC20(tokenB).balanceOf(address(this));
        if (actualA < reserveA) reserveA = actualA;
        if (actualB < reserveB) reserveB = actualB;
        emit Synced(reserveA, reserveB);
    }

    function getAmountOut(bool aToB, uint256 amountIn) external view returns (uint256 amountOut) {
        if (reserveA == 0 || reserveB == 0) return 0;
        uint256 amountInWithFee = amountIn * (BPS_DENOM - FEE_BPS);
        if (aToB) {
            uint256 numerator = amountInWithFee * reserveB;
            uint256 denominator = (reserveA * BPS_DENOM) + amountInWithFee;
            amountOut = numerator / denominator;
        } else {
            uint256 numerator = amountInWithFee * reserveA;
            uint256 denominator = (reserveB * BPS_DENOM) + amountInWithFee;
            amountOut = numerator / denominator;
        }
    }

    function getReserves() external view returns (uint256, uint256) {
        return (reserveA, reserveB);
    }

    function getShareValue(address provider) external view returns (uint256 amountA, uint256 amountB) {
        if (totalShares == 0) return (0, 0);
        amountA = (shares[provider] * reserveA) / totalShares;
        amountB = (shares[provider] * reserveB) / totalShares;
    }

    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}

// Factory: anyone can permissionlessly create a swap-enabled pool for any
// ERC20 token pair on Arc Testnet.
// v4 change (mainnet-readiness review): createPool() was permissionless —
// technically anyone could call it directly against the contract, even
// after FlowFi's own UI stopped exposing a "create pool" button. For
// mainnet, "the UI doesn't show it" isn't the same as "it can't happen" —
// this closes it at the contract level instead. Only the owner can create
// new pools now. Existing pools (created before this change, on either the
// legacy v2 factory or this v3 factory) are completely unaffected —
// swap/addLiquidity/removeLiquidity/sync on ArcPool itself stay open to
// everyone, exactly as before. This only restricts who can spin up a new
// pool in the first place.
contract ArcFactoryV2 {
    address[] public allPools;
    mapping(address => mapping(address => address)) public getPool;

    address public owner;
    address public pendingOwner;

    event PoolCreated(address indexed tokenA, address indexed tokenB, address pool);
    event OwnershipTransferStarted(address indexed currentOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function createPool(address tokenA, address tokenB) external onlyOwner returns (address pool) {
        require(tokenA != tokenB, "Identical tokens");
        require(tokenA != address(0) && tokenB != address(0), "Zero address");
        require(getPool[tokenA][tokenB] == address(0), "Pool already exists");

        ArcPool newPool = new ArcPool(tokenA, tokenB);
        pool = address(newPool);

        getPool[tokenA][tokenB] = pool;
        getPool[tokenB][tokenA] = pool;
        allPools.push(pool);

        emit PoolCreated(tokenA, tokenB, pool);
    }

    // Two-step ownership transfer — same reasoning as ArcSwap: a single
    // mistyped address can't permanently lock this contract away from
    // anyone's control.
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

    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }
}
