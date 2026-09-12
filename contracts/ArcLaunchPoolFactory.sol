// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

// Same low-level-call pattern as ArcFactoryV2_v4's SafeERC20 — handles
// non-standard tokens (like real USDT) that return no data on
// transfer/transferFrom instead of reverting on the strict interface.
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

// A minimal read-only view into ArcTokenFactoryV2 — just enough to confirm
// a token was genuinely minted through it (launchedAt != 0 for a real
// launched token, 0 for anything else, including a malicious token someone
// deploys by hand to spoof this check).
interface IArcTokenFactory {
    function launchedAt(address token) external view returns (uint256);
}

// Identical AMM logic to ArcFactoryV2_v4's ArcPool (same fee, same
// MINIMUM_SHARES first-deposit lock, same reentrancy guard, same
// balanceOf-delta accounting for fee-on-transfer/rebase tokens, same
// SafeERC20 usage) — deliberately not reinvented. The only thing that's
// different in this file is who's allowed to deploy a new instance of it
// (see ArcLaunchPoolFactory below), not how the pool itself behaves.
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

    uint256 private locked;

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

// Permissionless — BUT ONLY for (a genuinely launched token, USDC) pairs.
// This exists so a token creator isn't stuck waiting for the FlowFi owner
// to manually open a pool before their token is tradeable at all, without
// reopening ArcFactoryV2 v4's createPool() itself back up (that one stays
// onlyOwner, for curated pools like USDC/EURC/cirBTC — this factory is a
// separate, narrower trust boundary that doesn't touch it).
//
// The only thing stopping this from being pure spam-a-pool-for-any-token:
// tokenA must satisfy IArcTokenFactory.launchedAt(tokenA) != 0, i.e. it was
// actually minted through ArcTokenFactoryV2's launchToken(), not just any
// ERC20 someone deployed to look similar. tokenB is hardcoded to USDC —
// there's no way to call this for an arbitrary pair.
//
// NOTE before relying on this for mainnet: ArcTokenFactoryV2's
// lockLaunchLiquidity(token, pool, ...) — the function a creator calls to
// permanently lock their initial liquidity — takes the pool address as a
// caller-supplied parameter. Whether it validates that pool came from a
// specific trusted factory (e.g. checking pool.factory() against a known
// address) isn't visible from here, since ArcTokenFactoryV2's source isn't
// available (only verified bytecode). If it does, pools from THIS factory
// may need to be allowlisted there too, or lockLaunchLiquidity could reject
// them. Test this end-to-end on testnet — launch a token, create its pool
// here, then try lockLaunchLiquidity with it — before trusting this path
// for a real launch.
contract ArcLaunchPoolFactory {
    address public immutable tokenFactory;
    address public immutable usdc;

    address[] public allPools;
    mapping(address => address) public getPool; // launched token => pool

    event LaunchPoolCreated(address indexed token, address pool);

    constructor(address _tokenFactory, address _usdc) {
        require(_tokenFactory != address(0) && _usdc != address(0), "Zero address");
        tokenFactory = _tokenFactory;
        usdc = _usdc;
    }

    function createLaunchPool(address token) external returns (address pool) {
        require(token != address(0) && token != usdc, "Invalid token");
        require(getPool[token] == address(0), "Pool already exists");
        require(IArcTokenFactory(tokenFactory).launchedAt(token) != 0, "Not a token launched through ArcTokenFactoryV2");

        ArcPool newPool = new ArcPool(token, usdc);
        pool = address(newPool);

        getPool[token] = pool;
        allPools.push(pool);

        emit LaunchPoolCreated(token, pool);
    }

    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }
}
