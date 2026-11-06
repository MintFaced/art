// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base64} from "solady/utils/Base64.sol";
import {DynamicBufferLib} from "solady/utils/DynamicBufferLib.sol";
import {LibString} from "solady/utils/LibString.sol";
import {IStripsRenderer, TokenView} from "./IStripsRenderer.sol";
import {StripsDesign} from "./StripsDesign.sol";
import {StripsEngine} from "./StripsEngine.sol";
import {StripsTraits} from "./StripsTraits.sol";

/// @title StripsRenderer
/// @notice A token's metadata, drawn on demand from its design and its word:
///         an SVG of the still, an HTML page that plays the signal, and the
///         traits. Nothing here touches the network and nothing here is stored.
contract StripsRenderer is IStripsRenderer {
    using DynamicBufferLib for DynamicBufferLib.DynamicBuffer;
    using LibString for uint256;

    /// @notice The //STRIPS red. Every token's red line is this colour.
    string public constant RED = "#d32011";

    string private constant DESCRIPTION =
        "Every //STRIP is a screen. Its still design and its signal are drawn from data stored on Ethereum.";

    StripsEngine public immutable engine;

    constructor(StripsEngine engine_) {
        engine = engine_;
    }

    /// @notice The still as SVG. Every number in it is a whole number, so the
    ///         Maker's copy of this function can match it byte for byte.
    function still(bytes memory design) public pure returns (string memory) {
        StripsDesign.Shape memory s = StripsDesign.read(design);
        uint256 across = s.width * s.units;
        uint256 along = s.length * s.units;
        DynamicBufferLib.DynamicBuffer memory b;
        (uint256 w, uint256 h) = s.portrait ? (across, along) : (along, across);
        b.p(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ',
            bytes(w.toString()),
            " ",
            bytes(h.toString()),
            '" shape-rendering="crispEdges">'
        );
        uint256 at; // how far across the painting, from the bottom or the left
        for (uint256 i; i < s.bands; ++i) {
            uint256 band = uint8(design[s.bandsAt + i]);
            uint256 size = (band & 15) * s.width;
            bytes memory fill = bytes(_fill(design, band >> 4));
            if (s.portrait) {
                b.p('<rect x="', bytes(at.toString()), '" width="', bytes(size.toString()), '" height="');
                b.p(bytes(h.toString()), '" fill="', fill, '"/>');
            } else {
                b.p('<rect y="', bytes((across - at - size).toString()), '" width="', bytes(w.toString()));
                b.p('" height="', bytes(size.toString()), '" fill="', fill, '"/>');
            }
            at += size;
        }
        b.p("</svg>");
        return b.s();
    }

    function _fill(bytes memory design, uint256 colour) private pure returns (string memory) {
        if (colour == StripsDesign.RED_INDEX) return RED;
        uint256 at = StripsDesign.HEADER + 3 * colour;
        uint256 rgb = (uint256(uint8(design[at])) << 16) | (uint256(uint8(design[at + 1])) << 8) | uint8(design[at + 2]);
        return string.concat("#", LibString.toHexStringNoPrefix(rgb, 3));
    }

    /// @notice The page that plays the signal. It inlines the engine, the design
    ///         and the word, and asks the network for nothing.
    function page(TokenView memory t) public view returns (string memory) {
        DynamicBufferLib.DynamicBuffer memory b;
        b.p(
            '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>//STRIPS #',
            bytes(t.id.toString()),
            '</title><meta name="viewport" content="width=device-width,initial-scale=1">',
            "<style>html,body{margin:0;height:100%;background:#000}</style></head><body>"
        );
        b.p(
            '<script>window.STRIP={design:"',
            bytes(LibString.toHexString(t.design)),
            '",word:"',
            bytes(t.word == 0 ? "" : LibString.toHexString(t.word, 32)),
            '",minted:',
            bytes(t.mintedAt.toString()),
            "}</script>"
        );
        b.p('<script>(async()=>{const b=Uint8Array.from(atob("', bytes(Base64.encode(engine.read())));
        b.p(
            '"),c=>c.charCodeAt(0)),s=new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))),',
            'e=document.createElement("script");e.textContent=await s.text();document.body.append(e)})()</script></body></html>'
        );
        return b.s();
    }

    function _trait(DynamicBufferLib.DynamicBuffer memory b, bool first, string memory key, string memory value)
        private
        pure
    {
        b.p(first ? bytes('{"trait_type":"') : bytes(',{"trait_type":"'), bytes(key), '","value":"');
        b.p(bytes(LibString.escapeJSON(value)), '"}');
    }

    /// @notice The attributes, as a JSON array.
    function attributes(TokenView memory t) public pure returns (string memory) {
        StripsDesign.Shape memory s = StripsDesign.read(t.design);
        DynamicBufferLib.DynamicBuffer memory b;
        b.p("[");
        _trait(b, true, "Length", string.concat(s.length.toString(), " cm"));
        _trait(b, false, "Width", string.concat(s.width.toString(), " cm"));
        _trait(b, false, "Orientation", s.portrait ? "Portrait" : "Landscape");
        _trait(b, false, "Colours", s.colours.toString());
        _trait(
            b, false, "Red line", s.redLine == 16 ? "16 (standard)" : s.redLine.toString()
        );
        if (t.word == 0) {
            _trait(b, false, "Signal", "Tuning");
        } else {
            _trait(b, false, "Display", StripsTraits.nameAt(StripsTraits.DISPLAY_NAMES, StripsTraits.display(t.word)));
            uint256[] memory drawn = StripsTraits.faults(t.word);
            for (uint256 i; i < drawn.length; ++i) {
                _trait(b, false, "Faults", StripsTraits.nameAt(StripsTraits.FAULT_NAMES, drawn[i]));
            }
            _trait(b, false, "Rhythm", StripsTraits.nameAt(StripsTraits.RHYTHM_NAMES, StripsTraits.rhythm(t.word)));
        }
        _trait(b, false, "Redeemed", t.redeemed ? "Yes" : "No");
        if (t.no != 0) _trait(b, false, "No.", string.concat("No.", t.no.toString(), unicode" · ", t.site));
        b.p("]");
        return b.s();
    }

    /// @inheritdoc IStripsRenderer
    function render(TokenView calldata t) external view returns (string memory) {
        TokenView memory m = t;
        DynamicBufferLib.DynamicBuffer memory b;
        b.p('{"name":"//STRIPS #', bytes(m.id.toString()), '","description":"', bytes(DESCRIPTION), '","image":"');
        if (m.viewIndex >= 2) {
            b.p(bytes(LibString.escapeJSON(m.photo)));
        } else {
            b.p("data:image/svg+xml;base64,", bytes(Base64.encode(bytes(still(m.design)))));
        }
        b.p('"');
        if (m.viewIndex == 0) {
            b.p(',"animation_url":"data:text/html;base64,', bytes(Base64.encode(bytes(page(m)))), '"');
        }
        b.p(',"attributes":', bytes(attributes(m)), "}");
        return string.concat("data:application/json;base64,", Base64.encode(b.data));
    }
}
