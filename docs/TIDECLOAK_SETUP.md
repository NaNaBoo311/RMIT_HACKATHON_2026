# TideCloak setup

AIgree runs a local TideCloak server in Docker (`tideorg/tidecloak-dev:latest`). The image talks to the real Tide network. One script, `npm run init` (`aigree/scripts/init-tidecloak.sh`), does almost all of the setup. You do three things by hand:

1. Fill in `aigree/.env`.
2. Open the invite links the script prints, one per account.
3. Later, in the app, sign grants as the hospital account (an enclave popup).

All commands below run from the `aigree/` folder. To run without a licensed realm, use the local stand-in instead (README, "Run with the local TideCloak stand-in").

## 1. Prerequisites

- Docker, running, usable without `sudo`.
- `curl` and `jq`. The script stops if either is missing.
- bash: Linux, macOS, or WSL on Windows.
- Port 8080 free. The script stops if something is already listening there.
- Node.js 22+ for the app (runs on 24).

## 2. `.env`

`.env` is read only by the init script. It is gitignored. Put **only these four lines** in it (the first block of `.env.example`):

| Variable | Value |
|---|---|
| `KC_BOOTSTRAP_ADMIN_USERNAME` | `admin` (the TideCloak master admin) |
| `KC_BOOTSTRAP_ADMIN_PASSWORD` | A password you choose. Required: the script refuses to run without it. |
| `TIDE_LICENSE_EMAIL` | A real address you control. It manages the Tide licence. Placeholder domains such as `example.com` are rejected. |
| `TIDE_TERMS_ACCEPTED` | `yes`, only if you have read and agree to https://tide.org/legal. If it is empty, the script asks at the terminal, or stops without creating anything. |

Do not copy the second block of `.env.example` into `.env`. The script loads `.env` with bash, and the `<...>` placeholders there are a bash syntax error. The second block belongs in `.env.local` (see the README).

Optional overrides, set in the environment: `TIDECLOAK_URL` (default `http://localhost:8080`), `CLIENT_APP_URL` (default `http://localhost:3000`), `APP_ACCOUNTS` (the staff and patient accounts; default `lan binh nam minh ha tuan`), `BRAND_SKIP=1`. The realm name comes from `package.json`: `aigree`. The client is `aigree-client`.

## 3. What `npm run init` does, step by step

1. **Checks the answers.** No master-admin password, no usable licence email, or terms not accepted: it stops before creating anything.
2. **Cleans up.** Stops and removes any old `tidecloak` container and deletes `data/keycloakdb*`. This wipes the previous realm (see section 7).
3. **Starts TideCloak.** Container `tidecloak` on port 8080, with `data/` mounted for its database. It waits up to 2 minutes.
4. **Imports the realm** from `scripts/realm.json.template` as realm `aigree`:
   - Public client `aigree-client`, with DPoP-bound tokens, redirect URIs on `http://localhost:3000`, and token claims `tideuserkey` and `vuid`.
   - Access token lifespan 300 seconds (5 minutes).
   - Self-registration off. Sign-in goes straight to Tide.
   - Realm roles:

     | Role | Meaning |
     |---|---|
     | `benh_nhan` | Patient (also family members) |
     | `bac_si` | Doctor |
     | `benh_vien` | Hospital account: co-signs grants, cannot read records |
     | `khoa_mat` | Licensed for Ophthalmology |
     | `khoa_noitiet` | Licensed for Endocrinology |
     | `khoa_capcuu` | Licensed for Emergency |
     | `_tide_encryptor` | May encrypt where a signed policy names this user (name fixed by Tide) |
     | `_tide_decryptor` | May decrypt where a signed policy names this user (name fixed by Tide) |

     Specialty roles mean "may practise here". They grant no read access. `_tide_encryptor` and `_tide_decryptor` are capabilities only: a user still needs a signed policy naming them for each compartment.
   - Default roles for every user: `_tide_enabled`, `appUser`, `_tide_vault.selfencrypt` and `_tide_vault.selfdecrypt`. The two `_tide_vault` roles are leftovers from the starter template. They give no access to any patient compartment, because AIgree never uses self-encryption.
   - Staff and patient accounts, created unlinked (no Tide account yet):

     | Username | Name | Roles |
     |---|---|---|
     | `lan` | Nguyễn Thị Lan | `benh_nhan`, `_tide_encryptor`, `_tide_decryptor` |
     | `binh` | Trần Văn Bình | `benh_nhan`, `_tide_encryptor`, `_tide_decryptor` |
     | `nam` | Nguyễn Văn Nam | `benh_nhan`, `_tide_encryptor`, `_tide_decryptor` |
     | `minh` | Lê Minh | `bac_si`, `khoa_mat`, `khoa_noitiet`, `_tide_encryptor`, `_tide_decryptor` |
     | `ha` | Phạm Hà | `bac_si`, `khoa_noitiet`, `_tide_encryptor`, `_tide_decryptor` |
     | `tuan` | Võ Tuấn | `bac_si`, `khoa_capcuu`, `_tide_encryptor`, `_tide_decryptor` |
