/// <reference types="@cloudflare/workers-types/2023-07-01" />

interface Env {
  EVENT_DO: DurableObjectNamespace;
  ALLOWED_ORIGINS: string;
  EVENT_SETUP_SECRET: string; // wrangler secret put EVENT_SETUP_SECRET
}

const PROTOCOL_VERSION = 1;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const allow = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const cors: Record<string, string> = {
      'Access-Control-Allow-Origin': allow.includes(origin) ? origin : allow[0] || '',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,Sec-WebSocket-Protocol,X-Relay-Iat,X-Relay-Nonce,X-Relay-Sig',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    // Minimal mobile controller UI (staging): GET /app
    if (req.method === 'GET' && (url.pathname === '/app' || url.pathname === '/app/')) {
      const html = appHtml();
      const h = new Headers({ ...cors, 'content-type': 'text/html; charset=utf-8' });
      return new Response(html, { status: 200, headers: h });
    }

    // WebSocket: GET /e/{event}/ws
    let mw = url.pathname.match(/^\/e\/([a-z0-9-]{3,32})\/ws$/);
    if (req.method === 'GET' && mw && req.headers.get('Upgrade') === 'websocket') {
      // Optional Origin check: allow empty Origin (CLI/debug), or a member of allowlist
      if (origin && allow.length > 0 && !allow.includes(origin)) {
        return new Response('Forbidden origin', { status: 403 });
      }
      // Delegate the full WS upgrade to DO (DO will create WebSocketPair and accept)
      const stub = env.EVENT_DO.get(env.EVENT_DO.idFromName(mw[1]));
      return stub.fetch(req);
    }

    // /healthz
    if (url.pathname === '/healthz') {
      return json({ ok: true, version: PROTOCOL_VERSION }, { headers: cors });
    }

    // POST /e/{event}/register-pc
    let m = url.pathname.match(/^\/e\/([a-z0-9-]{3,32})\/register-pc$/);
    if (req.method === 'POST' && m) {
      const eventId = m[1];
      const path = `/e/${eventId}/register-pc`;
      const verify = await verifySigned(req, env, 'register-pc', path, eventId);
      if (!verify.ok) return error(verify, cors);

      const body = await readJson(req);
      if (!body || typeof body.pcid !== 'string' || !/^[a-z0-9-]{3,32}$/.test(body.pcid)) {
        return error({ status: 400, code: 'E_BAD_FIELD' }, cors);
      }

      // Pc登録（冪等）
      const stub = env.EVENT_DO.get(env.EVENT_DO.idFromName(eventId));
      const r = await stub.fetch('https://do/register-pc', { method: 'POST', body: JSON.stringify({ pcid: body.pcid }) });
      if (r.status === 200) return json({ ok: true }, { headers: cors });
      if (r.status === 429) return withRetryAfter(429, cors);
      return error({ status: 503, code: 'E_OVERLOADED' }, cors);
    }

    // POST /e/{event}/pending-sid
    m = url.pathname.match(/^\/e\/([a-z0-9-]{3,32})\/pending-sid$/);
    if (req.method === 'POST' && m) {
      const eventId = m[1];
      const path = `/e/${eventId}/pending-sid`;
      const verify = await verifySigned(req, env, 'pending-sid', path, eventId);
      if (!verify.ok) return error(verify, cors);

      const body = await readJson(req);
      const okFields =
        body && typeof body.pcid === 'string' && /^[a-z0-9-]{3,32}$/.test(body.pcid) && typeof body.sid === 'string' && /^[A-Za-z0-9]{10}$/.test(body.sid) && typeof body.ttl === 'number';
      if (!okFields) return error({ status: 400, code: 'E_BAD_FIELD' }, cors);

      const ttl = Math.max(30, Math.min(120, Math.floor(body.ttl)));
      const stub = env.EVENT_DO.get(env.EVENT_DO.idFromName(eventId));
      const r = await stub.fetch('https://do/pending-sid', { method: 'POST', body: JSON.stringify({ pcid: body.pcid, sid: body.sid, ttl }) });
      if (r.status === 200) return json({ ok: true }, { headers: cors });
      if (r.status === 409) return error({ status: 409, code: 'E_SID_EXISTS' }, cors);
      if (r.status === 403) return error({ status: 403, code: 'E_PC_NOT_REGISTERED' }, cors);
      if (r.status === 429) return withRetryAfter(429, cors);
      return error({ status: 503, code: 'E_OVERLOADED' }, cors);
    }

    // GET /e/{event}/sid-status?sid=XXXX
    m = url.pathname.match(/^\/e\/([a-z0-9-]{3,32})\/sid-status$/);
    if (req.method === 'GET' && m) {
      const eventId = m[1];
      const sid = new URL(req.url).searchParams.get('sid') || '';
      if (!sid || !/^[A-Za-z0-9]{10}$/.test(sid)) return error({ status: 400, code: 'E_BAD_SID' }, cors);
      const stub = env.EVENT_DO.get(env.EVENT_DO.idFromName(eventId));
      const r = await stub.fetch(`https://do/sid-status?sid=${encodeURIComponent(sid)}`);
      if (r.status === 404) return json({ ok: true, connected: false }, { headers: cors });
      if (!r.ok) return error({ status: 503, code: 'E_OVERLOADED' }, cors);
      const data = await r.json().catch(() => ({}));
      return json({ ok: true, connected: !!data?.claimed }, { headers: cors });
    }

    return new Response('Not Found', { status: 404, headers: cors });
  },
};

