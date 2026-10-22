# TideCloak integration plan

How AIgree uses TideCloak and the Tide network, what the local stand-in replaces, and how to check each part. Sources are cited as "Tide agent pack canon/<file> <entry>" (tide-pack MCP v1.9.33).

## 1. Purpose and status

| Item | Status |
|---|---|
| Live path (real TideCloak + Tide network) | **Built.** Sign-in, server-side JWT + DPoP checks, `RelationshipAttestation:1` grants, browser encrypt/decrypt, hospital co-signing in the Tide enclave. |
| Realm licensing | **Blocked.** `npm run init` fails at `setUpTideRealm`: Tide's licensing service returns HTTP 500 on `FinalizeWallet` (see [`SPIKE_RESULTS.md`](SPIKE_RESULTS.md), "Live results"). Nothing live can run until a realm is licensed. |
| Local mode | A local process, `aigree/tide-local/server.mjs` (port 8090), stands in for TideCloak (sign-in, roles, token signing) and for the Tide network (the `RelationshipAttestation:1` checks, policy signing, encryption). Wire protocol: [`aigree/tide-local/PROTOCOL.md`](../aigree/tide-local/PROTOCOL.md). |

**Mode switch.** Two variables in `aigree/.env.local`, and both must match:

| Variable | Read by | Values |
|---|---|---|
| `NEXT_PUBLIC_TIDE_MODE` | Browser (`src/lib/tide/mode.ts`) | `local` or `live` (unset means live) |
| `TIDE_MODE` | Next.js server | `local` or `live` |

The server accepts **only** the configured mode's tokens. A local-mode token sent to a live server is refused, and a live token sent to a local-mode server is refused too. In local mode the server verifies the token against the public key that the stand-in writes to `data/tidecloak.local.json`, and it does not check DPoP.

**Switching to live once a realm is licensed:**

1. `cd aigree && npm run init`, then link every account (see [`TIDECLOAK_SETUP.md`](TIDECLOAK_SETUP.md)). This writes `data/tidecloak.json` and `data/admin-policy.json`.
2. **Wipe the Supabase rows** (profiles, patients, records, grants, visits, logs). Local-mode data cannot be reused: its ciphertext uses the stand-in's own format, its signed policies are not Tide policies, and its `sub` / `tideuserkey` values are derived from a hash of the username.
3. Set `NEXT_PUBLIC_TIDE_MODE=live` and `TIDE_MODE=live`.
4. Stop the local stand-in and restart `npm run dev`. `NEXT_PUBLIC_*` values are fixed when Next.js starts or builds.
5. Redo the setup in [`WALKTHROUGH.md`](WALKTHROUGH.md), then run the live checklist in section 5.

## 2. Where TideCloak fits

