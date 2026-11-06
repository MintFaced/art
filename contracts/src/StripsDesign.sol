// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title StripsDesign
/// @notice Reads and checks one packed //STRIPS design.
///
///   offset        size   field
///   0             1      flags: bit 0 set means portrait, no other bit may be set
///   1             2      length in cm, big endian
///   3             2      width in cm, big endian
///   5             1      n, how many colours (3 to 12)
///   6             3n     the colours, RGB
///   6 + 3n        rest   the bands, bottom to top, one byte each:
///                        high nibble the colour's index, or 15 for the red line
///                        low nibble its height in relative units (1 to 15)
///
/// A band's height means nothing on its own, only against the sum of them all.
library StripsDesign {
    uint256 internal constant HEADER = 6;
    uint256 internal constant MIN_COLOURS = 3;
    uint256 internal constant MAX_COLOURS = 12;
    uint256 internal constant MAX_BANDS = 400;
    uint256 internal constant RED_INDEX = 15;

    error BadDesign();

    struct Shape {
        bool portrait;
        uint256 length;
        uint256 width;
        uint256 colours;
        uint256 bandsAt;
        uint256 bands;
        uint256 redLine; // counted from the bottom, the first band is 1
        uint256 units;
    }

    /// @notice The design's shape. Reverts unless every byte of it is well formed,
    ///         so a design that passes here can always be drawn.
    function read(bytes memory d) internal pure returns (Shape memory s) {
        if (d.length <= HEADER) revert BadDesign();
        uint256 flags = uint8(d[0]);
        if (flags > 1) revert BadDesign();
        s.portrait = flags == 1;
        s.length = (uint256(uint8(d[1])) << 8) | uint8(d[2]);
        s.width = (uint256(uint8(d[3])) << 8) | uint8(d[4]);
        s.colours = uint8(d[5]);
        if (s.length == 0 || s.width == 0) revert BadDesign();
        if (s.colours < MIN_COLOURS || s.colours > MAX_COLOURS) revert BadDesign();
        s.bandsAt = HEADER + 3 * s.colours;
        if (d.length <= s.bandsAt) revert BadDesign();
        s.bands = d.length - s.bandsAt;
        if (s.bands > MAX_BANDS) revert BadDesign();
        for (uint256 i; i < s.bands; ++i) {
            uint256 b = uint8(d[s.bandsAt + i]);
            uint256 colour = b >> 4;
            uint256 height = b & 15;
            if (height == 0) revert BadDesign();
            if (colour == RED_INDEX) {
                if (s.redLine != 0) revert BadDesign();
                s.redLine = i + 1;
            } else if (colour >= s.colours) {
                revert BadDesign();
            }
            s.units += height;
        }
        if (s.redLine == 0) revert BadDesign();
    }
}