// (legacy in-memory bridge removed; DO handles WS bridging)

// ---- Durable Object（EventDO）: nonce/pcid/sid を保持 ----
export class EventDO {
  private pcByPcid = new Map<string, WebSocket>();
  private mobilesBySid = new Map<string, Set<WebSocket>>();
  private meta = new Map<WebSocket, { role?: 'pc'|'mobile'; pcid?: string; sid?: string; lastSeen?: number; imageId?: string }>();
  private eventId: string | null = null;
  private hbTimer: any = null;
  private offlineTimers = new Map<string, any>(); // pcid -> timeout
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(req: Request) {
    const url = new URL(req.url);
    // WS upgrade handled entirely in DO (create pair and accept here)
    if (req.headers.get('Upgrade') === 'websocket') {
      const m = url.pathname.match(/^\/e\/([a-z0-9-]{3,32})\/ws$/);
      this.eventId = m ? m[1] : this.eventId;
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server);
      // lazy-start heartbeat ticker on first accepted socket
      if (!this.hbTimer) this.startHeartbeatTicker();
      const selected = selectSubprotocol(req);
      const headers = selected ? { 'Sec-WebSocket-Protocol': selected } : undefined;
      try { console.log(`[bridge/do] accepted socket for event=${this.eventId||'-'} proto=${selected||'-'}`); } catch {}
      return new Response(null, { status: 101, webSocket: client, headers });
    }

