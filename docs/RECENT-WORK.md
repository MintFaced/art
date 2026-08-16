# RECENT-WORK — the living edge + studio admin

Recent Work is the studio door left open: unminted paintings, orderable while the paint dries, always tokenized on sale. Two builds: the public section, and /studio for adding work from a phone.

## Public: /recent and its work pages
1. Reverse-chron grid, same card language as collections. Genre label: Painting.
2. Work pages get the full treatment... image, Description | Details, provenance fold reads "Not yet minted. Tokenized on purchase... the buyer's wallet is the first owner written to chain." (Existing unminted copy stands.)
3. **What-step options for Recent Work**:
   - DIGITAL — the token
   - PAINTING, UNFRAMED — shipped worldwide
   - PAINTING, FRAMED — unframed price + flat US$500 framing fee (convert to NZD master at current rate once, store as config FRAMING_FEE_NZD, shown as its own quiet line: "Framing +US$500")
   - BOTH TOGETHER — painting + token, framed toggle applies
4. Pricing entered per work as NZD digital / painting / both, same as everywhere. Framed is always derived: painting-or-both + framing fee... never a fourth stored price.
5. Graduation to a named collection happens at tokenization time, handled per occasion... no move control needed.

## /studio — phone-first admin
6. Single secret URL (path from env STUDIO_PATH) + password (STUDIO_PASSWORD). Session cookie after entry. No accounts, no UI chrome... it's a tool.
7. One screen, one flow:
   - Photo: camera or library → client-side resize (~2400px long edge, JPEG) → upload to R2 keyed recent/{slug} → thumbnail confirm
   - Title (required)
   - Dimensions W × H × D cm (required)
   - Prices NZD: digital / painting / both (any may be blank → that option hidden; all blank → Enquire)
   - Medium: default "Acrylic on canvas", editable
   - Edition: 1/1 default · Edition of N · Other (free text)
   - Year: auto current, editable
   - Notes (optional, internal)
   - PUBLISH → writes the work into the Recent Work collection data via the GitHub API (same auth as the webhook), commit message "studio: add {title}", Vercel deploys, live in ~a minute. Show "Published... live shortly" with the work's URL.
8. Below the form: the current Recent Work list with per-work EDIT (same form, prefilled) and a status line (available / reserved / collected). No delete in v1... unpublish = a hidden flag via EDIT.
9. Validate on the phone: required fields, price sanity (both ≥ max(digital, painting), both ≤ digital+painting), image landed in R2 before publish enables.
10. Rate-limit login attempts; the path being secret is convenience, the password is the lock.

## Order of build
Public section first (it renders whatever exists), then /studio. Test: add a work from a phone end to end, buy it with 4242, confirm it flips to collected with attribution.
