// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ICreatorExtensionTokenURI} from
    "@manifoldxyz/creator-core-solidity/contracts/extensions/ICreatorExtensionTokenURI.sol";
import {IERC721CreatorExtensionApproveTransfer} from
    "@manifoldxyz/creator-core-solidity/contracts/extensions/ERC721/IERC721CreatorExtensionApproveTransfer.sol";
import {Base, StripsExtension, IStripsRenderer, StripsRenderer} from "./Base.t.sol";
import {StripsDesign} from "../src/StripsDesign.sol";
import {TaoLedger} from "../src/TaoLedger.sol";

contract Hostile is IERC721Receiver {
    StripsExtension ext;
    bytes design;
    StripsExtension.Voucher voucher;
    bytes sig;
    bool public tried;
    bool public reentered;

    constructor(StripsExtension ext_) {
        ext = ext_;
    }

    function arm(bytes memory d, StripsExtension.Voucher memory v, bytes memory s) external {
        design = d;
        voucher = v;
        sig = s;
    }

    function go(bytes calldata d, StripsExtension.Voucher calldata v, bytes calldata s) external payable {
        ext.mint{value: 0.009 ether}(d, v, s);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (!tried) {
            tried = true;
            try ext.mint{value: 0.009 ether}(design, voucher, sig) {
                reentered = true;
            } catch {}
        }
        return this.onERC721Received.selector;
    }

    receive() external payable {}
}

contract Refuser {
    receive() external payable {
        revert("no");
    }
}

