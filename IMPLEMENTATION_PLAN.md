# Implementation Plan – SealedChart

> Hand this file to Claude Code. It describes what to build, in what order, and how to verify each phase.
> Working name: **SealedChart** (rename freely). UI language: English. Sample people use Vietnamese names.

---

## 0. Summary

A medical record app where:

- Every medical record is **encrypted in the browser** with TideCloak before it reaches Supabase. The database only ever stores ciphertext.
- A doctor can read a patient's records **only during a visit the patient approved**, and only for the specialties in that visit.
- Access is revoked automatically when the visit ends.
- In an emergency, records unlock with **2 of 3 approvals** (emergency doctor, hospital account, family member).
- **Nobody holds a decryption key**, including the hospital account, the server and the developers.

### Core rule: the server never decrypts

All `doEncrypt` / `doDecrypt` calls happen in the browser with the signed-in user's TideCloak session. Next.js API routes only move ciphertext and manage metadata. Never create a "service" account that holds decrypt roles.

---

## 1. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router, TypeScript), Node.js 18.17+ |
| Auth, roles, encryption | TideCloak via `@tidecloak/nextjs` |
| Database | Supabase (Postgres), accessed **only from server routes** with the service-role key |
| Styling | Tailwind CSS |
| Optional chatbot | Any LLM API (key in env), called from a server route |

Useful references:
- TideCloak Next.js SDK README: https://app.unpkg.com/@tidecloak/nextjs/files/README.md
- Next.js example: https://github.com/tide-foundation/tidecloak-client-nextJS
- Getting started: https://github.com/tide-foundation/tidecloak-gettingstarted
- Tide's MCP for coding agents ("Raziel"): see https://github.com/tide-foundation

SDK pieces used:
- `<TideCloakProvider>` in `app/layout.tsx`
- `useTideCloak()` → `authenticated`, `login`, `logout`, `token`, `refreshToken`, `hasRealmRole`, `doEncrypt`, `doDecrypt`
- `verifyTideCloakToken(config, token, roles)` in API routes
- `createTideCloakMiddleware()` in `middleware.ts`
- `doEncrypt` data must be a **string or Uint8Array** → always `JSON.stringify` objects
- Encrypting needs role `_tide_<tag>.selfencrypt`; decrypting needs `_tide_<tag>.selfdecrypt`

---

## 2. Phase 0 – Verify critical assumptions FIRST (stop if any fail)

Build a throwaway page `app/dev/spike/page.tsx` and test these before building anything else. Record results in `docs/SPIKE_RESULTS.md`.

1. **Cross-user decryption.** User 1 (with `_tide_test.selfencrypt`) encrypts the string `"hello"` with tag `test`. Save the ciphertext. User 2 (with only `_tide_test.selfdecrypt`) decrypts it.
   - The whole design depends on this. The official example calls these "self-encryption roles", so it may only work for the user who encrypted the data.
   - **If it fails:** stop and report. Do not continue. The team will ask Tide mentors for the correct cross-user mechanism.
2. **Role management by API.** From a server route, using a TideCloak service-account client, create a realm role, assign it to a user and remove it (Keycloak Admin REST API: `POST /admin/realms/{realm}/roles`, `POST|DELETE /admin/realms/{realm}/users/{userId}/role-mappings/realm`).
   - Check whether the realm's IGA setting turns these into change requests that need approval, and how to approve and commit them (admin console or API). Document the exact steps.
3. **Token refresh.** After assigning a role, confirm `refreshToken()` in the browser returns a token containing it, and that `doDecrypt` now succeeds. After removal and refresh, confirm `doDecrypt` fails.
4. **Batch speed.** Time `doDecrypt` for 1, 10 and 30 items in one call.

---

## 3. TideCloak configuration

Document every manual step in `docs/TIDECLOAK_SETUP.md`.

