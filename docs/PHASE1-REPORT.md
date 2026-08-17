# Phase 1 ... catalog enumeration report

Generated 15 August 2026 from chain data. Output: `catalog.json` at the repo root (4.0 MB, 1,885 work records).

Sources: Blockscout v2 (Ethereum), public Ethereum RPC (ENS resolution, `tokenCreator` calls), ordinals.com recursive endpoints (Bitcoin Ordinals), xchain.io + counterparty.io (Counterparty), networked.art and rrrecursive.com for contract discovery. No API keys required, so this is all reproducible from the scripts.

## What is in catalog.json

Every token carries: title, token_id, contract, chain, standard, image, animation, on-chain mint timestamp + tx, current owner (address and ENS where set), status, and empty slots for your overlay (`pricing_nzd`, `physical` dimensions, `collector.display_name`, `collector.note`).

Status is derived from the current owner:

- `available` ... held by mintface.eth, ryanj.eth, the Foundation market escrow (listed), or the PixelArcade contract
- `vaulted` ... held by mintestate.eth
- `acquired` ... held by anyone else, with ENS resolved and acquisition date from the last transfer
- `burned` ... held by 0x0 or 0x...dEaD
- `sold_out` ... edition works with no artist-held copies

| Collection | Works | Available | Acquired | Vaulted | Burned | Contract |
|---|---:|---:|---:|---:|---:|---|
| PixelArcade | 64 | 63 | 1 | 0 | 0 | `0x97536ECC25Ae0A7ABAde7C2Bba1925CA6Eba30E8` |
| Artificial Flowers | 22 | 15 | 5 | 2 | 0 | `0xD64aC59835a9951f34472239ba70B44c5BEBe90d` |
| Patrimora | 181 | 12 | 121 | 48 | 0 | `0xEabffdE679Fe5F0b835771aeA36d90C1ce7502d8` |
| Two Burdens | 36 | 17 | 16 | 3 | 0 | `0xE1d1F99505A13d20B25D5Ef32280771d7Eb5ED09` |
| Hidden Landscapes | 18 | 12 | 2 | 4 | 0 | `0x38bae13b27222900c32Ec28ab28b54Cd61196045` |
| Roads & Rivers | 216 | 39 | 149 | 3 | 25 | `0x18bd004e13258F569ceDFbb537bA329e4730eE67` |
| Geodetic World | 95 | 68 | 27 | 0 | 0 | `0xE16c77A770C6De5439F617e6E2F9fD46BB15D396` |
| Geodetica | 100 | 13 | 80 | 7 | 0 | `0xF6f44F3ddE8EA78A3F49F78EecA339FFA17B2933` |
| Geodetic Illusions | 69 | 60 | 4 | 5 | 0 | `0x38bae13b27222900c32Ec28ab28b54Cd61196045` |
| Geodetic Moments | 78 | 14 | 53 | 10 | 1 | `0x495f947276749Ce646f68AC8c248420045cb7b5e` |
| Geodetic Memory | 832 | 1 | 811 | 2 | 18 | `0xa81f8083072F192948dcaE38DA5c0C6073DA979c` |
| Geodetic On-Chain | 4 | 4 | 0 | 0 | 0 | `0x7b5ccc13ffacf2bc8204be1359a3eea3cae4dce4` |
| Geodetic Home | 1 | 1 | 0 | 0 | 0 | `0x7b5ccc13ffacf2bc8204be1359a3eea3cae4dce4` |
| Visual Language | 35 | 30 | 5 | 0 | 0 | `0x75e7c7c2e507e6d95c20bcde14135035e7e7a88a` |
| Panoptic | 10 | 9 | 1 | 0 | 0 | `0x3ee441f307c4bf147849d15457339d6116bb8373` |
| WALLΞT | 10 | 10 | 0 | 0 | 0 | `0x7f51b00487fb9de02fe64cd5b5df073ba62e681d` |
| Recursive Mind | 9 | 9 | 0 | 0 | 0 | `bc1pnx85u4nlvy7q3sce5xvhm6e38fyve8eeg98kwu2c2e9v054jmj3suqsmrd` |
| FROGDNA | 1 | 1 | 0 | 0 | 0 | `FROGDNA` |
| 2022 (10k Project) | 6 | 6 | 0 | 0 | 0 | `0xe5eb0070a13f868a72996a568e12d085413445b8` |
| The Vault | 92 | 0 | 0 | 92 | 0 | `` |

