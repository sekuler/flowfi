// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// FlowFi "Flow Pioneer" badge — a soulbound (non-transferable) ERC-721 for early FlowFi users.
//
// - One badge per wallet. Free to mint (the wallet only pays Arc gas).
// - Minting needs a signature from FlowFi's server (api/badge.js). The server only signs for wallets
//   that completed a real transaction through FlowFi, so the eligibility rule can't be skipped by
//   calling this contract directly. The signature is tied to this contract, this chain and the
//   minting wallet, so it can't be reused anywhere else or by anyone else.
// - Supply is not capped here on purpose: the server stops signing at the limit FlowFi sets.
// - Soulbound: transfers and approvals always revert. Implements ERC-5192 (locked = true).
// - The owner can pause minting, rotate the signer key and update the metadata URI. The owner can't
//   move, burn or mint anyone's badge.
contract FlowPioneerBadge {
    string public constant name = "FlowFi Flow Pioneer";
    string public constant symbol = "FLOWP";

    address public owner;
    address public pendingOwner;
    address public signer;
    bool public paused;
    string private _tokenURI; // same metadata for every badge
    uint256 public totalSupply;

    mapping(uint256 => address) private _ownerOf;
    mapping(address => uint256) public badgeOf; // wallet => tokenId (0 = none; ids start at 1)

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Locked(uint256 tokenId); // ERC-5192
    event SignerUpdated(address indexed signer);
    event PausedSet(bool paused);
    event TokenURIUpdated(string uri);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error MintPaused();
    error AlreadyMinted();
    error BadSignature();
    error Soulbound();
    error NonexistentToken();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address signer_, string memory uri_) {
        if (signer_ == address(0)) revert ZeroAddress();
        owner = msg.sender;
        signer = signer_;
        _tokenURI = uri_;
        emit OwnershipTransferred(address(0), msg.sender);
        emit SignerUpdated(signer_);
    }

    // ---- minting ----

    /// Hash the server signs (EIP-191 personal_sign over this digest).
    function mintDigest(address to) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), block.chainid, to));
    }

    function mint(bytes calldata signature) external returns (uint256 tokenId) {
        if (paused) revert MintPaused();
        if (badgeOf[msg.sender] != 0) revert AlreadyMinted();
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", mintDigest(msg.sender)));
        if (_recover(ethHash, signature) != signer) revert BadSignature();

        tokenId = ++totalSupply;
        _ownerOf[tokenId] = msg.sender;
        badgeOf[msg.sender] = tokenId;
        emit Transfer(address(0), msg.sender, tokenId);
        emit Locked(tokenId);
    }

    // ---- ERC-721 views ----

    function balanceOf(address wallet) external view returns (uint256) {
        if (wallet == address(0)) revert ZeroAddress();
        return badgeOf[wallet] == 0 ? 0 : 1;
    }

    function ownerOf(uint256 tokenId) public view returns (address o) {
        o = _ownerOf[tokenId];
        if (o == address(0)) revert NonexistentToken();
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId);
        return _tokenURI;
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        ownerOf(tokenId);
        return address(0);
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }

    /// ERC-5192: every badge is permanently locked to its wallet.
    function locked(uint256 tokenId) external view returns (bool) {
        ownerOf(tokenId);
        return true;
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 // ERC-165
            || id == 0x80ac58cd // ERC-721
            || id == 0x5b5e139f // ERC-721 Metadata
            || id == 0xb45a3c0e; // ERC-5192
    }

    // ---- soulbound: no transfers, no approvals ----

    function transferFrom(address, address, uint256) external pure { revert Soulbound(); }
    function safeTransferFrom(address, address, uint256) external pure { revert Soulbound(); }
    function safeTransferFrom(address, address, uint256, bytes calldata) external pure { revert Soulbound(); }
    function approve(address, uint256) external pure { revert Soulbound(); }
    function setApprovalForAll(address, bool) external pure { revert Soulbound(); }

    // ---- owner ----

    function setSigner(address signer_) external onlyOwner {
        if (signer_ == address(0)) revert ZeroAddress();
        signer = signer_;
        emit SignerUpdated(signer_);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function setTokenURI(string calldata uri_) external onlyOwner {
        _tokenURI = uri_;
        emit TokenURIUpdated(uri_);
    }

    /// Two-step ownership transfer (e.g. to a Safe multisig): the new owner must accept.
    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // ---- signature recovery (65-byte r,s,v; rejects malleable high-s signatures) ----

    function _recover(bytes32 hash, bytes calldata sig) private pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        return ecrecover(hash, v, r, s);
    }
}