| Touchpoint | Live TideCloak mechanism | App file(s) | Local stand-in | What local mode does NOT give you |
|---|---|---|---|---|
| **Sign-in** | OIDC redirect to TideCloak. The password is verified by threshold PRISM across the Tide network's ORKs, and no password hash is stored anywhere (BYOiD). *Tide agent pack canon/feature-mapping.md "Login / SSO / Logout"* | `src/app/providers.tsx`, `src/lib/tide/client.tsx`, `src/lib/session.tsx` | Account picker at `/login`: `GET /users`, then `POST /login {username}` returns a token. | No password step and no authentication of any kind: anyone who can reach port 8090 gets a token for any user. No threshold verification. |
| **Token signing + server-side JWT verification** | The token is signed by the realm's VVK through a threshold of ORKs. The server verifies it with `jose` against the **embedded JWKS** in `data/tidecloak.json` (no remote JWKS fetch), then checks `iss`, `azp` (not `aud`), `exp` and `iat`. Roles are read only from the verified `realm_access.roles`. *canon/feature-mapping.md "JWT Verification (Server-Side Authorization)", "Adapter JSON Configuration"* | `src/lib/auth/tideJWT.ts`, `src/lib/auth/tidecloakConfig.ts`, `src/lib/auth/localTideJWT.ts` (local mode), `src/lib/requireUser.ts`, `src/lib/http.ts` (`route()`) | One ES256 key in `tide-local/.state/keys.json` signs tokens. Its public half is in `data/tidecloak.local.json`. Same claims (`iss` on `http://localhost:8090/realms/...`, `azp`, `realm_access`, `tideuserkey`), plus a `tide_local: true` marker. The server runs the same `iss`/`azp`/`exp` checks. | The signing key is whole, in one file. Whoever holds it can mint a token for any user with any role. Tokens last 3600 s; the live template sets 300 s. |
| **DPoP proof-of-possession** | `dpop.bound.access.tokens` on the client: the token carries `cnf.jkt`, and `IAMService.secureFetch` sends a fresh proof with each call. The server rejects a bound token sent as `Bearer`, and checks the proof's signature, `htm`, `htu`, `iat`, `jti` replay, `ath` and `cnf.jkt`. *canon/feature-mapping.md "DPoP Token Binding (API Security)"* | `src/lib/auth/verifyDpop.ts` (called from `requireUser`), `src/lib/api.ts`, `scripts/realm.json.template` | None. Plain `Authorization: Bearer`. | A stolen token can be replayed from any machine until it expires. |
| **Roles** | Realm roles `benh_nhan`, `bac_si`, `benh_vien`, `khoa_mat` / `khoa_noitiet` / `khoa_capcuu`. Patients and doctors also hold `_tide_encryptor` and `_tide_decryptor`. The hospital holds client role `realm-management/tide-realm-admin` and never `_tide_decryptor`. The UI uses roles only to show or hide things (UI gating); **real enforcement is server-side**: `route(handler, { roles })` checks roles from the verified token on every API route, and the Tide network checks `_tide_*` roles on every encrypt/decrypt. *canon/feature-mapping.md "Role-Based Route Protection (Client-Side)"; canon/security-gap-mapping.md SG-04* | `scripts/realm.json.template`, `src/lib/requireUser.ts`, `src/lib/http.ts`, the `src/app/api/**/route.ts` files | Roles copied from `realm.json.template` `users[]` when the stand-in starts. The hospital (`admin`) gets `benh_vien` + `tide-realm-admin` and never `_tide_decryptor` / `_tide_encryptor`. | Roles are not threshold-signed or IGA-governed: they are whatever the stand-in's code and the template say. |
| **Records E2EE (`RelationshipAttestation:1`)** | Shared, policy-governed encryption, not self-encryption (*canon/feature-mapping.md "Choosing the Encryption Model"*). The contract is built into the ORKs, so nothing is deployed. One policy has **one tag** (the compartment, `<patientCode>_<kind>`) as `assignmentId`; a `User` subject, which is the grantee's `tideuserkey`; roles `_tide_decryptor` (read) or both roles (read-write); and an expiry at visit end (60 min for an emergency, 365 days for the patient). The browser encrypts and decrypts. The network refuses a wrong subject, a wrong or extra tag, an expired policy, or a caller without the role. Rules: [`SPIKE_RESULTS.md`](SPIKE_RESULTS.md) check 1 and the pack's `relationship.ts` template. *canon/security-gap-mapping.md SG-06* | `src/lib/tide/relationship.ts`, `src/lib/tide/sealed.ts` (`decryptItems`, `encryptForTag`), `src/lib/tags.ts`, `src/app/api/records/route.ts` | `POST /encrypt` and `/decrypt` run the same checks in the same order, with the **same refusal messages** (for example `subjectId does not match.`). AES-256-GCM with a key derived by HKDF from one master secret for each `assignmentId`. | No threshold decryption: the stand-in holds the master secret and can decrypt every record. Plaintext passes through the stand-in's process. Ciphertext is not compatible with live mode. |
| **Grant signing in the hospital's enclave** | Two steps in the hospital's browser. `prepareGrants` builds each policy and calls `createTideRequest` before the click. On the click, `approveAndSign` opens **one** Tide enclave popup for the batch. Each approved request has the realm **admin policy** (`data/admin-policy.json`) attached and is signed by the network. The server only creates `pending_signature` rows and stores the signed bytes, after checking that each policy's contract, subject, tag, roles and expiry match the grant. It has no signing endpoint and no TideCloak admin credential. *canon/security-gap-mapping.md SG-07* (signer = `tide-realm-admin`) | `src/lib/tide/sealed.ts`, `src/lib/tide/localTide.tsx` (local mode), `src/app/hospital/page.tsx`, `src/app/api/grants/sign/route.ts`, `src/app/api/tide/admin-policy/route.ts`, `src/lib/tidecloakAdmin.ts`, `src/lib/grants.ts` | `prepareGrants` builds plain policy objects. An in-page "Tide enclave" dialog asks the hospital to approve. Then `POST /policies/sign` (the caller must hold `tide-realm-admin`) signs with the stand-in's VVK key and returns `policyB64`. | No isolated enclave: the dialog is part of the app's own page. No admin policy and no network approval. Whoever holds the VVK key, or a hospital token, can sign any grant. |
| **IGA governance of role changes** | `npm run init` enables IGA (order: licence, then IGA, then E2EE). While the realm is in FirstAdmin mode the script approves role change requests itself. After the first `tide-realm-admin` is linked, the realm is in MultiAdmin mode, and every role grant is a change request that needs an admin's enclave approval. **Not used at runtime:** the app never changes roles, because access is a signed policy and not a role. *canon/feature-mapping.md "IGA Quorum Approval"; canon/security-gap-mapping.md SG-07* | `scripts/init-tidecloak.sh` | None. Roles are fixed when the stand-in starts; to change them, edit the template and restart. | No change requests, no quorum, no cryptographic sealing. |
| **Access log / audit** | The Tide network enforces access, but the app does not receive a log feed from it. The app's log is the Supabase `access_logs` table. The **server** writes grant, sign and revoke entries. The **browser** reports decrypt and denied entries through `POST /api/logs`, and the actor is always the verified caller. Patients see their log on `/patient`. | `src/lib/grants.ts` (`logAccess`), `src/app/api/logs/route.ts` | Same `access_logs` table. The stand-in also prints one stdout line per request (time, endpoint, user, `assignmentId`, ALLOW or DENY with the reason), never plaintext. | The stdout log is not tamper-evident, and the process that writes it is the same one that holds the keys. |