contract MintTest is Base {
    function test_mint_paysStoresAndAsksForAWord() public {
        uint256 before = payoutTo.balance;
        uint256 id = mintAs(buyer, 1);
        assertEq(id, 1);
        assertEq(core.ownerOf(id), buyer);
        assertEq(payoutTo.balance - before, 0.009 ether, "ETH forwarded in the same transaction");
        assertEq(address(ext).balance, 0);
        assertEq(ext.designOf(id), design(1));
        assertTrue(ext.designUsed(keccak256(design(1))));
        assertEq(ext.publicMinted(), 1);
        assertEq(ext.tokenOf(id).heldSince, block.timestamp, "the clock starts at mint");
        assertEq(ext.tokenOf(id).mintedAt, block.timestamp);
        assertEq(ext.requestToken(1), id);
        assertEq(ext.seedOf(id), 0);
    }

    function test_mint_revertsWhenClosed() public {
        vm.prank(mintface);
        ext.setMintOpen(false);
        bytes memory d = design(1);
        (StripsExtension.Voucher memory v, bytes memory s) = voucherFor(d, buyer);
        vm.prank(buyer);
        vm.expectRevert(StripsExtension.MintClosed.selector);
        ext.mint{value: 0.009 ether}(d, v, s);
    }

    function test_mint_revertsOnWrongPrice() public {
        bytes memory d = design(1);
        (StripsExtension.Voucher memory v, bytes memory s) = voucherFor(d, buyer);
        vm.startPrank(buyer);
        vm.expectRevert(StripsExtension.WrongPrice.selector);
        ext.mint{value: 0.008 ether}(d, v, s);
        vm.expectRevert(StripsExtension.WrongPrice.selector);
        ext.mint{value: 0.01 ether}(d, v, s);
        vm.expectRevert(StripsExtension.WrongPrice.selector);
        ext.mint(d, v, s);
    }

    function test_mint_revertsOnExpiredVoucher() public {
        bytes memory d = design(1);
        (StripsExtension.Voucher memory v, bytes memory s) = voucherFor(d, buyer);
        vm.warp(v.deadline + 1);
        vm.prank(buyer);
        vm.expectRevert(StripsExtension.VoucherExpired.selector);
        ext.mint{value: 0.009 ether}(d, v, s);
    }

    function test_mint_revertsOnAnotherDesign() public {
        (StripsExtension.Voucher memory v, bytes memory s) = voucherFor(design(1), buyer);
        vm.prank(buyer);
        vm.expectRevert(StripsExtension.BadVoucher.selector);
        ext.mint{value: 0.009 ether}(design(2), v, s);
    }

    function test_mint_revertsOnTheWrongSigner() public {
        bytes memory d = design(1);
        (StripsExtension.Voucher memory v,) = voucherFor(d, buyer);
        bytes memory s = sign(v, 0xB0B);
        vm.prank(buyer);
        vm.expectRevert(StripsExtension.BadVoucher.selector);
        ext.mint{value: 0.009 ether}(d, v, s);
    }

    function test_mint_revertsWhenTheVoucherIsChanged() public {
        bytes memory d = design(1);
        (StripsExtension.Voucher memory v, bytes memory s) = voucherFor(d, buyer);
        v.to = other;
        vm.prank(other);
        vm.expectRevert(StripsExtension.BadVoucher.selector);
        ext.mint{value: 0.009 ether}(d, v, s);
    }

    function test_mint_refusesTheSameDesignTwice() public {
        mintAs(buyer, 1);
        bytes memory d = design(1);
        (StripsExtension.Voucher memory v, bytes memory s) = voucherFor(d, other);
        vm.prank(other);
        vm.expectRevert(StripsExtension.DesignTaken.selector);
        ext.mint{value: 0.009 ether}(d, v, s);
    }

    function test_mint_aVoucherOnlyWorksOnce() public {
        bytes memory d = design(1);
        (StripsExtension.Voucher memory v, bytes memory s) = voucherFor(d, buyer);
        vm.startPrank(buyer);
        ext.mint{value: 0.009 ether}(d, v, s);
        vm.expectRevert(StripsExtension.DesignTaken.selector);
        ext.mint{value: 0.009 ether}(d, v, s);
    }

    function test_mint_revertsOnABadDesign() public {
        bytes memory d = hex"00";
        (StripsExtension.Voucher memory v, bytes memory s) = voucherFor(d, buyer);
        vm.prank(buyer);
        vm.expectRevert(StripsDesign.BadDesign.selector);
        ext.mint{value: 0.009 ether}(d, v, s);
    }

    function test_mint_revertsWhenPayoutRefuses() public {
        Refuser r = new Refuser();
        vm.prank(mintface);
        ext.setPayout(payable(address(r)));
        bytes memory d = design(1);
        (StripsExtension.Voucher memory v, bytes memory s) = voucherFor(d, buyer);
        vm.prank(buyer);
        vm.expectRevert(StripsExtension.PayoutFailed.selector);
        ext.mint{value: 0.009 ether}(d, v, s);
    }

    function test_publicCap_stopsAt621_counterSharedWithTwins() public {
        for (uint256 i = 1; i <= 620; ++i) mintAs(buyer, i);
        vm.prank(mintface);
        ext.mintTwin(design(621), other);
        assertEq(ext.publicMinted(), 621);
        bytes memory d = design(622);
        (StripsExtension.Voucher memory v, bytes memory s) = voucherFor(d, buyer);
        vm.prank(buyer);
        vm.expectRevert(StripsExtension.PublicSoldOut.selector);
        ext.mint{value: 0.009 ether}(d, v, s);
        vm.prank(mintface);
        vm.expectRevert(StripsExtension.PublicSoldOut.selector);
        ext.mintTwin(d, other);
        vm.prank(mintface);
        ext.mintStreet(d, 1, "320 West");
        assertEq(ext.streetMinted(), 1, "the public cap leaves the street allowance alone");
    }

    function test_streetCap_stopsAt69_andGoesToTheEstate() public {
        vm.startPrank(mintface);
        for (uint256 i = 1; i <= 69; ++i) {
            uint256 id = ext.mintStreet(design(i), uint16(i), "Somewhere");
            assertEq(core.ownerOf(id), estate);
        }
        vm.expectRevert(StripsExtension.StreetFull.selector);
        ext.mintStreet(design(70), 70, "Somewhere");
        assertEq(ext.publicMinted(), 0);
    }

    function test_street_worksBeforeThePublicOpens_butOnlyForTheOwner() public {
        vm.prank(mintface);
        ext.setMintOpen(false);
        vm.prank(buyer);
        vm.expectRevert("Only callable by owner");
        ext.mintStreet(design(1), 1, "320 West");
        vm.startPrank(mintface);
        vm.expectRevert(StripsExtension.NotStreetWork.selector);
        ext.mintStreet(design(1), 0, "320 West");
        uint256 id = ext.mintStreet(design(1), 5, "300 West Laneway");
        assertEq(ext.streetOf(id).no, 5);
        assertEq(ext.streetOf(id).site, "300 West Laneway");
    }

    function test_twin_isOwnerOnly() public {
        vm.prank(buyer);
        vm.expectRevert("Only callable by owner");
        ext.mintTwin(design(1), buyer);
    }

    function test_reentrancy_aHostileReceiverCannotMintTwice() public {
        Hostile h = new Hostile(ext);
        vm.deal(address(h), 1 ether);
        bytes memory d1 = design(1);
        bytes memory d2 = design(2);
        (StripsExtension.Voucher memory v1, bytes memory s1) = voucherFor(d1, address(h));
        (StripsExtension.Voucher memory v2, bytes memory s2) = voucherFor(d2, address(h));
        h.arm(d2, v2, s2);
        h.go(d1, v1, s1);
        assertTrue(h.tried());
        assertFalse(h.reentered());
        assertEq(ext.publicMinted(), 1);
        assertFalse(ext.designUsed(keccak256(d2)));
    }
}

