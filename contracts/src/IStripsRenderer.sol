// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice What the extension hands the renderer for one token.
struct TokenView {
    uint256 id;
    bytes design;
    uint256 word; // the VRF word, 0 until it lands
    uint256 mintedAt;
    uint256 viewIndex; // 0 animated, 1 still, 2 and up a photo
    bool redeemed;
    string photo; // set when viewIndex is 2 or more
    uint256 no; // the catalogue number, 0 for anything but a street work
    string site;
}

interface IStripsRenderer {
    function render(TokenView calldata t) external view returns (string memory);
}
