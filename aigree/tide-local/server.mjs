// Local TideCloak + Tide network stand-in. Contract: tide-local/PROTOCOL.md
// NOT threshold crypto: this process holds whole keys. Demo / unlicensed-realm stand-in only.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateKeyPair, exportJWK, importJWK, calculateJwkThumbprint,
  SignJWT, jwtVerify, CompactSign, compactVerify,
} from 'jose';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const STATE_DIR = path.join(HERE, '.state');
const KEYS_FILE = path.join(STATE_DIR, 'keys.json');
const ADAPTER_FILE = path.join(APP, 'data', 'tidecloak.local.json');
const TEMPLATE_FILE = path.join(APP, 'scripts', 'realm.json.template');

// Key-derivation salt: fixed at first deployment. Changing it makes every stored record unreadable.
const KDF_SALT = 'sealedchart-sim';
const PORT = Number(process.env.TIDE_LOCAL_PORT || 8090);
const REALM = 'aigree';
const CLIENT = 'aigree-client';
const BASE_URL = 'http://localhost:8090/';
const ISS = 'http://localhost:8090/realms/aigree';
const CORS_ORIGIN = 'http://localhost:3000';
const CONTRACT = 'RelationshipAttestation:1';
const ENC = '_tide_encryptor';
const DEC = '_tide_decryptor';
const MAX_BODY = 1024 * 1024;
const MAX_ITEMS = 50;
const MAX_DATA = 64 * 1024;
const MAX_ENCRYPTED = Math.ceil(((MAX_DATA + 28) * 4) / 3) + 16;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const sha256hex = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const b64u = (buf) => Buffer.from(buf).toString('base64url');

// ---------- keys ----------
async function makeEsKey() {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const pub = await exportJWK(publicKey);
  const priv = await exportJWK(privateKey);
  const kid = await calculateJwkThumbprint(pub);
  return {
    kid,
    publicJwk: { ...pub, kid, alg: 'ES256', use: 'sig' },
    privateJwk: { ...priv, kid, alg: 'ES256', use: 'sig' },
  };
}

async function loadState() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  let state;
  if (fs.existsSync(KEYS_FILE)) {
    state = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  } else {
    state = {
      token: await makeEsKey(),
      vvk: await makeEsKey(),
      master: crypto.randomBytes(32).toString('base64'),
    };
    fs.writeFileSync(KEYS_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  }
  const strip = (j) => { const { d, ...rest } = j; return rest; };
  const tokenPub = strip(state.token.publicJwk);
  const vvkPub = strip(state.vvk.publicJwk);
  return {
    tokenKid: state.token.kid,
    tokenPublicJwk: tokenPub,
    vvkPublicJwk: vvkPub,
    tokenPriv: await importJWK(state.token.privateJwk, 'ES256'),
    tokenPub: await importJWK(tokenPub, 'ES256'),
    vvkPriv: await importJWK(state.vvk.privateJwk, 'ES256'),
    vvkPub: await importJWK(vvkPub, 'ES256'),
    master: Buffer.from(state.master, 'base64'),
  };
}

function writeAdapter(keys) {
  const adapter = {
    realm: REALM,
    'auth-server-url': BASE_URL,
    resource: CLIENT,
    vendorId: 'aigree-local',
    jwk: { keys: [keys.tokenPublicJwk] },
    policyJwk: keys.vvkPublicJwk,
    local: true,
  };
  fs.mkdirSync(path.dirname(ADAPTER_FILE), { recursive: true });
  fs.writeFileSync(ADAPTER_FILE, JSON.stringify(adapter, null, 2) + '\n');
}

