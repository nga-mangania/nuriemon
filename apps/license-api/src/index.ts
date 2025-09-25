/// <reference types="@cloudflare/workers-types/2023-07-01" />

interface Env {
  DB: D1Database;
  // Private signing JWK (RSA or OKP Ed25519). JSON string.
  SIGNING_JWK: string;
  // Optional: Pre-baked JWKS (public). JSON string. Preferred if present.
  SIGNING_PUBLIC_JWKS?: string;
  // Optional: Admin API key to protect license management endpoints
  ADMIN_API_KEY?: string;
  // Issuer/Audience and token TTL
  ISSUER: string;
  AUDIENCE: string;
  TOKEN_TTL_SECONDS?: string | number;
}

type Json = Record<string, any> | Array<any> | string | number | boolean | null;

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

      if (req.method === 'GET' && url.pathname === '/healthz') {
        return cors(json({ ok: true }));
      }

      if (req.method === 'GET' && url.pathname === '/.well-known/jwks.json') {
        try {
          // 1) Prefer explicitly provisioned public JWKS
          if (env.SIGNING_PUBLIC_JWKS && env.SIGNING_PUBLIC_JWKS.trim()) {
            const raw = env.SIGNING_PUBLIC_JWKS.trim();
            const obj = JSON.parse(raw);
            return cors(json(obj));
          }
        } catch (e) {
          try { console.error('[jwks] parse SIGNING_PUBLIC_JWKS failed', (e as any)?.message || e); } catch {}
        }
        // 2) Fallback: derive public part from provided private JWK fields (without export)
        const jwks = await currentPublicJwks(env).catch(() => ({ keys: [] }));
        return cors(json(jwks));
      }

      if (req.method === 'POST' && url.pathname === '/activate') {
        const body = await readJson(req);
        if (!body || typeof body.licenseCode !== 'string' || !body.device || typeof body.device.pcId !== 'string') {
          return cors(error(400, 'E_BAD_REQUEST'));
        }
        const now = Math.floor(Date.now() / 1000);
        const code = body.licenseCode.trim();
        const pcId = String(body.device.pcId).trim();
        const license = await findLicenseByCode(env.DB, code);
        if (!license) return cors(error(404, 'E_LICENSE_NOT_FOUND'));
        if (license.status !== 'active') return cors(error(403, 'E_LICENSE_INACTIVE'));
        if (license.expires_at && Number(license.expires_at) > 0 && Number(license.expires_at) < now) {
          return cors(error(403, 'E_LICENSE_EXPIRED'));
        }

        // enforce seats: deactivate oldest active devices if necessary
        const seats = Math.max(1, Number(license.seats || 1));
        const active = await countActiveDevices(env.DB, license.id);
        const existingDevice = await findDeviceByPcId(env.DB, license.id, pcId);
        if (!existingDevice && active >= seats) {
          return cors(error(409, 'E_SEAT_LIMIT'));
        }
        // upsert device
        const device = {
          id: existingDevice?.id || crypto.randomUUID(),
          pc_id: pcId,
          platform: String(body.device.platform || ''),
          created_at: now,
          last_seen_at: now,
          license_id: license.id,
          status: 'active',
        };
        await upsertDevice(env.DB, device);

        // sign token
        const ttl = Number(env.TOKEN_TTL_SECONDS || 2592000);
        const exp = now + Math.max(3600, ttl);
        const jwt = await signJwt(env, {
          iss: env.ISSUER,
          aud: env.AUDIENCE,
          sub: device.pc_id,
          lic: license.id,
          sku: license.sku,
          seats: seats,
          scope: ['pc:register', 'pc:pending-sid', 'pc:ws'],
          iat: now,
          exp,
          jti: crypto.randomUUID(),
        });
        return cors(json({ deviceToken: jwt, expiresAt: exp }));
      }

      if (req.method === 'POST' && url.pathname === '/token/refresh') {
        const token = bearer(req.headers.get('Authorization'));
        if (!token) return cors(error(401, 'E_NO_BEARER'));
        const payload = await verifyJwt(env, token).catch(() => null);
        if (!payload) return cors(error(401, 'E_BAD_TOKEN'));
        const now = Math.floor(Date.now() / 1000);
        const lic = await findLicenseById(env.DB, String((payload as any).lic || ''));
        if (!lic || lic.status !== 'active') return cors(error(403, 'E_LICENSE_INACTIVE'));
        if (lic.expires_at && Number(lic.expires_at) > 0 && Number(lic.expires_at) < now) return cors(error(403, 'E_LICENSE_EXPIRED'));
        const ttl = Number(env.TOKEN_TTL_SECONDS || 2592000);
        const exp = now + Math.max(3600, ttl);
        const jwt = await signJwt(env, {
          iss: env.ISSUER,
          aud: env.AUDIENCE,
          sub: String((payload as any).sub || ''),
          lic: String((payload as any).lic || ''),
          sku: lic.sku,
          seats: Number(lic.seats || 1),
          scope: Array.isArray((payload as any).scope) ? (payload as any).scope : ['pc:register','pc:pending-sid','pc:ws'],
          iat: now,
          exp,
          jti: crypto.randomUUID(),
        });
        return cors(json({ deviceToken: jwt, expiresAt: exp }));
      }

      if (req.method === 'POST' && url.pathname === '/license/issue') {
        if (!isAdmin(req, env)) return cors(error(401, 'E_ADMIN_REQUIRED'));
        const body = await readJson(req);
        const code = String(body?.code || '').trim() || generateLicenseCode();
        const id = body?.id && String(body.id).trim() ? String(body.id).trim() : `lic_${nanoid(10)}`;
        const seats = Number(body?.seats || 1);
        const sku = String(body?.sku || 'NRM-STD');
        const status = String(body?.status || 'active');
        const expires_at = body?.expiresAt ? Number(body.expiresAt) : null;
        const note = String(body?.note || '');
        const issued_at = Math.floor(Date.now() / 1000);
        await env.DB.prepare(
          'INSERT INTO licenses (id, code, sku, seats, status, issued_at, expires_at, note) VALUES (?,?,?,?,?,?,?,?)'
        ).bind(id, code, sku, seats, status, issued_at, expires_at, note).run();
        return cors(json({ ok: true, id, code }));
      }

      if (req.method === 'POST' && url.pathname === '/license/revoke') {
        if (!isAdmin(req, env)) return cors(error(401, 'E_ADMIN_REQUIRED'));
        const body = await readJson(req);
        const code = String(body?.code || '').trim();
        if (!code) return cors(error(400, 'E_BAD_CODE'));
        await env.DB.prepare('UPDATE licenses SET status = ? WHERE code = ?').bind('revoked', code).run();
        return cors(json({ ok: true }));
      }

      return cors(error(404, 'E_NOT_FOUND'));
    } catch (e: any) {
      try { console.error('[license-api] error', e?.stack || e?.message || String(e)); } catch {}
      return cors(error(500, 'E_INTERNAL'));
    }
  },
};