    if (req.method === 'POST' && url.pathname === '/register-pc') {
      const { pcid } = (await req.json<any>()) || {};
      await this.state.storage.put(`pc:${pcid}`, true);
      return new Response('ok');
    }
    if (req.method === 'POST' && url.pathname === '/pending-sid') {
      const { pcid, sid, ttl } = (await req.json<any>()) || {};
      const reg = await this.state.storage.get<boolean>(`pc:${pcid}`);
      if (!reg) return new Response('pc not registered', { status: 403 });
      const k = `sid:${sid}`;
      const exists = await this.state.storage.get(k);
      if (exists) return new Response('dup sid', { status: 409 });
      await this.state.storage.put(k, { pcid, claimed: false }, { expirationTtl: ttl });
      return new Response('ok');
    }
    if (req.method === 'POST' && url.pathname === '/claim-nonce') {
      const { nonce } = (await req.json<any>()) || {};
      const key = `nonce:${nonce}`;
      const exists = await this.state.storage.get(key);
      if (exists) return new Response('dup', { status: 409 });
      await this.state.storage.put(key, true, { expirationTtl: 120 });
      return new Response('ok');
    }
    if (req.method === 'POST' && url.pathname === '/check-sid') {
      const { sid } = (await req.json<any>()) || {};
      if (!sid) return new Response('bad', { status: 400 });
      const k = `sid:${sid}`;
      const exists = await this.state.storage.get(k);
      if (!exists) return new Response('not found', { status: 404 });
      return new Response('ok');
    }
    if (req.method === 'POST' && url.pathname === '/mark-claimed') {
      const { sid } = (await req.json<any>()) || {};
      if (!sid) return new Response('bad', { status: 400 });
      const k = `sid:${sid}`;
      const entry = await this.state.storage.get<any>(k);
      if (!entry) return new Response('not found', { status: 404 });
      await this.state.storage.put(k, { ...entry, claimed: true });
      return new Response('ok');
    }
    if (req.method === 'GET' && url.pathname === '/sid-status') {
      const sid = url.searchParams.get('sid') || '';
      if (!sid) return new Response('bad', { status: 400 });
      const k = `sid:${sid}`;
      const entry = await this.state.storage.get<any>(k);
      if (!entry) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify({ claimed: !!entry?.claimed }), { headers: { 'content-type': 'application/json; charset=utf-8' } });
    }
    // 追加: sidエントリの取得（pcid含む）
    if (req.method === 'GET' && url.pathname === '/sid-entry') {
      const sid = url.searchParams.get('sid') || '';
      if (!sid) return new Response('bad', { status: 400 });
      const k = `sid:${sid}`;
      const entry = await this.state.storage.get<any>(k);
      if (!entry) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(entry), { headers: { 'content-type': 'application/json; charset=utf-8' } });
    }
    return new Response('EventDO');
  }

  // DO WebSocket lifecycle handlers (note the capital 'S')
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      const text = typeof message === 'string' ? message : new TextDecoder().decode(message as ArrayBuffer);
      const msg = JSON.parse(text);
      const meta = this.meta.get(ws);
      if (meta) meta.lastSeen = Date.now();
      if (!msg || typeof msg !== 'object') return;
      if (msg.v !== 1) return this.safeSend(ws, { v: 1, type: 'error', code: 'E_BAD_VERSION' });

      // Heartbeat ack (optional from clients)
      if (msg.type === 'hb-ack') {
        // lastSeen is updated above; no additional action needed
        return;
      }

      // PC auth
      if (msg.type === 'pc-auth' || msg.op === 'ws-auth') {
        this.handlePcAuth(ws, msg);
        return;
      }
      // Mobile join
      if (msg.type === 'join') {
        this.handleJoin(ws, msg);
        return;
      }
      // Mobile → cmd → PC
      if (meta?.role === 'mobile' && (msg.type === 'cmd' || (msg?.payload && typeof msg?.payload?.cmd === 'string'))) {
        const pcid = meta.pcid;
        if (pcid) {
          let pc = this.pcByPcid.get(pcid);
          if (!pc) {
            for (const [sock, m] of this.meta.entries()) {
              if (m?.role === 'pc' && m.pcid === pcid) { pc = sock; this.pcByPcid.set(pcid, sock); break; }
            }
          }
          if (pc) {
            const payload = msg?.payload && typeof msg.payload === 'object' ? msg.payload : { cmd: msg.cmd, args: msg.args };
            this.safeSend(pc, { v: 1, type: 'cmd', sid: meta.sid, payload });
            try { console.log(`[bridge/do] fwd cmd sid=${meta.sid} pc=${pcid}`); } catch {}
          } else {
            try { console.log(`[bridge/do] no pc socket for pcid=${pcid}`); } catch {}
          }
        } else {
          try { console.log('[bridge/do] missing pcid on mobile meta'); } catch {}
        }
        return;
      }
      // PC → evt → Mobile(s)
      if (meta?.role === 'pc' && msg.type === 'evt' && msg.sid) {
        const set = this.mobilesBySid.get(String(msg.sid));
        if (set && set.size > 0) {
          const out = { v: 1, type: 'evt', sid: String(msg.sid), evt: msg.evt, data: msg.data };
          for (const m of set) this.safeSend(m, out);
          try { console.log(`[bridge/do] fwd evt sid=${msg.sid} -> ${set.size} mobile(s)`); } catch {}
        }
        return;
      }
      // echo
      this.safeSend(ws, { v: 1, type: 'evt', echo: msg });
    } catch {
      this.safeSend(ws, { v: 1, type: 'error', code: 'E_BAD_JSON' });
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    try { console.log('[bridge/do] close', code, reason, wasClean); } catch {}
    this.cleanup(ws);
  }
  webSocketError(ws: WebSocket, error: unknown) {
    try { console.log('[bridge/do] error', String(error)); } catch {}
    this.cleanup(ws);
  }

  private async handlePcAuth(ws: WebSocket, msg: any) {
    try { console.log('[bridge/do] pc-auth received'); } catch {}
    // Prefer client-provided canonical path; fallback to X-Original-Path sent from Worker
    if (!msg.path) {
      try { msg.path = '/e/' + (this.eventId || '') + '/ws'; } catch {}
    }
    const verify = await verifyPcAuthInDO(this.state, this.env, msg);
    if ((verify as any).ok) {
      const pcid = String(msg?.pcid || '');
      if (pcid) {
        this.pcByPcid.set(pcid, ws);
        this.meta.set(ws, { role: 'pc', pcid, lastSeen: Date.now() });
      }
      this.safeSend(ws, { v: 1, type: 'pc-ack' });
      try { console.log(`[bridge/do] pc-auth ok; pc=${pcid}`); } catch {}
      // Inform mobiles bound to this PC that it is online
      if (pcid) {
        // cancel any pending offline forced close
        const t = this.offlineTimers.get(pcid);
        if (t) { try { clearTimeout(t); } catch {}; this.offlineTimers.delete(pcid); }
        for (const [sock, m] of this.meta.entries()) {
          if (m?.role === 'mobile' && m.pcid === pcid) {
            this.safeSend(sock, { v: 1, type: 'evt', evt: 'pc-online' });
          }
        }
      }
    } else if ((verify as any).code === 'E_CLOCK_SKEW') {
      this.safeSend(ws, { v: 1, type: 'pc-err', code: 'E_CLOCK_SKEW', serverTime: (verify as any).serverTime });
    } else {
      this.safeSend(ws, { v: 1, type: 'pc-err', code: (verify as any).code || 'E_AUTH_FAILED' });
    }
  }

  private async handleJoin(ws: WebSocket, msg: any) {
    try { console.log('[bridge/do] join received'); } catch {}
    const sid: string | undefined = msg.sid;
    if (!sid || !/^[A-Za-z0-9]{10}$/.test(sid)) {
      return this.safeSend(ws, { v: 1, type: 'error', code: 'E_BAD_SID' });
    }
    const k = `sid:${sid}`;
    const entry: any = await this.state.storage.get(k);
    if (!entry || !entry.pcid) {
      return this.safeSend(ws, { v: 1, type: 'error', code: 'E_BAD_SID' });
    }
    const imageId: string | undefined = typeof msg.imageId === 'string' && msg.imageId ? String(msg.imageId) : undefined;
    this.meta.set(ws, { role: 'mobile', pcid: entry.pcid, sid, lastSeen: Date.now(), imageId });
    let set = this.mobilesBySid.get(sid);
    if (!set) { set = new Set<WebSocket>(); this.mobilesBySid.set(sid, set); }
    set.add(ws);
    try { await this.state.storage.put(k, { ...entry, claimed: true }); } catch {}
    try { console.log(`[bridge/do] mobile join sid=${sid} -> pc=${entry.pcid}`); } catch {}
    this.safeSend(ws, { v: 1, type: 'ack', ok: true });
    // Ask PC to provide a preview for this sid (one-shot)
    const pc = this.pcByPcid.get(entry.pcid);
    if (pc) {
      try { this.safeSend(pc, { v: 1, type: 'req', req: 'preview', sid, imageId }); } catch {}
    }
  }

  private cleanup(ws: WebSocket) {
    try {
      const meta = this.meta.get(ws);
      if (meta?.role === 'pc' && meta.pcid) {
        const cur = this.pcByPcid.get(meta.pcid);
        if (cur === ws) this.pcByPcid.delete(meta.pcid);
        console.log(`[bridge/do] pc closed ${meta.pcid}`);
        // Notify mobiles bound to this PC that it went offline
        for (const [sock, m] of this.meta.entries()) {
          if (m?.role === 'mobile' && m.pcid === meta.pcid) {
            this.safeSend(sock, { v: 1, type: 'evt', evt: 'pc-offline' });
          }
        }
        // Schedule forced close after grace if PC doesn't return
        const pcid = meta.pcid;
        const prev = this.offlineTimers.get(pcid);
        if (prev) { try { clearTimeout(prev); } catch {}; }
        const GRACE_MS = 45000;
        const timer = setTimeout(() => {
          try {
            if (this.pcByPcid.get(pcid)) {
              // PC came back; cancel
              this.offlineTimers.delete(pcid);
              return;
            }
            // Close all mobiles tied to this PC
            for (const [sock, m] of this.meta.entries()) {
              if (m?.role === 'mobile' && m.pcid === pcid) {
                try { this.safeSend(sock, { v: 1, type: 'evt', evt: 'pc-timeout' }); } catch {}
                try { sock.close(1012, 'pc-offline-timeout'); } catch {}
                this.cleanup(sock);
              }
            }
          } finally {
            this.offlineTimers.delete(pcid);
          }
        }, GRACE_MS);
        this.offlineTimers.set(pcid, timer);
      }
      if (meta?.role === 'mobile' && meta.sid) {
        const set = this.mobilesBySid.get(meta.sid);
        if (set) { set.delete(ws); if (set.size === 0) this.mobilesBySid.delete(meta.sid); }
        console.log(`[bridge/do] mobile closed sid=${meta.sid}`);
      }
      this.meta.delete(ws);
      // stop ticker when no sockets remain
      if (this.meta.size === 0 && this.hbTimer) {
        try { clearInterval(this.hbTimer); } catch {}
        this.hbTimer = null;
        try { console.log('[bridge/do] heartbeat ticker stopped (no sockets)'); } catch {}
      }
    } catch {}
  }

  private safeSend(ws: WebSocket, obj: any) {
    try { ws.send(JSON.stringify(obj)); } catch {}
  }

  private startHeartbeatTicker() {
    const INTERVAL_MS = 25000; // 25s
    try { console.log('[bridge/do] heartbeat ticker started'); } catch {}
    this.hbTimer = setInterval(() => {
      const now = Date.now();
      // iterate over all sockets we know
      for (const [sock, meta] of this.meta.entries()) {
        // Send lightweight heartbeat to keep intermediates from idling out
        try {
          sock.send(JSON.stringify({ v: 1, type: 'hb', t: now }));
        } catch (e) {
          try { console.log('[bridge/do] hb send failed; cleaning up'); } catch {}
          this.cleanup(sock);
        }
        // Optional stale cleanup based on lastSeen (disabled aggressive close; keep conservative)
        // If needed in future: if (meta.lastSeen && now - meta.lastSeen > INTERVAL_MS * 3) { try { sock.close(4000, 'hb-timeout'); } catch {}; this.cleanup(sock); }
      }
      // If no sockets, stop the ticker (defensive)
      if (this.meta.size === 0 && this.hbTimer) {
        try { clearInterval(this.hbTimer); } catch {}
        this.hbTimer = null;
        try { console.log('[bridge/do] heartbeat ticker stopped (idle)'); } catch {}
      }
    }, INTERVAL_MS);
  }
}

