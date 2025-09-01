import { emit } from '@tauri-apps/api/event';
import { currentRelayEnvAsSecretEnv, getEventSetupSecret } from './secureSecrets';
import { resolveBaseUrl } from './relayClient';
import { registerPc, retryWithBackoff } from './relayClient';

function b64url(bytes: Uint8Array): string {
  let b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(d)).map(x => x.toString(16).padStart(2, '0')).join('');
}

async function hmacBase64Url(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return b64url(new Uint8Array(sig));
}

export type PcWsClient = {
  start: () => Promise<void>;
  stop: () => void;
  isConnected: () => boolean;
};

export function createPcWsClient(params: { eventId: string; pcid: string }): PcWsClient {
  let ws: WebSocket | null = null;
  let hbTimer: any = null;
  let connected = false;
  let stopping = false;
  let ackTimer: any = null;

  async function start() {
    stopping = false;
    emit('pc-bridge-status', { state: 'starting' });
    const base = await resolveBaseUrl();
    // 事前にPCを登録（リージョンピン/整合のため）
    try {
      const res = await retryWithBackoff(() => registerPc({ eventId: params.eventId, pcid: params.pcid }));
      if (!res.ok) {
        emit('pc-bridge-status', { state: 'error', detail: 'register-pc failed', res });
      }
    } catch (e) {
      emit('pc-bridge-status', { state: 'error', detail: 'register-pc exception', e: String(e) });
    }
    const url = base.replace(/^http/i, 'ws') + `/e/${encodeURIComponent(params.eventId)}/ws`;
    try {
      ws = new WebSocket(url, 'v1');
    } catch (e) {
      console.error('[pcWsClient] WS open failed:', e);
      return;
    }

    ws.onopen = async () => {
      console.log('[pcWsClient] ws open:', url, 'protocol=', ws?.protocol);
      emit('pc-bridge-status', { state: 'open', url });
      try {
        const env = await currentRelayEnvAsSecretEnv();
        const secret = await getEventSetupSecret(env);
        if (!secret) {
          console.warn('[pcWsClient] missing EVENT_SETUP_SECRET');
          return;
        }
        const iat = Math.floor(Date.now() / 1000);
        const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
        const nonce = b64url(nonceBytes);
        const EMPTY_SHA256_HEX = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
        const path = new URL(url).pathname; // e.g. /e/demo/ws
        const canonical = ['ws-auth', path, EMPTY_SHA256_HEX, String(iat), nonce].join('\n');
        const sig = await hmacBase64Url(secret, canonical);
        const authMsg = { v: 1, type: 'pc-auth', op: 'ws-auth', path, iat, nonce, payloadHash: EMPTY_SHA256_HEX, sig, pcid: params.pcid };
        ws!.send(JSON.stringify(authMsg));
        console.log('[pcWsClient] pc-auth sent (iat,nonce):', iat, nonce);
        emit('pc-bridge-status', { state: 'auth-sent', iat, nonce });
        // fallback: send pc-hello once if ack does not arrive quickly
        setTimeout(() => {
          try {
            if (!connected && ws && ws.readyState === ws.OPEN) {
              console.warn('[pcWsClient] pc-ack timeout, sending fallback pc-hello');
              ws.send(JSON.stringify({ type: 'pc-hello', v: 1, pcid: params.pcid }));
            }
          } catch {}
        }, 1500);
        // start heartbeats
        if (ackTimer) { clearTimeout(ackTimer); ackTimer = null; }
        ackTimer = setTimeout(() => {
          if (!connected) emit('pc-bridge-status', { state: 'auth-timeout' });
        }, 4000);
        hbTimer = setInterval(() => {
          try { ws && ws.readyState === ws.OPEN && ws.send(JSON.stringify({ v: 1, type: 'hb' })); } catch {}
        }, 30000);
      } catch (e) {
        console.error('[pcWsClient] auth send failed:', e);
      }
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const t = msg?.type;
        if (t === 'pc-ack') {
          connected = true;
          if (ackTimer) { clearTimeout(ackTimer); ackTimer = null; }
          console.log('[pcWsClient] pc-ack received');
          emit('pc-bridge-status', { state: 'ack' });
          return;
        }
        if (t === 'pc-err') {
          console.warn('[pcWsClient] pc-err:', msg);
          emit('pc-bridge-status', { state: 'error', detail: msg });
          if (ackTimer) { clearTimeout(ackTimer); ackTimer = null; }
          if (msg?.code === 'E_CLOCK_SKEW' && typeof msg?.serverTime === 'number') {
            // one-shot resync
            resendAuthWithIat(msg.serverTime).catch(() => {});
          }
          return;
        }
        // Normalize cmds coming from Relay
        if (t === 'cmd') {
          try { console.log('[pcWsClient] recv cmd:', msg); } catch {}
          normalizeAndEmit(msg);
        } else if (t === 'evt' && msg.echo && msg.echo.type === 'cmd') {
          normalizeAndEmit(msg.echo);
        }
      } catch {}
    };

    ws.onclose = (ev) => {
      console.warn('[pcWsClient] ws close:', ev.code, ev.reason);
      emit('pc-bridge-status', { state: 'closed', code: ev.code, reason: ev.reason });
      connected = false;
      if (ackTimer) { clearTimeout(ackTimer); ackTimer = null; }
      if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
      if (!stopping) {
        // simple retry
        setTimeout(() => start(), 2000 + Math.floor(Math.random() * 1000));
      }
    };
    ws.onerror = (ev) => { console.warn('[pcWsClient] ws error', ev); emit('pc-bridge-status', { state: 'error', ev: String(ev) }); };
  }

  function normalizeAndEmit(msg: any) {
    const payload = msg?.payload || (typeof msg?.cmd === 'string' ? { cmd: msg.cmd, args: msg.args, imageId: msg.imageId } : {});
    const cmd: string | undefined = payload.cmd;
    const imageId = payload.imageId;
    if (!cmd) return;
    if (cmd.startsWith('emote:')) {
      const emoteType = cmd.slice('emote:'.length);
      emit('mobile-control', { type: 'emote', emoteType, imageId });
      return;
    }
    if (cmd === 'left' || cmd === 'right' || cmd === 'up' || cmd === 'down') {
      emit('mobile-control', { type: 'move', direction: cmd, imageId });
      return;
    }
    emit('mobile-control', { type: 'action', actionType: cmd, imageId });
  }

  function stop() {
    stopping = true;
    try { if (hbTimer) clearInterval(hbTimer); } catch {}
    hbTimer = null;
    if (ackTimer) { try { clearTimeout(ackTimer); } catch {}; ackTimer = null; }
    if (ws) {
      try { ws.close(); } catch {}
      ws = null;
    }
  }

  async function resendAuthWithIat(iat: number) {
    try {
      if (!ws || ws.readyState !== ws.OPEN) return;
      const env = await currentRelayEnvAsSecretEnv();
      const secret = await getEventSetupSecret(env);
      if (!secret) return;
      const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
      const nonce = b64url(nonceBytes);
      const EMPTY_SHA256_HEX = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const path = new URL(ws.url).pathname;
      const canonical = ['ws-auth', path, EMPTY_SHA256_HEX, String(iat), nonce].join('\n');
      const sig = await hmacBase64Url(secret, canonical);
      const authMsg = { v: 1, type: 'pc-auth', op: 'ws-auth', path, iat, nonce, payloadHash: EMPTY_SHA256_HEX, sig, pcid: params.pcid };
      ws.send(JSON.stringify(authMsg));
      console.log('[pcWsClient] pc-auth resent with serverTime:', iat);
      emit('pc-bridge-status', { state: 'auth-resent', iat });
    } catch (e) {
      console.warn('[pcWsClient] resendAuth failed:', e);
      emit('pc-bridge-status', { state: 'error', detail: String(e) });
    }
  }

  return { start, stop, isConnected: () => connected };
}