contract FreeMintTest is Base {
    bytes32 leafA;
    bytes32 leafB;
    bytes32 root;

    function setUp() public override {
        super.setUp();
        leafA = ledger.leaf(buyer, 500_000, 2);
        leafB = ledger.leaf(other, 150_000, 1);
        root = hashPair(leafA, leafB);
        vm.prank(mintface);
        ledger.publishSnapshot(root, uint64(T0 - 1 days), "ar://table", "Snapshot 1");
    }

    function proofFor(bytes32 sibling) internal pure returns (bytes32[] memory p) {
        p = new bytes32[](1);
        p[0] = sibling;
    }

    function free(address who, uint256 salt, uint256 tao, uint256 mints, bytes32 sibling) internal returns (uint256) {
        bytes memory d = design(salt);
        (StripsExtension.Voucher memory v, bytes memory s) = voucherFor(d, who);
        vm.prank(who);
        return ext.mintFree(d, v, s, tao, mints, proofFor(sibling));
    }

    function test_free_mintsAtNothingAndCountsAgainstThePublicCap() public {
        uint256 before = payoutTo.balance;
        uint256 id = free(buyer, 1, 500_000, 2, leafB);
        assertEq(core.ownerOf(id), buyer);
        assertEq(payoutTo.balance, before);
        assertEq(ledger.claimed(1, buyer), 1);
        assertEq(ext.publicMinted(), 1);
    }

    function test_free_stopsAtTheAllowance() public {
        free(buyer, 1, 500_000, 2, leafB);
        free(buyer, 2, 500_000, 2, leafB);
        bytes memory d = design(3);
        (StripsExtension.Voucher memory v, bytes memory s) = voucherFor(d, buyer);
        vm.prank(buyer);
        vm.expectRevert(TaoLedger.NoneLeft.selector);
        ext.mintFree(d, v, s, 500_000, 2, proofFor(leafB));
    }

    function test_free_cannotClaimMoreThanTheRowSays() public {
        bytes memory d = design(1);
        (StripsExtension.Voucher memory v, bytes memory s) = voucherFor(d, other);
        vm.prank(other);
        vm.expectRevert(TaoLedger.BadProof.selector);
        ext.mintFree(d, v, s, 150_000, 2, proofFor(leafA));
    }

    function test_free_isOnlyForTheWalletInTheVoucher() public {
        bytes memory d = design(1);
        (StripsExtension.Voucher memory v, bytes memory s) = voucherFor(d, buyer);
        vm.prank(other);
        vm.expectRevert(StripsExtension.WrongWallet.selector);
        ext.mintFree(d, v, s, 500_000, 2, proofFor(leafB));
    }

    function test_free_closesThirtyDaysAfterPublishing() public {
        assertEq(ledger.claimDeadline(), T0 + 30 days);
        vm.warp(T0 + 30 days);
        free(buyer, 1, 500_000, 2, leafB);
        vm.warp(T0 + 30 days + 1);
        bytes memory d = design(2);
        StripsExtension.Voucher memory v = StripsExtension.Voucher(buyer, keccak256(d), 99, block.timestamp + 1);
        bytes memory s = sign(v, signerKey);
        vm.prank(buyer);
        vm.expectRevert(TaoLedger.ClaimClosed.selector);
        ext.mintFree(d, v, s, 500_000, 2, proofFor(leafB));
    }

    function test_ledger_verifiesAnyRow() public view {
        assertTrue(ledger.verify(1, buyer, 500_000, 2, proofFor(leafB)));
        assertFalse(ledger.verify(1, buyer, 500_001, 2, proofFor(leafB)));
        assertFalse(ledger.verify(2, buyer, 500_000, 2, proofFor(leafB)));
        assertFalse(ledger.verify(0, buyer, 500_000, 2, proofFor(leafB)));
    }

    function test_ledger_laterSnapshotsAreRecordsNotClaims() public {
        vm.prank(mintface);
        uint256 id = ledger.publishSnapshot(bytes32(uint256(7)), uint64(T0), "ar://two", "Snapshot 2");
        assertEq(id, 2);
        assertEq(ledger.claimSnapshot(), 1);
        assertEq(ledger.snapshot(2).claimUntil, 0);
        assertEq(ledger.snapshot(2).label, "Snapshot 2");
    }

    function test_ledger_onlyTheMinterSpends() public {
        vm.prank(buyer);
        vm.expectRevert(TaoLedger.NotMinter.selector);
        ledger.claim(buyer, 500_000, 2, proofFor(leafB));
    }

    function test_ledger_onlyTheOwnerPublishes() public {
        vm.prank(buyer);
        vm.expectRevert("Ownable: caller is not the owner");
        ledger.publishSnapshot(root, 0, "", "");
        vm.prank(buyer);
        vm.expectRevert("Ownable: caller is not the owner");
        ledger.setMinter(buyer);
        vm.prank(buyer);
        vm.expectRevert("Ownable: caller is not the owner");
        ledger.setClaimSnapshot(1);
    }

    function test_ledger_aWrongRootCanBeCorrectedUntilSomeoneClaims() public {
        vm.startPrank(mintface);
        vm.warp(T0 + 2 days);
        ledger.publishSnapshot(bytes32(uint256(7)), uint64(T0), "ar://fixed", "Snapshot 1, corrected");
        vm.expectRevert(TaoLedger.NoSuchSnapshot.selector);
        ledger.setClaimSnapshot(3);
        vm.expectRevert(TaoLedger.NoSuchSnapshot.selector);
        ledger.setClaimSnapshot(0);
        ledger.setClaimSnapshot(2);
        assertEq(ledger.claimDeadline(), T0 + 32 days);
        assertEq(ledger.snapshot(1).claimUntil, 0);
        ledger.setClaimSnapshot(1);
        vm.stopPrank();
        free(buyer, 1, 500_000, 2, leafB);
        vm.prank(mintface);
        vm.expectRevert(TaoLedger.ClaimsStarted.selector);
        ledger.setClaimSnapshot(2);
    }

    function test_ledger_noSnapshotMeansNoClaim() public {
        TaoLedger fresh = new TaoLedger(address(this));
        fresh.setMinter(address(this));
        vm.expectRevert(TaoLedger.ClaimClosed.selector);
        fresh.claim(buyer, 1, 1, new bytes32[](0));
    }
}

