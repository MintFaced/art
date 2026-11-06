// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {stdStorage, StdStorage} from "forge-std/Test.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {Base} from "./Base.t.sol";
import {StripsExtension, IDelegateRegistry} from "../src/StripsExtension.sol";
import {IStripsRenderer} from "../src/IStripsRenderer.sol";
import {TaoLedger} from "../src/TaoLedger.sol";

/// @dev A buyer that does everything it can from inside the safeMint callback.
contract Fidget is IERC721Receiver {
    StripsExtension ext;
    IERC721 core;
    address friend;
    bool public burnRefused;
    bool public viewChanged;
    bool public passedOn;

    constructor(StripsExtension ext_, IERC721 core_, address friend_) {
        ext = ext_;
        core = core_;
        friend = friend_;
    }

    function mint(bytes calldata d, StripsExtension.Voucher calldata v, bytes calldata s) external {
        ext.mint{value: 0.009 ether}(d, v, s);
    }

    function onERC721Received(address, address, uint256 id, bytes calldata) external returns (bytes4) {
        (bool burned,) = address(core).call(abi.encodeWithSignature("burn(uint256)", id));
        burnRefused = !burned;
        try ext.setView(id, 1) {
            viewChanged = true;
        } catch {}
        try core.transferFrom(address(this), friend, id) {
            passedOn = true;
        } catch {}
        return this.onERC721Received.selector;
    }

    receive() external payable {}
}