// ---- helpers ----
async function verifyPcAuthInDO(
  state: DurableObjectState,
  env: Env,
  msg: any
): Promise<{ ok: true } | { ok: false; code: string; serverTime?: number }> {
  const EMPTY_SHA256_HEX = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const iat = Number(msg?.iat);
  const nonce = String(msg?.nonce || '');
  const sig = String(msg?.sig || '');
  const pcid = String(msg?.pcid || '');
  const path = String(msg?.path || '');
  const payloadHash = String(msg?.payloadHash || '');
  if (!iat || !nonce || !sig || !pcid || !path) return { ok: false, code: 'E_BAD_FIELD' };
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - iat) > 60) return { ok: false, code: 'E_CLOCK_SKEW', serverTime: now };
  // nonce replay protection in DO (TTL=120s)
  const keyNonce = `nonce:${nonce}`;
  const exists = await state.storage.get(keyNonce);
  if (exists) return { ok: false, code: 'E_NONCE_REPLAY' };
  await state.storage.put(keyNonce, true, { expirationTtl: 120 });
  // canonical verify
  const canonical = ['ws-auth', path, EMPTY_SHA256_HEX, String(iat), nonce].join('\n');
  const key = await crypto.subtle.importKey('raw', enc(env.EVENT_SETUP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sigBytes = b64urlDecode(sig);
  const ok = await crypto.subtle.verify('HMAC', key, sigBytes, enc(canonical));
  if (!ok) return { ok: false, code: 'E_BAD_SIGNATURE' };
  if (payloadHash && payloadHash !== EMPTY_SHA256_HEX) return { ok: false, code: 'E_BAD_PAYLOAD_HASH' };
  return { ok: true };
}

async function verifySigned(
  req: Request,
  env: Env,
  op: 'register-pc' | 'pending-sid',
  path: string,
  eventId: string
): Promise<{ ok: true } | { ok: false; status: number; code: string; serverTime?: number; headers?: Record<string, string> }> {
  const iat = Number(req.headers.get('X-Relay-Iat') || 0);
  const nonce = req.headers.get('X-Relay-Nonce') || '';
  const sig = req.headers.get('X-Relay-Sig') || '';
  if (!iat || !nonce || !sig) return { ok: false, status: 400, code: 'E_MISSING_HEADERS' };

  // clock skew
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - iat) > 60) return { ok: false, status: 401, code: 'E_CLOCK_SKEW', serverTime: now };

  // body bytes & hash (clone to avoid consuming the original body)
  const bodyBytes = new Uint8Array(await req.clone().arrayBuffer());
  const payloadHash = await sha256hex(bodyBytes);

  // claim nonce (dedupe)
  const stub = env.EVENT_DO.get(env.EVENT_DO.idFromName(eventId));
  const nr = await stub.fetch('https://do/claim-nonce', { method: 'POST', body: JSON.stringify({ nonce }) });
  if (nr.status !== 200) return { ok: false, status: 401, code: 'E_NONCE_REPLAY' };

  // canonical
  const canonical = [op, path, payloadHash, String(iat), nonce].join('\n');
  const key = await crypto.subtle.importKey('raw', enc(env.EVENT_SETUP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sigBytes = b64urlDecode(sig);
  const ok = await crypto.subtle.verify('HMAC', key, sigBytes, enc(canonical));
  if (!ok) return { ok: false, status: 401, code: 'E_BAD_SIGNATURE' };
  return { ok: true };
}

function json(obj: any, init: ResponseInit = {}) {
  const h = new Headers(init.headers);
  h.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(obj), { ...init, headers: h });
}
function error(e: { status: number; code: string; serverTime?: number; headers?: Record<string, string> }, cors: Record<string, string>) {
  const h = new Headers({ ...cors, 'content-type': 'application/json; charset=utf-8' });
  if (e.serverTime) h.set('X-Server-Time', String(e.serverTime));
  return new Response(JSON.stringify({ ok: false, error: { code: e.code } }), { status: e.status, headers: h });
}
function withRetryAfter(status: number, cors: Record<string, string>, seconds = 3) {
  const h = new Headers({ ...cors, 'Retry-After': String(seconds), 'content-type': 'application/json' });
  return new Response(JSON.stringify({ ok: false, error: { code: status === 429 ? 'E_RATE_LIMITED' : 'E_OVERLOADED' } }), { status, headers: h });
}
function enc(s: string) {
  return new TextEncoder().encode(s);
}
async function sha256hex(b: Uint8Array) {
  const d = await crypto.subtle.digest('SHA-256', b);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function b64urlDecode(s: string) {
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : '';
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
async function readJson(req: Request) {
  try {
    return await req.clone().json();
  } catch {
    return null;
  }
}

// (legacy handleWs removed; DO handles WebSocket upgrade and bridging)

function selectSubprotocol(req: Request): string | undefined {
  const raw = req.headers.get('Sec-WebSocket-Protocol') || '';
  if (!raw) return undefined;
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes('v1')) return 'v1';
  return list[0];
}

// (legacy verifyPcAuth for Worker path removed; DO uses verifyPcAuthInDO)

function appHtml(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  <title>ぬりえもん コントローラ (stg)</title>
  <style>
    :root { color-scheme: light; }
    *{box-sizing:border-box}
    html,body{height:100%}
    body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f8fafc;color:#111;min-height:100dvh;display:flex;align-items:center;justify-content:center;-webkit-user-select:none;user-select:none;overflow:hidden}
    .card{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:12px;max-width:420px;width:94%;box-shadow:0 8px 24px rgba(0,0,0,.08)}
    h1{font-size:18px;margin:0 0 4px;color:#0b1324}
    #status{opacity:.8;margin-bottom:6px}
    .preview{width:100%;height:120px;border-radius:10px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;overflow:hidden;border:1px solid #e5e7eb}
    .preview img{max-width:100%;max-height:100%;display:block}
    .actions{margin-top:8px}
    .dpad{display:grid;grid-template-columns:64px 64px 64px;grid-template-rows:64px 64px 64px;gap:8px;justify-content:center;margin-top:8px}
    .dpad .sp{visibility:hidden}
    button{padding:14px;border-radius:12px;border:1px solid #dbeafe;background:#eef2ff;color:#0b1324;font-weight:600;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
    button:active{transform:scale(.98)}
    .ok{color:#16a34a}
    .err{color:#dc2626}
    #reconnect{margin-top:8px;width:100%;background:#2563eb;border-color:#2563eb;color:#fff}
    .grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
    .emotes{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:8px}
    @media (max-width: 420px){
      .card{max-width: 360px;}
      .preview{height:104px}
      .dpad{grid-template-columns: 56px 56px 56px; grid-template-rows: 56px 56px 56px}
      button{padding:12px}
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>ぬりえもん - コントローラ</h1>
    <div id="status">初期化中...</div>
    <div class="preview"><img id="thumb" alt=""/></div>
    <div class="actions">
      <div class="grid2">
        <button onclick="action('jump')">ジャンプ</button>
        <button onclick="action('spin')">回転</button>
        <button onclick="action('shake')">ふるえる</button>
        <button onclick="action('grow')">おおきく</button>
        <button onclick="action('shrink')">ちいさく</button>
        <button onclick="emote('good')">👍</button>
      </div>
      <div class="emotes">
        <button onclick="emote('😊')">😊</button>
        <button onclick="emote('❤️')">❤️</button>
        <button onclick="emote('✊')">✊</button>
        <button onclick="emote('✌️')">✌️</button>
        <button onclick="emote('🖐')">🖐</button>
      </div>
    </div>
    <div class="dpad">
      <div class="sp"></div>
      <button onmousedown="startHold('up')" ontouchstart="startHold('up')" onmouseup="stopHold()" ontouchend="stopHold()" ontouchcancel="stopHold()">▲</button>
      <div class="sp"></div>
      <button onmousedown="startHold('left')" ontouchstart="startHold('left')" onmouseup="stopHold()" ontouchend="stopHold()" ontouchcancel="stopHold()">◀</button>
      <div class="sp"></div>
      <button onmousedown="startHold('right')" ontouchstart="startHold('right')" onmouseup="stopHold()" ontouchend="stopHold()" ontouchcancel="stopHold()">▶</button>
      <div class="sp"></div>
      <button onmousedown="startHold('down')" ontouchstart="startHold('down')" onmouseup="stopHold()" ontouchend="stopHold()" ontouchcancel="stopHold()">▼</button>
      <div class="sp"></div>
    </div>
    <button id="reconnect" style="display:none" onclick="manualReconnect()">再接続</button>
  </div>
  <script>
    // iOS Safari zoom prevention
    (function(){
      let lastTouchEnd=0;document.addEventListener('touchend',function(e){const now=Date.now();if(now-lastTouchEnd<=300){e.preventDefault();}lastTouchEnd=now;},{passive:false});
      ['gesturestart','gesturechange','gestureend'].forEach(ev=>document.addEventListener(ev,e=>e.preventDefault()));
    })();
    const params = (()=>{ const hash = location.hash.startsWith('#')?location.hash.slice(1):''; const h = new URLSearchParams(hash); if(h.has('e')&&h.has('sid')) return h; return new URLSearchParams(location.search.slice(1)); })();
    const e = params.get('e');
    const sid = params.get('sid');
    const imageId = params.get('img') || undefined;
    const status = document.getElementById('status');
    const reconnectBtn = document.getElementById('reconnect');
    const thumbImg = document.getElementById('thumb');
    let ws = null;
    let attempt = 0;
    let connecting = false;
    let connected = false;
    if(!e || !sid){ status.innerHTML = '<span class="err">URLに e/sid がありません</span>'; }
    else {
      const wsUrl = (location.protocol==='https:'?'wss://':'ws://') + location.host + '/e/' + encodeURIComponent(e) + '/ws';
      function setStatus(text, cls){ status.className=''; if(cls) status.classList.add(cls); status.innerHTML = text; }
      // show cached preview immediately
      try{ if(imageId){ const cached = localStorage.getItem('thumb:'+imageId); if(cached) thumbImg.src = cached; } }catch{}
      function connect(){
        if(connecting) return; connecting = true; connected = false;
        setStatus('接続中...', ''); reconnectBtn.style.display='none';
        try{ ws = new WebSocket(wsUrl, 'v1'); }catch(e){ setStatus('<span class="err">接続失敗</span>', 'err'); reconnectBtn.style.display=''; scheduleReconnect(); connecting=false; return; }
        ws.onopen = ()=>{ try{ ws.send(JSON.stringify({ v:1, type:'join', sid, imageId })); }catch{} };
        let pcOnline = true;
        ws.onmessage = (ev)=>{
          try{ const msg = JSON.parse(ev.data);
            if(msg.type==='ack' && msg.ok){ connected=true; connecting=false; attempt=0; pcOnline=true; setStatus('<span class="ok">接続OK</span>', 'ok'); reconnectBtn.style.display='none'; return; }
            if(msg.type==='hb'){ try{ ws && ws.send(JSON.stringify({ v:1, type:'hb-ack', t: Date.now() })); }catch{}; return; }
            if(msg.type==='evt' && msg.evt==='pc-offline'){ pcOnline=false; setStatus('<span class="err">PCが切断されました</span>', 'err'); reconnectBtn.style.display=''; return; }
            if(msg.type==='evt' && msg.evt==='pc-online'){ pcOnline=true; setStatus('<span class="ok">接続OK</span>', 'ok'); reconnectBtn.style.display='none'; return; }
            if(msg.type==='evt' && msg.evt==='preview' && msg.data && msg.data.imageId===imageId && msg.data.thumb){ try{ thumbImg.src = msg.data.thumb; localStorage.setItem('thumb:'+imageId, msg.data.thumb); }catch{}; return; }
          }catch{}
        };
        ws.onclose = ()=>{ connecting=false; connected=false; setStatus('<span class="err">切断されました</span>', 'err'); reconnectBtn.style.display=''; scheduleReconnect(); };
        ws.onerror = ()=>{ setStatus('<span class="err">エラー</span>', 'err'); };
      }
      function scheduleReconnect(){
        const delays=[500,1000,2000,5000,10000];
        const d = delays[Math.min(attempt, delays.length-1)]; attempt++;
        setTimeout(()=>{ if(!connected) connect(); }, d);
      }
      window.manualReconnect = ()=>{ attempt=0; if(ws){ try{ ws.close(); }catch{} } connect(); };
      function send(cmd){ try{ if(ws && ws.readyState===1){ ws.send(JSON.stringify({ v:1, type:'cmd', payload:{ cmd, imageId } })); } }catch{} }
      // Hold-to-repeat for D-pad
      let holdTimer = null;
      function startHold(c){ try{ send(c); if(holdTimer) clearInterval(holdTimer); holdTimer=setInterval(()=>send(c), 120); }catch{} }
      function stopHold(){ if(holdTimer){ try{ clearInterval(holdTimer); }catch{} holdTimer=null; } }
      try { document.addEventListener('mouseup', stopHold); document.addEventListener('touchend', stopHold); document.addEventListener('touchcancel', stopHold); } catch {}
      window.sendCmd = (c)=> send(c);
      window.dir = (d)=> send(d);
      window.action = (a)=> send(a);
      window.emote = (t)=> send('emote:'+t);
      connect();
    }
  </script>
 </body>
</html>`;
}
