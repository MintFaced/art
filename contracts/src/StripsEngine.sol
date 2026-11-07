// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SSTORE2} from "solady/utils/SSTORE2.sol";

/// @title StripsEngine
/// @notice The blink engine's gzipped JavaScript, stored once as contract code
///         and never changed. There is no owner and no setter.
contract StripsEngine {
    address[] private _chunks;
    uint256 public immutable size;

    constructor(bytes[] memory parts) {
        uint256 total;
        for (uint256 i; i < parts.length; ++i) {
            _chunks.push(SSTORE2.write(parts[i]));
            total += parts[i].length;
        }
        size = total;
    }

    function chunks() external view returns (address[] memory) {
        return _chunks;
    }

    /// @notice The whole file, gzipped.
    function read() external view returns (bytes memory out) {
        for (uint256 i; i < _chunks.length; ++i) {
            out = bytes.concat(out, SSTORE2.read(_chunks[i]));
        }
    }
}