## 3. Trust boundaries

```
                         ciphertext + signed policies + metadata only
  +-----------------+    (token + DPoP proof in live; Bearer in local)  +----------------------+   service-role key   +------------+
  |  Browser        | ------------------------------------------------> |  Next.js server      | -------------------> |  Supabase  |
  |  (patient /     | <------------------------------------------------ |  (src/app/api)       | <------------------- |  (Postgres)|
  |   doctor /      |                                                   |  verifies token,     |                      | ciphertext,|
  |   hospital)     |                                                   |  checks roles,       |                      | grants,    |
  |                 |                                                   |  NO decryption key   |                      | logs       |
  |  plaintext only |                                                   +----------------------+                      +------------+
  |  exists here    |
  |                 |   sign-in, encrypt/decrypt, grant signing
  |                 | ------------------------------------------------> LIVE:  TideCloak :8080 + Tide network (ORKs)
  |                 |                                                    keys split across ORKs; nobody holds them whole
  |                 | ------------------------------------------------> LOCAL: tide-local :8090 (one local process)
  +-----------------+                                                    holds the WHOLE token key, VVK key and data master
                                                                         secret in tide-local/.state/keys.json
```

- **In both modes the Next.js server never holds a decryption key.** It stores and serves ciphertext and signed policies only. Its sensitive secrets are `SUPABASE_SERVICE_ROLE_KEY`, `CCCD_HMAC_SECRET` and the optional `LLM_API_KEY`.
- **In local mode, the stand-in does hold the keys.** Treat the `tide-local` process and `tide-local/.state/keys.json` (gitignored) as fully trusted: reading that file means being able to read everything.
- Live: the hospital's signing approval happens in Tide's enclave window, separate from the app's page. Local: it happens in a dialog on the app's own page.

