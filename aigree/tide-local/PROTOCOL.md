# Local TideCloak + Tide network stand-in: wire protocol

`tide-local/server.mjs` is the local stand-in for two things the app reaches in live mode through a licensed realm:
**TideCloak** (sign-in, roles, token signing) and the **Tide network** (ORKs running
`RelationshipAttestation:1`, signing policies, encrypting/decrypting). It runs as its own process on
`http://localhost:8090`, so the Next.js server still never holds a key.

**What local mode does not provide:** threshold cryptography. This process holds whole keys (token key, VVK
policy key, data master secret) in `tide-local/.state/keys.json`. Real Tide splits them across ORKs so
nobody holds them. No password step (account picker), no DPoP.

## State (`tide-local/.state/keys.json`, gitignored, created on first start, reused after)
- `token`: ES256 keypair (JWK) — signs access tokens (stands in for TideCloak's threshold-signed JWT).
- `vvk`: ES256 keypair (JWK) — signs policies (stands in for the realm VVK).
- `master`: 32 random bytes (base64) — data keys are `HKDF-SHA256(master, salt=<fixed salt>, info=<assignmentId>)`. The salt is fixed at first deployment; changing it makes every stored record unreadable.
On start the server writes the PUBLIC halves to `../data/tidecloak.local.json` (the app's "adapter"):
`{ "realm":"aigree", "auth-server-url":"http://localhost:8090/", "resource":"aigree-client",
   "vendorId":"aigree-local", "jwk":{"keys":[<token public JWK with kid,alg:"ES256",use:"sig">]},
   "policyJwk": <vvk public JWK>, "local": true }`

## Users (from `scripts/realm.json.template` `users[]` + the hospital account)
- Each template user: `username`, `firstName`, `lastName`, `realmRoles` (drop `default-roles-*`; add `_tide_enabled`).
- Hospital: username `admin`, firstName `Hospital`, lastName `An Khang`, realm roles `["benh_vien","_tide_enabled"]`,
  client role `realm-management: ["tide-realm-admin"]`. Never `_tide_decryptor`/`_tide_encryptor`.
- `sub` = UUIDv5-like stable id: hex of SHA-256("sub:"+username) formatted 8-4-4-4-12.
- `tideuserkey` = hex SHA-256("tideuserkey:"+username) (64 hex chars). `vuid` = hex SHA-256("vuid:"+username).slice(0,32).

## Endpoints (JSON in/out; CORS: allow origin http://localhost:3000, headers Authorization, Content-Type; methods GET, POST, OPTIONS)
Errors: HTTP 4xx `{ "error": "<message>" }`. Contract refusals use HTTP 403 and EXACTLY these messages:
- `subjectId does not match.`
- `Tags do not contain assignmentId.` (a tag differs from the policy's assignmentId)
- `Every item must be tagged with the assignmentId.` (an item has no tags)
- `'_tide_decryptor' role not found for this decryption request.` / `'_tide_encryptor' role not found for this encryption request.` (caller's token lacks the realm role)
- `_tide_decryptor not found in list of roles.` / `_tide_encryptor not found in list of roles.` (policy `roles` lacks it)
- `Policy has expired.`
- `Policy supplied has not been signed.` (bad/missing VVK signature)
Token problems: HTTP 401 `{ "error": "Invalid token: <reason>" }`.

### `GET /health` → `{ ok: true }`
### `GET /users` → `{ users: [{ username, displayName, roles: string[] }] }` (for the sign-in picker; displayName = `${lastName} ${firstName}`)
### `POST /login` body `{ username }` → `{ access_token, expires_in }`
Access token (ES256, header `kid` = token key kid, `typ: "JWT"`), claims:
`iss: "http://localhost:8090/realms/aigree"`, `azp: "aigree-client"`, `aud: "aigree-client"`, `sub`, `iat`, `exp: iat+3600`,
`typ: "Bearer"`, `preferred_username`, `given_name`, `family_name`, `name`, `tideuserkey`, `vuid`,
`realm_access: { roles }`, `resource_access` (hospital only: `{ "realm-management": { roles: ["tide-realm-admin"] } }`), `tide_local: true`.
Unknown username → 404.

### `POST /policies/sign` (Authorization: Bearer <token>) body `{ policy }` → `{ policyB64 }`
Caller must hold client role `realm-management/tide-realm-admin` (else 403 `Only a tide-realm-admin can sign policies.`).
`policy` = `{ contractId: "RelationshipAttestation:1", subjectType: "User", subjectId, assignmentId, roles: "<JSON array string>", expiry: <unix seconds> }` — all validated (strings non-empty; roles parses to a non-empty subset of `["_tide_encryptor","_tide_decryptor"]`; expiry in the future).
Signed form: `policyB64 = base64url(JSON.stringify({ v: 1, policy, sig }))` where `sig` = base64url ES256 (JWS compact, `alg: ES256`, payload = canonical JSON of `policy` with keys in the order above) signed by the VVK key. Simplest: `sig` = the full compact JWS string from `new CompactSign(utf8(JSON.stringify(policy))).setProtectedHeader({alg:"ES256"}).sign(vvkPrivate)`.

### `POST /encrypt` (Bearer) body `{ items: [{ data: string, tags: string[] }], policyB64 }` → `{ ciphertexts: string[] }`
### `POST /decrypt` (Bearer) body `{ items: [{ encrypted: string, tags: string[] }], policyB64 }` → `{ plaintexts: string[] }`
Checks, in this order (first failure wins, whole request refused):
1. Token: ES256 signature with the token key, `iss`, `azp`, `exp`.
2. Policy: decode, verify VVK JWS and that its payload equals `policy`; else `Policy supplied has not been signed.`; `contractId` must be `RelationshipAttestation:1`.
3. `expiry` > now, else `Policy has expired.`
4. Items non-empty; each item has ≥1 tag (`Every item must be tagged with the assignmentId.`) and EVERY tag equals `assignmentId` (`Tags do not contain assignmentId.`) — so two tags is refused unless both equal it (refuse when tags.length !== 1 too, with the same message).
5. Subject: token `tideuserkey` === `subjectId`, else `subjectId does not match.`
6. Policy roles include the op role (`_tide_encryptor` for encrypt, `_tide_decryptor` for decrypt), else `<role> not found in list of roles.`
7. Caller's realm roles include the op role, else `'<role>' role not found for this <encryption|decryption> request.`
Crypto: AES-256-GCM, 12-byte random IV, key = HKDF as above. Ciphertext string = a fixed version prefix + `base64url(iv || ct || tag16)`. Decrypt failure (tampered) → 400 `Decryption failed.`
Limits: ≤ 50 items, each data ≤ 64 KB.

Every request logs one line to stdout: time, endpoint, username, assignmentId, ALLOW/DENY + reason. Never logs plaintext.

## Run
`npm run tide:local` starts it (`node tide-local/server.mjs`, using `jose` from the app's node_modules); `npm run dev:local` starts it and `next dev`. Port override: `TIDE_LOCAL_PORT`.

Checks: `npm run tide:check` (`tide-local/check-network.mjs`, the endpoint rules above; needs the stand-in running) and `npm run flows:check` (`tide-local/check-flows.mjs`, the app's visit flows through its API; needs the stand-in and `npm run dev`).