**1885 work records enumerated.**
The Vault row counts your own works only. mintestate.eth holds 250 NFTs in total: 92 MintFace works plus 158 collected pieces (123 of them Seize And Share).

## Contract addresses, expanded

All eleven truncated addresses in the seed resolved to exactly one match each. Every collection contract was deployed by mintface.eth, apart from the two Geodetic Sculpture contracts (ryanj.eth).

| Collection | Address | Std | Deployed |
|---|---|---|---|
| PixelArcade | `0x97536ECC25Ae0A7ABAde7C2Bba1925CA6Eba30E8` | 721 | 2026-06-01 |
| Artificial Flowers | `0xD64aC59835a9951f34472239ba70B44c5BEBe90d` | 721 | 2025-10-09 |
| Patrimora | `0xEabffdE679Fe5F0b835771aeA36d90C1ce7502d8` | 721 | 2025-02-03 |
| Two Burdens | `0xE1d1F99505A13d20B25D5Ef32280771d7Eb5ED09` | 721 | 2024-08-21 |
| Geodetic AI (Hidden Landscapes + Geodetic Illusions) | `0x38bae13b27222900c32Ec28ab28b54Cd61196045` | 721 | 2022-03-02 |
| Roads and Rivers | `0x18bd004e13258F569ceDFbb537bA329e4730eE67` | 721 | 2022-10-10 |
| Geodetic World | `0xE16c77A770C6De5439F617e6E2F9fD46BB15D396` | 721 | 2023-09-25 |
| Geodetica | `0xF6f44F3ddE8EA78A3F49F78EecA339FFA17B2933` | 721 | 2022-08-11 |
| Geodetic On-Chain + Geodetic Home | `0x7b5ccc13ffacf2bc8204be1359a3eea3cae4dce4` | 1155 | 2022-02-18 |
| Geodetic Moments | `0x495f947276749Ce646f68AC8c248420045cb7b5e` | 1155 | OpenSea shared storefront |
| Geodetic Memory | `0xa81f8083072F192948dcaE38DA5c0C6073DA979c` | 721 | networked.art shared contract |
| Visual Language | `0x75e7c7c2e507e6d95c20bcde14135035e7e7a88a` | 721 | 2022-11-14 |
| Panoptic | `0x3ee441f307c4bf147849d15457339d6116bb8373` | 721 | 2023-03-29 |
| WALLΞT | `0x7f51b00487fb9de02fe64cd5b5df073ba62e681d` | 721 | 2022-12-09 |
| 2022 (10k Project, the 1/1) | `0xe5eb0070a13f868a72996a568e12d085413445b8` | 721 | 2022-05-07 |
| 10k commemoration editions | `0xe125091e7c669d47e374d7f23bc857789f701780` | 1155 | 2022-05-08 |

Wallets: mintface.eth `0xd40B63bF04a44e43fBFE5784bCf22ACaAB34a180`, ryanj.eth `0xdD6B80649e8D472EB8fb52eb7eEcFd2Dc219AcE7`, mintestate.eth `0x6e420B64bb329bE84a6627c68A7BdFf825139773` (all forward and reverse verified).

Two addresses to know when reading owner fields: `0xcDA72070E455bb31C7690a170224Ce43623d0B6f` is the Foundation market escrow, so anything sitting there is yours and listed. `0xa9B3B278b8d8492Fc5F27B78ac6E26A88202A9A5` is the PixelArcade contract holding 63 of the 64 pixel paintings.

