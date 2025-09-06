import { GlobalSettingsService } from './globalSettings';
import { loadDeviceToken } from './licenseClient';
import { currentRelayEnvAsSecretEnv, getEventSetupSecret } from './secureSecrets';
import { PROTOCOL_VERSION } from '../protocol/version';

export type RelayResponse<T> = { ok: true; data: T } | { ok: false; status?: number; error?: string; retryAfterMs?: number; code?: string };

export async function resolveBaseUrl(): Promise<string> {
  // 0) ユーザー保存のベースURLがあれば最優先（開発時の一時切替用途）
  const userSaved = await GlobalSettingsService.get('relay_base_url');
  if (userSaved && userSaved.trim()) return userSaved.replace(/\/$/, '');

  // 1) effective の relay.baseUrl（プロビジョニング/ENVでの一元化）
  try {
    const eff = GlobalSettingsService.getEffective() || await GlobalSettingsService.loadEffective();
    const effUrl = (eff as any)?.relay?.baseUrl as string | undefined;
    if (effUrl && typeof effUrl === 'string' && effUrl.trim() !== '') {
      return effUrl.replace(/\/$/, '');
    }
  } catch (_) {}

  // 2) 互換: 既存の保存キー（env 切替 + prod/stg URL, 旧 relay_base_url）
  const env = (await GlobalSettingsService.get('relay_env')) || 'prod';
  const prod = (await GlobalSettingsService.get('relay_base_url_prod')) || 'https://ctrl.nuriemon.jp';
  const stg = (await GlobalSettingsService.get('relay_base_url_stg')) || 'https://stg.ctrl.nuriemon.jp';
  const legacy = await GlobalSettingsService.get('relay_base_url');
  let chosen: string;
  if (legacy && !prod && !stg) {
    chosen = legacy;
  } else {
    chosen = env === 'stg' ? stg : prod;
  }
  return (chosen || 'https://ctrl.nuriemon.jp').replace(/\/$/, '');
}

async function baseUrl(): Promise<string> {
  return resolveBaseUrl();
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = parseInt(header, 10);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

// ========= canonical v1 helpers =========
const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

async function sha256hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(d)).map(x => x.toString(16).padStart(2, '0')).join('');
}

async function signRequest(op: 'register-pc'|'pending-sid', path: string, bodyStr: string, secret: string, iatOverride?: number) {
  const enc = new TextEncoder();
  const payloadBytes = enc.encode(bodyStr);
  const payloadHash = await sha256hex(payloadBytes);
  const iat = iatOverride ?? Math.floor(Date.now() / 1000);
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = b64url(nonceBytes);
  const canonical = [op, path, payloadHash, String(iat), nonce].join('\n');
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(canonical));
  const sig = b64url(new Uint8Array(sigBuf));
  return {
    headers: {
      'X-Relay-Iat': String(iat),
      'X-Relay-Nonce': nonce,
      'X-Relay-Sig': sig,
      'Content-Type': 'application/json; charset=utf-8'
    }
  };
}