contract ClockTest is Base {
    function test_transfer_firesApproveTransferAndResetsTheClock() public {
        uint256 id = mintAs(buyer, 1);
        vm.warp(block.timestamp + 10 days);
        assertEq(ext.taoOf(id), 420, "4.2 a day, in tenths");
        vm.prank(buyer);
        core.transferFrom(buyer, other, id);
        assertEq(ext.tokenOf(id).heldSince, block.timestamp);
        assertEq(ext.taoOf(id), 0);
    }

    function test_safeTransfer_firesItToo() public {
        uint256 id = mintAs(buyer, 1);
        vm.warp(block.timestamp + 3 days);
        vm.prank(buyer);
        core.safeTransferFrom(buyer, other, id);
        assertEq(ext.tokenOf(id).heldSince, block.timestamp);
    }

    function test_approveTransfer_isOnlyForTheCore() public {
        uint256 id = mintAs(buyer, 1);
        vm.warp(block.timestamp + 3 days);
        vm.prank(buyer);
        vm.expectRevert(StripsExtension.NotCore.selector);
        ext.approveTransfer(buyer, buyer, other, id);
        assertEq(ext.taoOf(id), 126);
    }

    function test_setApproveTransfer_rules() public {
        vm.prank(buyer);
        vm.expectRevert("Only callable by owner");
        ext.setApproveTransfer(address(core), false);
        vm.startPrank(mintface);
        vm.expectRevert(StripsExtension.NotCore.selector);
        ext.setApproveTransfer(address(0xdead), false);
        ext.setApproveTransfer(address(core), true);
    }

    function test_taoOf_noSuchToken() public {
        vm.expectRevert(StripsExtension.NoSuchToken.selector);
        ext.taoOf(1);
    }

    function test_taoOfOwner_addsUpAndSkipsBurned() public {
        uint256 a = mintAs(buyer, 1);
        uint256 b = mintAs(buyer, 2);
        uint256 c = mintAs(other, 3);
        vm.warp(block.timestamp + 10 days);
        assertEq(ext.taoOfOwner(buyer), 840);
        assertEq(ext.taoOfOwner(other), 420);
        vm.prank(buyer);
        core.burn(b);
        assertEq(ext.taoOfOwner(buyer), 420);
        assertTrue(a != c);
    }

    function test_redeemed_ratesSplitAtRedemption_andTheBuyerKeeps690() public {
        uint256 id = mintAs(buyer, 1);
        vm.warp(block.timestamp + 10 days);
        vm.prank(mintface);
        ext.redeem(id, "ar://painted");
        vm.warp(block.timestamp + 2 days);
        assertEq(ext.taoOf(id), 420 + 1380);
        vm.prank(buyer);
        core.transferFrom(buyer, other, id);
        vm.warp(block.timestamp + 1 days);
        assertEq(ext.taoOf(id), 690, "a new holder earns the painting rate from day one");
    }
}