/// @notice The free mints are held back from the public allowance, and the
///         claim window and owner mints that go with that.
contract ReserveTest is Base {
    using stdStorage for StdStorage;

    StdStorage store;
    bytes32 leafA;
    bytes32 leafB;

    uint256 constant CAP = 621;
    uint256 constant DEADLINE = T0 + 30 days;

    /* the ledger's view of a pool, for a ledger with no extension behind it */
    uint256 public constant PUBLIC_CAP = 621;
    uint256 public publicMinted;

    function firstSnapshot() internal override {
        leafA = ledger.leaf(buyer, 500_000, 2);
        leafB = ledger.leaf(other, 150_000, 1);
        ledger.publishSnapshot(hashPair(leafA, leafB), uint64(T0), 3, "ar://table", "Snapshot 1");
    }

    /// @dev The public counter at n, without paying for n mints.
    function fill(uint256 n) internal {
        store.target(address(ext)).sig("publicMinted()").checked_write(n);
    }

    function proofFor(bytes32 sibling) internal pure returns (bytes32[] memory p) {
        p = new bytes32[](1);
        p[0] = sibling;
    }

    function claimA(uint256 salt) internal returns (uint256) {
        return claimAs(buyer, salt, 500_000, 2, leafB);
    }

    function claimB(uint256 salt) internal returns (uint256) {
        return claimAs(other, salt, 150_000, 1, leafA);
    }

    function claimAs(address who, uint256 salt, uint256 tao, uint256 mints, bytes32 sibling)
        internal
        returns (uint256)
    {
        bytes memory d = design(salt);
        (StripsExtension.Voucher memory v, bytes memory s) = voucherFor(d, who);
        vm.prank(who);
        return ext.mintFree(d, v, s, tao, mints, proofFor(sibling));
    }

    function refusedPaid(uint256 salt) internal {
        bytes memory d = design(salt);
        (StripsExtension.Voucher memory v, bytes memory s) = voucherFor(d, buyer);
        vm.prank(buyer);
        vm.expectRevert(StripsExtension.PublicSoldOut.selector);
        ext.mint{value: 0.009 ether}(d, v, s);
    }

    /* ---------- the reserve ---------- */

    function test_reserve_aRealSellOutLeavesEveryClaimStanding() public {
        for (uint256 i = 1; i <= CAP - 3; ++i) mintAs(buyer, i);
        assertEq(ext.publicMinted(), CAP - 3);
        refusedPaid(10_000);

        vm.warp(DEADLINE);
        claimA(10_001);
        claimA(10_002);
        claimB(10_003);
        assertEq(ext.publicMinted(), CAP, "every claim landed, on the last second of the window");
        assertEq(ledger.unclaimedReserve(), 0);
    }

    function test_reserve_fallsAsClaimsLand_andAClaimOpensNoPaidRoom() public {
        fill(CAP - 3);
        assertEq(ledger.unclaimedReserve(), 3);
        claimA(1);
        assertEq(ledger.unclaimedReserve(), 2);
        assertEq(ext.publicMinted(), CAP - 2);
        refusedPaid(2);
        claimB(3);
        assertEq(ledger.unclaimedReserve(), 1);
        refusedPaid(4);
    }

    function test_reserve_leavesPaidRoomUpToTheLine() public {
        fill(CAP - 4);
        mintAs(buyer, 1);
        assertEq(ext.publicMinted(), CAP - 3);
        refusedPaid(2);
    }

    function test_reserve_releasesTheMomentTheWindowCloses() public {
        fill(CAP - 3);
        claimA(1); // two stay unclaimed

        vm.warp(DEADLINE);
        assertEq(ledger.unclaimedReserve(), 2, "the last second is still the window");
        refusedPaid(2);

        vm.warp(DEADLINE + 1);
        assertEq(ledger.unclaimedReserve(), 0);
        mintAs(buyer, 3);
        mintAs(buyer, 4);
        assertEq(ext.publicMinted(), CAP);
        refusedPaid(5);
    }

    function test_reserve_holdsAgainstTheOwnerToo() public {
        fill(CAP - 3);
        vm.prank(mintface);
        vm.expectRevert(StripsExtension.PublicSoldOut.selector);
        ext.ownerMint(design(1), other);
        vm.prank(ryan);
        vm.expectRevert(StripsExtension.PublicSoldOut.selector);
        ext.ownerMint(design(1), ryan);
    }

    function test_reserve_aPublishCantPromiseMoreThanIsLeft() public {
        fill(CAP - 2);
        vm.startPrank(mintface);
        uint256 big = ledger.publishSnapshot(bytes32(uint256(7)), uint64(T0), 3, "ar://big", "too big");
        uint256 fits = ledger.publishSnapshot(bytes32(uint256(8)), uint64(T0), 2, "ar://fits", "fits");
        vm.expectRevert(TaoLedger.ReserveTooBig.selector);
        ledger.setClaimSnapshot(big);
        ledger.setClaimSnapshot(fits);
        vm.stopPrank();
        assertEq(ledger.unclaimedReserve(), 2);
    }

    function test_reserve_aFirstPublishIsCheckedToo() public {
        (TaoLedger l,) = freshStack();
        vm.expectRevert(TaoLedger.ReserveTooBig.selector);
        l.publishSnapshot(bytes32(uint256(1)), uint64(T0), 622, "ar://t", "too big");
        l.publishSnapshot(bytes32(uint256(1)), uint64(T0), 621, "ar://t", "all of it");
        assertEq(l.unclaimedReserve(), 621);
    }

    function test_reserve_aPublishNeedsAMinterToReadThePoolFrom() public {
        TaoLedger l = new TaoLedger(address(this), 30 days);
        vm.expectRevert(TaoLedger.NoMinter.selector);
        l.publishSnapshot(bytes32(uint256(1)), uint64(T0), 1, "ar://t", "t");
    }

    function test_reserve_anUnderstatedFigureDoesntRefuseAClaimWhileThereIsSupply() public {
        vm.startPrank(mintface);
        uint256 low = ledger.publishSnapshot(hashPair(leafA, leafB), uint64(T0), 1, "ar://low", "understated");
        ledger.setClaimSnapshot(low);
        vm.stopPrank();
        claimA(1);
        claimA(2);
        assertEq(ledger.unclaimedReserve(), 0, "it stops at zero rather than underflowing");
        claimB(3);
    }

    /// forge-config: default.fuzz.runs = 256
    function testFuzz_reserve_holdsThroughAnyOrderOfEvents(uint256 seed, uint8 start) public {
        fill(CAP - 3 - bound(start, 0, 12));
        address[3] memory owners = [mintface, ryan, buyer];
        for (uint256 i; i < 40; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            uint256 salt = 1000 + i;
            uint256 op = r % 6;
            if (op == 0) {
                bytes memory d = design(salt);
                (StripsExtension.Voucher memory v, bytes memory s) = voucherFor(d, buyer);
                vm.prank(buyer);
                try ext.mint{value: 0.009 ether}(d, v, s) {} catch {}
            } else if (op == 1) {
                vm.prank(owners[(r >> 8) % 3]);
                try ext.ownerMint(design(salt), other) {} catch {}
            } else if (op == 2 || op == 3) {
                bool a = op == 2;
                bytes memory d = design(salt);
                address who = a ? buyer : other;
                (StripsExtension.Voucher memory v, bytes memory s) = voucherFor(d, who);
                vm.prank(who);
                try ext.mintFree(d, v, s, a ? 500_000 : 150_000, a ? 2 : 1, proofFor(a ? leafB : leafA)) {} catch {}
            } else if (op == 4) {
                vm.warp(block.timestamp + (r >> 8) % 12 days);
            } else {
                vm.prank(mintface);
                try ledger.extendClaim(uint64(block.timestamp + 1 + (r >> 8) % 40 days)) {} catch {}
            }
            assertLe(ext.publicMinted() + ledger.unclaimedReserve(), CAP);
            assertLe(ext.publicMinted() + ext.streetMinted(), 690);
        }
        /* whoever's still owed can claim, as long as the window's open */
        if (block.timestamp <= ledger.claimDeadline()) {
            while (ledger.claimed(1, buyer) < 2) claimA(5000 + ledger.claimed(1, buyer));
            if (ledger.claimed(1, other) < 1) claimB(5100);
        }
    }

    /* ---------- owner mints ---------- */

    function test_ownerMint_bothWalletsMintFreeWithNoAllowlist() public {
        uint256 before = payoutTo.balance;
        vm.prank(mintface);
        uint256 a = ext.ownerMint(design(1), mintface);
        vm.prank(ryan);
        uint256 b = ext.ownerMint(design(2), ryan);
        assertEq(core.ownerOf(a), mintface);
        assertEq(core.ownerOf(b), ryan);
        assertEq(ext.publicMinted(), 2);
        assertEq(payoutTo.balance, before, "no price");
        assertEq(ledger.totalClaimed(), 0, "no allowance spent");
    }

    function test_ownerMint_worksBeforeThePublicOpens() public {
        vm.startPrank(mintface);
        ext.setMintOpen(false);
        uint256 id = ext.ownerMint(design(1), mintface);
        vm.stopPrank();
        assertEq(core.ownerOf(id), mintface);
    }

    function test_ownerMint_aSecondWalletCanBeTakenAway() public {
        vm.prank(buyer);
        vm.expectRevert("Only callable by owner");
        ext.setArtist(buyer);
        vm.prank(mintface);
        ext.setArtist(address(0));
        vm.prank(ryan);
        vm.expectRevert(StripsExtension.NotOwnerMinter.selector);
        ext.ownerMint(design(1), ryan);
    }

    function test_ownerMint_followsTheOwnerNotAnAddress() public {
        vm.prank(mintface);
        ext.transferOwnership(other);
        vm.prank(other);
        ext.acceptOwnership();
        vm.prank(mintface);
        vm.expectRevert(StripsExtension.NotOwnerMinter.selector);
        ext.ownerMint(design(1), mintface);
    }

    function test_ownerMint_refusesABadDesignAndATakenOne() public {
        vm.startPrank(mintface);
        vm.expectRevert();
        ext.ownerMint(hex"00", mintface);
        ext.ownerMint(design(1), mintface);
        vm.expectRevert(StripsExtension.DesignTaken.selector);
        ext.ownerMint(design(1), mintface);
        vm.stopPrank();
    }

    function test_artist_stopsAt69_andTheOwnerDoesnt() public {
        vm.startPrank(ryan);
        for (uint256 i = 1; i <= 69; ++i) ext.ownerMint(design(i), ryan);
        assertEq(ext.artistMinted(), 69);
        vm.expectRevert(StripsExtension.ArtistCapReached.selector);
        ext.ownerMint(design(70), ryan);
        vm.stopPrank();
        vm.prank(mintface);
        ext.ownerMint(design(70), mintface);
        assertEq(ext.artistMinted(), 69, "the owner's mints aren't counted");
        assertEq(ext.publicMinted(), 70);
    }

    function test_artist_aNewWalletDoesntStartTheCountAgain() public {
        store.target(address(ext)).sig("artistMinted()").checked_write(uint256(69));
        vm.prank(mintface);
        ext.setArtist(other);
        vm.prank(other);
        vm.expectRevert(StripsExtension.ArtistCapReached.selector);
        ext.ownerMint(design(1), other);
    }

    function test_artist_aRefusedMintIsntCounted() public {
        vm.startPrank(ryan);
        ext.ownerMint(design(1), ryan);
        vm.expectRevert(StripsExtension.DesignTaken.selector);
        ext.ownerMint(design(1), ryan);
        vm.stopPrank();
        assertEq(ext.artistMinted(), 1);
    }

    /// @dev A stolen ryanj.eth key, at its worst, before the snapshot: there's still
    ///      room for a table far bigger than the real one, and claims stand.
    function test_artist_aStolenKeyLeavesRoomForAnyTable() public {
        vm.startPrank(ryan);
        for (uint256 i = 1; i <= 69; ++i) ext.ownerMint(design(i), ryan);
        vm.stopPrank();
        vm.startPrank(mintface);
        uint256 id = ledger.publishSnapshot(hashPair(leafA, leafB), uint64(T0), 552, "ar://t", "after the theft");
        ledger.setClaimSnapshot(id);
        vm.stopPrank();
        assertEq(ledger.unclaimedReserve(), 552);
        claimAs(buyer, 1000, 500_000, 2, leafB);
    }

    function test_cap_noPathMintsPast690() public {
        fill(CAP);
        store.target(address(ext)).sig("streetMinted()").checked_write(uint256(69));
        assertEq(ext.publicMinted() + ext.streetMinted(), 690);

        refusedPaid(1);
        vm.prank(mintface);
        vm.expectRevert(StripsExtension.PublicSoldOut.selector);
        ext.ownerMint(design(2), mintface);
        vm.prank(ryan);
        vm.expectRevert(StripsExtension.PublicSoldOut.selector);
        ext.ownerMint(design(3), ryan);
        vm.prank(mintface);
        vm.expectRevert(StripsExtension.StreetFull.selector);
        ext.mintStreet(design(4), 1, "320 West");

        bytes memory d = design(5);
        (StripsExtension.Voucher memory v, bytes memory s) = voucherFor(d, buyer);
        vm.prank(buyer);
        vm.expectRevert(StripsExtension.PublicSoldOut.selector);
        ext.mintFree(d, v, s, 500_000, 2, proofFor(leafB));
    }

    /* ---------- opening ---------- */

    function test_open_needsASnapshot() public {
        (TaoLedger l, StripsExtension e) = freshStack();
        vm.expectRevert(StripsExtension.NoSnapshot.selector);
        e.setMintOpen(true);
        e.setMintOpen(false);
        l.publishSnapshot(bytes32(uint256(1)), uint64(T0), 0, "ar://t", "t");
        e.setMintOpen(true);
        assertTrue(e.mintOpen());
    }

    /* ---------- the claim window ---------- */

    function test_window_comesFromTheConstructor() public {
        TaoLedger l = new TaoLedger(address(this), 1 hours);
        l.setMinter(address(this));
        assertEq(l.CLAIM_WINDOW(), 1 hours);
        l.publishSnapshot(bytes32(uint256(1)), uint64(T0), 3, "ar://t", "t");
        assertEq(l.claimDeadline(), T0 + 1 hours);
    }

    function test_extend_movesLater_neverSooner() public {
        vm.startPrank(mintface);
        vm.expectRevert(TaoLedger.BadDeadline.selector);
        ledger.extendClaim(uint64(DEADLINE));
        vm.expectRevert(TaoLedger.BadDeadline.selector);
        ledger.extendClaim(uint64(DEADLINE - 1));
        ledger.extendClaim(uint64(DEADLINE + 10 days));
        assertEq(ledger.claimDeadline(), DEADLINE + 10 days);
        vm.expectRevert(TaoLedger.BadDeadline.selector);
        ledger.extendClaim(uint64(DEADLINE + 5 days));
        vm.stopPrank();
    }

    function test_extend_aSlipOfTheKeyboardDoesntReachFar() public {
        vm.startPrank(mintface);
        vm.expectRevert(TaoLedger.BadDeadline.selector);
        ledger.extendClaim(uint64(T0 * 1000)); // milliseconds
        ledger.extendClaim(uint64(T0 + 365 days));
        vm.stopPrank();
    }

    function test_extend_needsAClaim() public {
        (TaoLedger l,) = freshStack();
        vm.expectRevert(TaoLedger.NoSuchSnapshot.selector);
        l.extendClaim(uint64(T0 + 1 days));
    }

    function test_extend_worksAfterTheFirstClaim_whichFreezesOnlyTheRoot() public {
        claimA(1);
        vm.startPrank(mintface);
        vm.expectRevert(TaoLedger.ClaimsStarted.selector);
        ledger.setClaimSnapshot(1);
        ledger.extendClaim(uint64(DEADLINE + 1 days));
        vm.stopPrank();
        assertEq(ledger.claimDeadline(), DEADLINE + 1 days);
    }

    /// @dev Claims start, an incident closes the mint, the fix runs past the
    ///      deadline, and everyone can still claim.
    function test_extend_recoversAWindowThatRanOutWhileClosed() public {
        claimA(1);
        vm.prank(mintface);
        ext.setMintOpen(false);

        vm.warp(DEADLINE + 1 days);
        assertEq(ledger.unclaimedReserve(), 0, "released");
        vm.startPrank(mintface);
        ledger.extendClaim(uint64(block.timestamp + 10 days));
        ext.setMintOpen(true);
        vm.stopPrank();
        assertEq(ledger.unclaimedReserve(), 2, "held back again");
        claimA(2);
        claimB(3);
    }

    function test_extend_refusedIfTheReleasedReserveHasBeenSold() public {
        fill(CAP - 3);
        claimA(1);
        vm.warp(DEADLINE + 1);
        mintAs(buyer, 2); // two owed, one left to give

        vm.prank(mintface);
        vm.expectRevert(TaoLedger.ReserveTooBig.selector);
        ledger.extendClaim(uint64(block.timestamp + 10 days));
        assertEq(ledger.unclaimedReserve(), 0);
    }

    function test_correction_neverShortensAnExtendedDeadline() public {
        vm.startPrank(mintface);
        ledger.extendClaim(uint64(DEADLINE + 60 days));
        uint256 fixedOne = ledger.publishSnapshot(bytes32(uint256(7)), uint64(T0), 3, "ar://fixed", "corrected");
        ledger.setClaimSnapshot(fixedOne);
        vm.stopPrank();
        assertEq(ledger.claimDeadline(), DEADLINE + 60 days);
        assertEq(ledger.snapshot(1).claimUntil, 0, "the old table is no longer claimable");
    }

    function test_correction_pointedAtLateStillGetsAWholeWindow() public {
        vm.startPrank(mintface);
        uint256 fixedOne = ledger.publishSnapshot(bytes32(uint256(7)), uint64(T0), 3, "ar://fixed", "corrected");
        vm.warp(T0 + 40 days);
        ledger.setClaimSnapshot(fixedOne);
        vm.stopPrank();
        assertEq(ledger.claimDeadline(), T0 + 70 days);
    }

    /* ---------- the ledger's owner ---------- */

    function test_ledger_ownershipTakesTwoSteps_andCantBeRenounced() public {
        vm.prank(mintface);
        ledger.transferOwnership(other);
        assertEq(ledger.owner(), mintface);
        vm.prank(other);
        ledger.acceptOwnership();
        assertEq(ledger.owner(), other);
        (bool renounced,) = address(ledger).call(abi.encodeWithSignature("renounceOwnership()"));
        assertFalse(renounced);
    }

    function test_ledger_theMinterIsSetOnce() public {
        vm.prank(mintface);
        vm.expectRevert(TaoLedger.MinterSet.selector);
        ledger.setMinter(buyer);
    }

    /* ---------- settings that can't be undone by accident ---------- */

    function test_settings_refuseNothing() public {
        vm.startPrank(mintface);
        vm.expectRevert(bytes4(keccak256("ZeroAddress()")));
        ext.setPayout(payable(address(0)));
        vm.expectRevert(StripsExtension.NotARenderer.selector);
        ext.setRenderer(IStripsRenderer(address(0)));
        vm.expectRevert(StripsExtension.NotARenderer.selector);
        ext.setRenderer(IStripsRenderer(buyer));
        vm.stopPrank();
    }

    function test_constructor_refusesNoEstateAndNoPayout() public {
        StripsExtension.VrfConfig memory c = StripsExtension.VrfConfig(KEY_HASH, subId, 3, 100_000, true);
        vm.expectRevert(bytes4(keccak256("ZeroAddress()")));
        new StripsExtension(
            address(core), ledger, delegates, address(0), payoutTo, signer, renderer, address(coordinator), c
        );
        vm.expectRevert(bytes4(keccak256("ZeroAddress()")));
        new StripsExtension(
            address(core), ledger, delegates, estate, payable(address(0)), signer, renderer, address(coordinator), c
        );
    }

    function test_setVrf_leavesARecord() public {
        StripsExtension.VrfConfig memory c = StripsExtension.VrfConfig(KEY_HASH, subId, 5, 200_000, false);
        vm.expectEmit(address(ext));
        emit StripsExtension.VrfChanged(KEY_HASH, subId, 5, 200_000, false);
        vm.prank(mintface);
        ext.setVrf(c);
    }

    /* ---------- the mint callback ---------- */

    function test_callback_whatsReachableLeavesTheTokenWhole() public {
        Fidget f = new Fidget(ext, IERC721(address(core)), other);
        vm.deal(address(f), 1 ether);
        bytes memory d = design(1);
        (StripsExtension.Voucher memory v, bytes memory s) = voucherFor(d, address(f));
        f.mint(d, v, s);
        assertTrue(f.burnRefused(), "the core's guard");
        assertTrue(f.viewChanged());
        assertTrue(f.passedOn());
        assertEq(core.ownerOf(1), other);
        assertEq(ext.tokenOf(1).viewIndex, 0, "the mint writes after the callback");
        assertEq(ext.tokenOf(1).heldSince, block.timestamp);
        assertEq(ext.publicMinted(), 1);
        core.tokenURI(1);
    }

    /// @dev A ledger and extension with no snapshot on them. This contract owns
    ///      both and is the one calling.
    function freshStack() internal returns (TaoLedger l, StripsExtension e) {
        l = new TaoLedger(address(this), 30 days);
        e = new StripsExtension(
            address(core),
            l,
            IDelegateRegistry(address(delegates)),
            estate,
            payoutTo,
            signer,
            IStripsRenderer(address(renderer)),
            address(coordinator),
            StripsExtension.VrfConfig(KEY_HASH, subId, 3, 100_000, true)
        );
        l.setMinter(address(e));
    }
}