5. **Turns off Keycloak's "Update Account Information" page**, so new users go straight into the app.
6. **Licenses the realm** (`setUpTideRealm`, with your licence email). Then it sets `iga.attestor=tide` and **enables IGA in Tide mode**, and approves the resulting change requests. The realm is still in FirstAdmin mode, so the script may do this itself.
7. **Creates the admin user** `admin` with your licence email. This is the **hospital account**. It gets `benh_vien`. It does **not** get `_tide_encryptor` or `_tide_decryptor`.
8. **Prints invite links** for the six staff and patient accounts and the admin (valid 12 hours). They are also saved to `data/invite-links.txt` (gitignored), one `<username> <link>` per line. The admin's line starts with `admin(hospital)`.
9. **Waits for linking.** First for the admin, then for all staff and patient accounts (it polls every 10 seconds and lists who is missing). To continue without the rest, run `touch data/.skip-link-wait` in another terminal.
10. **Approves the remaining change requests**, points the Tide identity provider at this realm's console, and signs the identity provider settings.
11. **Grants `tide-realm-admin` to the admin, last.** Committing this grant flips the realm from FirstAdmin to MultiAdmin. After the flip, every governed change (for example a role grant) needs an enclave approval from an admin's browser.
12. **Exports the realm's signed admin policy** to `data/admin-policy.json`. The app server reads it to let the hospital's enclave sign grants.
13. **Brands the login screen**, but only if the pack's branding template is present. Otherwise it skips this step.
14. **Exports the adapter config** to `data/tidecloak.json`, and checks that it contains `jwk`, `vendorId` and `homeOrkUrl`.

The final banner lists the AIgree roles (`benh_nhan`, `bac_si`, `benh_vien`, `khoa_*`; `_tide_encryptor` / `_tide_decryptor`) and the admin policy path. You can ignore the banner about branding and new-user details: the accounts already have names, and the app needs no extra fields.

## 4. Linking the accounts (the manual part)

- Open each invite link in its **own browser profile** (or a fresh private window, one at a time). Each link creates a separate Tide account, with its own username and password, inside the Tide enclave.
- Link the **admin (hospital)** first; the script waits for it. Then link `lan`, `binh`, `nam`, `minh`, `ha` and `tuan`.
- Note which Tide credentials belong to which account. You need them for the walkthrough.
- After linking, each user signs in to http://localhost:3000 once. This creates their profile in the app and stores their `tideuserkey`. A grant cannot be made for someone who has never signed in.
- If you skipped some users with `data/.skip-link-wait`, linking them later has not been checked. The realm is MultiAdmin by then, so if linking creates change requests, the admin must approve them in the TideCloak admin console. Linking everyone during init is simpler.

## 5. Why there is no `aigree-admin` service account

The original plan had a confidential client, `aigree-admin`, with realm-management roles. The server would have used it to create per-patient roles and assign them to doctors. We dropped it:

- Access is now a signed policy per user per compartment, not a role (see [`SPIKE_RESULTS.md`](SPIKE_RESULTS.md)). The server never creates, assigns or removes roles.
- In MultiAdmin mode a role change needs an admin's enclave approval in the browser anyway. Approvals must not be proxied through the app server (tide-pack AP-89).
- So the server holds **no TideCloak admin credential**. The only TideCloak file it reads is `data/admin-policy.json`, exported once by init. The admin policy lets the hospital's enclave sign grants. It is not a key, and it decrypts nothing.
- The server can only write grant rows as `pending_signature`. A grant without the hospital's enclave signature is refused by the Tide network.