### 3.1 Server
```bash
docker run -d -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD=password \
  tideorg/tidecloak-dev:latest
```
- Console: http://localhost:8080 (admin / password)
- Activate the license: Identity Providers → tide → Licenses
- Use realm `myrealm` (ships with the dev image) or create `sealedchart` with IGA enabled
- Create the public client for the app, redirect URI `http://localhost:3000/*`, then export the adapter JSON to the project root as `tidecloak.json`
- Create a **confidential service-account client** `sealedchart-admin` with `realm-management` roles to manage roles and role mappings (used only by server routes)
- Set **Access Token Lifespan to 5 minutes**, so revoked roles stop working quickly

### 3.2 Base realm roles (create manually)

| Role | Meaning |
|---|---|
| `benh_nhan` | Patient (also used for family members) |
| `bac_si` | Doctor |
| `benh_vien` | Hospital account: manages doctors, approves emergencies, **cannot read records** |
| `khoa_mat` | Licensed for Ophthalmology |
| `khoa_noitiet` | Licensed for Endocrinology |
| `khoa_capcuu` | Licensed for Emergency |

Specialty roles mean "may practise here". They grant **no** read access.

### 3.3 Per-patient encryption roles (created by the app)

Each patient gets an internal random code like `bn_7f3k9x`. Tags:

| Tag | Content |
|---|---|
| `bn_7f3k9x_mat` | Eye records |
| `bn_7f3k9x_noitiet` | Endocrine records |
| `bn_7f3k9x_thietyeu` | Essentials: allergies, blood type, current medicines |
| `bn_7f3k9x_dinhdanh` | Identity: CCCD number |

For each tag, roles `_tide_<tag>.selfencrypt` and `_tide_<tag>.selfdecrypt`. When a patient registers, the server creates these roles and assigns **all** of them to the patient (patients own their data). Doctors receive them temporarily per visit.

**Never** put a CCCD number in a tag, role name, URL or log.

---

## 4. Architecture

```
Browser (Next.js client)
  ├─ TideCloak login (zero-knowledge)
  ├─ doEncrypt / doDecrypt ──► Tide ORK network (checks roles in token)
  └─ fetch /api/* with Authorization: Bearer <token>
        │
Next.js API routes (server)
  ├─ verifyTideCloakToken + role checks
  ├─ Supabase (service-role key): ciphertext + metadata only
  └─ TideCloak Admin API (service account): create / assign / remove roles
```

- The browser **never** talks to Supabase directly. Enable RLS on every table with **no policies**, so the anon key can read nothing.
- `lib/auth.ts`: helper `requireUser(req, roles?)` that verifies the token, reads `sub` and `realm_access.roles`, and loads the `profiles` row.
- `lib/tidecloakAdmin.ts`: service-account token caching, `createRole`, `assignRoles`, `removeRoles`.
- `lib/tags.ts`: `tagFor(patientCode, kind)` and `rolesFor(tag)`.
- `lib/crypto.ts`: `hmacCccd(cccd)` using `CCCD_HMAC_SECRET` (HMAC-SHA256). **Never** plain SHA-256, because CCCD numbers are easy to brute-force.

---

## 5. Environment variables

`.env.local` (gitignored). Also create `.env.example` with placeholders only.

```
NEXT_PUBLIC_SUPABASE_URL=https://yizzqzuajhygdvfhbpmi.supabase.co
SUPABASE_ANON_KEY=<provided anon key – not used by the browser in this design>
SUPABASE_SERVICE_ROLE_KEY=<from Supabase → Project Settings → API; server only, never commit>

TIDECLOAK_URL=http://localhost:8080
TIDECLOAK_REALM=myrealm
TIDECLOAK_ADMIN_CLIENT_ID=sealedchart-admin
TIDECLOAK_ADMIN_CLIENT_SECRET=<from TideCloak>

CCCD_HMAC_SECRET=<random 32+ byte string>
LLM_API_KEY=<optional, for chatbot>
```

The anon key the team has is meant to be public, but it is only safe because RLS blocks everything. The service-role key must only ever be used server-side.

