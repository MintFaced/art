// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC721Creator} from "@manifoldxyz/creator-core-solidity/contracts/ERC721Creator.sol";
import {VRFCoordinatorV2_5Mock} from "@chainlink/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2_5Mock.sol";
import {StripsExtension, IDelegateRegistry} from "../src/StripsExtension.sol";
import {StripsRenderer} from "../src/StripsRenderer.sol";
import {StripsEngine} from "../src/StripsEngine.sol";
import {IStripsRenderer} from "../src/IStripsRenderer.sol";
import {TaoLedger} from "../src/TaoLedger.sol";

/// @dev delegate.xyz, as far as the extension can tell.
contract FakeDelegates is IDelegateRegistry {
    mapping(address => mapping(address => bool)) public ok;
    bytes32 public lastRights;

    function set(address to, address from, bool yes) external {
        ok[to][from] = yes;
    }

    function checkDelegateForERC721(address to, address from, address, uint256, bytes32)
        external
        view
        returns (bool)
    {
        return ok[to][from];
    }
}

abstract contract Base is Test {
    ERC721Creator core;
    VRFCoordinatorV2_5Mock coordinator;
    TaoLedger ledger;
    StripsEngine engine;
    StripsRenderer renderer;
    StripsExtension ext;
    FakeDelegates delegates;
    uint256 subId;

    uint256 signerKey = 0xA11CE;
    address signer;
    address mintface = makeAddr("mintface.eth");
    address ryan = makeAddr("ryanj.eth");
    address payable payoutTo = payable(makeAddr("payout"));
    address estate = makeAddr("mintestate.eth");
    address buyer = makeAddr("buyer");
    address other = makeAddr("other");

    bytes32 constant KEY_HASH = bytes32(uint256(1));
    uint256 constant T0 = 1_795_000_000;
    uint256 nonce;

    function setUp() public virtual {
        vm.warp(T0);
        signer = vm.addr(signerKey);
        vm.startPrank(mintface);
        core = new ERC721Creator("//STRIPS", "STRIPS");
        coordinator = new VRFCoordinatorV2_5Mock(0.1 ether, 1e9, 4e15);
        subId = coordinator.createSubscription();
        coordinator.fundSubscription(subId, 1_000_000 ether);
        vm.deal(mintface, 1_000_000 ether);
        coordinator.fundSubscriptionWithNative{value: 100_000 ether}(subId);
        ledger = new TaoLedger(mintface, 30 days);
        delegates = new FakeDelegates();
        bytes[] memory parts = new bytes[](2);
        parts[0] = hex"1f8b0800aabbcc";
        parts[1] = hex"ddeeff";
        engine = new StripsEngine(parts);
        renderer = new StripsRenderer(engine);
        ext = new StripsExtension(
            address(core),
            ledger,
            delegates,
            estate,
            payoutTo,
            signer,
            IStripsRenderer(address(renderer)),
            address(coordinator),
            StripsExtension.VrfConfig({
                keyHash: KEY_HASH,
                subId: subId,
                confirmations: 3,
                callbackGas: 100_000,
                native: true
            })
        );
        coordinator.addConsumer(subId, address(ext));
        ledger.setMinter(address(ext));
        core.registerExtension(address(ext), "");
        ext.setArtist(ryan);
        firstSnapshot();
        ext.setMintOpen(true);
        vm.stopPrank();
        vm.deal(buyer, 100 ether);
        vm.deal(other, 100 ether);
    }

    /// @dev The mint can't open without a snapshot. Runs as mintface.eth.
    function firstSnapshot() internal virtual {
        ledger.publishSnapshot(bytes32(uint256(1)), uint64(T0), 0, "ar://table", "Snapshot 1");
    }

    /* ---------- designs ---------- */

    /// @dev Three colours and a band list made different by `salt`, red line 16th.
    function design(uint256 salt) internal pure returns (bytes memory) {
        return shaped(salt, 60, 240, false, 16, 24);
    }

    function shaped(uint256 salt, uint16 width, uint16 length, bool portrait, uint256 redAt, uint256 bands)
        internal
        pure
        returns (bytes memory d)
    {
        d = abi.encodePacked(
            uint8(portrait ? 1 : 0), length, width, uint8(3), uint24(salt), uint24(0x80e080), uint24(0x0e5890)
        );
        for (uint256 i; i < bands; ++i) {
            uint8 height = uint8(1 + (i * 7 + salt) % 5);
            uint8 colour = i + 1 == redAt ? 15 : uint8(i % 3);
            d = abi.encodePacked(d, (colour << 4) | height);
        }
    }

    /* ---------- vouchers ---------- */

    function voucherFor(bytes memory d, address to)
        internal
        returns (StripsExtension.Voucher memory v, bytes memory sig)
    {
        v = StripsExtension.Voucher(to, keccak256(d), ++nonce, block.timestamp + 1 hours);
        sig = sign(v, signerKey);
    }

    function sign(StripsExtension.Voucher memory v, uint256 key) internal view returns (bytes memory) {
        bytes32 typeHash = keccak256("Voucher(address to,bytes32 designHash,uint256 nonce,uint256 deadline)");
        bytes32 structHash = keccak256(abi.encode(typeHash, v.to, v.designHash, v.nonce, v.deadline));
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("//STRIPS"),
                keccak256("1"),
                block.chainid,
                address(ext)
            )
        );
        (uint8 r, bytes32 s, bytes32 t) = vm.sign(key, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(s, t, r);
    }

    function mintAs(address who, uint256 salt) internal returns (uint256 id) {
        bytes memory d = design(salt);
        (StripsExtension.Voucher memory v, bytes memory sig) = voucherFor(d, who);
        vm.prank(who);
        id = ext.mint{value: 0.009 ether}(d, v, sig);
    }

    /// @dev Land the VRF word for the most recent request.
    function land(uint256 requestId, uint256 word) internal {
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        coordinator.fulfillRandomWordsWithOverride(requestId, address(ext), words);
    }

    /* ---------- merkle ---------- */

    function hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }
}
