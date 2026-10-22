# Walkthrough

How to set up the accounts and records, and a 2-minute walkthrough of AIgree's flows.

## Local TideCloak stand-in

- Start `npm run tide:local` and `npm run dev` in `aigree/` (`.env.local` has `TIDE_MODE=local` and `NEXT_PUBLIC_TIDE_MODE=local`), or `npm run dev:local` for both.
- Sign in from the account picker at `/login`. **Each browser tab keeps its own account**, so one browser window with a tab per person is enough.
- The hospital's "Approve in Tide enclave" opens an in-page **"Tide enclave"** dialog instead of Tide's popup.
- Refusals use the same messages as the Tide contract (`subjectId does not match.` and so on), so locked cards look the same as in live mode.

## Accounts

| Person | TideCloak username | Role in the app | Realm roles |
|---|---|---|---|
| Hospital account | `admin` (shows as "User Admin") | Hospital: co-signs grants, approves emergencies, runs the breach drill | `benh_vien` (no `_tide_decryptor`) |
| Nguyễn Thị Lan | `lan` | Patient | `benh_nhan` |
| Trần Văn Bình | `binh` | Patient | `benh_nhan` |
| Nguyễn Văn Nam | `nam` | Lan's brother (family member) | `benh_nhan` |
| Dr Lê Minh | `minh` | Doctor: Ophthalmology and Endocrinology | `bac_si`, `khoa_mat`, `khoa_noitiet` |
| Dr Phạm Hà | `ha` | Doctor: Endocrinology | `bac_si`, `khoa_noitiet` |
| Dr Võ Tuấn | `tuan` | Doctor: Emergency | `bac_si`, `khoa_capcuu` |

Patients, family and doctors also hold `_tide_encryptor` and `_tide_decryptor`. Those are capabilities only: each user still needs a signed policy for each compartment.

CCCD (citizen ID) numbers:

| Patient | CCCD |
|---|---|
| Nguyễn Thị Lan | `079301001234` |
| Trần Văn Bình | `079302005678` |

Type a CCCD only into the registration or lookup form. The app never puts it in a URL.

Dr Phạm Hà is not needed in the walkthrough. Use her for extra refusal checks: she has no visits, so she can read nothing.

## Browsers

- With the local stand-in, use **one browser tab per account**. With live TideCloak, use **one browser profile per account** (for example separate Chrome profiles, or Chrome plus Firefox): private windows of the same browser share one session, so they cannot keep several accounts signed in at once.
- The walkthrough needs at least: Hospital, Lan, Dr Minh, Dr Tuấn and Nam signed in. Bình does not need to be signed in.
- In live mode, allow popups for `http://localhost:3000` in the hospital's profile. Every grant is signed in a Tide enclave popup.
- Signing is two clicks on `/hospital`: **Co-sign with Tide** (or **Co-sign all**) prepares the sign requests with the network (a few seconds per grant), then **Approve in Tide enclave** opens the popup (the in-page dialog with the local stand-in). Two clicks keep the popup inside the browser's user-activation window.
- Invite links from `npm run init` are in `aigree/data/invite-links.txt` and expire after 12 hours. See [`TIDECLOAK_SETUP.md`](TIDECLOAK_SETUP.md).

## Setup (before the walkthrough)

Lan is registered with CCCD `079301001234` and has prior history (six records). Bình is registered with CCCD `079302005678` and has two records. Patients add further history themselves at `/patient/import`.

1. **Everyone signs in once.** For each account, open http://localhost:3000 and sign in. This creates their profile in the app. Doctors and Nam must have signed in before anyone can grant them access.
2. **Lan links Nam as family.** On `/patient`, Lan adds the family member "Nguyễn Văn Nam" (exactly as written), relation "brother". Nam does not need to register as a patient.
3. **Breach drill off.** Check on `/hospital` that the breach drill is off.
4. **Run through once.** Every unlock below needs a hospital signing click. Know where it is.

## Walkthrough (2 minutes)

Four parts: the possibility, the constraint, the prototype, what changes.

### 0:00 to 0:12: the possibility

- Show the landing page.
- Say: "AIgree is a medical record a doctor can read only during a visit the patient approved. Nobody else can read it, not even the hospital."

