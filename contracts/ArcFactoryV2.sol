// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
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
contract ArcPool {
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

    function addLiquidity(uint256 amountA, uint256 amountB) external nonReentrant returns (uint256 mintedShares) {
        require(amountA > 0 && amountB > 0, "Amounts must be > 0");

        if (totalShares == 0) {
            mintedShares = sqrt(amountA * amountB);
            require(mintedShares > MINIMUM_SHARES, "Initial liquidity too small");
            mintedShares -= MINIMUM_SHARES;
            shares[address(0)] += MINIMUM_SHARES;
            totalShares += MINIMUM_SHARES;
        } else {
            uint256 shareA = (amountA * totalShares) / reserveA;
            uint256 shareB = (amountB * totalShares) / reserveB;
            mintedShares = shareA < shareB ? shareA : shareB;
            require(mintedShares > 0, "Insufficient liquidity minted");
        }

        reserveA += amountA;
        reserveB += amountB;
        shares[msg.sender] += mintedShares;
        totalShares += mintedShares;

        require(IERC20(tokenA).transferFrom(msg.sender, address(this), amountA), "TokenA transfer failed");
        require(IERC20(tokenB).transferFrom(msg.sender, address(this), amountB), "TokenB transfer failed");

        emit LiquidityAdded(msg.sender, amountA, amountB, mintedShares);
    }

    function removeLiquidity(uint256 shareAmount) external nonReentrant returns (uint256 amountA, uint256 amountB) {
        require(shareAmount > 0 && shareAmount <= shares[msg.sender], "Invalid share amount");

        amountA = (shareAmount * reserveA) / totalShares;
        amountB = (shareAmount * reserveB) / totalShares;
        require(amountA > 0 && amountB > 0, "Insufficient reserves");

        shares[msg.sender] -= shareAmount;
        totalShares -= shareAmount;
        reserveA -= amountA;
        reserveB -= amountB;

        require(IERC20(tokenA).transfer(msg.sender, amountA), "TokenA transfer failed");
        require(IERC20(tokenB).transfer(msg.sender, amountB), "TokenB transfer failed");

        emit LiquidityRemoved(msg.sender, amountA, amountB, shareAmount);
    }

    // Constant product swap: (x + dx*0.997) * (y - dy) = x * y
    function swap(bool aToB, uint256 amountIn, uint256 minAmountOut) external nonReentrant returns (uint256 amountOut) {
        require(amountIn > 0, "Amount must be > 0");
        require(reserveA > 0 && reserveB > 0, "No liquidity");

        uint256 amountInWithFee = amountIn * (BPS_DENOM - FEE_BPS);

        if (aToB) {
            uint256 numerator = amountInWithFee * reserveB;
            uint256 denominator = (reserveA * BPS_DENOM) + amountInWithFee;
            amountOut = numerator / denominator;
            require(amountOut >= minAmountOut, "Slippage too high");
            require(amountOut < reserveB, "Insufficient pool liquidity");

            reserveA += amountIn;
            reserveB -= amountOut;

            require(IERC20(tokenA).transferFrom(msg.sender, address(this), amountIn), "TokenA transfer failed");
            require(IERC20(tokenB).transfer(msg.sender, amountOut), "TokenB transfer failed");
        } else {
            uint256 numerator = amountInWithFee * reserveA;
            uint256 denominator = (reserveB * BPS_DENOM) + amountInWithFee;
            amountOut = numerator / denominator;
            require(amountOut >= minAmountOut, "Slippage too high");
            require(amountOut < reserveA, "Insufficient pool liquidity");

            reserveB += amountIn;
            reserveA -= amountOut;

            require(IERC20(tokenB).transferFrom(msg.sender, address(this), amountIn), "TokenB transfer failed");
            require(IERC20(tokenA).transfer(msg.sender, amountOut), "TokenA transfer failed");
        }

        emit Swap(msg.sender, aToB, amountIn, amountOut);
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
contract ArcFactoryV2 {
    address[] public allPools;
    mapping(address => mapping(address => address)) public getPool;

    event PoolCreated(address indexed tokenA, address indexed tokenB, address pool);

    function createPool(address tokenA, address tokenB) external returns (address pool) {
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

    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }
}
