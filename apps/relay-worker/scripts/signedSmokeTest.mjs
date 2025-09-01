// Signed smoke test for staging/production
// Usage examples:
//   RELAY_EVENT_SETUP_SECRET="<secret>" node ./scripts/signedSmokeTest.mjs \
//     --base=https://stg.ctrl.nuriemon.jp --event=demo --pcid=booth-01 --ttl=90
//   RELAY_EVENT_SETUP_SECRET="<secret>" node ./scripts/signedSmokeTest.mjs --help

import crypto from 'node:crypto';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function sha256hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function randomNonce() {
  return b64url(crypto.randomBytes(16));
}

function generateSid(len = 10) {
  // Crockford base32 (I O L excluded)
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function parseArgs(argv) {
  const args = {};
  for (const a of argv.slice(2)) {
    if (a === '--help' || a === '-h') args.help = true;
    else if (a.startsWith('--')) {
      const [k, v] = a.replace(/^--/, '').split('=');
      args[k] = v ?? true;
    }
  }
  return args;
}

function usage() {
  console.log(`Signed smoke test for Relay endpoints\n\n` +
`Required env:\n  RELAY_EVENT_SETUP_SECRET  Shared HMAC secret (same as Worker secret)\n\n` +
`Flags:\n  --base=URL        Base URL (default: https://stg.ctrl.nuriemon.jp)\n  --event=ID        Event ID (e.g., demo)\n  --pcid=ID         PC ID (e.g., booth-01). If omitted, pc-<rand>\n  --sid=ID          10-char base32 session ID. If omitted, random\n  --ttl=N           TTL seconds (default: 90; clamped [30,120])\n  --origin=ORIGIN   Optional Origin header (e.g., tauri://localhost)\n  --skew-test       Also test 401 clock-skew then auto-resign\n  --help            Show this help\n\nExamples:\n  RELAY_EVENT_SETUP_SECRET=... node scripts/signedSmokeTest.mjs \\\n    --base=https://stg.ctrl.nuriemon.jp --event=demo --pcid=booth-01 --ttl=90\n`);
}

async function postSigned({ base, op, path, body, secret, origin, iatOverride }) {
  const url = base.replace(/\/$/, '') + path;
  const bodyStr = body ? JSON.stringify(body) : '';
  const payloadHash = sha256hex(bodyStr);
  const iat = iatOverride ?? Math.floor(Date.now() / 1000);
  const nonce = randomNonce();
  const canonical = [op, path, payloadHash, String(iat), nonce].join('\n');
  const sig = b64url(crypto.createHmac('sha256', secret).update(canonical).digest());
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Relay-Iat': String(iat),
    'X-Relay-Nonce': nonce,
    'X-Relay-Sig': sig,
  };
  if (origin) headers['Origin'] = origin;

  const res = await fetch(url, { method: 'POST', headers, body: bodyStr });
  let data = null;
  try { data = await res.clone().json(); } catch {}
  return { res, data };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) return usage();

  const secret = process.env.RELAY_EVENT_SETUP_SECRET;
  if (!secret) {
    console.error('ERROR: RELAY_EVENT_SETUP_SECRET is not set.');
    console.error('Set it in your shell before running this script.');
    process.exit(2);
  }

  const base = args.base || 'https://stg.ctrl.nuriemon.jp';
  const eventId = args.event || process.env.EVENT_ID;
  if (!eventId) {
    console.error('ERROR: --event is required (or set EVENT_ID env).');
    process.exit(2);
  }
  const pcid = args.pcid || process.env.PCID || `pc-${Math.random().toString(36).slice(2, 8)}`;
  const ttlRaw = Number(args.ttl ?? 90);
  const ttl = Math.max(30, Math.min(120, Math.floor(isFinite(ttlRaw) ? ttlRaw : 90)));
  const origin = args.origin || undefined;
  const sid = args.sid || generateSid();

  // Health check
  const h = await fetch(base.replace(/\/$/, '') + '/healthz');
  const hv = await h.json().catch(() => ({}));
  if (!h.ok) {
    console.error('Health check failed:', h.status, hv);
    process.exit(1);
  }
  console.log('[healthz]', h.status, hv);

  // register-pc (normal)
  console.log(`[register-pc] event=${eventId} pcid=${pcid}`);
  let r = await postSigned({ base, op: 'register-pc', path: `/e/${eventId}/register-pc`, body: { pcid }, secret, origin });
  if (r.res.status === 401 && r.res.headers.get('x-server-time')) {
    const serverTime = parseInt(r.res.headers.get('x-server-time'), 10);
    console.log('[register-pc] 401 clock skew; retrying with server time', serverTime);
    r = await postSigned({ base, op: 'register-pc', path: `/e/${eventId}/register-pc`, body: { pcid }, secret, origin, iatOverride: serverTime });
  }
  console.log('[register-pc] status', r.res.status, r.data);
  if (![200, 429, 503].includes(r.res.status)) {
    console.error('register-pc unexpected status, aborting.');
    process.exit(1);
  }

  // optional clock-skew forced test
  if (args['skew-test']) {
    console.log('[register-pc/skew-test] forcing iat-200 to trigger 401');
    let s = await postSigned({ base, op: 'register-pc', path: `/e/${eventId}/register-pc`, body: { pcid }, secret, origin, iatOverride: Math.floor(Date.now() / 1000) - 200 });
    const st = s.res.headers.get('x-server-time');
    console.log('[register-pc/skew-test] first status', s.res.status, 'X-Server-Time:', st);
    if (s.res.status === 401 && st) {
      const t = parseInt(st, 10);
      s = await postSigned({ base, op: 'register-pc', path: `/e/${eventId}/register-pc`, body: { pcid }, secret, origin, iatOverride: t });
      console.log('[register-pc/skew-test] retry status', s.res.status, s.data);
    }
  }

  // pending-sid
  console.log(`[pending-sid] event=${eventId} pcid=${pcid} sid=${sid} ttl=${ttl}`);
  let p = await postSigned({ base, op: 'pending-sid', path: `/e/${eventId}/pending-sid`, body: { pcid, sid, ttl }, secret, origin });
  if (p.res.status === 401 && p.res.headers.get('x-server-time')) {
    const serverTime = parseInt(p.res.headers.get('x-server-time'), 10);
    console.log('[pending-sid] 401 clock skew; retrying with server time', serverTime);
    p = await postSigned({ base, op: 'pending-sid', path: `/e/${eventId}/pending-sid`, body: { pcid, sid, ttl }, secret, origin, iatOverride: serverTime });
  }
  console.log('[pending-sid] status', p.res.status, p.data);
  if (p.res.status !== 200) {
    console.error('pending-sid failed.');
    process.exit(1);
  }

  // duplicate should be 409
  const dup = await postSigned({ base, op: 'pending-sid', path: `/e/${eventId}/pending-sid`, body: { pcid, sid, ttl }, secret, origin });
  console.log('[pending-sid/dup] status', dup.res.status, dup.data);
  if (dup.res.status !== 409) {
    console.warn('Expected 409 for duplicate sid but got', dup.res.status);
  }

  console.log('\nDONE: All checks executed.');
  console.log(`Summary:\n  base=${base}\n  event=${eventId}\n  pcid=${pcid}\n  sid=${sid}\n  ttl=${ttl}`);
}

main().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(1);
});

