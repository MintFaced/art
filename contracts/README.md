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
npm ci && (cd .. && npm ci)               # the JS checks use the root's packages too
node ../scripts/strips/build-engine.mjs   # writes build/engine.js.gz
forge build
forge test --no-match-path 'test/fork/*'
forge test --match-path 'test/fork/*'     # FORK_URL to use your own node
node ../scripts/strips/test-chain.mjs     # JS against Solidity, byte for byte
node ../scripts/strips/test-mint.mjs      # the buyer's path on a local chain
node ../scripts/strips/test-render.mjs    # the token plays with the network blocked
node ../scripts/strips/test-snapshot.mjs  # the snapshot rule, and the tool when things go wrong
node ../scripts/strips/test-secrets.mjs   # nothing about the method in any of it
```

## Mainnet, in order

Sepolia first, the same way, on a test Creator Core. Set `STRIPS_NETWORK=sepolia` and
the cron's keys become `strips:sepolia:…`, so a rehearsal can use the same store as
mainnet and touch nothing of it. Sepolia's VRF v2.5 coordinator
and key hash are on Chainlink's supported networks page. `CLAIM_WINDOW=<seconds>` in
step 4 shortens the claim there. It's a constructor argument, so the bytes are the
same, and the script refuses it on mainnet.

Before step 4, have someone other than the deployer read the values that can't be
changed afterwards: `PRICE`, the caps, the TAO rates, `CORE`, `ESTATE`.

1. **Core.** In Manifold Studio, from the MintFace wallet, deploy an ERC721 contract
   named //STRIPS. Set a 5% royalty to `0xd40B63bF04a44e43fBFE5784bCf22ACaAB34a180`
   (mintface.eth, resolved 2026-11-05). Then check what Studio actually deployed. The
   fork tests pin `0x5133522ea5A0494EcB83F26311A095DDD7a9D4b6`. If this prints anything
   else, rerun them against that implementation before going on:

   ```sh
   cast storage $CORE 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc --rpc-url $RPC
   ```
2. **VRF.** At vrf.chain.link, make a v2.5 subscription and fund it. Native payment
   is on by default, so ETH works. Note the subscription id.
3. **Voucher key.** Generate a fresh key, add it to Vercel as `STRIPS_VOUCHER_KEY`
   (Sensitive). Only its address goes in the next step.
4. **Deploy.** The MintFace key lives on a hardware signer. `--sender` is the wallet
   on the Ledger, and it's needed: without it Foundry warns it's using its default
   sender. Run it once with no `--broadcast` first. That's a free simulation, and it
   proves the device and the derivation path are the ones you think they are.

   ```sh
   CORE=0x... OWNER=0xd40B63bF04a44e43fBFE5784bCf22ACaAB34a180 \
   ARTIST=0xdD6B80649e8D472EB8fb52eb7eEcFd2Dc219AcE7 \
   PAYOUT=0xd40B63bF04a44e43fBFE5784bCf22ACaAB34a180 \
   ESTATE=0x6e420B64bb329bE84a6627c68A7BdFf825139773 \
   VOUCHER_SIGNER=0x... VRF_SUB_ID=... \
   VRF_COORDINATOR=0xD7f86b4b8Cae7D942340FF628F82735b7a20893a \
   VRF_KEY_HASH=0x3fd2fec10d06ee8f65e7f2e95f5c56511359ece3f33960ad8a866ae24a8ff10b \
   ETHERSCAN_API_KEY=... \
   forge script script/Deploy.s.sol --rpc-url $RPC --ledger \
     --sender 0xd40B63bF04a44e43fBFE5784bCf22ACaAB34a180 \
     --broadcast --verify
   ```

   That key hash is the 500 gwei lane, checked on-chain on 2026-11-05. `ARTIST` is
   ryanj.eth, the second wallet that can `ownerMint`. If the deployer isn't the MintFace
   wallet, the MintFace wallet calls `acceptOwnership()` on the extension and on the
   ledger: ownership of both takes two steps, and neither can be renounced.
5. **Connect.** Add the extension as a consumer on the subscription, then from the
   MintFace wallet call `registerExtension(extension, "")` on the core.
6. **Tell the site.** Merge `strips-mint` to main if it isn't: the routes, the console
   and the snapshot tool only exist there. Fill in `data/strips.json`, commit it, push
   and wait for the deploy. `first_block` is the core's deploy block, or any block before
   the first mint. The nightly TAO run starts the core's event file there, so if it's
   left empty, nothing earns TAO and the run alarms. In Vercel, check `OPENSEA_API_KEY`
   is set, and set `ETH_RPC` to a paid node. Without one the site reads through shared
   public endpoints, and during a claim a failed read pauses the mint for everyone.
7. **Snapshot 1.** On the day, after the nightly TAO run has landed on `origin/main`.
   In this order, because the site has to serve the proofs before the claim opens:

   1. Pull main, then build it. `--rpc-a` and `--rpc-b` must be different providers.
      It reads delegations at one block through each and exits 1, writing nothing, on
      any read failure, a register behind `origin/main`, a TAO run that failed or is
      over 26 hours old, or two tables that differ. There's no flag past any of these.

      ```sh
      node scripts/strips/snapshot.mjs --id 1 --rpc-a $RPC_A --rpc-b $RPC_B
      ```

   2. Audit it straight away, while the node still has that block. This rebuilds the
      table and compares every row, works out every wallet's TAO by hand, reads the
      table's own fields, and checks what the events say is held, and each edition's
      supply, against the chain. **The console won't publish without a pass.**

      ```sh
      node scripts/strips/audit-snapshot.mjs data/strips-snapshot-1.json --rpc $RPC_A
      ```

      A pass writes `data/strips-snapshot-1-audit.json`. If it fails:

      - **The table disagrees with a fresh build, the sum by hand, or its own fields.**
        Stop. Don't accept anything. Run the build again from step 1, and if it fails
        the same way, find out why before going on.
      - **A holding or a supply disagrees with the chain.** Look at each one. A sale after
        last night's TAO run shows up here: waiting for the next run clears it, or accept
        it. An event the cache lost is real: fix the cache, let the TAO run land on main,
        and go back to step 1. Anything you can't explain and that touches a wallet with
        free mints is a stop.
      - **To accept one**, list it with its reason, and audit again. The reason is
        published in the audit file, so write it for a stranger to read:

        ```sh
        echo '[{"wallet":"0x...","contract":"0x...","token":"362","reason":"..."}]' > accept.json
        node scripts/strips/audit-snapshot.mjs data/strips-snapshot-1.json --rpc $RPC_A --accept accept.json
        ```

      A build older than about half an hour may need building again first, because an
      ordinary node won't have its block any more.

   3. Read `data/strips-snapshot-1-exclusions.csv`. That's the list that gets published.
   4. Put `strips-snapshot-1.json`, its audit file and the two CSVs on Arweave.
   5. **Deploy the proofs.** Commit `data/strips-snapshot-1.json`, `data/strips-snapshot-1-audit.json`
      and both CSVs, push to main, and wait for the deploy. Check it:
      `curl -s https://mintface.art/data/strips-snapshot-1.json | jq .root` has to print
      the root from step 1, and so does `.../strips-snapshot-1-audit.json`. If this is
      skipped, the console won't publish.
      If the file ever goes missing after publishing, every mint button goes to paused
      and vouchers stop, for everyone, until it's back. That's on purpose.
   6. Publish from /mintwork/strips. Paste the root and the `ar://` URI. The console
      rebuilds the root from the deployed table and from the copy on Arweave and refuses
      if either differs. The date and the free mints it reserves are read from the table.

   The window runs 30 days from this publish. If it's late, the deadline is late. It
   can be moved later from the console, and never earlier. If an incident closes the
   mint, extend before the deadline. After it the reserve goes back to paid supply, and
   one paid mint can leave too little to reopen, so close the mint before it passes.

   Until the first claim lands a wrong table can be replaced: rebuild as `--id 2`, deploy
   it, publish it, then **Point the claim at it**. The first claim freezes the root, and
   nobody can claim until step 10, so check it before then.