### 0:12 to 0:25: the constraint

- Open Supabase → Table Editor → `records`: every record is ciphertext.
- Say: "Today, admins, IT staff and servers can read every record. One stolen admin account leaks everyone's history. Here, the database, the server and the hospital account hold no key."

### 0:25 to 1:40: the prototype

**Beat 1: patient approves, hospital co-signs, record unlocks (0:25 to 0:50).**

- Dr Minh, on `/doctor`: book a visit for Lan. Find her by CCCD `079301001234`, choose Ophthalmology, from now to one hour from now.
- Lan, on `/patient`: the request appears. Approve it.
- Hospital, on `/hospital`: **Co-sign with Tide**, then **Approve in Tide enclave**, and approve.
- Dr Minh, on the visit page `/doctor/visit/[id]`: Eye and Essentials records decrypt in his browser, with a watermark (his name and the time). Endocrine stays locked: it is not part of this visit.
- Say: "The server only prepared the grant. The hospital's Tide enclave signed it after Lan said yes. The Tide network checks it on every decrypt."

**Breach drill (0:50 to 1:02).** Stay on Dr Minh's visit page, where Endocrine is still locked.

- Hospital, on `/hospital`: **Turn breach drill on**.
- Dr Minh reloads the visit page. A red banner appears. The server now deliberately hands out all of Lan's ciphertext, including Endocrine, plus the patient's own policy for each compartment Dr Minh has no grant for.
- The Tide network refuses ("subjectId does not match"): the Endocrine cards stay locked.
- Say: "Even a misbehaving server cannot leak a record. The network only decrypts for the person a signed policy names."
- Hospital: **Turn breach drill off**.

**Extra specialty: Endocrine (1:02 to 1:12).**

- Dr Minh, on the visit page: request Endocrinology.
- Lan, on `/patient`: approve.
- Hospital: sign the pending grant.
- Dr Minh: Endocrine records now decrypt, read-only, until the visit ends.

**More refusals (1:12 to 1:25).**

- **Other patient.** Dr Minh books a visit for Bình (CCCD `079302005678`), and Bình never approves it. Dr Minh opens that visit's page: Bình's records are locked.
- **Hospital tries to read.** On `/hospital`, the hospital tries to read Lan's records: locked. The hospital holds no `_tide_decryptor`.
- **End visit.** Dr Minh ends his visit with Lan and reloads: her records are locked again.

**Emergency, 2 of 3 (1:25 to 1:40).**

- Dr Tuấn, on `/doctor`: raise an emergency for Lan (CCCD lookup) with a reason, for example "unconscious after a road accident". This counts as the doctor's approval.
- Nam, on `/patient`: approve as family. (The hospital could approve instead.) Two of three approver types: the request is approved for 60 minutes.
- Hospital: sign the pending emergency grants. The hospital signs even when it was not one of the two approvers.
- Dr Tuấn: Essentials, Eye and Endocrine records decrypt, until the 60 minutes are up.

### 1:40 to 2:00: what changes

- Lan, on `/patient`: the access log shows every grant, signature, decryption, refusal and the emergency, with who and when. She can revoke a doctor's active grant.
- Say: "Lan shares precisely and temporarily, and sees every access. Nobody holds a master key. A breached server leaks only ciphertext."

## Checklist of expected results

| Check | Expected |
|---|---|
| Lan reads her own records on `/patient` | Decrypted |
| Dr Minh during the signed visit: visit specialties and Essentials | Decrypted, watermarked |
| Dr Minh: a specialty not in the visit | Locked until Lan approves and the hospital signs |
| Dr Minh: Bình's records | Locked |
| Dr Minh after the visit ends | Locked |
| Hospital tries to read any record | Locked |
| Breach drill on: anyone without a grant | Ciphertext delivered, network refuses, locked |
| Emergency after 2 of 3 approvals and the hospital's signature | Decrypted for 60 minutes |
| Dr Phạm Hà, no visits | Locked |
| Supabase `records` table | Ciphertext only |

## Screen-sharing tips

- Keep `.env`, `.env.local`, the terminal and the invite links off screen.
