// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// ArcTokenFactoryV2 — token launch, learning from o1.exchange's production
// launchpad model, adapted honestly to FlowFi's actual architecture:
//
// 1. PERMANENT LIQUIDITY LOCK (adopted) — the old TokenFactory minted a bare
//    ERC-20 with no pool step at all. This version adds lockLaunchLiquidity():
//    once a pool exists for a launched token (created through the existing,
//    unchanged, owner-gated Pools flow — deliberately NOT touched here),
//    anyone can deposit the launch liquidity through this contract, and the
//    resulting LP shares are held by this contract forever — no withdraw
//    function is exposed anywhere, so the lock is structural, not a
//    separate burn step that could be forgotten.
//
//    Pool creation itself stays exactly as it is today (owner-only
//    createPool on ArcFactoryV2) — this contract does not attempt to call
//    it, avoiding the owner-gate conflict entirely. This means launching a
//    token and locking its liquidity is two on-chain steps, not one atomic
//    transaction, in exchange for not touching working, curated
//    infrastructure.
//
// 2. ANTI-SNIPE WINDOW (adopted, honestly scoped) — buyDuringLaunch()
//    enforces a per-wallet cap (2% of supply) for the first 20 seconds
//    after launch, for anyone buying through this contract. It cannot
//    (without changing ArcPool itself, which serves every pair on FlowFi,
//    not just launches) block a direct call to the pool's own swap() during
//    that window — a real, stated limitation, not hidden.
//
// 3. NET FEE SPLIT — not adopted. ArcPool's 0.3% fee accrues to liquidity
//    providers for every pair on FlowFi; splitting it three ways would mean
//    changing that shared contract's fee logic, a separate decision.
//
// 4. RESTRICTED PRICE UPDATER — not applicable. FlowFi's launched tokens
//    price purely by the AMM; there is no admin-set price for this role to
//    restrict.
//
// Token order safety: ArcPool exposes tokenA()/tokenB() as public immutable
// state — this contract always reads that order live rather than assuming
// which side the owner passed to createPool.

interface IArcPool {
    function addLiquidity(uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, uint256 deadline) external returns (uint256 mintedShares);
    function swap(bool aToB, uint256 amountIn, uint256 minAmountOut, uint256 deadline) external returns (uint256 amountOut);
    function tokenA() external view returns (address);
    function tokenB() external view returns (address);
    function totalShares() external view returns (uint256);
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract LaunchedToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    address public immutable creator;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint256 _supply, address _creator) {
        name = _name;
        symbol = _symbol;
        totalSupply = _supply;
        creator = _creator;
        balanceOf[_creator] = _supply; // minted straight to the creator, who then approves the factory for the locking step
        emit Transfer(address(0), _creator, _supply);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "Allowance exceeded");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "Insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

contract ArcTokenFactoryV2 {
    address public immutable usdc;
    uint256 public constant ANTI_SNIPE_WINDOW = 20 seconds;
    uint256 public constant ANTI_SNIPE_MAX_BUY_BPS = 200; // 2% of total supply, per wallet, during the window

    address[] public allTokens;
    mapping(address => uint256) public tokenSupply;
    mapping(address => uint256) public launchedAt;
    mapping(address => address) public tokenPool; // set once, by lockLaunchLiquidity
    mapping(address => mapping(address => uint256)) public boughtDuringSnipeWindow;

    event TokenLaunched(address indexed token, address indexed creator, uint256 supply);
    event LiquidityLocked(address indexed token, address indexed pool, uint256 tokenAmount, uint256 usdcAmount);

    constructor(address _usdc) {
        usdc = _usdc;
    }

    function launchToken(string calldata name, string calldata symbol, uint256 supply) external returns (address token) {
        require(supply > 0, "Supply must be > 0");
        LaunchedToken newToken = new LaunchedToken(name, symbol, supply, msg.sender);
        token = address(newToken);
        tokenSupply[token] = supply;
        launchedAt[token] = block.timestamp;
        allTokens.push(token);
        emit TokenLaunched(token, msg.sender, supply);
    }

    // Call after a pool already exists for `token` (created through the
    // normal, unchanged, owner-gated Pools flow). Caller must first approve
    // this contract for both `tokenAmount` of `token` and `usdcAmount` of
    // USDC. This must be the pool's first-ever deposit (totalShares == 0 in
    // ArcPool), which is why amountAMin/amountBMin = 0 is safe — no
    // ratio-matching or partial-fill risk exists on a first deposit. Can
    // only be called once per token.
    function lockLaunchLiquidity(address token, address pool, uint256 tokenAmount, uint256 usdcAmount, uint256 deadline) external {
        require(tokenSupply[token] > 0, "Not a token launched here");
        require(tokenPool[token] == address(0), "Already locked for this token");
        require(block.timestamp <= deadline, "Transaction expired");

        address a = IArcPool(pool).tokenA();
        address b = IArcPool(pool).tokenB();
        require((a == token && b == usdc) || (a == usdc && b == token), "Pool is not for this token/USDC pair");
        require(IArcPool(pool).totalShares() == 0, "Pool already has liquidity, launch-lock path is first-deposit only");
        tokenPool[token] = pool;

        IERC20(token).transferFrom(msg.sender, address(this), tokenAmount);
        IERC20(usdc).transferFrom(msg.sender, address(this), usdcAmount);
        IERC20(token).approve(pool, tokenAmount);
        IERC20(usdc).approve(pool, usdcAmount);

        if (a == token) {
            IArcPool(pool).addLiquidity(tokenAmount, usdcAmount, 0, 0, deadline);
        } else {
            IArcPool(pool).addLiquidity(usdcAmount, tokenAmount, 0, 0, deadline);
        }
        // Resulting LP shares are recorded under this contract's address
        // inside ArcPool's own storage. No function anywhere in this
        // contract ever calls removeLiquidity — the lock is permanent by
        // omission, not by a revocable flag.

        emit LiquidityLocked(token, pool, tokenAmount, usdcAmount);
    }

    // Anti-snipe buy path. Honest limitation stated at the top of this file:
    // this caps purchases made THROUGH this function, not direct calls to
    // the pool's own swap().
    function buyDuringLaunch(address token, uint256 usdcIn, uint256 minTokenOut, uint256 deadline) external returns (uint256 tokenOut) {
        address pool = tokenPool[token];
        require(pool != address(0), "Liquidity not locked yet for this token");
        require(block.timestamp <= deadline, "Transaction expired");

        bool tokenIsA = IArcPool(pool).tokenA() == token;

        IERC20(usdc).transferFrom(msg.sender, address(this), usdcIn);
        IERC20(usdc).approve(pool, usdcIn);
        // Buying `token` with USDC: if token is tokenA, USDC is tokenB, so
        // the swap direction (A to B) is false — USDC (B) moves in, token
        // (A) moves out.
        tokenOut = IArcPool(pool).swap(!tokenIsA, usdcIn, minTokenOut, deadline);

        bool inSnipeWindow = block.timestamp <= launchedAt[token] + ANTI_SNIPE_WINDOW;
        if (inSnipeWindow) {
            uint256 cap = (tokenSupply[token] * ANTI_SNIPE_MAX_BUY_BPS) / 10000;
            uint256 newTotal = boughtDuringSnipeWindow[token][msg.sender] + tokenOut;
            require(newTotal <= cap, "Anti-snipe cap exceeded for this wallet");
            boughtDuringSnipeWindow[token][msg.sender] = newTotal;
        }

        IERC20(token).transfer(msg.sender, tokenOut);
    }

    function allTokensLength() external view returns (uint256) {
        return allTokens.length;
    }
}
