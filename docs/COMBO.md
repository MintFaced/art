# COMBO — wallet grouping across two registries

**Crazy Obvious Merging, Because Onboarding.**
A collector's hot wallet and vault(s) act as one voice: the COMBO. The vault signs a one-time delegation — on Delegate Cash or the 6529 NFTDelegation registry — and the hot wallet deploys the combined TAO here. The vault never connects to the site. Two registries, one COMBO.

## Scope
Every TAO gate honours the COMBO: nudge weighing, the 69k notes privilege, chat access, and any future gate. One coherent promise: your TAO works from your hot wallet.

## Registries (unioned)
1. **Delegate Cash** (delegate.xyz, v2 with v1 fallback): accept wallet-level ("ALL") delegations AND the scoped rights string **`mintface`** — cautious vaults can delegate to this site alone.
2. **6529 NFTDelegation** (NFTDelegation.com): accept the **'All' use case (#1)** as equivalent to Delegate's ALL. Other use-case codes ignored in v1 — their scoped semantics are Memes-specific; our cautious-scope need is covered by Delegate's `mintface` rights. State the mapping plainly on /combo.
3. **Union rule**: read incoming delegations for the connected wallet from both registries, verify each on-chain, union into one COMBO. A vault delegating to the same hot wallet in both registries is ONE member. One hop only: vault→hot honoured, chains ignored. Batched lookups; fail open — either registry down degrades to the other, both down degrades to solo. COMBO is additive; a registry hiccup never blocks a plain connect.

## Mechanics — the three moments
4. **Make the COMBO (session start)**: on SIWE sign-in, build the COMBO from both registries. Session carries members + combined TAO. Nav/name area shows the quiet mono marker: `COMBO · 2 WALLETS`.
5. **Weigh time**: available TAO = COMBO total minus anything any member already has committed on that nudge. No wallet counts twice across any COMBO. Vault-connects-directly resolves by latest-stands; ledger shows the move.
6. **Close clamp**: at nudge close, per member — delegation still active on-chain (in whichever registry granted it) AND TAO still held. Revocation or sell-down clamps like a sale. Chain truth at all three moments; no delegation state cached across days.
7. **Register unchanged**: leaderboard, collector pages, TAO totals stay per-wallet chain truth. COMBO is a voting-time power, not a register merge. Ledger rows attribute to the connected wallet's name + the COMBO marker.
8. **Notes gate**: 69k checks COMBO total at post time. Chat gate likewise.

## /combo — the page is the product
9. Linked from the studio, nudge cards, and the collector's own page. House voice, three steps, near-zero jargon. Opens:
   "Your vault holds the art. Your hot wallet does the talking. A COMBO lets the two act as one — the vault signs once, ever, and never connects here. Crazy Obvious Merging, Because Onboarding."
10. **Two doors, one outcome**:
    - **Door one — Delegate Cash**: OPEN DELEGATE.XYZ, deep-linked with delegate-to = their connected hot wallet and rights = `mintface` prefilled where their URL/API supports it; exact values shown in mono with copy buttons where not. Sign from the vault on Delegate's own audited site — we deliberately never proxy a vault signature.
    - **Door two — 6529 NFTDelegation**: "Already delegated for the Memes? Your COMBO may exist already — sign in and see." OPEN NFTDELEGATION.COM with the same prefill-or-copy treatment, use case 'All'.
11. **Step 2 — Reconnect**: "Sign in here with your hot wallet." **Step 3 — Done**: live detection flips the page to "YOUR COMBO · vault.eth + hot.eth · 847,231 TAO" with the member list and which registry granted each.
12. **Ambient discovery**: any signed-in wallet with existing incoming delegations (either registry) gets its COMBO formed silently — collectors who delegated years ago for allowlists find it already works. A small "what's this?" beside the marker links /combo.
13. **Revocation honesty**, stated on the page: "Revoke any time at the registry you used. A revoked delegation drops from your COMBO within the session, and at any nudge close it clamps like a sale."

## Acceptance
14. Real test delegations, both registries: (a) Delegate ALL, (b) Delegate rights=mintface, (c) NFTDelegation use case All, (d) the same vault in both registries → one member. Hot connects → COMBO forms → weighs combined → vault sells a work → close clamps → revoke → COMBO drops next session. Notes gate passes at combined ≥ 69k where solo fails. The vault never appears in any connect flow. Marker renders on ledger, collector page, and OG surfaces consistently.

## Noted, not now
- Agent wallets holding delegated TAO — the same rails let a machine weigh with its owner's seniority. Nothing here precludes a COMBO member being an agent.
- Profile-visible linked wallets (opt-in) if collectors ask for it.

## Note copy discipline
The em dashes in this file are structural markdown for CC; site copy follows the house rule — ellipses, never em dashes.