---

## 6. Database (Supabase)

Create `supabase/migrations/001_init.sql`:

```sql
create table profiles (
  id uuid primary key default gen_random_uuid(),
  tide_user_id text unique not null,          -- token "sub"
  role text not null check (role in ('benh_nhan','bac_si','benh_vien')),
  display_name text not null,
  specialties text[] default '{}',            -- mirror of khoa_* roles, for UI
  created_at timestamptz default now()
);

create table patients (
  code text primary key,                      -- e.g. bn_7f3k9x (random)
  profile_id uuid unique references profiles(id),
  cccd_hmac text unique not null,
  cccd_ciphertext text not null,              -- tag <code>_dinhdanh
  created_at timestamptz default now()
);

create table family_links (
  patient_code text references patients(code),
  family_profile_id uuid references profiles(id),
  relation text,
  primary key (patient_code, family_profile_id)
);

create table records (
  id uuid primary key default gen_random_uuid(),
  patient_code text references patients(code),
  kind text not null check (kind in ('mat','noitiet','thietyeu')),
  tag text not null,
  ciphertext text not null,
  author_profile_id uuid references profiles(id),
  visit_id uuid,
  created_at timestamptz default now()
);

create table visits (
  id uuid primary key default gen_random_uuid(),
  patient_code text references patients(code),
  doctor_profile_id uuid references profiles(id),
  specialties text[] not null,                -- subset of doctor's specialties
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending_consent'
    check (status in ('pending_consent','active','declined','completed','expired')),
  created_at timestamptz default now()
);

create table access_requests (                -- extra specialty during a visit
  id uuid primary key default gen_random_uuid(),
  visit_id uuid references visits(id),
  specialty text not null,
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  created_at timestamptz default now(),
  decided_at timestamptz
);

create table emergency_requests (
  id uuid primary key default gen_random_uuid(),
  patient_code text references patients(code),
  doctor_profile_id uuid references profiles(id),
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','expired')),
  expires_at timestamptz,
  created_at timestamptz default now()
);

create table emergency_approvals (
  request_id uuid references emergency_requests(id),
  approver_profile_id uuid references profiles(id),
  approver_type text not null check (approver_type in ('doctor','hospital','family')),
  approved_at timestamptz default now(),
  primary key (request_id, approver_type)
);

create table role_grants (
  id uuid primary key default gen_random_uuid(),
  doctor_profile_id uuid references profiles(id),
  role_name text not null,
  visit_id uuid references visits(id),
  emergency_id uuid references emergency_requests(id),
  granted_at timestamptz default now(),
  revoked_at timestamptz
);

create table access_logs (
  id uuid primary key default gen_random_uuid(),
  patient_code text references patients(code),
  actor_profile_id uuid references profiles(id),
  action text not null check (action in ('decrypt','encrypt','denied','emergency','grant','revoke')),
  tag text,
  visit_id uuid,
  created_at timestamptz default now()
);

create table demo_settings (
  key text primary key,
  value jsonb not null
);
insert into demo_settings values ('hacker_mode', 'false');

-- RLS on, no policies: only the service-role key (server) can access.
alter table profiles enable row level security;
alter table patients enable row level security;
alter table family_links enable row level security;
alter table records enable row level security;
alter table visits enable row level security;
alter table access_requests enable row level security;
alter table emergency_requests enable row level security;
alter table emergency_approvals enable row level security;
alter table role_grants enable row level security;
alter table access_logs enable row level security;
alter table demo_settings enable row level security;
```

Patient display names are stored in plain text for usability. List this in "Known limitations".

---

## 7. API routes

All routes require a valid TideCloak token. Roles in brackets.