## 4. Security gaps closed vs residual risks

**Gaps from Tide agent pack canon/security-gap-mapping.md:**

| Entry | Gap | Live mode | Local mode | Evidence |
|---|---|---|---|---|
| SG-03 | Bearer tokens with no proof-of-possession | **Closed.** DPoP-bound tokens, and `verifyDpop` runs on every API call. | **Open.** Bearer only, 3600 s tokens. | `realm.json.template` (`dpop.bound.access.tokens`), `requireUser.ts` |
| SG-04 | Client-side-only authorization | **Closed.** UI gating is UX only. Every route file under `src/app/api` goes through `route()`, which verifies the token and enforces roles. | **Closed** for the Next.js server (same `route()` checks, against tokens signed by the stand-in). Tokens can be minted freely, though (see residual risks). | `http.ts`, `requireUser.ts` |
| SG-05 | Unprotected or partially protected APIs | **Closed.** Route-by-route enumeration on 2026-10-22: every `route.ts` exports only `route(...)`-wrapped handlers. Re-run this check whenever a route is added. | Same | `src/app/api/**/route.ts` |
| SG-06 | Server-readable sensitive data | **Closed.** Records are encrypted in the browser. Server and database hold ciphertext only, and decryption needs the Tide network and a matching signed policy. | **Closed for the Next.js server and Supabase. Not closed overall:** the stand-in holds the master secret. | `sealed.ts` |
| SG-07 | Unilateral admin power | **Partly closed.** The app server holds no TideCloak admin credential and changes no roles at runtime, and grants need the hospital's enclave signature. But the hospital is the **only** signer (quorum `max(1, floor(0.7 x 1)) = 1`). The cryptographic IGA guarantee also needs a **Tide-licensed** realm (`iga.attestor=tide`), and licensing is what is blocked. | **Open.** Any holder of the hospital token or the VVK key signs alone. | `tidecloakAdmin.ts`, README "Known limitations" |

**Residual risks: both modes** (from README "Known limitations")

| Risk | Note |
|---|---|
| Single Tide signer (threshold 1) | Production needs several admins and a quorum, ideally a custom Forseti contract, so that the patient's consent is itself cryptographic. Today the app server records consent and the hospital co-signs. |
| Emergency 2-of-3 is counted by the app server | The server decides when to ask the hospital to sign. |
| Decrypted data can be copied or photographed | Only the watermark and the access log discourage this. |
| Decrypt and denied log entries come from the browser | A modified client can skip reporting them. |
| Revoking a grant is server-side only | A copied policy still works for the named doctor until its expiry, which the network enforces. |
| `CCCD_HMAC_SECRET` lives on the server | Whoever has the server can look up a patient by ID number. |
| Patient display names are stored in plain text | |
| The chatbot sends decrypted context to an external LLM | Production should use a hospital-hosted model. |
| Visit start is enforced by the server only | A Tide policy has an expiry but no not-before (`activeGrantsFor`). |

**Residual risks: local mode only**

| Risk | Note |
|---|---|
| Whole keys in one file | `tide-local/.state/keys.json`: token key, VVK key and data master secret. Reading it means being able to mint tokens, forge grants and decrypt every record. |
| No authentication | `POST /login {username}` hands out any user's token. CORS (localhost:3000 only) does not stop curl. |
| No DPoP, 1-hour tokens | A stolen token can be replayed. |
| One process enforces the contract | That process is not a threshold of ORKs: whoever runs or edits it can change the rules. |
| Enclave approval is an in-page dialog | It has no isolation from the app's own scripts. |
| Data does not carry over to live | Wipe Supabase when switching (section 1). |
| Mode mismatch | If `NEXT_PUBLIC_TIDE_MODE` and `TIDE_MODE` differ, every API call returns 401. This fails safely, but it looks like an outage. |