## Genesis timeline, from chain

**City versus Nature** ... Rarible ERC-1155 `0xd07dc4262BCDbf85190C01c996b4C06a461d2430` token `518231`. Minted **2021-04-26 03:22:16 UTC**, five editions straight to ryanj.eth, tx `0x1322d01c496c24f30c570e4af6a26d4d636825607a063f2cb910a7b570e862db`. This is the first NFT mint by any of your wallets, so the genesis claim holds. The brief says 25 April: 03:22 UTC is 25 April in US time zones and 26 April in New Zealand, so the date in the Genesis piece depends on which clock you want to tell it from. On-chain title is "City versus Nature", not "City vs Nature".

**Geodetic Moments** ... the brief expects a first mint in August 2021. There is nothing on chain in August. These were lazy-minted on the OpenSea shared storefront, where creation is off-chain and nothing is written until the first sale. The earliest on-chain event is **2021-10-02 07:26:24 UTC**, Geodetic Moment #33 to genesis.articulate.eth. If the August date matters for the Genesis piece it needs to come from your OpenSea records, not the chain.

**Foundation 1/1s** ... six, not seven or eight. Verified by calling `tokenCreator()` on the Foundation contract for every Foundation token that has ever touched your wallets: gm (91077), gn (91080), Mountains on Mountains (91070), True Identity (105105), wen moon (109050), Geodetic Moment (132520). Minted between 2021-09-25 and 2022-01-27. Four of the six are currently listed in Foundation escrow.

## Corrections to the seed

- **FROGDNA is not an Ordinal.** It is a Counterparty asset on Bitcoin, part of the Fake Rare series. Asset `FROGDNA`, id 1753067758, supply 88 (locked), issued from `1GpCYqHS3sqvg4n837NJmcsmWLfAssXcqK`. 43 holders; you hold 33 natively. A further 30 of the edition are wrapped in EmblemVault as one ERC-1155 (`0x4C03BCAD293fb0562D26FAa7D90A0cb3Ea74c919`, "FROGDNA | Series 18 Card 9") across 10 holders: 14 with mintface.eth, 8 in the vault, 8 with collectors. That is the only wrapped token on that contract, so the ETH path has 14 available today.
- **Geodetic Illusions is 69 works, not 87.** 87 is the whole Geodetic AI contract: 69 Illusions plus the 18 Hidden Landscapes. Split cleanly on description ("Dark hearts of kings and queens geo-located by AI" for the Illusions).
- **Geodetic Memory is 832 minted, not 823** (18 burned, 814 live, 1 still held by you).
- **Visual Language is 35, not 31. Panoptic is 10, not 9. Artificial Flowers is 22, not 21.** WALLΞT is 10 as stated.
- **Roads & Rivers** ... 40 tokens named "Roads and Rivers #N" and 168 edition tokens (156 Traffic, 12 Rivers End), plus 8 burned. The seed said 36 x 1/1 and 162 editions.
- **Geodetic On-Chain** ... five tokens on the shared 1155: Geodetic Moment Light (81 minted), Geodetic Moment Dark (86), Geodetic Signal (100), Patrimora (26), Geodetic Home (15). Not "2 x 100". Geodetic Home is token 5 on the same contract, kept as its own collection in the catalog.
- **Patrimora** ... 181 tokens minted on the Highlight contract, not 469. 48 of them are in the vault.
- **Geodetic Memory contract is ERC-721**, not 1155 as the seed had it.

## Gaps that need you