// =============== storage helpers ===============
async function findLicenseByCode(DB: D1Database, code: string) {
  const r = await DB.prepare('SELECT * FROM licenses WHERE code = ?').bind(code).first();
  return r as any;
}
async function findLicenseById(DB: D1Database, id: string) {
  const r = await DB.prepare('SELECT * FROM licenses WHERE id = ?').bind(id).first();
  return r as any;
}
async function countActiveDevices(DB: D1Database, licenseId: string): Promise<number> {
  const r = await DB.prepare('SELECT COUNT(1) as c FROM devices WHERE license_id = ? AND status = ?').bind(licenseId, 'active').first();
  return Number((r as any)?.c || 0);
}
async function findDeviceByPcId(DB: D1Database, licenseId: string, pcId: string) {
  const row = await DB.prepare('SELECT * FROM devices WHERE license_id = ? AND pc_id = ? LIMIT 1').bind(licenseId, pcId).first();
  return row as any || null;
}
async function upsertDevice(DB: D1Database, d: any) {
  // Try update by pc_id + license
  const ex = await DB.prepare('SELECT id FROM devices WHERE pc_id = ? AND license_id = ?').bind(d.pc_id, d.license_id).first();
  if (ex) {
    await DB.prepare('UPDATE devices SET platform=?, last_seen_at=?, status=? WHERE id=?').bind(d.platform, d.last_seen_at, 'active', (ex as any).id).run();
  } else {
    await DB.prepare('INSERT INTO devices (id, pc_id, platform, created_at, last_seen_at, license_id, status) VALUES (?,?,?,?,?,?,?)')
      .bind(d.id, d.pc_id, d.platform, d.created_at, d.last_seen_at, d.license_id, d.status).run();
  }
}

