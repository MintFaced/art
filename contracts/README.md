# //STRIPS contracts

The custom code on top of a Manifold ERC721 Creator Core.

| Contract | Job |
|---|---|
| `StripsExtension` | Minting, caps, design storage, the VRF request, the TAO clock, views, stories, redemption |
| `StripsRenderer` | `tokenURI`: the SVG still, the HTML page, the attributes |
| `StripsEngine` | The blink engine's gzipped JavaScript, stored once, no owner |
| `TaoLedger` | TAO snapshot roots and free mint claims |
| `StripsDesign`, `StripsTraits` | Libraries: reading a design, reading a word |

## Build and test

```sh
npm ci
node ../scripts/strips/build-engine.mjs   # writes build/engine.js.gz
forge build
forge test --no-match-path 'test/fork/*'
forge test --match-path 'test/fork/*'     # FORK_URL to use your own node
node ../scripts/strips/test-chain.mjs     # JS against Solidity, byte for byte
node ../scripts/strips/test-mint.mjs      # the buyer's path on a local chain
node ../scripts/strips/test-render.mjs    # the token plays with the network blocked
node ../scripts/strips/test-secrets.mjs   # nothing about the method in any of it
```

## Mainnet, in order

Sepolia first, the same way, on a test Creator Core. Sepolia's VRF v2.5 coordinator
and key hash are on Chainlink's supported networks page.

1. **Core.** In Manifold Studio, from the MintFace wallet, deploy an ERC721 contract
   named //STRIPS. Set a 5% royalty to `0xd40B63bF04a44e43fBFE5784bCf22ACaAB34a180`
   (mintface.eth, resolved 2026-11-05).
2. **VRF.** At vrf.chain.link, make a v2.5 subscription and fund it. Native payment
   is on by default, so ETH works. Note the subscription id.
3. **Voucher key.** Generate a fresh key, add it to Vercel as `STRIPS_VOUCHER_KEY`
   (Sensitive). Only its address goes in the next step.
4. **Deploy.**

   ```sh
   CORE=0x... OWNER=0xd40B63bF04a44e43fBFE5784bCf22ACaAB34a180 \
   PAYOUT=0xd40B63bF04a44e43fBFE5784bCf22ACaAB34a180 \
   ESTATE=0x6e420B64bb329bE84a6627c68A7BdFf825139773 \
   VOUCHER_SIGNER=0x... VRF_SUB_ID=... \
   VRF_COORDINATOR=0xD7f86b4b8Cae7D942340FF628F82735b7a20893a \
   VRF_KEY_HASH=0x3fd2fec10d06ee8f65e7f2e95f5c56511359ece3f33960ad8a866ae24a8ff10b \
   forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --verify --ledger
   ```

   That key hash is the 500 gwei lane, checked on-chain on 2026-11-05. If the deployer
   isn't the MintFace wallet, the MintFace wallet calls `acceptOwnership()` on the extension.
5. **Connect.** Add the extension as a consumer on the subscription, then from the
   MintFace wallet call `registerExtension(extension, "")` on the core.
6. **Tell the site.** Fill in `data/strips.json`. `first_block` is the core's deploy
   block, or any block before the first mint. The nightly TAO run starts the core's
   event file there, so if it's left empty, nothing earns TAO and the run alarms.
7. **Snapshot 1.** `node scripts/strips/snapshot.mjs --id 1`, put the CSV and JSON on
   Arweave, publish the root from /mintwork/strips. The 30 day claim starts when
   it's published, so publish on the day.
8. **Street works.** Mint the existing ones to mintestate.eth from /mintwork/strips.
9. **Open.** `setMintOpen(true)`.

## Rules for the core

- Register the extension with an empty base URI. Never pass a URI when minting
  through it, or Manifold serves that instead of the extension's `tokenURI`.
- Never unregister or blacklist the extension. Its tokens depend on it for metadata.
- `freezeRenderer()` is permanent.

## Things a reviewer should look at

- `approveTransfer` isn't called on mints, by design of the core, so `_mint` starts
  the clock itself. It's called on burns, which is harmless.
- `_safeMint` calls out to a contract buyer before the extension has stored the
  token. Every counter and the design hash are written first, the core and the
  extension are both `nonReentrant`, and the two fields the callback could touch
  are overwritten after it. See `test_reentrancy_aHostileReceiverCannotMintTwice`.
- The voucher nonce isn't stored: a design can only be minted once, so a voucher
  can only be used once. That saves a storage write on every mint.
- `setCoordinator` comes from Chainlink's base contract and stays with the owner
  after the renderer is frozen. A word can't be replaced once it has landed, but an
  owner could point the extension at another coordinator for tokens still tuning.
- `retrySeed` exists because the coordinator doesn't check the subscription balance
  when it takes a request, so a dry subscription leaves tokens tuning with no error.
