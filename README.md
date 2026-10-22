[![Built with TideCloak](https://tide.org/badges/built-with-tidecloak.svg)](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked)

## Project overview

AIgree is a medical record, with an AI assistant, that doctors read only during patient-approved visits. Not even the hospital can read it.

### 1. Vision & originality

Access follows the visit, not the job title. The AI assistant sees only what the doctor was granted.

### 2. Trust constraint insight

Hospital admins, IT staff and servers can read every record; one stolen account leaks everyone's history. Remove that trust, and patients share precisely, temporarily and verifiably.

### 3. Value & impact

Patients control and audit who sees what. Example: Lan's eye doctor needs her diabetes history; she approves in seconds, and access ends with the visit.

### 4. Why TideCloak matters

- Records are encrypted in the browser, per patient and specialty.
- Access is a Tide `RelationshipAttestation` policy naming one doctor, one compartment and an expiry.
- Only the hospital's Tide enclave can sign it, after the patient consents; the hospital itself cannot decrypt.
- The Tide network refuses anyone not named, even if the server leaks ciphertext.

### 5. Prototype & storytelling

Watch: patient approves → hospital co-signs → records unlock → the assistant answers with citations, refuses locked data and requests access → visit ends, access revoked.

Video (2 min): [`docs/demo.mp4`](docs/demo.mp4)

## Setup

```bash
cd aigree && npm install
# run supabase/migrations/001_init.sql in Supabase; fill .env.local from .env.example
npm run dev:local        # app on :3000 + local TideCloak stand-in on :8090
```

Live TideCloak: `npm run init`, `TIDE_MODE=live`. See [`docs/TIDECLOAK_SETUP.md`](docs/TIDECLOAK_SETUP.md), [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md).

## Known limitations

- **Local TideCloak stand-in:** our realm could not be licensed in time, so the prototype runs on a local stand-in (`aigree/tide-local/`) holding whole keys, without passwords or DPoP. The live path is built.
- One hospital signer (threshold 1); production needs a quorum.
