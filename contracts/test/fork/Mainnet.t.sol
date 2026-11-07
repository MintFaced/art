// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Base64} from "solady/utils/Base64.sol";
import {LibString} from "solady/utils/LibString.sol";
import {StripsExtension, IDelegateRegistry} from "../../src/StripsExtension.sol";
import {StripsRenderer} from "../../src/StripsRenderer.sol";
import {StripsEngine} from "../../src/StripsEngine.sol";
import {IStripsRenderer} from "../../src/IStripsRenderer.sol";
import {TaoLedger} from "../../src/TaoLedger.sol";

interface ICore {
    function registerExtension(address extension, string calldata baseURI) external;
    function setRoyalties(address payable[] calldata receivers, uint256[] calldata basisPoints) external;
    function tokenURI(uint256 id) external view returns (string memory);
    function royaltyInfo(uint256 id, uint256 value) external view returns (address, uint256);
    function supportsInterface(bytes4 id) external view returns (bool);
}

interface ICoordinator {
    function createSubscription() external returns (uint256);
    function addConsumer(uint256 subId, address consumer) external;
    function fundSubscriptionWithNative(uint256 subId) external payable;
}

interface IRealDelegates {
    function delegateERC721(address to, address contract_, uint256 tokenId, bytes32 rights, bool enable)
        external
        payable
        returns (bytes32);
    function delegateAll(address to, bytes32 rights, bool enable) external payable returns (bytes32);
}

