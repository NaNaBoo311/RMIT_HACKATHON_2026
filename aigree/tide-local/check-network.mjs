// Network check for tide-local/server.mjs: every RelationshipAttestation rule and refusal message. Needs the server running.
const BASE = process.env.TIDE_LOCAL_URL || `http://localhost:${process.env.TIDE_LOCAL_PORT || 8090}`;
const TAG = 'bn_test01_mat';
let failures = 0;

function report(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  -> ' + detail : ''}`);
}

async function call(method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

const claimsOf = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8'));
const now = () => Math.floor(Date.now() / 1000);

async function login(username) {
  const r = await call('POST', '/login', { username });
  if (r.status !== 200 || !r.json?.access_token) throw new Error(`login ${username} failed: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.access_token;
}

function policyFor(subjectId, roles, expiry, assignmentId = TAG) {
  return {
    contractId: 'RelationshipAttestation:1', subjectType: 'User', subjectId,
    assignmentId, roles: JSON.stringify(roles), expiry,
  };
}

async function sign(token, policy) {
  return call('POST', '/policies/sign', { policy }, token);
}

async function expectOk(name, r, check) {
  const ok = r.status === 200 && (!check || check(r.json));
  report(name, ok, `${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
}

function expectErr(name, r, status, message) {
  const ok = r.status === status && r.json?.error === message;
  report(name, ok, `got ${r.status} ${JSON.stringify(r.json)}; want ${status} "${message}"`);
}

async function main() {
  const h = await call('GET', '/health');
  report('health', h.status === 200 && h.json?.ok === true, JSON.stringify(h.json));

  const u = await call('GET', '/users');
  const names = (u.json?.users || []).map((x) => x.username);
  report('users lists lan, minh, admin', ['lan', 'minh', 'admin'].every((n) => names.includes(n)), names.join(','));

  expectErr('unknown user login -> 404', await call('POST', '/login', { username: 'nobody' }), 404, 'Unknown user.');
  report('bad JSON -> 400', (await call('POST', '/login', '{not json')).status === 400);

  const lan = await login('lan');
  const minh = await login('minh');
  const admin = await login('admin');
  report('logins (lan, minh, admin)', !!(lan && minh && admin));
  const lanKey = claimsOf(lan).tideuserkey;
  const minhKey = claimsOf(minh).tideuserkey;
  const adminKey = claimsOf(admin).tideuserkey;
  report('token claims shape', claimsOf(admin).resource_access?.['realm-management']?.roles?.includes('tide-realm-admin')
    && !claimsOf(lan).resource_access && claimsOf(lan).realm_access.roles.includes('_tide_enabled')
    && !claimsOf(lan).realm_access.roles.some((r) => r.startsWith('default-roles-')));

  const pLan = (await expectOk('admin signs lan read-write policy',
    await sign(admin, policyFor(lanKey, ['_tide_encryptor', '_tide_decryptor'], now() + 600)), (j) => !!j.policyB64))?.policyB64;
  const pMinh = (await expectOk('admin signs minh read policy',
    await sign(admin, policyFor(minhKey, ['_tide_decryptor'], now() + 600)), (j) => !!j.policyB64))?.policyB64;
  const pMinhShort = (await expectOk('admin signs minh short-lived policy',
    await sign(admin, policyFor(minhKey, ['_tide_decryptor'], now() + 2)), (j) => !!j.policyB64))?.policyB64;
  const pAdmin = (await expectOk('admin signs policy for own key',
    await sign(admin, policyFor(adminKey, ['_tide_decryptor'], now() + 600)), (j) => !!j.policyB64))?.policyB64;

  expectErr('sign with past expiry -> 400', await sign(admin, policyFor(lanKey, ['_tide_decryptor'], now() - 10)), 400,
    'expiry must be an integer unix time in the future.');
  expectErr('minh cannot sign -> 403', await sign(minh, policyFor(minhKey, ['_tide_decryptor'], now() + 600)), 403,
    'Only a tide-realm-admin can sign policies.');

  const enc = await expectOk('lan encrypts "hello"',
    await call('POST', '/encrypt', { items: [{ data: 'hello', tags: [TAG] }], policyB64: pLan }, lan),
    (j) => Array.isArray(j.ciphertexts) && j.ciphertexts[0].startsWith('sim1.'));
  const ct = enc?.ciphertexts?.[0];

  await expectOk('lan decrypts -> "hello"',
    await call('POST', '/decrypt', { items: [{ encrypted: ct, tags: [TAG] }], policyB64: pLan }, lan),
    (j) => j.plaintexts?.[0] === 'hello');
  await expectOk('minh decrypts lan ciphertext with his read policy -> "hello"',
    await call('POST', '/decrypt', { items: [{ encrypted: ct, tags: [TAG] }], policyB64: pMinh }, minh),
    (j) => j.plaintexts?.[0] === 'hello');

  expectErr('minh encrypts with read policy', await call('POST', '/encrypt',
    { items: [{ data: 'x', tags: [TAG] }], policyB64: pMinh }, minh), 403, '_tide_encryptor not found in list of roles.');
  expectErr('minh uses lan policy', await call('POST', '/decrypt',
    { items: [{ encrypted: ct, tags: [TAG] }], policyB64: pLan }, minh), 403, 'subjectId does not match.');
  expectErr('lan encrypts with wrong tag', await call('POST', '/encrypt',
    { items: [{ data: 'x', tags: [TAG + '_x'] }], policyB64: pLan }, lan), 403, 'Tags do not contain assignmentId.');
  expectErr('two tags refused', await call('POST', '/encrypt',
    { items: [{ data: 'x', tags: [TAG, 'other'] }], policyB64: pLan }, lan), 403, 'Tags do not contain assignmentId.');
  expectErr('two identical tags refused', await call('POST', '/encrypt',
    { items: [{ data: 'x', tags: [TAG, TAG] }], policyB64: pLan }, lan), 403, 'Tags do not contain assignmentId.');
  expectErr('no tags refused', await call('POST', '/encrypt',
    { items: [{ data: 'x', tags: [] }], policyB64: pLan }, lan), 403, 'Every item must be tagged with the assignmentId.');
  expectErr('hospital decrypts with lan policy', await call('POST', '/decrypt',
    { items: [{ encrypted: ct, tags: [TAG] }], policyB64: pLan }, admin), 403, 'subjectId does not match.');
  expectErr('hospital decrypts with own-key policy', await call('POST', '/decrypt',
    { items: [{ encrypted: ct, tags: [TAG] }], policyB64: pAdmin }, admin), 403,
    "'_tide_decryptor' role not found for this decryption request.");

  // tampered policy: change subjectId inside the envelope, keep the original sig
  const envl = JSON.parse(Buffer.from(pLan, 'base64url').toString('utf8'));
  envl.policy.subjectId = minhKey;
  const tampered = Buffer.from(JSON.stringify(envl)).toString('base64url');
  expectErr('tampered policyB64', await call('POST', '/decrypt',
    { items: [{ encrypted: ct, tags: [TAG] }], policyB64: tampered }, minh), 403, 'Policy supplied has not been signed.');
  expectErr('garbage policyB64', await call('POST', '/decrypt',
    { items: [{ encrypted: ct, tags: [TAG] }], policyB64: 'zzz' }, minh), 403, 'Policy supplied has not been signed.');

  const bad = ct.slice(0, -2) + (ct.endsWith('A') ? 'BB' : 'AA');
  expectErr('tampered ciphertext', await call('POST', '/decrypt',
    { items: [{ encrypted: bad, tags: [TAG] }], policyB64: pLan }, lan), 400, 'Decryption failed.');

  const noTok = await call('POST', '/decrypt', { items: [{ encrypted: ct, tags: [TAG] }], policyB64: pLan });
  report('missing token -> 401', noTok.status === 401 && String(noTok.json?.error).startsWith('Invalid token: '), JSON.stringify(noTok.json));
  const forged = lan.slice(0, -4) + (lan.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  const badTok = await call('POST', '/decrypt', { items: [{ encrypted: ct, tags: [TAG] }], policyB64: pLan }, forged);
  report('forged token -> 401', badTok.status === 401 && String(badTok.json?.error).startsWith('Invalid token: '), JSON.stringify(badTok.json));

  await new Promise((r) => setTimeout(r, 3000));
  expectErr('expired policy', await call('POST', '/decrypt',
    { items: [{ encrypted: ct, tags: [TAG] }], policyB64: pMinhShort }, minh), 403, 'Policy has expired.');

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAIL(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FAIL  network check crashed:', e.message); process.exit(1); });
