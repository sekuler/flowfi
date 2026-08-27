// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

// v2 changes from the original ArcLending (audit findings addressed):
// 1. Added a minimal "guardian" role that can ONLY pause/unpause new
//    borrowing — it cannot withdraw funds, change interest parameters, or
//    touch anyone's position. This exists specifically for a stablecoin
//    depeg scenario (this contract assumes USDC/EURC are both ~$1 with no
//    oracle) — if that assumption ever breaks, new borrowing can be frozen
//    while supply/repay/withdraw/liquidate all remain fully open, so no
//    user is ever trapped by the pause itself.
// 2. Reordered external calls to happen AFTER state updates
//    (Checks-Effects-Interactions) in supply/depositCollateral/repay/
//    liquidate, and added a nonReentrant guard as defense-in-depth.
// 3. Guardian is two-step transferable (nominate + accept), same reasoning
//    as ArcSwap v2 — a lost key shouldn't be a permanent dead end.
//
// Still true of this design (unchanged, documented for transparency): this
// remains a stablecoin-pegged-price assumption model with no price oracle.
// The pause added here is a mitigation, not a fix — a real oracle-based
// solvency check would be a stronger mainnet requirement.
contract ArcLending {
    IERC20 public immutable usdc;
    IERC20 public immutable eurc;

    uint256 constant LTV_BPS = 7500;
    uint256 constant LIQUIDATION_BPS = 8500;
    uint256 constant BASE_RATE_BPS = 200;
    uint256 constant SLOPE_BPS = 1800;
    uint256 constant BPS_DENOM = 10000;
    uint256 constant SECONDS_PER_YEAR = 365 days;

    uint256 public totalSupplied;
    uint256 public totalBorrowed;
    uint256 public lastAccrualTime;
    uint256 public borrowIndex = 1e18;

    mapping(address => uint256) public suppliedShares;
    uint256 public totalSupplyShares;

    mapping(address => uint256) public collateralBalance;
    mapping(address => uint256) public borrowedPrincipal;
    mapping(address => uint256) public borrowIndexSnapshot;

    address public guardian;
    address public pendingGuardian;
    bool public borrowingPaused;

    uint256 private locked; // reentrancy guard: 0 = unlocked, 1 = locked

    event Supplied(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event Borrowed(address indexed user, uint256 amount);
    event Repaid(address indexed user, uint256 amount);
    event Liquidated(address indexed borrower, address indexed liquidator, uint256 debtCovered, uint256 collateralSeized);
    event BorrowingPaused(address indexed by);
    event BorrowingUnpaused(address indexed by);
    event GuardianTransferStarted(address indexed currentGuardian, address indexed pendingGuardian);
    event GuardianTransferred(address indexed previousGuardian, address indexed newGuardian);

    modifier onlyGuardian() {
        require(msg.sender == guardian, "Not guardian");
        _;
    }

    modifier nonReentrant() {
        require(locked == 0, "Reentrancy blocked");
        locked = 1;
        _;
        locked = 0;
    }

    constructor(address _usdc, address _eurc) {
        usdc = IERC20(_usdc);
        eurc = IERC20(_eurc);
        lastAccrualTime = block.timestamp;
        guardian = msg.sender;
    }

    // ---------- Guardian: pause/unpause new borrowing only ----------

    function pauseBorrowing() external onlyGuardian {
        borrowingPaused = true;
        emit BorrowingPaused(msg.sender);
    }

    function unpauseBorrowing() external onlyGuardian {
        borrowingPaused = false;
        emit BorrowingUnpaused(msg.sender);
    }

    function transferGuardian(address newGuardian) external onlyGuardian {
        require(newGuardian != address(0), "Zero address");
        pendingGuardian = newGuardian;
        emit GuardianTransferStarted(guardian, newGuardian);
    }

    function acceptGuardian() external {
        require(msg.sender == pendingGuardian, "Not pending guardian");
        address previous = guardian;
        guardian = pendingGuardian;
        pendingGuardian = address(0);
        emit GuardianTransferred(previous, guardian);
    }

    function accrueInterest() public {
        if (block.timestamp == lastAccrualTime) return;
        uint256 elapsed = block.timestamp - lastAccrualTime;
        uint256 utilization = totalSupplied == 0 ? 0 : (totalBorrowed * BPS_DENOM) / totalSupplied;
        uint256 rateBps = BASE_RATE_BPS + (SLOPE_BPS * utilization) / BPS_DENOM;

        uint256 interestFactor = (rateBps * elapsed * 1e18) / (BPS_DENOM * SECONDS_PER_YEAR);
        borrowIndex += (borrowIndex * interestFactor) / 1e18;

        uint256 interestAccrued = (totalBorrowed * interestFactor) / 1e18;
        totalBorrowed += interestAccrued;
        totalSupplied += interestAccrued;

        lastAccrualTime = block.timestamp;
    }

    function currentAPR() external view returns (uint256 bps) {
        uint256 utilization = totalSupplied == 0 ? 0 : (totalBorrowed * BPS_DENOM) / totalSupplied;
        bps = BASE_RATE_BPS + (SLOPE_BPS * utilization) / BPS_DENOM;
    }

    // ---------- Supply side ----------

    function supply(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        accrueInterest();

        uint256 shares = totalSupplyShares == 0 ? amount : (amount * totalSupplyShares) / totalSupplied;

        suppliedShares[msg.sender] += shares;
        totalSupplyShares += shares;
        totalSupplied += amount;

        require(usdc.transferFrom(msg.sender, address(this), amount), "USDC transfer failed");

        emit Supplied(msg.sender, amount);
    }

    function withdraw(uint256 shareAmount) external nonReentrant {
        require(shareAmount > 0 && shareAmount <= suppliedShares[msg.sender], "Invalid shares");
        accrueInterest();

        uint256 amount = (shareAmount * totalSupplied) / totalSupplyShares;
        uint256 available = totalSupplied - totalBorrowed;
        require(amount <= available, "Insufficient available liquidity");

        suppliedShares[msg.sender] -= shareAmount;
        totalSupplyShares -= shareAmount;
        totalSupplied -= amount;

        require(usdc.transfer(msg.sender, amount), "USDC transfer failed");
        emit Withdrawn(msg.sender, amount);
    }

    function supplyBalance(address user) public view returns (uint256) {
        if (totalSupplyShares == 0) return 0;
        return (suppliedShares[user] * totalSupplied) / totalSupplyShares;
    }

    // ---------- Collateral & borrow side ----------

    function depositCollateral(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        collateralBalance[msg.sender] += amount;
        require(eurc.transferFrom(msg.sender, address(this), amount), "EURC transfer failed");
        emit CollateralDeposited(msg.sender, amount);
    }

    function withdrawCollateral(uint256 amount) external nonReentrant {
        accrueInterest();
        _syncBorrower(msg.sender);
        require(amount > 0 && amount <= collateralBalance[msg.sender], "Invalid amount");

        uint256 remainingCollateral = collateralBalance[msg.sender] - amount;
        uint256 debt = borrowedPrincipal[msg.sender];
        require(debt * BPS_DENOM <= remainingCollateral * LTV_BPS, "Would exceed LTV");

        collateralBalance[msg.sender] -= amount;
        require(eurc.transfer(msg.sender, amount), "EURC transfer failed");
        emit CollateralWithdrawn(msg.sender, amount);
    }

    function _syncBorrower(address user) internal {
        if (borrowIndexSnapshot[user] == 0) {
            borrowIndexSnapshot[user] = borrowIndex;
            return;
        }
        if (borrowedPrincipal[user] > 0) {
            uint256 accrued = (borrowedPrincipal[user] * borrowIndex) / borrowIndexSnapshot[user];
            borrowedPrincipal[user] = accrued;
        }
        borrowIndexSnapshot[user] = borrowIndex;
    }

    function debtOf(address user) public view returns (uint256) {
        if (borrowedPrincipal[user] == 0 || borrowIndexSnapshot[user] == 0) return borrowedPrincipal[user];
        return (borrowedPrincipal[user] * borrowIndex) / borrowIndexSnapshot[user];
    }

    function maxBorrowable(address user) public view returns (uint256) {
        uint256 capacity = (collateralBalance[user] * LTV_BPS) / BPS_DENOM;
        uint256 debt = debtOf(user);
        return capacity > debt ? capacity - debt : 0;
    }

    function healthFactor(address user) public view returns (uint256 bps) {
        uint256 debt = debtOf(user);
        if (debt == 0) return type(uint256).max;
        uint256 liqThreshold = (collateralBalance[user] * LIQUIDATION_BPS) / BPS_DENOM;
        return (liqThreshold * BPS_DENOM) / debt;
    }

    function borrow(uint256 amount) external nonReentrant {
        require(!borrowingPaused, "Borrowing is paused");
        require(amount > 0, "Amount must be > 0");
        accrueInterest();
        _syncBorrower(msg.sender);

        require(amount <= maxBorrowable(msg.sender), "Exceeds borrowing capacity");
        require(amount <= totalSupplied - totalBorrowed, "Insufficient pool liquidity");

        borrowedPrincipal[msg.sender] += amount;
        totalBorrowed += amount;

        require(usdc.transfer(msg.sender, amount), "USDC transfer failed");
        emit Borrowed(msg.sender, amount);
    }

    function repay(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        accrueInterest();
        _syncBorrower(msg.sender);

        uint256 debt = borrowedPrincipal[msg.sender];
        uint256 payment = amount > debt ? debt : amount;
        require(payment > 0, "No debt to repay");

        borrowedPrincipal[msg.sender] -= payment;
        totalBorrowed -= payment;

        require(usdc.transferFrom(msg.sender, address(this), payment), "USDC transfer failed");
        emit Repaid(msg.sender, payment);
    }

    // ---------- Liquidation ----------

    function liquidate(address borrower, uint256 repayAmount) external nonReentrant {
        accrueInterest();
        _syncBorrower(borrower);

        require(healthFactor(borrower) < BPS_DENOM, "Position is healthy");
        uint256 debt = borrowedPrincipal[borrower];
        uint256 actualRepay = repayAmount > debt ? debt : repayAmount;
        require(actualRepay > 0, "Nothing to liquidate");

        uint256 collateralSeized = (actualRepay * 10500) / BPS_DENOM;
        if (collateralSeized > collateralBalance[borrower]) {
            collateralSeized = collateralBalance[borrower];
        }

        borrowedPrincipal[borrower] -= actualRepay;
        totalBorrowed -= actualRepay;
        collateralBalance[borrower] -= collateralSeized;

        require(usdc.transferFrom(msg.sender, address(this), actualRepay), "USDC transfer failed");
        require(eurc.transfer(msg.sender, collateralSeized), "EURC transfer failed");
        emit Liquidated(borrower, msg.sender, actualRepay, collateralSeized);
    }

    // ---------- Views ----------

    function getMarketInfo() external view returns (uint256 _totalSupplied, uint256 _totalBorrowed, uint256 _availableLiquidity) {
        _totalSupplied = totalSupplied;
        _totalBorrowed = totalBorrowed;
        _availableLiquidity = totalSupplied > totalBorrowed ? totalSupplied - totalBorrowed : 0;
    }
}
