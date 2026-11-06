// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title TaoLedger
/// @notice TAO snapshots as verifiable roots, and the free mints the first one
///         sets. A leaf is (wallet, taoTotal, freeMints), the full table is on
///         Arweave, and anyone can check any wallet against a root.
contract TaoLedger is Ownable {
    uint64 public constant CLAIM_WINDOW = 30 days;

    struct Snapshot {
        bytes32 root;
        uint64 takenAt;
        uint64 publishedAt;
        uint64 claimUntil; // 0 for a snapshot that sets no free mints
        string arweaveUri;
        string label;
    }

    /// @notice Snapshot ids start at 1.
    mapping(uint256 => Snapshot) private _snapshots;
    uint256 public snapshotCount;

    /// @notice The snapshot whose free mints can be claimed.
    uint256 public claimSnapshot;
    mapping(uint256 => mapping(address => uint256)) public claimed;
    uint256 public totalClaimed;

    /// @notice The only address that may spend a free mint: the //STRIPS extension.
    address public minter;

    event SnapshotPublished(uint256 indexed id, bytes32 root, uint64 takenAt, string arweaveUri, string label);
    event ClaimSnapshotChanged(uint256 indexed id, uint64 claimUntil);
    event MinterChanged(address minter);
    event FreeMintClaimed(uint256 indexed id, address indexed wallet, uint256 claimedSoFar);

    error NotMinter();
    error NoSuchSnapshot();
    error BadProof();
    error ClaimClosed();
    error NoneLeft();
    error ClaimsStarted();

    constructor(address owner_) {
        _transferOwnership(owner_);
    }

    function setMinter(address minter_) external onlyOwner {
        minter = minter_;
        emit MinterChanged(minter_);
    }

    /// @notice Publish a snapshot. The first one opens the 30 day free mint claim.
    function publishSnapshot(bytes32 root, uint64 takenAt, string calldata arweaveUri, string calldata label)
        external
        onlyOwner
        returns (uint256 id)
    {
        id = ++snapshotCount;
        Snapshot storage s = _snapshots[id];
        s.root = root;
        s.takenAt = takenAt;
        s.publishedAt = uint64(block.timestamp);
        s.arweaveUri = arweaveUri;
        s.label = label;
        emit SnapshotPublished(id, root, takenAt, arweaveUri, label);
        if (claimSnapshot == 0) _openClaim(id);
    }

    /// @notice Point the claim at a corrected snapshot, only while nobody has
    ///         claimed. The window runs from when the correction was published.
    function setClaimSnapshot(uint256 id) external onlyOwner {
        if (id == 0 || id > snapshotCount) revert NoSuchSnapshot();
        if (totalClaimed != 0) revert ClaimsStarted();
        delete _snapshots[claimSnapshot].claimUntil;
        _openClaim(id);
    }

    function _openClaim(uint256 id) private {
        Snapshot storage s = _snapshots[id];
        s.claimUntil = s.publishedAt + CLAIM_WINDOW;
        claimSnapshot = id;
        emit ClaimSnapshotChanged(id, s.claimUntil);
    }

    function snapshot(uint256 id) external view returns (Snapshot memory) {
        return _snapshots[id];
    }

    /// @notice When the free mints stop, shown on the Maker as a countdown.
    function claimDeadline() external view returns (uint64) {
        return _snapshots[claimSnapshot].claimUntil;
    }

    function leaf(address wallet, uint256 taoTotal, uint256 freeMints) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(wallet, taoTotal, freeMints))));
    }

    /// @notice Is this wallet's row in this snapshot?
    function verify(uint256 id, address wallet, uint256 taoTotal, uint256 freeMints, bytes32[] calldata proof)
        public
        view
        returns (bool)
    {
        if (id == 0 || id > snapshotCount) return false;
        return MerkleProof.verifyCalldata(proof, _snapshots[id].root, leaf(wallet, taoTotal, freeMints));
    }

    /// @notice Spend one of a wallet's free mints.
    function claim(address wallet, uint256 taoTotal, uint256 freeMints, bytes32[] calldata proof) external {
        if (msg.sender != minter) revert NotMinter();
        uint256 id = claimSnapshot;
        if (id == 0 || block.timestamp > _snapshots[id].claimUntil) revert ClaimClosed();
        if (!verify(id, wallet, taoTotal, freeMints, proof)) revert BadProof();
        uint256 used = claimed[id][wallet];
        if (used >= freeMints) revert NoneLeft();
        claimed[id][wallet] = used + 1;
        ++totalClaimed;
        emit FreeMintClaimed(id, wallet, used + 1);
    }
}