// ---------- users ----------
function formatSub(username) {
  const h = sha256hex('sub:' + username);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function loadUsers() {
  const text = fs.readFileSync(TEMPLATE_FILE, 'utf8')
    .replace(/REALM_NAME/g, REALM)
    .replace(/CLIENT_NAME/g, CLIENT);
  const realm = JSON.parse(text);
  const users = new Map();
  for (const u of realm.users || []) {
    if (!u.username) continue;
    const roles = (u.realmRoles || []).filter((r) => !r.startsWith('default-roles-'));
    if (!roles.includes('_tide_enabled')) roles.push('_tide_enabled');
    users.set(u.username, {
      username: u.username, firstName: u.firstName || '', lastName: u.lastName || '',
      realmRoles: roles, clientRoles: null,
    });
  }
  users.set('admin', {
    username: 'admin', firstName: 'Hospital', lastName: 'An Khang',
    realmRoles: ['benh_vien', '_tide_enabled'],
    clientRoles: { 'realm-management': { roles: ['tide-realm-admin'] } },
  });
  for (const u of users.values()) {
    u.sub = formatSub(u.username);
    u.tideuserkey = sha256hex('tideuserkey:' + u.username);
    u.vuid = sha256hex('vuid:' + u.username).slice(0, 32);
  }
  return users;
}

// ---------- http helpers ----------
function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooBig = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { tooBig = true; return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return reject(new HttpError(413, 'Request body too large.'));
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return reject(new HttpError(400, 'Invalid JSON body.'));
      try {
        const v = JSON.parse(raw);
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
        resolve(v);
      } catch {
        reject(new HttpError(400, 'Invalid JSON body.'));
      }
    });
    req.on('error', () => reject(new HttpError(400, 'Invalid request body.')));
  });
}

// ---------- token ----------
async function verifyToken(req, keys, users) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) throw new HttpError(401, 'Invalid token: missing bearer token');
  let payload;
  try {
    ({ payload } = await jwtVerify(m[1].trim(), keys.tokenPub, { issuer: ISS, algorithms: ['ES256'] }));
  } catch (e) {
    throw new HttpError(401, `Invalid token: ${e.code || e.message}`);
  }
  if (payload.azp !== CLIENT) throw new HttpError(401, 'Invalid token: azp mismatch');
  if (typeof payload.exp !== 'number') throw new HttpError(401, 'Invalid token: missing exp');
  const user = users.get(payload.preferred_username);
  if (!user) throw new HttpError(401, 'Invalid token: unknown user');
  return payload;
}

// ---------- policy ----------
function canonicalPolicy(p) {
  return {
    contractId: p.contractId, subjectType: p.subjectType, subjectId: p.subjectId,
    assignmentId: p.assignmentId, roles: p.roles, expiry: p.expiry,
  };
}

function validatePolicy(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new HttpError(400, 'policy must be an object.');
  if (p.contractId !== CONTRACT) throw new HttpError(400, `contractId must be "${CONTRACT}".`);
  if (p.subjectType !== 'User') throw new HttpError(400, 'subjectType must be "User".');
  for (const k of ['subjectId', 'assignmentId']) {
    if (typeof p[k] !== 'string' || !p[k].trim()) throw new HttpError(400, `${k} must be a non-empty string.`);
  }
  if (typeof p.roles !== 'string' || !p.roles.trim()) throw new HttpError(400, 'roles must be a JSON array string.');
  let roles;
  try { roles = JSON.parse(p.roles); } catch { throw new HttpError(400, 'roles must be a JSON array string.'); }
  if (!Array.isArray(roles) || roles.length === 0 || !roles.every((r) => r === ENC || r === DEC)) {
    throw new HttpError(400, `roles must be a non-empty subset of ["${ENC}","${DEC}"].`);
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof p.expiry !== 'number' || !Number.isInteger(p.expiry) || p.expiry <= now) {
    throw new HttpError(400, 'expiry must be an integer unix time in the future.');
  }
}

async function signPolicy(policy, keys) {
  const canon = canonicalPolicy(policy);
  const sig = await new CompactSign(new TextEncoder().encode(JSON.stringify(canon)))
    .setProtectedHeader({ alg: 'ES256' })
    .sign(keys.vvkPriv);
  return b64u(JSON.stringify({ v: 1, policy: canon, sig }));
}

const NOT_SIGNED = 'Policy supplied has not been signed.';