// =============== JWT ===============
async function signJwt(env: Env, payload: Record<string, any>): Promise<string> {
  const jwk = JSON.parse(env.SIGNING_JWK);
  const kid = jwk.kid || `k_${nanoid(6)}`;
  jwk.kid = kid;
  const header = { alg: jwk.kty === 'OKP' ? 'EdDSA' : 'RS256', typ: 'JWT', kid };
  const enc = new TextEncoder();
  const input = `${b64url(enc.encode(JSON.stringify(header)))}.${b64url(enc.encode(JSON.stringify(payload)))}`;
  const key = await importPrivateKey(jwk);
  const sigBuf = await crypto.subtle.sign(jwk.kty === 'OKP' ? 'Ed25519' : { name: 'RSASSA-PKCS1-v1_5' }, key, enc.encode(input));
  const sig = b64url(new Uint8Array(sigBuf));
  return `${input}.${sig}`;
}

async function verifyJwt(env: Env, token: string): Promise<Record<string, any>> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('bad token');
  const enc = new TextEncoder();
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  const sig = b64urlDecode(parts[2]);
  const jwks = await currentPublicJwks(env);
  const jwk = jwks.keys.find((k: any) => k.kid === header.kid);
  if (!jwk) throw new Error('kid not found');
  const key = await importPublicKey(jwk);
  const data = enc.encode(`${parts[0]}.${parts[1]}`);
  const ok = await crypto.subtle.verify(jwk.kty === 'OKP' ? 'Ed25519' : { name: 'RSASSA-PKCS1-v1_5' }, key, sig, data);
  if (!ok) throw new Error('bad signature');
  // basic claims
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now >= Number(payload.exp)) throw new Error('exp');
  if (payload.nbf && now < Number(payload.nbf)) throw new Error('nbf');
  if (env.AUDIENCE && payload.aud !== env.AUDIENCE) throw new Error('aud');
  if (env.ISSUER && payload.iss !== env.ISSUER) throw new Error('iss');
  return payload;
}

async function currentPublicJwks(env: Env): Promise<any> {
  try {
    const jwk = JSON.parse(env.SIGNING_JWK);
    const kid = jwk.kid || `k_${nanoid(6)}`;
    if (jwk.kty === 'OKP') {
      // Use embedded public component if present; never export from private key
      if (jwk.x) {
        return { keys: [{ kty: 'OKP', crv: jwk.crv || 'Ed25519', x: jwk.x, kid }] };
      }
      return { keys: [] };
    }
    if (jwk.kty === 'RSA') {
      if (jwk.n && jwk.e) {
        return { keys: [{ kty: 'RSA', n: jwk.n, e: jwk.e, kid }] };
      }
      return { keys: [] };
    }
    return { keys: [] };
  } catch {
    return { keys: [] };
  }
}

async function importPrivateKey(jwk: any): Promise<CryptoKey> {
  if (jwk.kty === 'OKP') {
    return crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign']);
  }
  return crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}
async function importPublicKey(jwk: any): Promise<CryptoKey> {
  if (jwk.kty === 'OKP') {
    return crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['verify']);
  }
  return crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}
// Removed export-based derivation; Workers keys are non-extractable by design

// =============== utils ===============
function json(j: Json, init: ResponseInit = {}) {
  const h = new Headers(init.headers);
  h.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(j), { ...init, headers: h });
}
function error(status: number, code: string) {
  return json({ ok: false, error: { code } }, { status });
}
function cors(res: Response): Response {
  const h = new Headers(res.headers);
  const origin = '*';
  h.set('Access-Control-Allow-Origin', origin);
  h.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Admin-Api-Key');
  return new Response(res.body, { status: res.status, headers: h });
}
async function readJson(req: Request): Promise<any> {
  try { return await req.json(); } catch { return null; }
}
function bearer(h: string | null): string | null {
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}
function nanoid(n = 12): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
  let s = '';
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  for (let i = 0; i < n; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}
function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : '';
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
function isAdmin(req: Request, env: Env): boolean {
  const k = req.headers.get('X-Admin-Api-Key');
  return !!k && !!env.ADMIN_API_KEY && k === env.ADMIN_API_KEY;
}
function generateLicenseCode(): string {
  // 20-char uppercase base32ish
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  for (let i = 0; i < 20; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}
