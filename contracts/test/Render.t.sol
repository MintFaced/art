// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base64} from "solady/utils/Base64.sol";
import {LibString} from "solady/utils/LibString.sol";
import {Base, StripsExtension, StripsRenderer} from "./Base.t.sol";
import {StripsEngine} from "../src/StripsEngine.sol";
import {StripsDesign} from "../src/StripsDesign.sol";
import {StripsTraits} from "../src/StripsTraits.sol";
import {TokenView, IStripsRenderer} from "../src/IStripsRenderer.sol";

/// @dev Library calls need an external frame for expectRevert to catch them.
contract DesignReader {
    function read(bytes memory d) external pure returns (StripsDesign.Shape memory) {
        return StripsDesign.read(d);
    }

    function traits(uint256 word) external pure returns (uint256, uint256, uint256[] memory) {
        return (StripsTraits.display(word), StripsTraits.rhythm(word), StripsTraits.faults(word));
    }
}

contract RenderTest is Base {
    DesignReader reader = new DesignReader();

    function json(uint256 id) internal view returns (string memory) {
        string memory uri = core.tokenURI(id);
        string memory prefix = "data:application/json;base64,";
        assertTrue(LibString.startsWith(uri, prefix), "a data URI");
        return string(Base64.decode(LibString.slice(uri, bytes(prefix).length)));
    }

    function has(string memory s, string memory part) internal pure returns (bool) {
        return LibString.contains(s, part);
    }

    function test_uri_comesFromTheExtension_throughTheCore() public {
        uint256 id = mintAs(buyer, 1);
        string memory j = json(id);
        assertEq(vm.parseJsonString(j, ".name"), "//STRIPS #1");
        assertTrue(LibString.startsWith(vm.parseJsonString(j, ".image"), "data:image/svg+xml;base64,"));
        assertTrue(LibString.startsWith(vm.parseJsonString(j, ".animation_url"), "data:text/html;base64,"));
    }

    function test_traits_readTuningUntilTheWordLands() public {
        uint256 id = mintAs(buyer, 1);
        string memory before_ = json(id);
        assertTrue(has(before_, '{"trait_type":"Signal","value":"Tuning"}'));
        assertFalse(has(before_, '"Display"'));
        land(1, 0xabc123);
        string memory after_ = json(id);
        assertFalse(has(after_, "Tuning"));
        assertTrue(has(after_, '"Display"'));
        assertTrue(has(after_, '"Faults"'));
        assertTrue(has(after_, '"Rhythm"'));
    }

    function test_view_stillLeavesTheAnimationOut() public {
        uint256 id = mintAs(buyer, 1);
        vm.prank(buyer);
        ext.setView(id, 1);
        string memory j = json(id);
        assertFalse(vm.keyExistsJson(j, ".animation_url"));
        assertTrue(LibString.startsWith(vm.parseJsonString(j, ".image"), "data:image/svg+xml;base64,"));
    }

    function test_view_photoLeadsTheMetadata() public {
        vm.startPrank(mintface);
        uint256 id = ext.mintStreet(design(1), 5, "300 West Laneway");
        ext.addPhoto(id, "ar://installed");
        vm.stopPrank();
        vm.prank(estate);
        ext.setView(id, 2);
        string memory j = json(id);
        assertEq(vm.parseJsonString(j, ".image"), "ar://installed");
        assertFalse(vm.keyExistsJson(j, ".animation_url"));
        assertTrue(has(j, unicode'"value":"No.5 · 300 West Laneway"'));
    }

    function test_street_textIsEscaped() public {
        vm.prank(mintface);
        uint256 id = ext.mintStreet(design(1), 7, 'The "Line", Hastings\\');
        vm.parseJsonKeys(json(id), "$");
        assertTrue(has(json(id), 'The \\"Line\\", Hastings\\\\'));
    }

    function test_photo_textIsEscaped() public {
        vm.startPrank(mintface);
        uint256 id = ext.mintStreet(design(1), 7, "Site");
        ext.addPhoto(id, 'ar://a"b');
        vm.stopPrank();
        vm.prank(estate);
        ext.setView(id, 2);
        assertEq(vm.parseJsonString(json(id), ".image"), 'ar://a"b');
    }

    function test_redLine_trait() public {
        uint256 id = mintAs(buyer, 1);
        assertTrue(has(json(id), '"Red line","value":"16 (standard)"'));
        bytes memory d = shaped(2, 60, 240, false, 3, 24);
        (StripsExtension.Voucher memory v, bytes memory s) = voucherFor(d, buyer);
        vm.prank(buyer);
        uint256 moved = ext.mint{value: 0.009 ether}(d, v, s);
        assertTrue(has(json(moved), '"Red line","value":"3"'));
    }

    function test_redeemed_trait() public {
        uint256 id = mintAs(buyer, 1);
        assertTrue(has(json(id), '"Redeemed","value":"No"'));
        vm.prank(mintface);
        ext.redeem(id, "ar://painted");
        assertTrue(has(json(id), '"Redeemed","value":"Yes"'));
    }

    function test_still_landscapeIsBottomFirst_portraitLeftFirst() public view {
        bytes memory land_ = abi.encodePacked(
            uint8(0), uint16(100), uint16(50), uint8(3), hex"112233445566778899", hex"01f102"
        );
        assertEq(
            renderer.still(land_),
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" shape-rendering="crispEdges">'
            '<rect y="150" width="400" height="50" fill="#112233"/>'
            '<rect y="100" width="400" height="50" fill="#d32011"/>'
            '<rect y="0" width="400" height="100" fill="#112233"/></svg>'
        );
        bytes memory up = abi.encodePacked(
            uint8(1), uint16(100), uint16(50), uint8(3), hex"112233445566778899", hex"01f102"
        );
        assertEq(
            renderer.still(up),
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 400" shape-rendering="crispEdges">'
            '<rect x="0" width="50" height="400" fill="#112233"/>'
            '<rect x="50" width="50" height="400" fill="#d32011"/>'
            '<rect x="100" width="100" height="400" fill="#112233"/></svg>'
        );
    }

    function test_gas_worstCaseFitsA30MCall() public {
        bytes memory big = new bytes(30 * 1024);
        for (uint256 i; i < big.length; ++i) big[i] = bytes1(uint8(uint256(keccak256(abi.encode(i)))));
        bytes[] memory parts = new bytes[](2);
        bytes memory a = new bytes(20 * 1024);
        bytes memory b = new bytes(10 * 1024);
        for (uint256 i; i < a.length; ++i) a[i] = big[i];
        for (uint256 i; i < b.length; ++i) b[i] = big[a.length + i];
        parts[0] = a;
        parts[1] = b;
        StripsEngine full = new StripsEngine(parts);
        assertEq(full.read(), big, "chunks come back in order, whole");
        StripsRenderer r = new StripsRenderer(full);

        bytes memory d = abi.encodePacked(uint8(0), uint16(240), uint16(120), uint8(12));
        for (uint256 i; i < 12; ++i) d = abi.encodePacked(d, uint24(0xABCDEF - i));
        for (uint256 i; i < 400; ++i) d = abi.encodePacked(d, uint8(i == 15 ? 0xF4 : ((i % 12) << 4) | 15));

        TokenView memory t = TokenView(690, d, type(uint256).max, T0, 0, true, "", 69, "A long street address, somewhere");
        uint256 start = gasleft();
        string memory out = r.render(t);
        uint256 used = start - gasleft();
        emit log_named_uint("worst case tokenURI gas", used);
        emit log_named_uint("worst case tokenURI bytes", bytes(out).length);
        assertLt(used, 30_000_000);
    }

    function test_gas_mintCosts() public {
        bytes memory d = abi.encodePacked(uint8(0), uint16(240), uint16(60), uint8(12));
        for (uint256 i; i < 12; ++i) d = abi.encodePacked(d, uint24(0xABCDEF - i));
        for (uint256 i; i < 55; ++i) d = abi.encodePacked(d, uint8(i == 15 ? 0xF2 : ((i % 12) << 4) | 1 + (i % 4)));
        emit log_named_uint("design bytes", d.length);
        mintAs(buyer, 1);
        (StripsExtension.Voucher memory v, bytes memory s) = voucherFor(d, buyer);
        vm.prank(buyer);
        uint256 start = gasleft();
        ext.mint{value: 0.009 ether}(d, v, s);
        emit log_named_uint("mint gas, 12 colours, 55 bands, mock coordinator", start - gasleft());
    }

    /* ---------- fuzz: packing ---------- */

    function testFuzz_design_acceptsEveryWellFormedOne(
        uint16 length,
        uint16 width,
        uint8 colours,
        uint16 bands,
        uint16 red,
        bool portrait,
        uint256 salt
    ) public view {
        length = uint16(bound(length, 1, type(uint16).max));
        width = uint16(bound(width, 1, type(uint16).max));
        colours = uint8(bound(colours, 3, 12));
        bands = uint16(bound(bands, 1, 400));
        red = uint16(bound(red, 0, bands - 1));
        bytes memory d = abi.encodePacked(uint8(portrait ? 1 : 0), length, width, colours);
        for (uint256 i; i < colours; ++i) d = abi.encodePacked(d, uint24(salt >> (i * 8)));
        uint256 units;
        for (uint256 i; i < bands; ++i) {
            uint256 h = 1 + uint256(keccak256(abi.encode(salt, i))) % 15;
            uint256 c = i == red ? 15 : uint256(keccak256(abi.encode(i, salt))) % colours;
            units += h;
            d = abi.encodePacked(d, uint8((c << 4) | h));
        }
        StripsDesign.Shape memory s = reader.read(d);
        assertEq(s.portrait, portrait);
        assertEq(s.length, length);
        assertEq(s.width, width);
        assertEq(s.colours, colours);
        assertEq(s.bands, bands);
        assertEq(s.redLine, uint256(red) + 1);
        assertEq(s.units, units);
    }

    function testFuzz_design_anyFlippedByteEitherStillReadsOrReverts(uint256 at, uint8 value) public {
        bytes memory d = design(7);
        at = bound(at, 0, d.length - 1);
        d[at] = bytes1(value);
        try reader.read(d) returns (StripsDesign.Shape memory s) {
            renderer.still(d);
            assertGe(s.colours, 3);
            assertLe(s.colours, 12);
            assertGt(s.redLine, 0);
        } catch {}
    }

    function test_design_rejections() public {
        bytes memory ok = hex"0000f0003c03112233445566778899"; // no bands yet
        bytes[] memory bad = new bytes[](10);
        bad[0] = hex"";
        bad[1] = hex"0000f0003c03"; // header only
        bad[2] = bytes.concat(hex"02", hex"00f0003c03112233445566778899f1"); // unknown flag
        bad[3] = hex"000000003c03112233445566778899f1"; // no length
        bad[4] = hex"0000f0000003112233445566778899f1"; // no width
        bad[5] = hex"0000f0003c02112233445566f1"; // two colours
        bad[6] = bytes.concat(ok, hex"01"); // no red line
        bad[7] = bytes.concat(ok, hex"f1f1"); // two red lines
        bad[8] = bytes.concat(ok, hex"f100"); // a band with no height
        bad[9] = bytes.concat(ok, hex"f131"); // a colour that isn't there
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(StripsDesign.BadDesign.selector);
            reader.read(bad[i]);
        }
        vm.expectRevert(StripsDesign.BadDesign.selector);
        reader.read(hex"0000f0003c0d11223344556677889911223344556677889911223344556677889911223344556677f1"); // 13 colours
        bytes memory tooMany = ok;
        tooMany = bytes.concat(tooMany, hex"f1");
        for (uint256 i; i < 400; ++i) tooMany = bytes.concat(tooMany, hex"01");
        vm.expectRevert(StripsDesign.BadDesign.selector);
        reader.read(tooMany);
    }

    /* ---------- fuzz: the word ---------- */

    function testFuzz_traits_alwaysInTheTables(uint256 word) public view {
        (uint256 d, uint256 r, uint256[] memory f) = reader.traits(word);
        assertLt(d, 10);
        assertLt(r, 3);
        assertGe(f.length, 2);
        assertLe(f.length, 4);
        uint8[11] memory starts = [0, 7, 15, 19, 25, 29, 37, 41, 45, 51, 56];
        for (uint256 i; i < f.length; ++i) {
            assertGe(f[i], starts[d], "a fault from this display");
            assertLt(f[i], starts[d + 1], "a fault from this display");
            for (uint256 j; j < i; ++j) assertTrue(f[i] != f[j], "no fault twice");
        }
    }

    function test_traits_oddsAreTheStudys() public view {
        uint256[10] memory want = [uint256(8), 22, 14, 14, 7, 14, 9, 4, 6, 2];
        uint256[10] memory got;
        for (uint256 roll; roll < 100; ++roll) {
            (uint256 d,,) = reader.traits(roll);
            ++got[d];
        }
        for (uint256 i; i < 10; ++i) assertEq(got[i], want[i]);
        uint256[3] memory rhythm;
        for (uint256 roll; roll < 100; ++roll) {
            (, uint256 r,) = reader.traits(roll << 192);
            ++rhythm[r];
        }
        assertEq(rhythm[0], 60);
        assertEq(rhythm[1], 32);
        assertEq(rhythm[2], 8);
    }

    function test_traits_nameTables() public pure {
        assertEq(StripsTraits.nameAt(StripsTraits.DISPLAY_NAMES, 9), "Digital signal");
        assertEq(StripsTraits.nameAt(StripsTraits.FAULT_NAMES, 0), "Snow");
        assertEq(StripsTraits.nameAt(StripsTraits.FAULT_NAMES, 55), "No signal");
        assertEq(StripsTraits.nameAt(StripsTraits.FAULT_NAMES, 56), "");
        assertEq(StripsTraits.nameAt(StripsTraits.RHYTHM_NAMES, 2), "Haywire");
    }
}