| Route | Purpose |
|---|---|
| `POST /api/profile/sync` [any] | Create or update `profiles` from the token on first login |
| `POST /api/patients/register` [benh_nhan] | Body: `cccd_hmac_input` (raw CCCD sent over HTTPS, hashed server-side, never stored raw), `cccd_ciphertext`. Creates code, roles for all 4 tags, assigns them to the patient. Flow detail in §9.1 |
| `POST /api/patients/lookup` [bac_si, benh_vien] | Body with CCCD → returns `code`, display name, masked CCCD (`0792••••1234`). Never put CCCD in the query string |
| `POST /api/visits` [bac_si] | Create a visit; validate specialties ⊆ doctor's `khoa_*` roles |
| `GET /api/visits` [any] | Patient: own visits. Doctor: own visits. Also lazily expires visits past `ends_at` and revokes roles |
| `POST /api/visits/:id/consent` [benh_nhan] | Approve or decline; caller must own the patient. On approve: grant roles, set `active` |
| `POST /api/visits/:id/end` [bac_si] | Revoke roles, set `completed` |
| `POST /api/visits/:id/requests` [bac_si] | Request an extra specialty |
| `POST /api/requests/:id/decide` [benh_nhan] | Approve or decline; on approve grant that specialty's roles for this visit |
| `GET /api/records?patient=code` [benh_nhan, bac_si] | Return ciphertext only for tags the caller currently holds `selfdecrypt` roles for (layer 1). If `hacker_mode` is on, return **all** records for that patient |
| `POST /api/records` [bac_si, benh_nhan] | Store ciphertext; caller must hold the tag's `selfencrypt` role |
| `POST /api/logs` [any] | Client reports decrypt / denied events |
| `GET /api/logs?patient=code` [benh_nhan] | Patient's access log |
| `POST /api/emergency` [bac_si with khoa_capcuu] | Create emergency request; counts as the doctor approval |
| `POST /api/emergency/:id/approve` [benh_vien or linked family] | Add approval; when 2 types approved → grant `thietyeu` + all specialty roles for 60 minutes |
| `GET /api/demo/raw` [any signed-in] | Raw `records` rows (ciphertext) for the demo screen |
| `POST /api/demo/hacker-mode` [benh_vien] | Toggle `hacker_mode` |
| `POST /api/chat` [bac_si, benh_nhan] (optional) | Body: question + **already-decrypted** context from the browser. Calls the LLM. Never fetches or decrypts anything itself |

Every grant and revoke writes to `role_grants` and `access_logs`. If IGA requires approving role changes, implement the approve/commit step found in Phase 0 inside `lib/tidecloakAdmin.ts`.

---

## 8. Pages

| Path | Who | Content |
|---|---|---|
| `/` | Everyone | Landing, "Login with TideCloak" |
| `/auth/redirect` | Everyone | Required by the SDK |
| `/patient` | benh_nhan | My records (decrypted in browser), pending visit and access requests with Approve / Decline, active grants with Revoke, access log, family emergency approvals |
| `/patient/register` | benh_nhan | First-time setup: enter CCCD, encrypt it, register |
| `/doctor` | bac_si | Today's visits, "Book a visit" (find patient by CCCD, choose specialties and time), emergency button |
| `/doctor/visit/[id]` | bac_si | Records for this visit (decrypted in browser), add new record (encrypted in browser), request extra specialty, end visit |
| `/hospital` | benh_vien | Doctors and their specialties, emergency approvals, hacker mode toggle |
| `/demo/raw-database` | Signed-in | Table of raw ciphertext from Supabase |
| `/dev/spike` | Dev only | Phase 0 tests |

UI requirements:
- When `doDecrypt` fails for an item, show a clear locked card: "Locked – Tide network refused to decrypt" and report a `denied` log.
- Show a banner on `/doctor/visit/[id]` when hacker mode is on.
- Masked CCCD everywhere.
- Watermark (doctor name and time) on decrypted record views.

---

## 9. Key flows

