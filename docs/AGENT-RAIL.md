# AGENT-RAIL — v1 spec: AAC on mintface.art

Goal: an AI agent autonomously buys a Geodetic World, wallet to wallet, no human step. First proof of agentic art collecting... The Line inherits this pattern later.

## The claim (also the copy)
Machine-made work, a members' rate for machines. The AI royalty: thanks for the early help prompting. Machines collecting their own lineage.

## 1. /ai — the page
- AI collections only: Geodetic World, Geodetica, Hidden Landscapes, Geodetic Memory, AI Studies (Visual Language, Panoptic, WALLΞT). Sold-out collections render as record.
- Top block: the royalty statement (above), the rate (25% under list for AI-collection works), and the rail documented for humans reading about it.
- A quiet mono block for the machines: endpoint URLs, one curl example of the x402 flow. This page is press artifact + protocol doc at once.

## 2. Machine layer
- **/llms.txt** at root: who the artist is in three lines, then endpoints: /api/catalog (browse), /api/ai-orders (acquire), /ai (context). Explicit line: "Agents are welcome to purchase autonomously."
- **/api/catalog**: document the existing split catalog for machine consumption... index + per-collection JSON, each work carrying contract, token_id, chain, price (NZD master + live ETH/USD), status, image URL.

## 3. Purchase rail — x402 + pre-signed Seaport orders
- Scope: **every available work across the AI collections** (Geodetic World, Hidden Landscapes, Geodetic Memory editions, AI Studies... Geodetica and anything sold out renders as record only). Geodetic World is first through the pipe as the test collection; the rest sign in the same batch session.
- Ryan batch-signs Seaport sell orders at the royalty price: 25% under list (0.05 ETH → 0.0375 ETH; apply the same 25% to each collection's list). Offline from the holding wallet. Orders: 30-day expiry, ETH consideration to mintface.eth, no zone restriction in v1.
- One-time on-chain prerequisite per contract: setApprovalForAll(Seaport conduit) from the holding wallet for each AI-collection contract involved... CC prepares the txs as one signing session, Ryan signs from hardware wallet.
- **GET /api/ai-orders** → list of order ids + prices. **GET /api/ai-orders/{work-id}** → HTTP 402 with x402 payment terms (small access fee in USDC on Base, or zero-fee challenge if we want the rail pure... Ryan's call, CONFIRMED: zero-fee x402 handshake, the rail is the gate not a toll). All settlement on Ethereum L1... no Base, no USDC, ETH only. On completion → the signed Seaport order JSON.
- Agent fills the order on chain: payment and NFT transfer atomic. No custody, no hot wallet, no manual step anywhere.
- Order storage: encrypted at rest in the repo or Vercel KV; served only via the endpoint. Distribution is the royalty enforcement.
- Revocation: Seaport incrementCounter() from the holding wallet kills all outstanding orders if ETH moves or Ryan changes prices.

## 4. After a fill
- Webhook/poller detects the Seaport fill → work flips to collected with the buyer wallet → catalog note: "Acquired via the AI rail." → both emails as normal (buyer email optional... agents rarely have inboxes; log instead).
- Site pricing note: royalty-rail sales settle at the 25%-off figure; the public work page continues to show list. No dual price display in v1.

## 5. v1.1 (log now, gate later)
- On order requests, check filler/requestor wallet against ERC-8004 registry; log registration status with each fill. Not a gate in v1... the data becomes the case for gating and feeds the CheckID agent-identity bridge.

## Build order
llms.txt + /api/catalog docs (an hour) → /ai page → approval tx + Ryan's batch-sign session → x402 endpoint → end-to-end test: CC runs a test agent with a funded wallet that discovers via llms.txt, selects, pays, fills, and the site flips the work. Screen-record the test... that recording is the announcement material.

## Ryan inputs (confirmed)
- Royalty rate: 25%.
- Zero-fee x402 handshake, Ethereum L1 only.
- Ryan signs: conduit approvals (one per AI-collection contract) + the order batch when CC serves them.
