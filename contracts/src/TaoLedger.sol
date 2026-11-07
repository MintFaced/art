// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ConfirmedOwner} from "@chainlink/contracts/src/v0.8/shared/access/ConfirmedOwner.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @dev The public allowance, as far as the ledger needs to see it.
interface IPublicPool {
    function PUBLIC_CAP() external view returns (uint256);
    function publicMinted() external view returns (uint256);
}

/// @title TaoLedger
/// @notice TAO snapshots as verifiable roots, and the free mints the first one
///         sets. A leaf is (wallet, taoTotal, freeMints), the full table is on
///         Arweave, and anyone can check any wallet against a root.
///
///         The free mints are held back from the public allowance until the
///         claim closes: publicMinted + unclaimedReserve never passes the cap,
///         so a sell-out can't take a mint that's owed. Ownership is two steps
///         and can't be renounced, like the extension's.
contract TaoLedger is ConfirmedOwner {
    /// @notice The furthest out one extension can set the deadline. A deadline
    ///         can't come back in, so a slip of the keyboard shouldn't reach far.
    uint64 public constant MAX_EXTENSION = 365 days;

    /// @notice How long a claim runs once it opens: 30 days on mainnet. An
    ///         argument so a testnet can run these same bytes on a shorter one.
    uint64 public immutable CLAIM_WINDOW;

    struct Snapshot {
        bytes32 root;
        uint64 takenAt;
        uint64 publishedAt;
        uint64 claimUntil; // 0 for a snapshot that sets no free mints
        uint64 freeMints; // the table's allowances added up: what a claim holds back
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
    ///         It's set once, and it's also where the public allowance is read.
    address public minter;

    event SnapshotPublished(uint256 indexed id, bytes32 root, uint64 takenAt, string arweaveUri, string label);
    event ClaimSnapshotChanged(uint256 indexed id, uint64 claimUntil);
    event ClaimExtended(uint256 indexed id, uint64 claimUntil);
    event MinterChanged(address minter);
    event FreeMintClaimed(uint256 indexed id, address indexed wallet, uint256 claimedSoFar);

    error NotMinter();
    error NoSuchSnapshot();
    error BadProof();
    error ClaimClosed();
    error NoneLeft();
    error ClaimsStarted();
    error MinterSet();
    error NoMinter();
    error ReserveTooBig();
    error BadDeadline();

    constructor(address owner_, uint64 claimWindow_) ConfirmedOwner(owner_) {
        CLAIM_WINDOW = claimWindow_;
    }

    function setMinter(address minter_) external onlyOwner {
        if (minter != address(0)) revert MinterSet();
        minter = minter_;
        emit MinterChanged(minter_);
    }

    /// @notice Publish a snapshot. The first one opens the free mint claim.
    /// @param freeMints What the table's allowances add up to, which the claim
    ///        holds back. A root can't be summed on-chain, so the console reads
    ///        this from the table and won't sign a figure that doesn't match.
    function publishSnapshot(
        bytes32 root,
        uint64 takenAt,
        uint64 freeMints,
        string calldata arweaveUri,
        string calldata label
    ) external onlyOwner returns (uint256 id) {
        id = ++snapshotCount;
        Snapshot storage s = _snapshots[id];
        s.root = root;
        s.takenAt = takenAt;
        s.publishedAt = uint64(block.timestamp);
        s.freeMints = freeMints;
        s.arweaveUri = arweaveUri;
        s.label = label;
        emit SnapshotPublished(id, root, takenAt, arweaveUri, label);
        if (claimSnapshot == 0) _openClaim(id);
    }

    /// @notice Point the claim at a corrected snapshot, only while nobody has
    ///         claimed. The first claim freezes the root for good. The window
    ///         runs from now, and never ends sooner than the one it replaces.
    function setClaimSnapshot(uint256 id) external onlyOwner {
        if (id == 0 || id > snapshotCount) revert NoSuchSnapshot();
        if (totalClaimed != 0) revert ClaimsStarted();
        _openClaim(id);
    }

    function _openClaim(uint256 id) private {
        Snapshot storage was = _snapshots[claimSnapshot];
        Snapshot storage s = _snapshots[id];
        uint64 until = uint64(block.timestamp) + CLAIM_WINDOW;
        if (was.claimUntil > until) until = was.claimUntil;
        _checkRoom(s.freeMints);
        delete was.claimUntil;
        s.claimUntil = until;
        claimSnapshot = id;
        emit ClaimSnapshotChanged(id, until);
    }

    /// @notice Give the free mints longer. A deadline only ever moves later.
    ///         After it has passed the reserve has gone back to the public
    ///         allowance, so reopening works only if what's owed still fits.
    function extendClaim(uint64 until) external onlyOwner {
        uint256 id = claimSnapshot;
        if (id == 0) revert NoSuchSnapshot();
        Snapshot storage s = _snapshots[id];
        if (until <= s.claimUntil || until <= block.timestamp || until > block.timestamp + MAX_EXTENSION) {
            revert BadDeadline();
        }
        _checkRoom(_unspent(s));
        s.claimUntil = until;
        emit ClaimExtended(id, until);
    }

    /// @dev Nothing may promise more than the public allowance has left.
    function _checkRoom(uint256 owed) private view {
        if (minter == address(0)) revert NoMinter();
        IPublicPool pool = IPublicPool(minter);
        if (pool.publicMinted() + owed > pool.PUBLIC_CAP()) revert ReserveTooBig();
    }

    function _unspent(Snapshot storage s) private view returns (uint256) {
        uint256 total = s.freeMints;
        uint256 spent = totalClaimed;
        return total > spent ? total - spent : 0;
    }

    /// @notice Free mints still held back from the public allowance. It falls as
    ///         claims land and goes to zero when the claim closes, which is what
    ///         hands whatever nobody claimed back to paid supply.
    function unclaimedReserve() public view returns (uint256) {
        Snapshot storage s = _snapshots[claimSnapshot];
        if (block.timestamp > s.claimUntil) return 0;
        return _unspent(s);
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