### 9.1 Patient registration
1. Patient logs in. `/api/profile/sync` creates the profile.
2. Patient enters CCCD on `/patient/register`.
3. Server pre-step: `POST /api/patients/register?step=prepare` generates `code`, creates the 8 roles, assigns them to the patient, returns `code`.
4. Browser calls `refreshToken()`, then `doEncrypt([{ data: cccd, tags: [code + '_dinhdanh'] }])`.
5. Browser sends `step=complete` with the CCCD (for HMAC only) and the ciphertext. Server stores HMAC + ciphertext.

### 9.2 Visit (main flow)
1. Doctor books a visit → `pending_consent`.
2. Patient sees "Dr Minh (Ophthalmology) requests your Eye records and Essentials, 08:00–10:00" → Approve.
3. Server assigns `selfdecrypt` + `selfencrypt` for the visit's specialty tags and `selfdecrypt` for `thietyeu`. Visit → `active`.
4. Doctor page polls the visit every 5 s; when `active`, calls `refreshToken()`.
5. Doctor page: `GET /api/records` → ciphertext → one batched `doDecrypt` call → render.
6. New record: `doEncrypt([{ data: JSON.stringify(note), tags: [tag] }])` → `POST /api/records`.
7. End visit (button or `ends_at` passed) → remove roles → `completed`.

### 9.3 Extra specialty
Doctor requests `noitiet` → patient approves → server grants → doctor refreshes token → endocrine records appear.

### 9.4 Emergency
Emergency doctor finds the patient by CCCD, enters a reason → hospital account and family member see it → when 2 approver types exist → grant essentials + all specialties for 60 minutes → log as `emergency` → notify patient (shown on their dashboard).

### 9.5 Optional chatbot
On `/doctor/visit/[id]`, a chat panel sends the question plus the records **already decrypted in the browser** to `/api/chat`. Strip name and CCCD before sending. Answers must cite record IDs and show "Assistive only – not a diagnosis." If the doctor asks about a specialty not in the visit, show a "Request access from patient" button. Store chat history encrypted with the visit's tag, or not at all.

---

## 10. Demo data and accounts

Create these users in TideCloak (document in `docs/DEMO_SCRIPT.md`):