## 6. Re-exporting the admin policy

Do this if `data/admin-policy.json` is missing or empty, or if the app reports that it "has no `policy` field". Master-admin tokens last about 60 seconds, so run the commands together:

```bash
cd aigree
set -a; . ./.env; set +a     # loads the master-admin password; .env must hold only the four lines
TOKEN=$(curl -s -X POST "http://localhost:8080/realms/master/protocol/openid-connect/token" \
  -d client_id=admin-cli -d grant_type=password \
  --data-urlencode "username=$KC_BOOTSTRAP_ADMIN_USERNAME" \
  --data-urlencode "password=$KC_BOOTSTRAP_ADMIN_PASSWORD" | jq -r .access_token)
curl -s "http://localhost:8080/admin/realms/aigree/iga/role-policies/name/tide-realm-admin" \
  -H "Authorization: Bearer $TOKEN" > data/admin-policy.json
jq -e '.policy | length > 0' data/admin-policy.json   # prints true when it worked
```

If that endpoint returns nothing useful, save the list instead: `GET /admin/realms/aigree/iga/role-policies`. The app accepts either format.

Restart `npm run dev` afterwards. The server caches the policy in memory.

## 7. Re-running init wipes everything

`npm run init` deletes the old realm. You get a new realm key, new user IDs and new `tideuserkey`s. Everything stored in Supabase then points at accounts that no longer exist, and old ciphertext and grants stop working. After any re-run:

1. Open each new invite link again.
2. Reset the database. The migration uses plain `create table`, so drop the tables first, in the Supabase SQL Editor:

   ```sql
   drop table if exists access_logs, policy_grants, emergency_approvals, emergency_requests,
     access_requests, records, visits, family_links, patients, profiles, demo_settings cascade;
   ```

   Then run `supabase/migrations/001_init.sql` again.
3. Restart `npm run dev` (it caches the old admin policy).
4. Redo the setup in [`WALKTHROUGH.md`](WALKTHROUGH.md).

## 8. Troubleshooting

**Signing popup blocked.** Signing grants opens a Tide enclave popup. Allow popups for `http://localhost:3000` in the hospital's browser profile, then click sign again.

**"subjectId does not match".** The network refused because the caller is not the user the policy names. This is the expected result during a breach drill, and for anyone using someone else's policy. If the rightful user sees it, the grant was signed for a different `tideuserkey`, for example one from before a re-init. Have the user sign out and in again, then create a fresh grant (a new visit or request).

**"Could not reach enough VVK ORKs" (`TIDE-TIDEJS-NET-THRESHOLD_FAILURE`).** Usually a **refusal, not an outage**. The real reason is in the error's `cause`; the app shows it on the locked card. Look for "subjectId does not match", "Tags do not contain assignmentId", "has expired" or "not found in list of roles". Suspect the network only if a patient's own records on `/patient` also fail to decrypt.

**A user has no `tideuserkey`.** The claim appears only after the user has linked a Tide account and signed in. Until then the app cannot make a grant for them. Ask them to sign in to the app once. If they were already signed in before linking, they should sign out and in again.

**"not found in list of roles" or a voucher error.** The caller lacks `_tide_decryptor` (or `_tide_encryptor`). For the hospital account this is expected: it is designed never to decrypt. For a doctor or patient, check their realm roles in the TideCloak console, then sign out and in.

**`setUpTideRealm` fails during init** (an HTTP error, `NEED_PAYMENT`, or a key-generation error). Read `docker logs tidecloak` and look for `[Midgard]`. Key-generation and network errors are often temporary: run `npm run init` again. Nothing is linked yet at that point, so the wipe costs nothing. `NEED_PAYMENT` means the realm got no licence: check the licence email.

**"Port 8080 is already in use".** Another program holds the port. The script already removes its own old `tidecloak` container, so look for something else (`lsof -i :8080`) and stop it.

**TideCloak did not start within 120 seconds.** Run `docker logs tidecloak`, fix the cause, then re-run init.