contract RedeemTest is Base {
    function test_redeem_setsTheRateAddsAViewAndTellsTheStory() public {
        uint256 id = mintAs(buyer, 1);
        vm.expectEmit(true, false, false, true);
        emit StripsExtension.Redeemed(id, 2);
        vm.expectEmit(true, false, false, true);
        emit StripsExtension.CreatorStory(id, "240 x 60 cm, painted by MintFace");
        vm.prank(mintface);
        ext.redeem(id, "ar://painted");
        assertEq(ext.redeemedAt(id), block.timestamp);
        assertEq(ext.photosOf(id)[0], "ar://painted");
    }

    function test_redeem_onlyOnce() public {
        uint256 id = mintAs(buyer, 1);
        vm.startPrank(mintface);
        ext.redeem(id, "ar://painted");
        vm.expectRevert(StripsExtension.AlreadyRedeemed.selector);
        ext.redeem(id, "ar://again");
    }

    function test_redeem_notAStreetWorkAndOnlyTheOwner() public {
        vm.startPrank(mintface);
        uint256 id = ext.mintStreet(design(1), 1, "320 West");
        vm.expectRevert(StripsExtension.StreetWork.selector);
        ext.redeem(id, "ar://x");
        vm.expectRevert(StripsExtension.NoSuchToken.selector);
        ext.redeem(99, "ar://x");
        vm.stopPrank();
        uint256 mine = mintAs(buyer, 2);
        vm.prank(buyer);
        vm.expectRevert("Only callable by owner");
        ext.redeem(mine, "ar://x");
    }
}