async function verifyPolicy(policyB64, keys) {
  let policy;
  try {
    if (typeof policyB64 !== 'string' || !policyB64) throw new Error('missing');
    const env = JSON.parse(Buffer.from(policyB64, 'base64url').toString('utf8'));
    if (!env || env.v !== 1 || typeof env.sig !== 'string' || !env.policy || typeof env.policy !== 'object') {
      throw new Error('bad envelope');
    }
    const { payload } = await compactVerify(env.sig, keys.vvkPub, { algorithms: ['ES256'] });
    const signed = new TextDecoder().decode(payload);
    if (signed !== JSON.stringify(env.policy)) throw new Error('payload mismatch');
    policy = JSON.parse(signed);
  } catch {
    throw new HttpError(403, NOT_SIGNED);
  }
  if (policy.contractId !== CONTRACT) throw new HttpError(403, NOT_SIGNED);
  return policy;
}

// ---------- crypto ----------
function dataKey(master, assignmentId) {
  return Buffer.from(crypto.hkdfSync('sha256', master, KDF_SALT, assignmentId, 32));
}

function encryptOne(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return 'sim1.' + b64u(Buffer.concat([iv, ct, c.getAuthTag()]));
}

function decryptOne(key, s) {
  try {
    if (typeof s !== 'string' || !s.startsWith('sim1.')) throw new Error('prefix');
    const raw = Buffer.from(s.slice(5), 'base64url');
    if (raw.length < 28) throw new Error('short');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(raw.length - 16);
    const ct = raw.subarray(12, raw.length - 16);
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch {
    throw new HttpError(400, 'Decryption failed.');
  }
}

// ---------- handlers ----------
async function handleCrypto(op, req, keys, users, ctx) {
  const token = await verifyToken(req, keys, users); // 1
  ctx.username = token.preferred_username;
  const body = await readJson(req);
  const policy = await verifyPolicy(body.policyB64, keys); // 2
  ctx.assignmentId = policy.assignmentId;
  if (!(Number(policy.expiry) > Math.floor(Date.now() / 1000))) throw new HttpError(403, 'Policy has expired.'); // 3
  const items = body.items; // 4
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'items must be a non-empty array.');
  if (items.length > MAX_ITEMS) throw new HttpError(400, `At most ${MAX_ITEMS} items per request.`);
  for (const it of items) {
    if (!it || typeof it !== 'object') throw new HttpError(400, 'Each item must be an object.');
    if (!Array.isArray(it.tags) || it.tags.length === 0) throw new HttpError(403, 'Every item must be tagged with the assignmentId.');
    if (it.tags.length !== 1 || !it.tags.every((t) => t === policy.assignmentId)) {
      throw new HttpError(403, 'Tags do not contain assignmentId.');
    }
  }
  if (token.tideuserkey !== policy.subjectId) throw new HttpError(403, 'subjectId does not match.'); // 5
  const role = op === 'encrypt' ? ENC : DEC;
  let policyRoles = [];
  try { policyRoles = JSON.parse(policy.roles); } catch { /* empty */ }
  if (!Array.isArray(policyRoles) || !policyRoles.includes(role)) throw new HttpError(403, `${role} not found in list of roles.`); // 6
  const realmRoles = (token.realm_access && token.realm_access.roles) || [];
  if (!realmRoles.includes(role)) { // 7
    throw new HttpError(403, `'${role}' role not found for this ${op === 'encrypt' ? 'encryption' : 'decryption'} request.`);
  }
  const key = dataKey(keys.master, policy.assignmentId);
  if (op === 'encrypt') {
    for (const it of items) {
      if (typeof it.data !== 'string') throw new HttpError(400, 'Each item.data must be a string.');
      if (Buffer.byteLength(it.data, 'utf8') > MAX_DATA) throw new HttpError(413, 'Item data exceeds 64 KB.');
    }
    ctx.detail = `${items.length} item(s)`;
    return { ciphertexts: items.map((it) => encryptOne(key, it.data)) };
  }
  for (const it of items) {
    if (typeof it.encrypted !== 'string') throw new HttpError(400, 'Each item.encrypted must be a string.');
    if (it.encrypted.length > MAX_ENCRYPTED) throw new HttpError(413, 'Item ciphertext too large.');
  }
  ctx.detail = `${items.length} item(s)`;
  return { plaintexts: items.map((it) => decryptOne(key, it.encrypted)) };
}