## 5. Verification checklist

**Live mode** (after section 1's switch; record the results in `SPIKE_RESULTS.md`, "Live results")

| # | Check | How | Expected |
|---|---|---|---|
| L1 | Adapter has an embedded JWKS and a vendor id | `jq '.jwk, .vendorId' data/tidecloak.json` | Both non-null (*canon/feature-mapping.md "Adapter JSON Configuration"*) |
| L2 | Admin policy exported | `[ -s data/admin-policy.json ]` | File present |
| L3 | Own round-trip | Lan opens `/patient` after setup | Her records decrypt |
| L4 | Wrong tag, two tags on one item | Covered in local mode by `npm run tide:check` | Refused |
| L5 | Foreign policy and breach drill | Breach drill on; Dr Minh opens a visit page with a compartment he has no grant for | Locked, `subjectId does not match` |
| L6 | Batch decrypt time | A patient with many records opens `/patient` | All decrypt; note the time |
| L7 | No token | `curl -i http://localhost:3000/api/grants` | 401 |
| L8 | Bound token replayed as `Bearer`, without a DPoP proof | `curl -i -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/grants` | 401 ("presented without the DPoP auth scheme") |
| L9 | Local-mode token sent to the live server | Same curl with a token from the stand-in | 401 |
| L10 | Wrong role | Patient calls `POST /api/grants/sign` | 403 |
| L11 | Every row of the "Checklist of expected results" table in [`WALKTHROUGH.md`](WALKTHROUGH.md) | The realm's accounts | As listed: Bình's records locked for Dr Minh, locked after the visit ends, hospital locked, breach drill refused, Dr Hà locked, Supabase `records` table ciphertext only |

**Local mode**

Results on 2026-10-22: `npm run tide:check` **29/29 pass**. `npm run flows:check`, run against the app with the real Supabase project, **24/24 pass**. It covers registration → hospital co-sign → visit consent → doctor decrypt → refusals (another user's policy, hospital, breach drill) → end visit → tampered token. A local-mode token checked against the live JWKS is rejected (`ERR_JWKS_NO_MATCHING_KEY`).

| # | Check | How | Expected |
|---|---|---|---|
| S1 | Protocol checks | `npm run tide:check` | All pass. They cover PROTOCOL.md's seven ordered checks and their exact messages: bad or expired token gives 401 `Invalid token: ...`; then `Policy supplied has not been signed.`, `Policy has expired.`, `Every item must be tagged with the assignmentId.` / `Tags do not contain assignmentId.` (including two tags), `subjectId does not match.`, `<role> not found in list of roles.`, `'<role>' role not found for this <encryption\|decryption> request.` Also: tampered ciphertext gives 400 `Decryption failed.`, an unknown username gives 404, and `/policies/sign` called without `tide-realm-admin` gives 403. |
| S2 | Keys stay out of the app | `grep -rn "keys.json" aigree/src` | No hits: the Next.js server reads only the public `data/tidecloak.local.json` |
| S3 | A live token sent to the local-mode server, or a local-mode token sent to a live server | curl | 401 |
| S4 | Hospital cannot decrypt | Hospital account | `'_tide_decryptor' role not found for this decryption request.` |
| S5 | The [`WALKTHROUGH.md`](WALKTHROUGH.md) checklist, run end to end | The stand-in's accounts, `npm run dev:local` | Same outcomes as live. The refusal text matches the live contract's text. |
| S6 | No plaintext in the stand-in's log | Read the `tide-local` stdout during S5 | Only ALLOW/DENY lines, no record content |