| Account | Roles |
|---|---|
| Patient Nguyễn Thị Lan | benh_nhan |
| Patient Trần Văn Bình | benh_nhan |
| Family: Nguyễn Văn Nam (Lan's brother) | benh_nhan, linked in `family_links` |
| Dr Lê Minh | bac_si, khoa_mat, khoa_noitiet |
| Dr Phạm Hà | bac_si, khoa_noitiet |
| Dr Võ Tuấn | bac_si, khoa_capcuu |
| Hospital account | benh_vien |

Seed records: encryption only works in the browser, so build `/dev/seed`. When a patient is signed in, it encrypts and saves sample Eye, Endocrine and Essentials records for that patient (they hold all their own roles). Use fake CCCD numbers.

---

## 11. Build phases and acceptance checks

| Phase | Deliverable | Done when |
|---|---|---|
| 0 | Spike tests | All four checks in §2 documented; cross-user decryption works |
| 1 | Project skeleton | Next.js + Tailwind + TideCloak login + middleware + profile sync + Supabase migration applied |
| 2 | Patient registration + seed | Patient registers with CCCD; seed records stored as ciphertext; patient can read own records |
| 3 | Visit flow | Booking → consent → doctor reads only that patient's visit specialties → end visit → doctor loses access |
| 4 | Demo screens | Raw database page; hacker mode returns all records but doctor's browser shows them locked |
| 5 | Extra access + patient log | Extra specialty request works; patient sees full access log and can revoke |
| 6 | Emergency | 2 of 3 approvals unlock essentials for 60 min, then expire |
| 7 | Optional chatbot | Summaries with citations; prompt injection cannot reveal locked data |
| 8 | Polish | README, docs, demo rehearsal |

Test these negative cases explicitly:
- Doctor opens another patient's records → locked
- Doctor opens a specialty not in the visit → locked
- After visit end + token expiry → locked
- Hospital account tries to decrypt any record → locked
- Hacker mode on → ciphertext delivered, decryption refused

---

## 12. Known limitations (say these openly in the pitch)

- The app server decides when to grant and revoke roles, and counts emergency approvals. A fully compromised server with the admin service account could grant roles. Production should rely on TideCloak's quorum-approved role changes (IGA) so no single server or admin can do this.
- Already-decrypted data can be copied or photographed by the viewer. Mitigated by audit logs and watermarks only.
- Access logs for decryption are reported by the client.
- The CCCD lookup HMAC key lives on the server.
- Patient display names are stored in plain text.
- If the optional chatbot uses an external LLM API, the provider sees the decrypted context. Production should use a hospital-hosted model.

---

## 13. README.md (create at repo root exactly as below)

~~~markdown
[![Built with TideCloak](https://tide.org/badges/built-with-tidecloak.svg)](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked)

## Project overview

SealedChart is a medical record that doctors can read only during a patient-approved visit, and that nobody else, not even the hospital, can read.

Built with [TideCloak](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked).

### 1. Vision & originality

A consent-first medical record. Access follows the visit, not the job title: an eye doctor sees a patient's eye history only for the visit she approved, and loses it when the visit ends. Emergencies use a 2-of-3 "break-glass" approval.

### 2. Trust constraint insight

Hospital systems today trust administrators, IT staff and servers with every record. One stolen admin account can leak everyone's health history, so patients cannot really control who sees what. Remove that trust, and patients can share precisely, temporarily and verifiably.

### 3. Value & impact

Patients gain control and a visible audit trail. Hospitals get a model suited to Vietnam's data protection rules, which treat health data as sensitive. Example: Lan visits an eye clinic. Her doctor needs her diabetes history, Lan approves it on her phone in seconds, and access expires after the visit.

### 4. Why TideCloak matters

- Every record is encrypted in the browser with a per-patient, per-specialty tag.
- Decryption succeeds only when Tide's decentralized network confirms the doctor holds the role granted for that visit.
- No key exists anywhere to steal: the database, server and hospital account hold only ciphertext.
- Zero-knowledge login means the hospital never handles passwords.

### 5. Prototype & storytelling

Watch for:

1. A doctor books a visit; the patient approves on her phone and the record unlocks.
2. The doctor tries another patient's record: refused.
3. "Hacker mode" makes the server return every record, yet the network refuses to decrypt.
4. The raw database shows only ciphertext.
5. Emergency: two approvers unlock an unconscious patient's essentials.

## Setup

Prerequisites: Node.js 18.17+, Docker Desktop, a Supabase project.

1. Clone the repo and open the folder: `cd sealedchart`
2. Start TideCloak:
   `docker run -d -p 8080:8080 -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=password tideorg/tidecloak-dev:latest`
3. Open http://localhost:8080, activate the license, then create the roles, clients and demo users in `docs/TIDECLOAK_SETUP.md`. Download the adapter as `tidecloak.json` to the project root.
4. In Supabase → SQL Editor, run `supabase/migrations/001_init.sql`.
5. Copy `.env.example` to `.env.local` and fill in the values.
6. Install and run: `npm install` then `npm run dev` (Windows: `npm.cmd install`, `npm.cmd run dev`).
7. Open http://localhost:3000 and click **Login with TideCloak**.
8. Follow `docs/DEMO_SCRIPT.md` to seed data and run the demo.
~~~

Keep sections 1–5 of the README at **300 words or fewer**. Update the Setup section if implementation details change.

---

## 14. Files Claude Code should create

- `README.md` (§13)
- `.env.example`, `.gitignore` (includes `.env.local`, `tidecloak.json`)
- `supabase/migrations/001_init.sql` (§6)
- `docs/SPIKE_RESULTS.md`, `docs/TIDECLOAK_SETUP.md`, `docs/DEMO_SCRIPT.md`
- `middleware.ts`, `app/**`, `lib/**` as described above
