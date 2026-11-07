// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title StripsTraits
/// @notice Everything about a token's signal, read from its one VRF word. These
///         tables are public on purpose: anyone can take the word and the proof
///         and get the same answer. Each 32-bit slice of the word does one job.
///
///   bits 0-31     the display
///   bits 32-63    how many faults (2 to 4)
///   bits 64-191   one slice for each fault drawn
///   bits 192-223  the rhythm
///   bits 224-255  the timing, read by the engine
library StripsTraits {
    uint256 internal constant DISPLAYS = 10;
    uint256 internal constant FAULTS = 56;

    /// @dev Odds out of 100, in the study's order, as running totals, one byte each.
    ///      Valve 8, Colour CRT 22, Trinitron 14, VHS 14, Plasma 7,
    ///      LCD 14, LED 9, LED wall 4, OLED 6, Digital signal 2.
    bytes internal constant DISPLAY_ODDS = hex"081e2c3a414f585c6264";

    /// @dev Where each display's faults start in the list below, and the end.
    bytes internal constant FAULT_START = hex"00070f13191d25292d3338";

    string internal constant DISPLAY_NAMES =
        "Valve B&W|Colour CRT|Trinitron|VHS|Plasma|LCD|LED|LED wall|OLED|Digital signal";

    string internal constant RHYTHM_NAMES = "Calm|Restless|Haywire";

    string internal constant FAULT_NAMES =
        "Snow|Vertical roll|Horizontal hold|Picture shrink|Switch-off dot|Ghosting|Hum bars|"
        "Convergence drift|Purity blotches|Degauss|Gun loss|Vertical collapse|Horizontal collapse|Pincushion|Interlace flicker|"
        "Damper wires|Burn-in|Blooming|Tilt|"
        "Tracking|Head switching|Chroma bleed|Blue screen|Colour bars|Tape crease|"
        "Image retention|False contouring|Dead line|Panel buzz|"
        "Vertical lines|Row repeat|Dead pixels|Backlight bleed|Half dark|Cracked panel|Timing board fault|Pressure ripple|"
        "LED strip failure|Halo blooming|PWM banding|Zone pumping|"
        "Dead module|Module mismatch|Scan refresh|Cabinet seams|"
        "Burn-in|Pink tint|The green line|Mura|Panel damage|Low-light flicker|"
        "Macroblocking|Bandwidth drop|Datamosh|HDMI sparkles|No signal";

    function _slice(uint256 word, uint256 at) private pure returns (uint256) {
        return uint32(word >> at);
    }

    function display(uint256 word) internal pure returns (uint256 i) {
        uint256 roll = _slice(word, 0) % 100;
        bytes memory odds = DISPLAY_ODDS;
        while (roll >= uint8(odds[i])) ++i;
    }

    function rhythm(uint256 word) internal pure returns (uint256) {
        uint256 roll = _slice(word, 192) % 100;
        if (roll < 60) return 0;
        return roll < 92 ? 1 : 2;
    }

    /// @notice The faults drawn for this word, as indexes into FAULT_NAMES.
    function faults(uint256 word) internal pure returns (uint256[] memory drawn) {
        uint256 d = display(word);
        bytes memory starts = FAULT_START;
        uint256 start = uint8(starts[d]);
        uint256 size = uint8(starts[d + 1]) - start;

        uint256[] memory pool = new uint256[](size);
        for (uint256 i; i < size; ++i) pool[i] = start + i;

        uint256 n = 2 + (_slice(word, 32) % 3);
        drawn = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            uint256 left = size - i;
            uint256 pick = _slice(word, 64 + 32 * i) % left;
            drawn[i] = pool[pick];
            pool[pick] = pool[left - 1];
        }
    }

    /// @notice The nth name in a list separated by |.
    function nameAt(string memory list, uint256 n) internal pure returns (string memory) {
        bytes memory all = bytes(list);
        uint256 from;
        uint256 seen;
        for (uint256 i; i <= all.length; ++i) {
            if (i != all.length && all[i] != "|") continue;
            if (seen == n) {
                bytes memory out = new bytes(i - from);
                for (uint256 j; j < out.length; ++j) out[j] = all[from + j];
                return string(out);
            }
            ++seen;
            from = i + 1;
        }
        return "";
    }
}