async function signedPost<T>({ base, op, path, body, secret }: { base: string; op: 'register-pc'|'pending-sid'; path: string; body: any; secret: string }): Promise<RelayResponse<T>> {
  try {
    const url = base.replace(/\/$/, '') + path;
    const bodyStr = body ? JSON.stringify(body) : '';
    let signed = await signRequest(op, path, bodyStr, secret);
    let res = await fetch(url, {
      method: 'POST',
      headers: signed.headers as any,
      body: bodyStr,
      credentials: 'omit',
    });

    // 401 clock skew with X-Server-Time → one-time resync retry
    if (res.status === 401) {
      const serverTime = res.headers.get('X-Server-Time');
      if (serverTime) {
        const iat = parseInt(serverTime, 10);
        if (!Number.isNaN(iat)) {
          signed = await signRequest(op, path, bodyStr, secret, iat);
          res = await fetch(url, { method: 'POST', headers: signed.headers as any, body: bodyStr, credentials: 'omit' });
        }
      }
    }

    if (res.status === 429 || res.status === 503) {
      return { ok: false, status: res.status, retryAfterMs: parseRetryAfter(res.headers.get('Retry-After')) };
    }
    if (!res.ok) {
      let code: string | undefined;
      try { const err = await res.json(); code = err?.code; } catch {}
      return { ok: false, status: res.status, code };
    }
    const data = await res.json();
    return { ok: true, data } as RelayResponse<T>;
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// HMAC-SHA256 signature, return base64url string
export async function hmacSignBase64Url(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(mac)));
  // base64url
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function registerPc(params: { eventId: string; pcid: string }): Promise<RelayResponse<{ ok: true }>> {
  const base = await baseUrl();
  const path = `/e/${encodeURIComponent(params.eventId)}/register-pc`;
  const body = { pcid: params.pcid };
  const bearer = await loadDeviceToken();
  if (bearer) {
    try {
      const url = base + path;
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', 'Authorization': `Bearer ${bearer}` }, body: JSON.stringify(body), credentials: 'omit' });
      if (res.status === 429 || res.status === 503) return { ok: false, status: res.status, retryAfterMs: parseRetryAfter(res.headers.get('Retry-After')) };
      if (!res.ok) { let code: string | undefined; try { const err = await res.json(); code = err?.code; } catch {}; return { ok: false, status: res.status, code }; }
      const data = await res.json();
      return { ok: true, data } as RelayResponse<{ ok: true }>;
    } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
  }
  // fallback (legacy HMAC): staging/demo only via secureSecrets
  const env = await currentRelayEnvAsSecretEnv();
  const secret = await getEventSetupSecret(env);
  if (!secret) return { ok: false, error: 'E_MISSING_SECRET' };
  return signedPost<{ ok: true }>({ base, op: 'register-pc', path, body, secret });
}

export async function pendingSid(params: { eventId: string; pcid: string; sid: string; ttl: number; ts?: number }): Promise<RelayResponse<{ ok: true }>> {
  const base = await baseUrl();
  const path = `/e/${encodeURIComponent(params.eventId)}/pending-sid`;
  // clamp ttl to [30,120]
  const ttl = Math.max(30, Math.min(120, Math.floor(params.ttl)));
  const body = { pcid: params.pcid, sid: params.sid, ttl };
  const bearer = await loadDeviceToken();
  if (bearer) {
    try {
      const url = base + path;
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', 'Authorization': `Bearer ${bearer}` }, body: JSON.stringify(body), credentials: 'omit' });
      if (res.status === 429 || res.status === 503) return { ok: false, status: res.status, retryAfterMs: parseRetryAfter(res.headers.get('Retry-After')) };
      if (!res.ok) { let code: string | undefined; try { const err = await res.json(); code = err?.code; } catch {}; return { ok: false, status: res.status, code }; }
      const data = await res.json();
      return { ok: true, data } as RelayResponse<{ ok: true }>;
    } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
  }
  // fallback legacy HMAC
  const env = await currentRelayEnvAsSecretEnv();
  const secret = await getEventSetupSecret(env);
  if (!secret) return { ok: false, error: 'E_MISSING_SECRET' };
  return signedPost<{ ok: true }>({ base, op: 'pending-sid', path, body, secret });
}

export async function getHealthz(): Promise<RelayResponse<{ ok: boolean; version: number }>> {
  const base = await baseUrl();
  try {
    const res = await fetch(`${base}/healthz`);
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    return { ok: data?.ok === true && data?.version === PROTOCOL_VERSION, data } as any;
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// Query if a SID has been claimed (WS joined) on Relay
export async function getSidStatus(eventId: string, sid: string): Promise<RelayResponse<{ connected: boolean }>> {
  const base = await baseUrl();
  try {
    const url = `${base}/e/${encodeURIComponent(eventId)}/sid-status?sid=${encodeURIComponent(sid)}`;
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    return { ok: true, data } as any;
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// Exchange a pending SID for a one-time WS bearer token
export async function exchangeSidForToken(eventId: string, sid: string): Promise<RelayResponse<{ token: string; exp?: number }>> {
  const base = await baseUrl();
  try {
    const url = `${base}/e/${encodeURIComponent(eventId)}/session`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ sid }),
      credentials: 'omit',
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    return { ok: true, data } as any;
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// Retry helper with exponential backoff and jitter
export async function retryWithBackoff<T>(
  task: () => Promise<RelayResponse<T>>,
  opts?: { maxAttempts?: number; baseMs?: number; factor?: number; jitter?: number; capMs?: number }
): Promise<RelayResponse<T>> {
  const maxAttempts = opts?.maxAttempts ?? 5;
  const baseMs = opts?.baseMs ?? 400;
  const factor = opts?.factor ?? 2;
  const jitter = opts?.jitter ?? 0.2;
  const capMs = opts?.capMs ?? 15000;

  let attempt = 0;
  while (attempt < maxAttempts) {
    const res = await task();
    if (res.ok) return res;
    attempt++;
    if (attempt >= maxAttempts) return res;

    // Respect Retry-After if present
    let delay = (res as any).retryAfterMs as number | undefined;
    if (delay === undefined) {
      const pow = Math.min(capMs, baseMs * Math.pow(factor, attempt - 1));
      const jitterDelta = pow * jitter;
      delay = Math.floor(pow + (Math.random() * 2 - 1) * jitterDelta);
    }
    await new Promise(r => setTimeout(r, Math.max(0, delay)));
  }
  // Should not reach here
  return { ok: false, error: 'retry_exhausted' };
}
