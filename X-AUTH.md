# X-AUTH — sign in with X first, wallet second

X login becomes the everyday key. The wallet is signed once to prove holdings, then rarely touched again. This kills the mobile WalletConnect pain for daily use: weigh in, chat, react — all on an X session.

## Identity model
1. One account, two credentials. An account can hold: a verified X identity (via OAuth) and one or more wallets (via SIWE, plus COMBO delegation as already built). Either credential logs you into the same account.
2. TAO stays wallet-born. X login alone (no wallet ever linked) = spectator: can read everything, cannot chat, weigh in, or set a display name. The moment a wallet with TAO is linked, the account acts with that wallet's TAO under either login method.
3. The link is permanent until the user unlinks. Linking a wallet requires a SIWE signature; linking X requires completing the OAuth flow. No admin-side linking except the existing artist overlay (below).

## Sign in with X — OAuth 2.0 PKCE
4. Same developer app as the tweet bot. The OAuth 2.0 Client ID and Client Secret already exist on it (Keys & Tokens, bottom section). Env vars: X_OAUTH_CLIENT_ID, X_OAUTH_CLIENT_SECRET — Production, plaintext not Sensitive (we learned this the hard way). Names only here; Ryan pastes values.
5. Flow: /api/auth/x → X authorize (PKCE, state) → /api/auth/x/callback → fetch users/me (id, username, name, profile_image_url) → session. Scopes: users.read tweet.read offline.access — nothing more. We never tweet as users.
6. Store the X user **id** as the stable key, username as display data (handles change, ids don't). Refresh username/avatar on each login.
7. Callback URLs registered in the app's User authentication settings: https://mintface.art/api/auth/x/callback and https://collectors.mintface.art/api/auth/x/callback (or one callback + SSO redirect — CC's call, but the session must land on the .mintface.art cookie either way).

## Session — long, both methods
8. One session system regardless of entry: the existing .mintface.art-scoped cookie + shared SESSION_SECRET. Lifetime 90 days, rolling — any visit inside the window re-extends. Signing in again is the only re-auth event.
9. SIWE sessions get the same 90-day rolling treatment (up from whatever they are now). One connect a season, not one a session.
10. Sign out kills the cookie everywhere (both subdomains).

## Surfaces
11. Connect UI everywhere becomes two options, X first:
    - **CONTINUE WITH X** (primary, black button, X glyph)
    - **CONNECT WALLET** (secondary, existing MF.enter() path)
    Copy under: "X to sign in · wallet to prove your art". No modal stacking — same inline pattern as now.
12. First X login with no wallet: land on their (spectator) state with one quiet prompt where TAO would act: "LINK A WALLET TO WEIGH IN — one signature, once." That prompt runs the existing wallet connect and links to the current account.
13. Wallet-first collectors (everyone today): a LINK X button on their own page + in the profile menu. Runs the OAuth flow, attaches the X identity.
14. Nav name precedence once linked: existing display-name precedence stands; X is identity plumbing, not a new name tier — except where no name exists at all, then @handle renders.

## X handle display — verified beats typed
15. The existing typed X-handle field survives but verified OAuth handles override it and render with no change in style (absence of a "verified" badge; the register stays quiet — verification is plumbing, not decoration).
16. Artist overlay handles remain until that collector verifies via OAuth; verified wins over overlay. Tweet bot tagging reads the same resolved handle (verified > overlay > typed), so bot tags get more accurate for free.
17. Unlinking X clears the verified handle; typed/overlay value resurfaces if present.

## Rainbow mobile — finish the fixes (wallet is backup, still must work)
18. Verify the pageshow re-sync landed on every MF.enter() surface (home, /studio, /claim, /combo, /activate) — returning from the wallet app must advance the page when pairing/signature completed while we were backgrounded.
19. Home sign-step button: after pairing succeeds but before signature, the button state must offer SIGN IN — no dead end.
20. The decisive test stays: fresh throwaway wallet in Rainbow iOS, full pair + sign on mobile Safari. Ryan runs it; instrument enough that one failed run tells us which side dropped it (sign-issued vs sign telemetry already distinguishes refused / never-answered).
21. If Rainbow still won't answer personal_sign on some accounts after all this, the X-first flow is the mitigation: link the wallet on desktop once, use X on mobile forever. Add one line to the link-wallet prompt on mobile only: "Easiest on a computer — then X is all you need here."

## Data
22. Accounts table (or extend the existing session/profile store): account_id, x_id, x_handle, x_avatar, linked_wallets[], created, last_login, login_method. Wallet remains the join key to TAO/register — nothing in TAO computation changes.
23. Collision rule: an X identity can link to exactly one account; a wallet to exactly one account. Attempting to link an already-claimed credential fails with a plain sentence, no merge UI in v1 (artist can resolve manually if it ever happens).

## Acceptance
24. Fresh phone, no wallet app installed: CONTINUE WITH X → sign in → reads studio, sees own spectator state, chat composer shows the link-wallet line instead of input.
25. Same account links a wallet with TAO on desktop → phone X session (no re-login) can now weigh in and chat.
26. Existing SIWE collector links X → handle renders on their page and in tweet-bot tags; typed handle overridden; unlink restores it.
27. Close browser, return day 30: still signed in (both methods). Day 91 idle: signed out cleanly.
28. Second account tries to link the same X identity: refused with the plain sentence.
29. Rainbow: fresh-wallet mobile pair + sign completes, or telemetry names the dropping side.

## Ryan inputs
- Paste OAuth 2.0 Client ID + Client Secret into the two new Production vars (both projects if collectors deploys separately).
- Add the two callback URLs in the X app's User authentication settings (App permissions can stay Read and write; sign-in doesn't need more).
- Run the fresh-wallet Rainbow test when 18–19 deploy.