1. **Geodetic Moments: 78 of 100 located.** The missing 22 (#7, 9, 10, 13, 24, 25, 27, 28, 31, 32, 40, 43 to 51, 53, 58, 59, 96, 97, 99, 100) have no on-chain footprint touching your wallets, which is what lazy minting looks like when a piece sold straight from OpenSea. The OpenSea API needs a key for every NFT endpoint now, and the collection page is client rendered, so neither is reachable from here. A free key from opensea.io/account/developer closes this in one pass.

   The fallback has now been run and come back empty. `scripts/catalog/24-os-deepscan.mjs` probed 3,188 storefront token ids: every index from 401 to 1500 at supply 1, and all 226 unused indexes below 400 against nine plausible supply values. Zero hits. Storefront ids encode creator, index and supply, so this covers the space those 22 could occupy. They have no chain record at all, which means they were never transferred, so OpenSea's own database is the only place they exist. Worth checking whether the collection is genuinely sold out or whether those 22 are still sitting lazy-minted and unsold.
2. **Recursive Mind: resolved.** The canon is thirteen thoughts, and rrrecursive.com lists all thirteen with titles, motifs and images. Eight are inscribed on Bitcoin (thoughts one to eight, inscribed 13 February 2025, all at your ordinals wallet). Five are not yet inscribed: children of the geodetic, encirclement, crossing through, distant scope, dark summer. The ninth inscription, RRRECURSIVE, is the collection cover rather than a work, which is where the "9 inscribed" count came from. The catalog now carries thirteen works, five of them in a new `uninscribed` state.

3. **Statements still empty** ... PixelArcade, Artificial Flowers, Patrimora, FROGDNA, Recursive Mind. Every other collection statement is filled, several straight from the token metadata.
4. **Prices, dimensions, collector display names** ... every slot exists in the catalog, all null.
5. **ID Please was missing from the catalog entirely** (found in Phase 2, while rebuilding the provenance table from the old site). Meme Card 362, season 11, in The Memes by 6529, contract `0x33fd426905f149f8376e227d0c9d3340aad17af1` token 362. Minted 27 August 2025, 328 editions, 232 holders, none held by your wallets. The old provenance table listed it as "1/1 + 328 editions"; the chain shows 328 of token 362, so if there is a separate 1/1 it lives somewhere else and needs pointing out.
6. **Three things on chain that the seed does not mention.** Seize And Share (`0xe63f4E6CE4110A2faD3DE9ed38e7eA5858EB953b`, deployed June 2022, 838 holders, 123 in the vault). Now enumerated in Phase 2: 3,257 tokens, 72 works across 46 series, all derivatives of meme cards by other artists, kept as an archive. Two Geodetic Sculpture 1/1 contracts deployed by ryanj.eth on 20 June 2026, both still held by you. And the Purple MintPass (100 passes, `0xE35CB2BE...`), which I left out of the catalog as it is access rather than artwork. Say where these should sit, if anywhere.
7. **Geodetica contract carries two extra works** ... Trouble Ahead (78 editions) and AInception (1/1). Listed under `other_works` in the catalog awaiting placement.
7. **Token 4 on the Geodetic On-Chain contract is called "Patrimora"** (26 editions), predating the 2025 Patrimora collection. Worth deciding whether it reads as part of Patrimora or stays in the on-chain set.

## Data completeness

- 1,879 token records across the collections, plus 6 more under Genesis and the 10k feature.
- On-chain mint date and tx on 1,694 of them. The 185 without are OpenSea storefront and Rarible tokens where the mint predates any transfer the indexer holds.
- Acquisition date on 1,224 of the 1,275 acquired works.
- 614 distinct collector addresses, 214 of them with an ENS name resolved. Those 214 are the ones that can show a name on a work page today; the rest need your mapping.
- 6 works have no image URL in their metadata: the six burned Roads & Rivers tokens.

## Notes for Phase 2

`catalog.json` is 4 MB, most of it the 832 Geodetic Memory editions and the 216 Roads & Rivers tokens. Before the site loads it client-side it should be split: a small `catalog.index.json` for browse, and per-collection files fetched on demand. Edition sets can collapse to one work record plus a holder count rather than one record per edition.

The enumeration scripts are committed at `scripts/catalog/`, with a README covering the run order. Re-run them any time to refresh owners and statuses after a sale. They need no API keys and no build step, so nothing about the repo ethos changes.