contract HolderTest is Base {
    function test_setView_holderOrDelegateOnly() public {
        uint256 id = mintAs(buyer, 1);
        vm.prank(other);
        vm.expectRevert(StripsExtension.NotHolder.selector);
        ext.setView(id, 1);
        vm.prank(buyer);
        ext.setView(id, 1);
        assertEq(ext.tokenOf(id).viewIndex, 1);
        delegates.set(other, buyer, true);
        vm.prank(other);
        ext.setView(id, 0);
        assertEq(ext.tokenOf(id).viewIndex, 0);
    }

    function test_setView_mustExist() public {
        uint256 id = mintAs(buyer, 1);
        vm.startPrank(buyer);
        vm.expectRevert(StripsExtension.NoSuchView.selector);
        ext.setView(id, 2);
        vm.stopPrank();
        vm.prank(mintface);
        ext.addPhoto(id, "ar://one");
        vm.startPrank(buyer);
        ext.setView(id, 2);
        vm.expectRevert(StripsExtension.NoSuchView.selector);
        ext.setView(id, 3);
    }

    function test_setView_theEstateDelegateRunsStreetWorks() public {
        vm.startPrank(mintface);
        uint256 id = ext.mintStreet(design(1), 5, "300 West Laneway");
        ext.addPhoto(id, "ar://installed");
        vm.stopPrank();
        delegates.set(mintface, estate, true);
        vm.prank(mintface);
        ext.setView(id, 2);
        assertEq(ext.tokenOf(id).viewIndex, 2);
    }

    function test_story_limits() public {
        uint256 id = mintAs(buyer, 1);
        bytes memory fine = new bytes(280);
        bytes memory long = new bytes(281);
        for (uint256 i; i < 281; ++i) long[i] = "a";
        for (uint256 i; i < 280; ++i) fine[i] = "a";
        vm.startPrank(buyer);
        ext.tellStory(id, string(fine));
        vm.expectRevert(StripsExtension.StoryTooLong.selector);
        ext.tellStory(id, string(long));
        vm.stopPrank();
        vm.prank(other);
        vm.expectRevert(StripsExtension.NotHolder.selector);
        ext.tellStory(id, "not mine");
    }

    function test_story_countsCharactersNotBytes() public {
        uint256 id = mintAs(buyer, 1);
        string memory s;
        for (uint256 i; i < 28; ++i) s = string.concat(s, unicode"ēēēēēēēēēē");
        assertEq(bytes(s).length, 560);
        vm.prank(buyer);
        ext.tellStory(id, s);
    }

    function test_ownerTools_rejectMissingTokens() public {
        vm.startPrank(mintface);
        vm.expectRevert(StripsExtension.NoSuchToken.selector);
        ext.addPhoto(1, "ar://x");
        vm.expectRevert(StripsExtension.NoSuchToken.selector);
        ext.addCreatorStory(1, "x");
        vm.expectRevert(StripsExtension.NotStreetWork.selector);
        ext.setArTarget(1, "ar://x", 100, 50);
    }

    function test_arTarget_onStreetWorks() public {
        vm.startPrank(mintface);
        uint256 id = ext.mintStreet(design(1), 5, "300 West Laneway");
        ext.setArTarget(id, "ar://crop", 55, 110);
        assertEq(ext.arTargetOf(id).uri, "ar://crop");
        assertEq(ext.arTargetOf(id).heightCm, 110);
    }
}

