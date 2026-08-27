// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

// v2 changes from the original ArcEscrow (audit finding addressed):
// 1. Added a claim-after-timeout path: once a freelancer submits work, if
//    the client neither releases funds nor refunds within SUBMISSION_TIMEOUT
//    (7 days), the freelancer can claim the funds themselves. This closes
//    the "unresponsive or malicious client holds funds hostage forever"
//    gap found in the original — every other function is unchanged.
// v3 changes from v2 (minimal addition, per second-pass review):
// - Added a minimal owner + pause() that ONLY blocks new createEscrow()
//   calls. It does NOT touch submitWork/releaseFunds/refund/
//   claimAfterTimeout — every escrow already in flight keeps working
//   exactly as before, with or without the contract being paused. This is
//   deliberately narrow: an emergency stop for "something's wrong, stop
//   new escrows from being created" without giving the owner any power
//   over funds already locked in existing escrows.
contract ArcEscrow {
    enum Status { Funded, Submitted, Completed, Refunded }

    struct Escrow {
        address client;
        address freelancer;
        uint256 amount;
        string title;
        Status status;
        uint256 createdAt;
        uint256 submittedAt; // 0 until submitWork() is called
    }

    uint256 constant SUBMISSION_TIMEOUT = 7 days;

    IERC20 public immutable usdc;
    uint256 public escrowCount;
    mapping(uint256 => Escrow) public escrows;

    address public owner;
    bool public paused;

    event EscrowCreated(uint256 indexed id, address indexed client, address indexed freelancer, uint256 amount, string title);
    event WorkSubmitted(uint256 indexed id, uint256 submittedAt);
    event FundsReleased(uint256 indexed id);
    event Refunded(uint256 indexed id);
    event ClaimedAfterTimeout(uint256 indexed id);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _usdc) {
        usdc = IERC20(_usdc);
        owner = msg.sender;
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function createEscrow(address freelancer, uint256 amount, string calldata title) external returns (uint256) {
        require(!paused, "New escrows are paused");
        require(freelancer != address(0), "Invalid freelancer");
        require(freelancer != msg.sender, "Cannot escrow to yourself");
        require(amount > 0, "Amount must be > 0");

        uint256 id = escrowCount++;
        escrows[id] = Escrow({
            client: msg.sender,
            freelancer: freelancer,
            amount: amount,
            title: title,
            status: Status.Funded,
            createdAt: block.timestamp,
            submittedAt: 0
        });

        require(usdc.transferFrom(msg.sender, address(this), amount), "USDC transfer failed");

        emit EscrowCreated(id, msg.sender, freelancer, amount, title);
        return id;
    }

    function submitWork(uint256 id) external {
        Escrow storage e = escrows[id];
        require(e.freelancer == msg.sender, "Only freelancer can submit");
        require(e.status == Status.Funded, "Invalid status");

        e.status = Status.Submitted;
        e.submittedAt = block.timestamp;
        emit WorkSubmitted(id, block.timestamp);
    }

    function releaseFunds(uint256 id) external {
        Escrow storage e = escrows[id];
        require(e.client == msg.sender, "Only client can release");
        require(e.status == Status.Submitted, "Work not submitted yet");

        e.status = Status.Completed;
        require(usdc.transfer(e.freelancer, e.amount), "Transfer failed");

        emit FundsReleased(id);
    }

    function refund(uint256 id) external {
        Escrow storage e = escrows[id];
        require(e.client == msg.sender, "Only client can refund");
        require(e.status == Status.Funded || e.status == Status.Submitted, "Cannot refund");

        e.status = Status.Refunded;
        require(usdc.transfer(e.client, e.amount), "Transfer failed");

        emit Refunded(id);
    }

    // New in v2: if work was submitted and the client has neither released
    // nor refunded within SUBMISSION_TIMEOUT, the freelancer can claim the
    // funds directly. This is the freelancer's safety valve against an
    // unresponsive or bad-faith client — it does NOT let the freelancer
    // claim before submitting work, and does NOT affect the client's
    // ability to release/refund promptly (this only matters once the
    // timeout has actually passed).
    function claimAfterTimeout(uint256 id) external {
        Escrow storage e = escrows[id];
        require(e.freelancer == msg.sender, "Only freelancer can claim");
        require(e.status == Status.Submitted, "Not in submitted state");
        require(e.submittedAt > 0, "Not yet submitted");
        require(block.timestamp >= e.submittedAt + SUBMISSION_TIMEOUT, "Timeout not reached yet");

        e.status = Status.Completed;
        require(usdc.transfer(e.freelancer, e.amount), "Transfer failed");

        emit ClaimedAfterTimeout(id);
    }

    function getEscrow(uint256 id) external view returns (
        address client,
        address freelancer,
        uint256 amount,
        string memory title,
        Status status,
        uint256 createdAt,
        uint256 submittedAt
    ) {
        Escrow storage e = escrows[id];
        return (e.client, e.freelancer, e.amount, e.title, e.status, e.createdAt, e.submittedAt);
    }

    // Convenience view for the frontend to show a countdown / "claim now"
    // button state without re-deriving the math client-side.
    function timeUntilClaimable(uint256 id) external view returns (uint256 secondsRemaining) {
        Escrow storage e = escrows[id];
        if (e.status != Status.Submitted || e.submittedAt == 0) return type(uint256).max;
        uint256 claimableAt = e.submittedAt + SUBMISSION_TIMEOUT;
        if (block.timestamp >= claimableAt) return 0;
        return claimableAt - block.timestamp;
    }
}
