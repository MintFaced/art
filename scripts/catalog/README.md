# Catalog enumeration (Phase 1)

Rebuilds `catalog.json` at the repo root from chain data. No API keys needed.

```
npm install          # js-sha3, for keccak / ENS namehash
node 00-wallets.mjs      # resolve + reverse-verify mintface.eth, ryanj.eth, mintestate.eth
node 01-discover.mjs     # candidate contracts from wallet holdings, match seed's truncated addresses
node 02-enumerate.mjs contracts.json   # token instances for the dedicated contracts
node 02-enumerate.mjs contracts2.json  # Visual Language, Panoptic, WALLΞT
node 03-shared.mjs       # artist tokens on OpenSea storefront / Rarible / Foundation / networked.art
node 04-analyze-shared.mjs
node 05-os-scan.mjs      # OpenSea storefront ids are creator+index+supply, so scan the index space
node 06-foundation.mjs   # tokenCreator() to prove which Foundation 1/1s are yours
node 07-mints.mjs        # every mint received by the wallets (genesis timeline)
node 08-ordinals.mjs     # Recursive Mind inscriptions (needs rrr.html, see below)
node 09-ord-address.mjs  # everything at the ordinals wallet (needs ordaddr.html)
node 10-os-detail.mjs    # holders + first/last transfer per storefront token
node 11-minted.mjs       # Geodetic Memory on the networked.art shared contract
node 12-vault.mjs        # mintestate.eth holdings
node 13-contract-meta.mjs
node 21-transfers.mjs    # mint date + acquisition date per token (slow, ~10 min)
node 23-memory-transfers.mjs  # same for the 832 Geodetic Memory editions (~5 min)
node 20-build.mjs        # writes /catalog.json
node 22-report.mjs       # summary table
```

Scripts write their fetched data to `raw/`, which is gitignored: it is a cache, delete it to re-fetch.

Two scripts read saved HTML because the sources are client-rendered:

```
curl -sL -A 'Mozilla/5.0' https://rrrecursive.com -o rrr.html
curl -sL https://ordinals.com/address/bc1pnx85u4nlvy7q3sce5xvhm6e38fyve8eeg98kwu2c2e9v054jmj3suqsmrd -o ordaddr.html
curl -sL https://xchain.io/api/holders/FROGDNA -o frogdna-holders.json
```

Data sources: Blockscout v2 (`eth.blockscout.com`), public Ethereum RPC (publicnode, drpc, 1rpc, flashbots), ordinals.com recursive endpoints, xchain.io / counterparty.io.

To refresh statuses after a sale, re-run `02` (or `10`/`21` for the shared contracts) then `20`.