/// @notice Against what's really on mainnet: the Manifold implementation behind
///         Geodetic World, the live VRF v2.5 coordinator and delegate.xyz.
contract MainnetForkTest is Test {
    address constant MANIFOLD_IMPL = 0x5133522ea5A0494EcB83F26311A095DDD7a9D4b6;
    address constant COORDINATOR = 0xD7f86b4b8Cae7D942340FF628F82735b7a20893a;
    address constant DELEGATES = 0x00000000000000447e69651d841bD8D104Bed493;
    bytes32 constant LANE_500 = 0x3fd2fec10d06ee8f65e7f2e95f5c56511359ece3f33960ad8a866ae24a8ff10b;
    address constant MINTFACE = 0xd40B63bF04a44e43fBFE5784bCf22ACaAB34a180;
    address constant ESTATE = 0x6e420B64bb329bE84a6627c68A7BdFf825139773;

    ICore core;
    StripsExtension ext;
    TaoLedger ledger;
    StripsRenderer renderer;
    uint256 signerKey = 0xA11CE;
    address buyer = makeAddr("buyer");
    address friend = makeAddr("friend");
    uint256 subId;

    function setUp() public {
        vm.createSelectFork(vm.envOr("FORK_URL", string("https://ethereum-rpc.publicnode.com")));
        vm.deal(MINTFACE, 100 ether);
        vm.deal(buyer, 10 ether);
        vm.startPrank(MINTFACE);
        core = ICore(
            address(
                new ERC1967Proxy(MANIFOLD_IMPL, abi.encodeWithSignature("initialize(string,string)", "//STRIPS", "STRIPS"))
            )
        );
        subId = ICoordinator(COORDINATOR).createSubscription();
        ICoordinator(COORDINATOR).fundSubscriptionWithNative{value: 5 ether}(subId);
        ledger = new TaoLedger(MINTFACE, 30 days);
        bytes[] memory parts = new bytes[](1);
        parts[0] = vm.readFileBinary("build/engine.js.gz");
        renderer = new StripsRenderer(new StripsEngine(parts));
        ext = new StripsExtension(
            address(core),
            ledger,
            IDelegateRegistry(DELEGATES),
            ESTATE,
            payable(MINTFACE),
            vm.addr(signerKey),
            IStripsRenderer(address(renderer)),
            COORDINATOR,
            StripsExtension.VrfConfig({keyHash: LANE_500, subId: subId, confirmations: 3, callbackGas: 100_000, native: true})
        );
        ICoordinator(COORDINATOR).addConsumer(subId, address(ext));
        ledger.setMinter(address(ext));
        core.registerExtension(address(ext), "");
        address payable[] memory to = new address payable[](1);
        to[0] = payable(MINTFACE);
        uint256[] memory bps = new uint256[](1);
        bps[0] = 500;
        core.setRoyalties(to, bps);
        ledger.publishSnapshot(bytes32(uint256(1)), uint64(block.timestamp), 0, "ar://table", "Snapshot 1");
        ext.setMintOpen(true);
        vm.stopPrank();
    }

    function design(uint256 salt) internal pure returns (bytes memory d) {
        d = abi.encodePacked(uint8(0), uint16(240), uint16(60), uint8(12));
        for (uint256 i; i < 12; ++i) d = abi.encodePacked(d, uint24(0xABCDEF - i - salt * 16));
        for (uint256 i; i < 55; ++i) d = abi.encodePacked(d, uint8(i == 15 ? 0xF2 : ((i % 12) << 4) | 1 + (i % 4)));
    }

    function mintOne(uint256 salt) internal returns (uint256 id) {
        bytes memory d = design(salt);
        StripsExtension.Voucher memory v = StripsExtension.Voucher(buyer, keccak256(d), salt, block.timestamp + 1 hours);
        bytes32 typeHash = keccak256("Voucher(address to,bytes32 designHash,uint256 nonce,uint256 deadline)");
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("//STRIPS"),
                keccak256("1"),
                block.chainid,
                address(ext)
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01", domain, keccak256(abi.encode(typeHash, v.to, v.designHash, v.nonce, v.deadline))
            )
        );
        (uint8 r, bytes32 s, bytes32 t) = vm.sign(signerKey, digest);
        vm.prank(buyer);
        uint256 start = gasleft();
        id = ext.mint{value: 0.009 ether}(d, v, abi.encodePacked(s, t, r));
        emit log_named_uint("mint gas on the real core and coordinator", start - gasleft());
    }

    function test_theRealCoreIsAnErc721() public view {
        assertTrue(core.supportsInterface(0x80ac58cd));
    }

    function test_vrf_theRealCoordinatorTakesTheRequest_andOnlyItAnswers() public {
        uint256 id = mintOne(1);
        assertEq(ext.seedOf(id), 0);
        uint256[] memory words = new uint256[](1);
        words[0] = uint256(keccak256("word"));
        vm.expectRevert();
        ext.rawFulfillRandomWords(1, words);
        vm.prank(MINTFACE);
        uint256 requestId = ext.retrySeed(id);
        vm.prank(COORDINATOR);
        ext.rawFulfillRandomWords(requestId, words);
        assertEq(ext.seedOf(id), words[0]);
    }

    function test_clock_transferAndSafeTransferBothFire() public {
        uint256 id = mintOne(1);
        assertEq(ext.tokenOf(id).heldSince, block.timestamp);
        vm.warp(block.timestamp + 10 days);
        assertEq(ext.taoOf(id), 420);
        vm.prank(buyer);
        IERC721(address(core)).transferFrom(buyer, friend, id);
        assertEq(ext.tokenOf(id).heldSince, block.timestamp);
        vm.warp(block.timestamp + 1 days);
        vm.prank(friend);
        IERC721(address(core)).safeTransferFrom(friend, buyer, id);
        assertEq(ext.tokenOf(id).heldSince, block.timestamp);
    }

    function test_delegates_theRealRegistry_allAndScoped() public {
        uint256 id = mintOne(1);
        vm.prank(friend);
        vm.expectRevert(StripsExtension.NotHolder.selector);
        ext.setView(id, 1);

        vm.prank(buyer);
        IRealDelegates(DELEGATES).delegateAll(friend, bytes32("mintface"), true);
        vm.prank(friend);
        ext.setView(id, 1);
        assertEq(ext.tokenOf(id).viewIndex, 1);

        vm.prank(buyer);
        IRealDelegates(DELEGATES).delegateAll(friend, bytes32("mintface"), false);
        vm.prank(friend);
        vm.expectRevert(StripsExtension.NotHolder.selector);
        ext.setView(id, 0);

        vm.prank(buyer);
        IRealDelegates(DELEGATES).delegateERC721(friend, address(core), id, bytes32(0), true);
        vm.prank(friend);
        ext.setView(id, 0);
        assertEq(ext.tokenOf(id).viewIndex, 0);
    }

    function test_uri_throughTheRealCore_andItsCost() public {
        uint256 id = mintOne(1);
        uint256 start = gasleft();
        string memory uri = core.tokenURI(id);
        uint256 used = start - gasleft();
        emit log_named_uint("tokenURI gas through the real core", used);
        assertLt(used, 30_000_000);
        string memory j = string(Base64.decode(LibString.slice(uri, 29)));
        assertEq(vm.parseJsonString(j, ".name"), "//STRIPS #1");
        assertTrue(LibString.contains(vm.parseJsonString(j, ".animation_url"), "data:text/html;base64,"));
    }

    function test_royalty_fivePercentToMintface_onAnExtensionToken() public {
        uint256 id = mintOne(1);
        (address to, uint256 amount) = core.royaltyInfo(id, 1 ether);
        assertEq(to, MINTFACE);
        assertEq(amount, 0.05 ether);
    }

    function test_street_toTheRealEstate() public {
        vm.prank(MINTFACE);
        uint256 id = ext.mintStreet(design(9), 5, "300 West Laneway");
        assertEq(IERC721(address(core)).ownerOf(id), ESTATE);
    }
}