8. **Street works.** Mint the existing ones to mintestate.eth from /mintwork/strips.
9. **Mint 1, quietly.** `ownerMint` needs no open mint, and nothing tweets while the
   mint is closed. Send it to mintface.eth or ryanj.eth: on any other wallet the next TAO
   run earns on it, and the snapshot tool can't see //STRIPS tokens yet, so a corrected
   table couldn't build. The design hex comes from the preview route:
   `curl -s -X POST https://mintface.art/api/strips/preview -d '<a mint spec>' | jq -r .design`.
   Mint it from the console, and check it on a marketplace before anything is announced.
10. **Open.** `setMintOpen(true)`. It reverts until a snapshot is published.

## The public allowance

`publicMinted + unclaimedReserve` never passes 621. A paid mint, an `ownerMint` and a
twin all stop at that line, so a sell-out can't take a free mint that's owed. ryanj.eth
stops sooner, at 69 in all, which is the most a stolen copy of that key can take. Claims
draw the reserve down as they land, and when the deadline passes, whatever's left
goes back to paid supply on its own. `extendClaim` after that works only if what's
owed still fits, so it never promises what's been sold. Nothing mints past 690.

The figure the ledger reserves is the table's sum, which the console reads from the
table. It can't be checked on-chain, so sign only what the console builds. If the ledger
ever holds a different figure from the table, the site pauses the mint.

## Rules for the core

- Register the extension with an empty base URI. Never pass a URI when minting
  through it, or Manifold serves that instead of the extension's `tokenURI`.
- Never unregister or blacklist the extension. Its tokens depend on it for metadata.
- Never call the core's `mintBase`, or register a second extension. 690 is enforced
  by the extension. The core's owner can mint around it, and nothing here can stop
  that without giving up ownership of the core.
- `freezeRenderer()` is permanent. It freezes the renderer and nothing else: see below.

## Things a reviewer should look at

- `approveTransfer` isn't called on mints, by design of the core, so `_mint` starts
  the clock itself. It's called on burns, which is harmless.
- `_safeMint` calls out to a contract buyer before the extension has stored the
  token. Every counter and the design hash are written first, the core and the
  extension are both `nonReentrant`, and the two fields the callback could touch
  are overwritten after it. See `test_reentrancy_aHostileReceiverCannotMintTwice`.
- The voucher nonce isn't stored: a design can only be minted once, so a voucher
  can only be used once. That saves a storage write on every mint.
- `setCoordinator` comes from Chainlink's base contract, isn't virtual, and stays with
  the owner after the renderer is frozen. A word can't be replaced once it has landed,
  but an owner could point the extension at another coordinator for tokens still tuning.
  `setApproveTransfer` also survives the freeze, as do the core's own powers.
- `viem`'s `multicall` with `allowFailure` reports a dead provider as a row of failed
  calls, so the snapshot tool calls Multicall3 directly. Don't "simplify" that.
- `retrySeed` exists because the coordinator doesn't check the subscription balance
  when it takes a request, so a dry subscription leaves tokens tuning with no error.
