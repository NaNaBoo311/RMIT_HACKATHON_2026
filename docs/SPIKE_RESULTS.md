# Phase 0 spike results

Phase 0 of `IMPLEMENTATION_PLAN.md` (§2) asked us to check four assumptions before building anything. The first check failed, so the crypto model changed. This file records what we found, what we decided, and what is still to be measured on a licensed realm.

## Summary

| # | Check | Result | Decision |
|---|---|---|---|
| 1 | Cross-user decryption with self-encryption roles | **Not viable** | Use Tide's built-in `RelationshipAttestation:1` contract instead |
| 2 | Role management by API | **Replaced** | No runtime role changes. Access is a signed policy, not a role |
| 3 | Token refresh after a role change | **Not needed for grants** | A grant works as soon as it is signed. The network enforces its expiry |
| 4 | Batch decrypt speed | **Pending a licensed realm** | Measure in live mode |

## Check 1: cross-user decryption with self-encryption roles

**Question.** User 1 encrypts under a self-encryption tag (role `_tide_<tag>.selfencrypt`). Can User 2, holding only `_tide_<tag>.selfdecrypt`, decrypt it? The original design depended on this: doctors would get a patient's `selfdecrypt` roles for the length of a visit.

**Result: not viable.** The evidence comes from Tide's own documentation in the Tide agent pack (tide-pack MCP v1.9.33). We did not repeat the check live; the pack marks the finding as verified.

- Playbook `configure-e2ee-roles-and-policies`:
  > "Ciphertext is bound to the encrypting user's identity. Another user with the same `selfdecrypt` role cannot decrypt it. VERIFIED."
- Playbook `setup-forseti-e2ee`, on self-encryption:
  > "Only that user can ever decrypt."

So a doctor could never read what a patient encrypted, whatever roles we gave the doctor.

**Decision (team-approved): switch to the built-in `RelationshipAttestation:1` contract.** It ships inside the Tide network's nodes (ORKs). Nothing has to be written or deployed. It answers "may this one user encrypt or decrypt the data of this one record?". In AIgree:

| Item | Value in AIgree |
|---|---|
| Tag (the policy's `assignmentId`) | One patient compartment: `<patientCode>_<kind>`, kind = `mat` (Eye), `noitiet` (Endocrine), `thietyeu` (Essentials) or `dinhdanh` (Identity). Every encrypted item carries exactly one tag. |
| Subject | `User` + the grantee's `tideuserkey` (from their token) |
| Access | `read` lists `_tide_decryptor`; `read-write` lists `_tide_encryptor` and `_tide_decryptor` |
| Expiry | Visit end (doctors), 60 minutes (emergency), 365 days (the patient's own access) |
| Signer | A `tide-realm-admin`, in the Tide enclave popup. In AIgree this is the hospital account. |

To decrypt, the network checks that the caller holds the realm role `_tide_decryptor`, is the policy's subject, the item's tag matches the policy, and the policy has not expired. Patients and doctors hold `_tide_decryptor` and `_tide_encryptor` from the start. The hospital account holds neither, so it can sign grants but can never decrypt.

## Check 2: role management by API

**Original plan.** A service-account client (`aigree-admin`) would let the server create per-patient roles and assign them to doctors during a visit.

**Result: replaced.** With signed policies there is nothing to change at runtime: every role is created once by `npm run init`. What we learned about IGA (Tide's governance layer) while checking:

- `npm run init` enables IGA in Tide mode. While the realm is in **FirstAdmin** mode, the script may authorise and commit change requests itself.
- Once the first `tide-realm-admin` is granted, the realm becomes **MultiAdmin**. From then on, every governed change, including a role grant, is a change request. Each one needs an enclave approval from an admin's browser, using the admin's own token, before it can be committed.
- Approvals must not be proxied through the app server (tide-pack anti-pattern AP-89). TideCloak credits an approval to the caller, so a server proxy would record every human approval under its own account.
- Policies, including `RelationshipAttestation` grants, must be signed by a `tide-realm-admin` in the enclave. There is no server-side signing endpoint.

**Consequence.** The app server holds no TideCloak admin credential. It can only write grant rows as `pending_signature`. The hospital signs them in its browser, and the server stores the signed bytes. See [`TIDECLOAK_SETUP.md`](TIDECLOAK_SETUP.md).

## Check 3: token refresh

**Not needed for grants.** The doctor already holds `_tide_decryptor` from init. A grant is a signed policy that the browser passes with each decrypt call; it is not a role inside the token. So:

- A new grant works as soon as the hospital signs it. No token refresh or re-login.
- Expiry is written into the policy and enforced by the Tide network.
- Ending a visit or revoking a grant marks it `revoked`, and the server stops handing out that policy. A copy of the policy kept elsewhere still works for its named subject until its expiry (listed under Known limitations in the README).

## Check 4: batch speed

**Pending a licensed realm.** Time one `doDecrypt` call with 1, 10 and 30 items in live mode. In the app, decryption is one network call per compartment tag.

## Live results

**Blocked on 2026-10-22: the realm could not be licensed.** `npm run init` failed at `setUpTideRealm` four times,
on `tideorg/tidecloak-dev:latest` (0.14.41) and on `0.14.17`, with `TIDE-IDPEXT-VENDOR-KEYGEN_FAILED`. The
container log shows the cause is Tide's remote licensing service, not the local setup:

```
Initialized subscription for realm sealedchart on tier free, awaiting vendor payment
Free tier with email on realm sealedchart, finalizing vendor creation now
[Midgard] FinalizeWallet failed: HttpRequestException: Response status code does not indicate success: 500 (Internal Server Error).
```

Our request is identical to the one Tide's official initializer (`npm init @tidecloak/nextjs`, `tcinit.sh`) sends:
`email`, `isRagnarokEnabled=true`, `skipLicense=false`. Whether the licence email or a Tide-side fault is the
cause was not established. Next step: report it to Tide support (Discord #support, https://discord.gg/XBMd9ny2q5),
or retry `npm run init` with another licence email the team controls. Until a realm is licensed, nothing below can run.

Once a realm is licensed, run these in live mode with the realm's accounts (see [`TIDECLOAK_INTEGRATION_PLAN.md`](TIDECLOAK_INTEGRATION_PLAN.md), section 5), then fill in this table. The refusal cases already pass against the local stand-in (`npm run tide:check`, `npm run flows:check`).

| # | Check | Expected | Status |
|---|---|---|---|
| 1 | Own round-trip: encrypt, then decrypt, with the user's own policy for one tag | Plaintext comes back | Pending a licensed realm |
| 2 | Wrong tag: item tag differs from the policy's tag | Refused by the network | Pending a licensed realm |
| 3 | Two tags on one item | Refused by the network | Pending a licensed realm |
| 4 | Foreign policy: decrypt with another user's policy | Refused ("subjectId does not match") | Pending a licensed realm |
| 5 | Doctor reads during an approved, signed visit | Plaintext comes back | Pending a licensed realm |
| 6 | Doctor after the visit ends | Locked | Pending a licensed realm |
| 7 | Hospital account tries to decrypt | Refused (no `_tide_decryptor`) | Pending a licensed realm |
| 8 | Breach drill: server hands out ciphertext and the patient's policy | Refused ("subjectId does not match") | Pending a licensed realm |
| 9 | Batch decrypt, 1 item | Time in ms | Pending a licensed realm |
| 10 | Batch decrypt, 10 items | Time in ms | Pending a licensed realm |
| 11 | Batch decrypt, 30 items | Time in ms | Pending a licensed realm |
