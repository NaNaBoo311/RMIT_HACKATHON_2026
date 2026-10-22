[![Built with TideCloak](https://tide.org/badges/built-with-tidecloak.svg)](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked)

## Project overview

AIgree is a medical record that doctors can read only during a patient-approved visit, and that nobody else, not even the hospital, can read.

Built with [TideCloak](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked).

### 1. Vision & originality

A consent-first medical record. Access follows the visit, not the job title: an eye doctor sees a patient's eye history only during a visit the patient approved, and loses it when the visit ends. Emergencies use a 2-of-3 "break-glass" approval.

### 2. Trust constraint insight

Hospital systems trust administrators, IT staff and servers with every record. One stolen admin account can leak everyone's health history; patients cannot control who sees what. Remove that trust, and patients can share precisely, temporarily and verifiably.

### 3. Value & impact

Patients gain control and a visible audit trail. Hospitals get a model suited to Vietnam's data protection rules, which treat health data as sensitive. Example: Lan's eye doctor needs her diabetes history; she approves on her phone in seconds, and access expires after the visit.

### 4. Why TideCloak matters

- Records are encrypted in the browser, one compartment tag per patient and specialty.
- Access is a Tide policy (built-in `RelationshipAttestation` contract) naming one doctor and one compartment, expiring at visit end.
- The server cannot create a valid grant: only the hospital's Tide enclave can sign one, after the patient consents. The hospital holds no `_tide_decryptor` role.
- The Tide network refuses anyone not named, even when the server hands out ciphertext (the "breach drill").
- Zero-knowledge login: the hospital never handles passwords.

### 5. Prototype & storytelling

Watch for:

<<<<<<< HEAD
Provenance of the final result (trained on Modal, app IDs, billing, Kaggle history): [`docs/C1_PROVENANCE.md`](docs/C1_PROVENANCE.md).

### AI model & research
=======
1. The patient approves a visit, the hospital co-signs, and the record unlocks.
2. The doctor tries another patient's record: refused.
3. Breach drill: the server hands out every ciphertext; the Tide network still refuses.
4. Emergency: 2 of 3 approvers unlock an unconscious patient's records for 60 minutes.
>>>>>>> 9b38b2b (feat: initialize web application)

Video (2 min): [`docs/demo.mp4`](docs/demo.mp4)

## Setup

Prerequisites: Node.js 22+ (Next.js 16 and supabase-js need it; runs on 24), Docker, `curl` and `jq`, bash (Linux, macOS or WSL), and a Supabase project.

1. Open the app folder: `cd aigree`
2. Create `.env` (read only by the init script). Copy just the **first block** of `.env.example`, the four `KC_*` / `TIDE_*` lines, and fill in:
   - `KC_BOOTSTRAP_ADMIN_PASSWORD`: a password for the local TideCloak master admin.
   - `TIDE_LICENSE_EMAIL`: a real address you control. It manages the Tide licence.
   - `TIDE_TERMS_ACCEPTED=yes`: only if you have read and agree to https://tide.org/legal.

   Do not copy the whole file: the `<...>` placeholders in the second block break `npm run init`.
3. `npm install`
4. `npm run init`. It starts TideCloak in Docker, creates realm `aigree` (client `aigree-client`) with the app roles and six user accounts, licenses it and enables IGA. It prints invite links (also saved to `data/invite-links.txt`). Open each link in its own browser profile or private window and create a Tide account: first `admin(hospital)` (the hospital account), then each user. When all are linked, the script finishes and writes `data/tidecloak.json` and `data/admin-policy.json`. Every step is explained in [`docs/TIDECLOAK_SETUP.md`](docs/TIDECLOAK_SETUP.md).
5. In Supabase, open the SQL Editor and run `supabase/migrations/001_init.sql`.
6. Create `.env.local` from the **second block** of `.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`: your project's URL.
   - `SUPABASE_SERVICE_ROLE_KEY`: from Supabase, Project Settings, API. Server only; never commit it.
   - `CCCD_HMAC_SECRET`: a random string of 32+ bytes, for example from `openssl rand -base64 48`.
   - `LLM_API_KEY` (optional): an Anthropic API key for the visit chatbot.
   - Keep `TIDECLOAK_URL=http://localhost:8080` and `TIDECLOAK_REALM=aigree`.
7. `npm run dev`, then open http://localhost:3000 and sign in.
8. Follow [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md) to set up the accounts and records, then walk through the flows.

### Run with the local TideCloak stand-in

The app can also run against a local stand-in for TideCloak and the Tide network, `aigree/tide-local/`. It provides TideCloak sign-in, the realm roles and the Tide network's `RelationshipAttestation` checks, with the same refusal messages. Where each piece fits in live TideCloak is mapped in [`docs/TIDECLOAK_INTEGRATION_PLAN.md`](docs/TIDECLOAK_INTEGRATION_PLAN.md).

1. `cd aigree && npm install`, then run the Supabase migration (step 5 above) and create `.env.local` (step 6) with `TIDE_MODE=local` and `NEXT_PUBLIC_TIDE_MODE=local`.
2. `npm run tide:local` in one terminal (the stand-in on :8090), `npm run dev` in another. `npm run dev:local` starts both.
3. Open http://localhost:3000/login and choose an account. Each browser tab holds its own account.
4. Optional checks: `npm run tide:check` (network refusals) and `npm run flows:check` (visit flow through the API).

Switch to live TideCloak by setting both variables to `live` after `npm run init` succeeds. The server accepts only the configured mode's tokens.

## Known limitations

- The hospital account is the realm's only Tide signer (threshold 1). Production would use several admins and a quorum, ideally a custom Forseti contract so that the patient's consent is itself cryptographic. Today the app server records consent, and the hospital co-signs.
- The app server counts emergency approvals (2 of 3) before it asks the hospital to sign.
- Already-decrypted data can be copied or photographed. Only a watermark and the access log discourage this.
- Decrypt and "denied" entries in the access log are reported by the browser.
- Revoking a grant stops the server serving that policy. A copied policy still works for the named doctor until its expiry, which the Tide network enforces.
- The HMAC key used for CCCD (ID card) lookup lives on the server.
- Patient display names are stored in plain text.
- The optional chatbot sends decrypted context to an external LLM API. Production should use a hospital-hosted model.
- **Local TideCloak stand-in.** Our TideCloak realm could not be licensed in time (Tide's licensing service returned an error), so the prototype runs against a local stand-in (`aigree/tide-local/`) that reproduces TideCloak sign-in, roles and the Tide network's RelationshipAttestation checks but holds whole keys in one process and has no password step or DPoP; the live TideCloak path is built and switches on with `TIDE_MODE=live`.

## Docs and repository layout

- [`docs/TIDECLOAK_SETUP.md`](docs/TIDECLOAK_SETUP.md): every TideCloak step, and troubleshooting.
- [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md): accounts, setup steps and the 2-minute walkthrough.
- [`docs/SPIKE_RESULTS.md`](docs/SPIKE_RESULTS.md): Phase 0 findings, and why grants are signed policies, not roles.
- [`docs/TIDECLOAK_INTEGRATION_PLAN.md`](docs/TIDECLOAK_INTEGRATION_PLAN.md): where TideCloak fits, trust boundaries, and the live and local checklists.
- `aigree/`: the app (Next.js, TideCloak, Supabase). `aigree/tide-local/`: the local TideCloak stand-in.
- `core-ai/`, `backend/`, `frontend/`: earlier QuorumGate and Challenge 1 work, separate from AIgree. See [`docs/QUORUMGATE_README.md`](docs/QUORUMGATE_README.md).