contract VrfTest is Base {
    function test_word_landsOnceAndNeverChanges() public {
        uint256 id = mintAs(buyer, 1);
        land(1, 12345);
        assertEq(ext.seedOf(id), 12345);
        vm.expectRevert(StripsExtension.AlreadySeeded.selector);
        vm.prank(mintface);
        ext.retrySeed(id);
    }

    function test_retry_cannotReRoll_aLateAnswerIsIgnored() public {
        uint256 id = mintAs(buyer, 1);
        vm.prank(mintface);
        uint256 second = ext.retrySeed(id);
        assertEq(second, 2);
        land(2, 777);
        assertEq(ext.seedOf(id), 777);
        land(1, 888);
        assertEq(ext.seedOf(id), 777, "the first word to land stays");
    }

    function test_retry_rules() public {
        uint256 id = mintAs(buyer, 1);
        vm.prank(buyer);
        vm.expectRevert("Only callable by owner");
        ext.retrySeed(id);
        vm.prank(mintface);
        vm.expectRevert(StripsExtension.NoSuchToken.selector);
        ext.retrySeed(99);
    }

    function test_onlyTheCoordinatorAnswers() public {
        uint256 id = mintAs(buyer, 1);
        uint256[] memory words = new uint256[](1);
        words[0] = 1;
        vm.prank(buyer);
        vm.expectRevert();
        ext.rawFulfillRandomWords(1, words);
        assertEq(ext.seedOf(id), 0);
    }

    function test_setVrf_ownerOnly() public {
        StripsExtension.VrfConfig memory c = StripsExtension.VrfConfig(bytes32(uint256(2)), subId, 5, 90_000, false);
        vm.prank(buyer);
        vm.expectRevert("Only callable by owner");
        ext.setVrf(c);
        vm.prank(mintface);
        ext.setVrf(c);
        (bytes32 k,, uint16 conf,, bool native) = ext.vrf();
        assertEq(k, bytes32(uint256(2)));
        assertEq(conf, 5);
        assertFalse(native);
    }
}

contract AdminTest is Base {
    function test_renderer_swapsUntilFrozenThenNever() public {
        StripsRenderer next = new StripsRenderer(engine);
        vm.prank(buyer);
        vm.expectRevert("Only callable by owner");
        ext.setRenderer(IStripsRenderer(address(next)));
        vm.startPrank(mintface);
        ext.setRenderer(IStripsRenderer(address(next)));
        assertEq(address(ext.renderer()), address(next));
        ext.freezeRenderer();
        assertTrue(ext.rendererFrozen());
        vm.expectRevert(StripsExtension.Frozen.selector);
        ext.setRenderer(IStripsRenderer(address(renderer)));
    }

    function test_freeze_ownerOnly() public {
        vm.prank(buyer);
        vm.expectRevert("Only callable by owner");
        ext.freezeRenderer();
    }

    function test_settings_ownerOnly() public {
        vm.startPrank(buyer);
        vm.expectRevert("Only callable by owner");
        ext.setMintOpen(false);
        vm.expectRevert("Only callable by owner");
        ext.setPayout(payable(buyer));
        vm.expectRevert("Only callable by owner");
        ext.setVoucherSigner(buyer);
    }

    function test_voucherSigner_canBeRotated() public {
        uint256 newKey = 0xBEEF;
        vm.prank(mintface);
        ext.setVoucherSigner(vm.addr(newKey));
        bytes memory d = design(1);
        (StripsExtension.Voucher memory v, bytes memory s) = voucherFor(d, buyer);
        vm.prank(buyer);
        vm.expectRevert(StripsExtension.BadVoucher.selector);
        ext.mint{value: 0.009 ether}(d, v, s);
        s = sign(v, newKey);
        vm.prank(buyer);
        ext.mint{value: 0.009 ether}(d, v, s);
    }

    function test_interfaces() public view {
        assertTrue(ext.supportsInterface(type(ICreatorExtensionTokenURI).interfaceId));
        assertTrue(ext.supportsInterface(type(IERC721CreatorExtensionApproveTransfer).interfaceId));
        assertTrue(ext.supportsInterface(type(IERC165).interfaceId));
        assertTrue(ext.supportsInterface(0x7005caad), "legacy Manifold id");
        assertFalse(ext.supportsInterface(0xffffffff));
    }

    function test_ownerIsTheDeployerThenHandsOver() public {
        assertEq(ext.owner(), mintface);
        vm.prank(mintface);
        ext.transferOwnership(other);
        assertEq(ext.owner(), mintface, "two steps");
        vm.prank(other);
        ext.acceptOwnership();
        assertEq(ext.owner(), other);
    }

    function test_tokenURI_rejectsOtherCreatorsAndMissingTokens() public {
        vm.expectRevert(StripsExtension.NotCore.selector);
        ext.tokenURI(address(0xdead), 1);
        vm.expectRevert(StripsExtension.NoSuchToken.selector);
        ext.tokenURI(address(core), 1);
        vm.expectRevert(StripsExtension.NoSuchToken.selector);
        ext.designOf(1);
    }
}