async function route(req, keys, users, ctx) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname.replace(/\/+$/, '') || '/';
  if (req.method === 'GET' && p === '/health') return { ok: true };
  if (req.method === 'GET' && p === '/users') {
    return {
      users: [...users.values()].map((u) => ({
        username: u.username, displayName: `${u.lastName} ${u.firstName}`.trim(), roles: u.realmRoles,
      })),
    };
  }
  if (req.method === 'POST' && p === '/login') {
    const body = await readJson(req);
    ctx.username = typeof body.username === 'string' ? body.username : '-';
    const u = typeof body.username === 'string' ? users.get(body.username) : undefined;
    if (!u) throw new HttpError(404, 'Unknown user.');
    const iat = Math.floor(Date.now() / 1000);
    const claims = {
      azp: CLIENT, typ: 'Bearer',
      preferred_username: u.username, given_name: u.firstName, family_name: u.lastName,
      name: `${u.firstName} ${u.lastName}`.trim(),
      tideuserkey: u.tideuserkey, vuid: u.vuid,
      realm_access: { roles: u.realmRoles },
      tide_local: true,
    };
    if (u.clientRoles) claims.resource_access = u.clientRoles;
    const access_token = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid: keys.tokenKid, typ: 'JWT' })
      .setIssuer(ISS).setAudience(CLIENT).setSubject(u.sub)
      .setIssuedAt(iat).setExpirationTime(iat + 3600)
      .sign(keys.tokenPriv);
    return { access_token, expires_in: 3600 };
  }
  if (req.method === 'POST' && p === '/policies/sign') {
    const token = await verifyToken(req, keys, users);
    ctx.username = token.preferred_username;
    const roles = token.resource_access?.['realm-management']?.roles || [];
    if (!roles.includes('tide-realm-admin')) throw new HttpError(403, 'Only a tide-realm-admin can sign policies.');
    const body = await readJson(req);
    validatePolicy(body.policy);
    ctx.assignmentId = body.policy.assignmentId;
    return { policyB64: await signPolicy(body.policy, keys) };
  }
  if (req.method === 'POST' && p === '/encrypt') return handleCrypto('encrypt', req, keys, users, ctx);
  if (req.method === 'POST' && p === '/decrypt') return handleCrypto('decrypt', req, keys, users, ctx);
  throw new HttpError(404, 'Not found.');
}

function drain(req) { req.resume(); }

async function main() {
  const keys = await loadState();
  writeAdapter(keys);
  const users = loadUsers();

  const server = http.createServer(async (req, res) => {
    const ctx = { username: '-', assignmentId: '-', detail: '' };
    const endpoint = `${req.method} ${(req.url || '').split('?')[0]}`;
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': CORS_ORIGIN,
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Max-Age': '600',
        'Vary': 'Origin',
      });
      res.end();
      console.log(`${new Date().toISOString()} ${endpoint} user=- assignment=- ALLOW preflight`);
      return;
    }
    let status = 200;
    let verdict = 'ALLOW';
    let reason = '';
    try {
      const out = await route(req, keys, users, ctx);
      send(res, 200, out);
      reason = ctx.detail;
    } catch (e) {
      drain(req);
      if (e instanceof HttpError) {
        status = e.status;
        reason = e.message;
      } else {
        status = 500;
        reason = 'Internal error.';
        console.error(`${new Date().toISOString()} internal error: ${e && e.message}`);
      }
      verdict = 'DENY';
      send(res, status, { error: reason });
    }
    console.log(`${new Date().toISOString()} ${endpoint} user=${ctx.username} assignment=${ctx.assignmentId} ${verdict} ${status}${reason ? ' ' + reason : ''}`);
  });
  server.listen(PORT, () => {
    console.log(`tide-local listening on http://localhost:${PORT} (local stand-in: whole keys in one process, not threshold crypto)`);
    console.log(`adapter written: ${ADAPTER_FILE}`);
  });
}

main().catch((e) => { console.error('tide-local failed to start:', e); process.exit(1); });
