// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {StripsExtension, IDelegateRegistry} from "../src/StripsExtension.sol";
import {StripsRenderer} from "../src/StripsRenderer.sol";
import {StripsEngine} from "../src/StripsEngine.sol";
import {IStripsRenderer} from "../src/IStripsRenderer.sol";
import {TaoLedger} from "../src/TaoLedger.sol";

/// @notice Deploys everything but the core, which Ryan deploys in Manifold Studio.
///         See contracts/README.md for the order. Reads:
///           CORE            the Creator Core
///           VOUCHER_SIGNER  the address of STRIPS_VOUCHER_KEY
///           VRF_COORDINATOR, VRF_KEY_HASH, VRF_SUB_ID
///           OWNER           the MintFace wallet
///           ARTIST          ryanj.eth's address, resolved once
///           PAYOUT          mintface.eth's address, resolved once
///           ESTATE          mintestate.eth's address, resolved once
///           DELEGATES       delegate.xyz v2, optional
///           CLAIM_WINDOW    seconds, optional, off mainnet only
contract Deploy is Script {
    uint64 constant MAINNET_WINDOW = 30 days;

    function run() external {
        address owner = vm.envAddress("OWNER");
        address delegates = vm.envOr("DELEGATES", 0x00000000000000447e69651d841bD8D104Bed493);
        address coreAddress = vm.envAddress("CORE");
        require(coreAddress.code.length != 0, "CORE has no code on this chain");

        uint64 window = uint64(vm.envOr("CLAIM_WINDOW", uint256(MAINNET_WINDOW)));
        require(window != 0, "the claim needs a window");
        require(block.chainid != 1 || window == MAINNET_WINDOW, "mainnet's claim window is 30 days");

        bytes memory gz = vm.readFileBinary("build/engine.js.gz");
        require(gz.length <= 24_000, "split the engine into chunks");
        bytes[] memory parts = new bytes[](1);
        parts[0] = gz;

        vm.startBroadcast();
        /* Not msg.sender: with a hardware wallet that's Foundry's default sender
           until --sender says otherwise, and the broadcast is someone else. */
        (, address deployer,) = vm.readCallers();
        StripsEngine engine = new StripsEngine(parts);
        StripsRenderer renderer = new StripsRenderer(engine);
        TaoLedger ledger = new TaoLedger(deployer, window);
        StripsExtension ext = new StripsExtension(
            coreAddress,
            ledger,
            IDelegateRegistry(delegates),
            vm.envAddress("ESTATE"),
            payable(vm.envAddress("PAYOUT")),
            vm.envAddress("VOUCHER_SIGNER"),
            IStripsRenderer(address(renderer)),
            vm.envAddress("VRF_COORDINATOR"),
            StripsExtension.VrfConfig({
                keyHash: vm.envBytes32("VRF_KEY_HASH"),
                subId: vm.envUint("VRF_SUB_ID"),
                confirmations: 3,
                callbackGas: 100_000,
                native: true
            })
        );
        ledger.setMinter(address(ext));
        ext.setArtist(vm.envAddress("ARTIST"));
        if (owner != deployer) {
            /* the owner finishes both with acceptOwnership() */
            ledger.transferOwnership(owner);
            ext.transferOwnership(owner);
        }
        vm.stopBroadcast();

        console2.log("engine   ", address(engine));
        console2.log("renderer ", address(renderer));
        console2.log("ledger   ", address(ledger));
        console2.log("extension", address(ext));
    }
}
