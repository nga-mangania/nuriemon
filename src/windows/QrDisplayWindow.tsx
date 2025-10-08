// src/windows/QrDisplayWindow.tsx
import React, { useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useWorkspaceStore, loadStateFromFile } from '../stores/workspaceStore';
import { AppSettingsService } from '../services/database';
import { GlobalSettingsService } from '../services/globalSettings';
import { checkRelayHealth } from '../services/connectivityProbe';
import { pendingSid, registerPc, retryWithBackoff, resolveBaseUrl, getSidStatus } from '../services/relayClient';
import { loadDeviceToken } from '../services/licenseClient';
import { TauriEventListener } from '../events/tauriEventListener';
import styles from './QrDisplayWindow.module.scss';

// Relayブリッジはグローバル（App側）で起動するためQR画面では起動しない

interface QrSession {
  imageId: string;
  sessionId: string;
  qrCode: string;
  connected: boolean;
  envKey: string;
  blockedReason?: 'missing' | 'invalid' | 'error';
  errorMessage?: string;
}

type PollController = {
  timer: number;
  stopped: boolean;
  attempts: number;
};

const FALLBACK_DELAY_MS = 8000;
const FALLBACK_BASE_INTERVAL_MS = 2000;
const FALLBACK_MAX_INTERVAL_MS = 15000;
const FALLBACK_MAX_ATTEMPTS = 6;

export const QrDisplayWindow: React.FC = () => {
  const processedImagesState = useWorkspaceStore((state) => state.processedImages);

  const [sessions, setSessions] = useState<Map<string, QrSession>>(new Map());
  const [isServerStarted, setIsServerStarted] = useState(false);
  const [serverPort, setServerPort] = useState<number | null>(null);
  const [operationMode, setOperationMode] = useState<'auto' | 'relay' | 'local'>('auto');
  const [relayBaseUrl, setRelayBaseUrl] = useState<string>('https://ctrl.nuriemon.jp');
  const [relayEventId, setRelayEventId] = useState<string>('');
  const [pcId, setPcId] = useState<string>('');
  const [useRelay, setUseRelay] = useState<boolean>(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [regenTick, setRegenTick] = useState<number>(0);
  const [showDebug, setShowDebug] = useState<boolean>(false);

  const showDebugRef = useRef<boolean>(false);
  useEffect(() => { showDebugRef.current = showDebug; }, [showDebug]);

  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const visibleIdsRef = useRef<Set<string>>(new Set());
  const inflightRef = useRef<Set<string>>(new Set());
  const licenseAlertShownRef = useRef<boolean>(false);
  const [licenseBlocked, setLicenseBlocked] = useState<boolean>(false);
  const [licenseBlockedReason, setLicenseBlockedReason] = useState<'missing' | 'invalid' | null>(null);
  const generalAlertShownRef = useRef<boolean>(false);
  const [pcBridgeHealthy, setPcBridgeHealthy] = useState<boolean>(false);

  const sessionsRef = useRef<Map<string, QrSession>>(sessions);
  const sessionByIdRef = useRef<Map<string, string>>(new Map());
  const fallbackTimeoutsRef = useRef<Map<string, number>>(new Map());
  const pollControllersRef = useRef<Map<string, PollController>>(new Map());
  const relayEventIdRef = useRef<string>(relayEventId);
  const localPollsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { relayEventIdRef.current = relayEventId; }, [relayEventId]);

  const debug = (msg: string) => {
    try {
      const ts = new Date().toISOString().split('T')[1]?.replace('Z', '');
      const line = `[${ts}] ${msg}`;
      // コンソール
      console.log('[QRDEBUG]', line);
      if (showDebugRef.current) {
        setDebugLogs((prev) => {
          const next = prev.length > 400 ? prev.slice(prev.length - 400) : prev.slice();
          next.push(line);
          return next;
        });
      }
    } catch {}
  };

  const onVisibleChange = (id: string, visible: boolean) => {
    const next = new Set(visibleIdsRef.current);
    if (visible) next.add(id);
    else next.delete(id);
    visibleIdsRef.current = next;
    setVisibleIds(next);
  };

  const updateSessions = (updater: (prev: Map<string, QrSession>) => Map<string, QrSession>) => {
    setSessions((prev) => {
      const result = updater(prev);
      sessionsRef.current = result;
      return result;
    });
  };

  const cancelLocalTimer = (sessionId?: string) => {
    if (!sessionId) return;
    const handle = localPollsRef.current.get(sessionId);
    if (handle !== undefined) {
      try { window.clearInterval(handle); } catch {}
      localPollsRef.current.delete(sessionId);
    }
  };

  const cancelFallbackForSession = (sessionId: string) => {
    const timeout = fallbackTimeoutsRef.current.get(sessionId);
    if (timeout !== undefined) {
      window.clearTimeout(timeout);
      fallbackTimeoutsRef.current.delete(sessionId);
    }
    const controller = pollControllersRef.current.get(sessionId);
    if (controller) {
      controller.stopped = true;
      window.clearTimeout(controller.timer);
      pollControllersRef.current.delete(sessionId);
    }
    cancelLocalTimer(sessionId);
  };

  const startFallbackPolling = (sessionId: string, imageId: string) => {
    if (pollControllersRef.current.has(sessionId) || !sessionId) return;
    const controller: PollController = { timer: 0, stopped: false, attempts: 0 };

    const run = async () => {
      if (controller.stopped) return;

      const mappedImageId = sessionByIdRef.current.get(sessionId);
      if (!mappedImageId || mappedImageId !== imageId) {
        cancelFallbackForSession(sessionId);
        return;
      }
      const current = sessionsRef.current.get(imageId);
      if (!current || current.sessionId !== sessionId || current.connected) {
        cancelFallbackForSession(sessionId);
        return;
      }
      const eventId = relayEventIdRef.current;
      if (!eventId) {
        cancelFallbackForSession(sessionId);
        return;
      }

      try {
        const res = await getSidStatus(eventId, sessionId);
        debug(`fallback poll sid=${sessionId} attempt=${controller.attempts} ok=${res.ok} status=${(res as any).status ?? '-'} connected=${(res as any).data?.connected ?? false}`);
        if (res.ok && (res as any).data?.connected) {
          markSessionConnected(sessionId, imageId);
          cancelFallbackForSession(sessionId);
          return;
        }
      } catch (error) {
        debug(`fallback poll error sid=${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
      }

      controller.attempts += 1;
      if (controller.attempts >= FALLBACK_MAX_ATTEMPTS) {
        cancelFallbackForSession(sessionId);
        return;
      }
      const nextDelay = Math.min(FALLBACK_MAX_INTERVAL_MS, FALLBACK_BASE_INTERVAL_MS * Math.pow(2, controller.attempts - 1));
      controller.timer = window.setTimeout(run, nextDelay);
    };

    controller.timer = window.setTimeout(run, 0);
    pollControllersRef.current.set(sessionId, controller);
  };

  const scheduleFallback = (sessionId: string, imageId: string, delay: number) => {
    if (!sessionId || fallbackTimeoutsRef.current.has(sessionId) || pollControllersRef.current.has(sessionId)) return;
    const timeout = window.setTimeout(() => {
      fallbackTimeoutsRef.current.delete(sessionId);
      startFallbackPolling(sessionId, imageId);
    }, Math.max(0, delay));
    fallbackTimeoutsRef.current.set(sessionId, timeout);
  };

  const ensureFallbackForSession = (sessionId: string, imageId: string, immediate = false) => {
    if (!sessionId) return;
    if (immediate) startFallbackPolling(sessionId, imageId);
    else scheduleFallback(sessionId, imageId, FALLBACK_DELAY_MS);
  };

  const markSessionConnected = (sessionId: string, explicitImageId?: string) => {
    const resolvedImageId = explicitImageId || sessionByIdRef.current.get(sessionId);
    if (!resolvedImageId) return;
    cancelFallbackForSession(sessionId);
    updateSessions((prev) => {
      const next = new Map(prev);
      const target = next.get(resolvedImageId);
      if (!target || target.sessionId !== sessionId || target.connected) return prev;
      next.set(resolvedImageId, { ...target, connected: true });
      return next;
    });
  };

  const triggerFallbackForAllSessions = (immediate = false) => {
    sessionsRef.current.forEach((session) => {
      if (!session.connected && session.sessionId) {
        ensureFallbackForSession(session.sessionId, session.imageId, immediate);
      }
    });
  };

  const applyNewSession = (
    imageId: string,
    session: QrSession,
    sessionKey: string,
    usesRelayForSession: boolean,
    previous?: QrSession
  ) => {
    if (previous && previous.sessionId && previous.sessionId !== session.sessionId) {
      sessionByIdRef.current.delete(previous.sessionId);
      cancelLocalTimer(previous.sessionId);
    }
    sessionByIdRef.current.set(session.sessionId, imageId);

    updateSessions((prev) => {
      const next = new Map(prev);
      (session as any).sessionKey = sessionKey;
      next.set(imageId, session);
      return next;
    });

    if (!session.sessionId) return;

    if (!usesRelayForSession) {
      // Local: ローカル状態ポーリング
      startTimer(imageId, session.sessionId);
    } else {
      // Relay: WSが健全なら遅延フォールバック、切断/不安定なら即フォールバック
      if (pcBridgeHealthy) ensureFallbackForSession(session.sessionId, imageId, false);
      else ensureFallbackForSession(session.sessionId, imageId, true);
    }
  };

  // メタデータから表示用データを生成
  const processedImages = processedImagesState.map((img) => ({ ...img, type: 'processed' as const }));

  // Relay の有効/不足判定（表示の出し分け用）
  const relayActive = operationMode === 'relay' || (operationMode === 'auto' && useRelay);
  // UI の表示準備完了判定（レンダリング条件と生成スケジューラで共有）
  const uiReady = isServerStarted || relayActive;
  const missingRelay = relayActive && (!relayEventId || !pcId);

  // 条件が整ったら一時的なバナーを自動クリア
  useEffect(() => {
    if (!missingRelay && (useRelay || isServerStarted)) {
      if (banner) setBanner(null);
    }
  }, [missingRelay, useRelay, isServerStarted, banner]);

  // セッションキー（eventId:pcid:baseURL:imageId）
  const buildSessionKey = (imageId: string) => {
    return `${relayEventId || ''}:${pcId || ''}:${(relayBaseUrl || '').replace(/\/$/, '')}:${imageId}`;
  };

  // 設定値の再読込
  const reloadAppSettings = async () => {
    try {
      const mode = await AppSettingsService.getAppSetting('operation_mode');
      if (mode === 'relay' || mode === 'local' || mode === 'auto') setOperationMode(mode);

      await GlobalSettingsService.loadEffective();
      const eff = GlobalSettingsService.getEffective();

      const base = await resolveBaseUrl();
      if (base) setRelayBaseUrl(base);

      const eid = (eff?.relay?.eventId || (await GlobalSettingsService.get('relay_event_id'))) || '';
      if (eid) setRelayEventId(eid);

      let pid = (eff?.relay?.pcId || (await GlobalSettingsService.get('pcid'))) || '';
      if (!pid) {
        pid = generateDefaultPcid();
        try { await GlobalSettingsService.save('pcid', pid); } catch {}
      }
      if (pid) setPcId(pid);

      debug(`settings: mode=${mode} base=${base} eid=${eid} pcid=${pid}`);
    } catch {}
  };

  function generateDefaultPcid(): string {
    const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
    let s = '';
    for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
    return `pc-${s}`;
  }

  // 初期ロード
  useEffect(() => {
    loadStateFromFile();
    (async () => {
      await GlobalSettingsService.loadEffective();
      await reloadAppSettings();
    })();
  }, []);

  // 差分イベント（全ウィンドウ）を起動
  useEffect(() => {
    const listener = TauriEventListener.getInstance();
    listener.setupListeners().catch((e) => console.error('[QrDisplayWindow] Failed to setup Tauri event listeners:', e));
    return () => listener.cleanup();
  }, []);

  // processedImages から外れたセッションを整理
  useEffect(() => {
    const validIds = new Set(processedImages.map((img) => img.id));
    const stale: string[] = [];
    sessionsRef.current.forEach((session, imageId) => {
      if (!validIds.has(imageId)) {
        stale.push(imageId);
        cancelFallbackForSession(session.sessionId);
        cancelLocalTimer(session.sessionId);
      }
    });
    if (stale.length > 0) {
      updateSessions((prev) => {
        const next = new Map(prev);
        stale.forEach((id) => next.delete(id));
        return next;
      });
    }
  }, [processedImages]);

  // 他ウィンドウからの通知をリッスン
  useEffect(() => {
    const unsubs: Array<() => void> = [];
    const register = async (event: string, handler: () => void) => {
      try {
        const off = await listen(event, handler);
        unsubs.push(() => { try { off(); } catch {} });
      } catch (error) {
        console.error(`[QrDisplayWindow] Failed to register listener for ${event}:`, error);
      }
    };

    register('workspace-data-loaded', () => setRegenTick((t) => t + 1));
    register('app-settings-changed', () => { void reloadAppSettings(); setRegenTick((t) => t + 1); });

    return () => unsubs.forEach((un) => un());
  }, []);

  // 設定が変わっても既存QRは保持、必要な分のみ再生成
  useEffect(() => {
    setRegenTick((t) => t + 1);
  }, [operationMode, relayEventId, pcId, relayBaseUrl, useRelay]);

  // Webサーバーの起動
  useEffect(() => {
    const initialize = async () => {
      try {
        // 先に設定をロードしてから分岐判定（初期Auto→Local誤判定を避ける）
        await reloadAppSettings();

        // 直近の値で判定
        const mode = (await AppSettingsService.getAppSetting('operation_mode')) as 'auto' | 'relay' | 'local' | null;
        await GlobalSettingsService.loadEffective();
        const eff = GlobalSettingsService.getEffective();
        const eid = eff?.relay?.eventId || (await GlobalSettingsService.get('relay_event_id'));
        const base = await resolveBaseUrl();
        if (base) setRelayBaseUrl(base);
        if (eid) setRelayEventId(eid);

        // Relay 健全性チェック
        if (mode === 'relay' || mode === 'auto') {
          try {
            const res = await checkRelayHealth(base || relayBaseUrl);
            debug(`healthz: status=${res.status} ok=${res.ok} version=${res.version}`);
            const canRelay = res.ok && !!(eid || relayEventId);
            setUseRelay(canRelay);

            // Relay固定はローカル起動スキップ（UI ready だけ満たす）
            if (mode === 'relay') {
              setIsServerStarted(true);
              setServerPort(null);
              setRegenTick((t) => t + 1);
              return;
            }
          } catch {
            setUseRelay(false);
          }
        }

        // Auto / Local はローカルサーバ起動（※ Auto はオンライン発行だが ready 用に起動）
        const g: any = window as any;
        if (g.__NURIEMON_WEB_SERVER_PORT) {
          debug(`local web server already started on port=${g.__NURIEMON_WEB_SERVER_PORT}`);
          setServerPort(g.__NURIEMON_WEB_SERVER_PORT);
          setIsServerStarted(true);
          return;
        }
        debug('start_web_server invoke...');
        const port = await invoke<number>('start_web_server');
        debug(`start_web_server started on port=${port}`);
        g.__NURIEMON_WEB_SERVER_PORT = port;
        setServerPort(port);
        setIsServerStarted(true);
      } catch (error) {
        console.error('[QrDisplayWindow] Webサーバーの起動に失敗:', error);
        debug(`start_web_server failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    initialize();
  }, []);

  // モバイル接続イベント
  useEffect(() => {
    const unlisten = listen('mobile-connected', (event) => {
      const payload = event.payload as { sessionId?: string; sid?: string; imageId?: string };
      const sessionId = payload?.sessionId || payload?.sid;
      if (!sessionId) return;
      const imageId = payload?.imageId || sessionByIdRef.current.get(sessionId);
      markSessionConnected(sessionId, imageId);
    });

    return () => {
      unlisten.then((fn) => { try { fn(); } catch {} }).catch(() => {});
    };
  }, []);

  // Bridge 状態
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    (async () => {
      try {
        cleanup = await listen('pc-bridge-status', (event) => {
          const payload: any = event.payload || {};
          const state = typeof payload === 'string' ? payload : payload.state;
          if (state === 'token-missing') {
            setLicenseBlocked(true);
            setLicenseBlockedReason((prev) => prev || 'missing');
          }
          const healthy = state === 'ack' || state === 'open';
          const semiHealthy = state === 'auth-sent' || state === 'starting';
          const degraded = state === 'closed' || state === 'error' || state === 'auth-timeout' || state === 'token-missing';

          if (healthy || semiHealthy) {
            licenseAlertShownRef.current = false;
            setLicenseBlocked(false);
            setLicenseBlockedReason(null);
            setBanner(null);
            setPcBridgeHealthy(true);
            updateSessions((prev) => {
              let changed = false;
              const next = new Map(prev);
              prev.forEach((value, key) => {
                if ((value as any)?.blockedReason) {
                  next.delete(key);
                  changed = true;
                }
              });
              return changed ? next : prev;
            });
            setRegenTick((t) => t + 1);
          }
          if (degraded) {
            setPcBridgeHealthy(false);
            triggerFallbackForAllSessions(true);
          }
        });
      } catch {}
    })();
    return () => { try { cleanup && cleanup(); } catch {} };
  }, []);

  // QR 生成
  const generateQr = async (imageId: string) => {
    debug(`generateQr called imageId=${imageId}`);
    if (inflightRef.current.has(imageId)) {
      debug(`generateQr skipped (inflight) imageId=${imageId}`);
      return;
    }
    generalAlertShownRef.current = false;

    const previousSession = sessionsRef.current.get(imageId);
    if (previousSession) cancelFallbackForSession(previousSession.sessionId);

    updateSessions((prev) => {
      const next = new Map(prev);
      const session = next.get(imageId);
      if (session && (session as any).blockedReason) next.delete(imageId);
      return next;
    });

    inflightRef.current.add(imageId);

    const relayOn = operationMode === 'relay' || (operationMode === 'auto' && useRelay);
    let usesRelay = relayOn;

    if (!relayOn && !isServerStarted) {
      // 初期化未完了
      setBanner('初期化中です。数秒後に自動再試行します…');
      debug(`skip generateQr(imageId=${imageId}) because not ready`);
      inflightRef.current.delete(imageId);
      return;
    }

    try {
      const sessionKey = buildSessionKey(imageId);
      let session: QrSession;
      const envKey = `${relayBaseUrl}|${relayEventId}|${pcId}|${operationMode}`;

      if (relayOn) {
        if (licenseBlocked) {
          handleLicenseBlocking(licenseBlockedReason || 'missing', imageId, sessionKey, envKey);
          inflightRef.current.delete(imageId);
          return;
        }
        const bearer = await loadDeviceToken();
        if (!bearer) {
          handleLicenseBlocking('missing', imageId, sessionKey, envKey);
          inflightRef.current.delete(imageId);
          return;
        }

        if (!relayEventId || !pcId) {
          // Relay 不足：Auto は Local にフォールバック / Relay 固定はエラー
          if (operationMode === 'relay') {
            setBanner('Relay設定が不足しています（イベントID/PCID）。設定画面で確認してください。');
            debug('missing relayEventId or pcid in relay mode');
            inflightRef.current.delete(imageId);
            return;
          } else {
            debug('missing relayEventId/pcid in auto; fallback to local');
            const result = await invoke<{ sessionId: string; qrCode: string; imageId: string }>('generate_qr_code', { imageId });
            session = { imageId: result.imageId, sessionId: result.sessionId, qrCode: result.qrCode, connected: false, envKey };
            usesRelay = false;
            setBanner('Relay設定が未完了のため、ローカル接続に切替えました');
            inflightRef.current.delete(imageId);
            applyNewSession(imageId, session, sessionKey, usesRelay, previousSession);
            return;
          }
        }

        // 必要ならPC登録
        try {
          debug(`registerPc start eid=${relayEventId} pcid=${pcId}`);
          const r = await retryWithBackoff(() => registerPc({ eventId: relayEventId, pcid: pcId }));
          debug(`registerPc done ok=${r.ok} status=${(r as any).status} code=${(r as any).code} err=${(r as any).error}`);
          if (!r.ok) {
            const errCode = (r as any)?.code || (r as any)?.error;
            const status = (r as any)?.status;
            if (errCode === 'E_MISSING_TOKEN' || errCode === 'E_TOKEN_REQUIRED') {
              handleLicenseBlocking('missing', imageId, sessionKey, envKey);
              inflightRef.current.delete(imageId);
              return;
            }
            if (errCode === 'E_BAD_TOKEN' || status === 401) {
              handleLicenseBlocking('invalid', imageId, sessionKey, envKey);
              inflightRef.current.delete(imageId);
              return;
            }
            if (operationMode === 'auto') {
              setBanner('Relay接続に失敗したためローカル接続に切替えました');
              debug('registerPc failed; fallback to local');
              const result = await invoke<{ sessionId: string; qrCode: string; imageId: string }>('generate_qr_code', { imageId });
              session = { imageId: result.imageId, sessionId: result.sessionId, qrCode: result.qrCode, connected: false, envKey };
              usesRelay = false;
              inflightRef.current.delete(imageId);
              applyNewSession(imageId, session, sessionKey, usesRelay, previousSession);
              return;
            }
            handleGeneralFailure('QRの事前登録に失敗しました。時間をおいて再試行してください。', imageId, sessionKey, envKey);
            inflightRef.current.delete(imageId);
            return;
          }
        } catch (e: any) {
          debug(`registerPc error ${e?.message || e}`);
          handleGeneralFailure('Relay 接続に失敗しました。ネットワーク環境を確認してから再試行してください。', imageId, sessionKey, envKey);
          inflightRef.current.delete(imageId);
          return;
        }

        // pending-sid 登録
        const sid = generateSid();
        const ttl = 90;
        debug(`pendingSid start eid=${relayEventId} pcid=${pcId} sid=${sid} ttl=${ttl}`);
        const res = await retryWithBackoff(() => pendingSid({ eventId: relayEventId, pcid: pcId, sid, ttl }));
        debug(`pendingSid done ok=${res.ok} status=${(res as any).status} code=${(res as any).code} err=${(res as any).error}`);

        if (!res.ok) {
          console.error('[QrDisplayWindow] pending-sid 登録に失敗:', res);
          setBanner(`pending-sid失敗: status=${(res as any).status || '-'} code=${(res as any).code || (res as any).error || '-'}`);
          const errCode = (res as any)?.error || (res as any)?.code;
          if (errCode === 'E_MISSING_TOKEN' || errCode === 'E_TOKEN_REQUIRED') {
            handleLicenseBlocking('missing', imageId, sessionKey, envKey);
            return;
          }
          if (errCode === 'E_BAD_TOKEN') {
            handleLicenseBlocking('invalid', imageId, sessionKey, envKey);
            return;
          }
          if (operationMode === 'auto') {
            // Auto → Local
            setBanner('ネットワーク不安定のためローカル接続に切替えました');
            debug('fallback to local');
            const result = await invoke<{ sessionId: string; qrCode: string; imageId: string }>('generate_qr_code', { imageId });
            session = { imageId: result.imageId, sessionId: result.sessionId, qrCode: result.qrCode, connected: false, envKey };
            usesRelay = false;
          } else {
            handleGeneralFailure('QRの事前登録に失敗しました。時間をおいて再試行してください。', imageId, sessionKey, envKey);
            debug('pending-sid failed in relay mode; abort');
            return;
          }
        } else {
          // Relay 正常
          setBanner(null);
          const base = (relayBaseUrl || 'https://ctrl.nuriemon.jp').replace(/\/$/, '');
          const qrUrl = `${base}/app/#e=${encodeURIComponent(relayEventId)}&sid=${encodeURIComponent(sid)}&img=${encodeURIComponent(imageId)}`;
          // 可能なら DataURL 化（tauri invoke）
          let qrDataUrl = qrUrl;
          try {
            qrDataUrl = await invoke<string>('generate_qr_from_text', { text: qrUrl });
            debug('QR data URL generated');
          } catch {
            debug('QR data URL generation failed; fallback to URL');
          }
          session = { imageId, sessionId: sid, qrCode: qrDataUrl, connected: false, envKey };
        }
      } else {
        // Local
        const result = await invoke<{ sessionId: string; qrCode: string; imageId: string }>('generate_qr_code', { imageId });
        session = { imageId: result.imageId, sessionId: result.sessionId, qrCode: result.qrCode, connected: false, envKey };
        usesRelay = false;
        debug(`local QR generated sessionId=${result.sessionId}`);
      }

      applyNewSession(imageId, session, sessionKey, usesRelay, previousSession);
      debug(`session stored for imageId=${imageId}`);
    } catch (error) {
      console.error('QRコードの生成に失敗しました:', error);
      debug(`generateQr error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      inflightRef.current.delete(imageId);
    }
  };

  // 再生成（必要なものだけ）
  useEffect(() => {
    const ready = uiReady;
    if (!ready) return;
    const envKey = `${relayBaseUrl}|${relayEventId}|${pcId}|${operationMode}`;
    const relayOn = operationMode === 'relay' || (operationMode === 'auto' && useRelay);
    if (licenseBlocked && relayOn) return;

    let delay = 0;
    const stepMs = 60;
    const noVisible = visibleIdsRef.current.size === 0;
    const targetList = noVisible ? processedImages.slice(0, 3) : processedImages;

    targetList.forEach((image) => {
      const s = sessions.get(image.id);
      const desiredKey = buildSessionKey(image.id);
      const valid = !!s && (s as any).envKey === envKey && (s as any).sessionKey === desiredKey;
      const visible = noVisible ? true : visibleIdsRef.current.has(image.id);
      if (!valid && !inflightRef.current.has(image.id) && visible) {
        setTimeout(() => { generateQr(image.id).catch(() => {}); }, delay);
        delay += stepMs;
      }
    });
  }, [regenTick, processedImages, sessions, operationMode, useRelay, relayBaseUrl, relayEventId, pcId, isServerStarted, uiReady, visibleIds, licenseBlocked]);

  // すべて再生成（環境キーが変わったものだけ個別再生成になる）
  const regenerateAll = () => {
    inflightRef.current.clear();
    setRegenTick((t) => t + 1);
  };

  // Relay時（ローカル未使用）のサムネイル読み込み（DataURL化）
  useEffect(() => {
    const loadThumbs = async () => {
      if (serverPort) return;
      const { loadImage } = await import('../services/imageStorage');
      const { downscaleDataUrl } = await import('../utils/image');
      const map = new Map(thumbs);
      let delay = 0;
      const step = 30;
      for (const image of processedImages) {
        if (!map.get(image.id)) {
          setTimeout(async () => {
            try {
              const full = await loadImage(image as any);
              const small = await downscaleDataUrl(full, 200, 0.8);
              map.set(image.id, small);
              setThumbs(new Map(map));
            } catch (e) {
              console.warn('[QrDisplayWindow] thumbnail load failed:', e);
            }
          }, delay);
          delay += step;
        }
      }
    };
    loadThumbs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processedImages, serverPort]);

  // デバッグトグル
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'd' || e.key === 'D') && (e.metaKey || e.ctrlKey)) setShowDebug((s) => !s);
      if (e.key === 'I' && e.metaKey && e.altKey) {
        try { invoke('open_devtools', { window_label: 'qr-display' } as any); } catch {}
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Local 用ポーリング
  const startTimer = (imageId: string, sessionId: string) => {
    cancelLocalTimer(sessionId);
    const interval = window.setInterval(async () => {
      try {
        const status = await invoke<{ connected: boolean }>('get_qr_session_status', { sessionId });
        updateSessions((prev) => {
          const existing = prev.get(imageId);
          if (!existing) return prev;
          const nextConnected = !!status.connected;
          if (existing.connected === nextConnected) {
            if (nextConnected) {
              window.clearInterval(interval);
              localPollsRef.current.delete(sessionId);
            }
            return prev;
          }
          const next = new Map(prev);
          next.set(imageId, { ...existing, connected: nextConnected });
          if (nextConnected) {
            window.clearInterval(interval);
            localPollsRef.current.delete(sessionId);
          }
          return next;
        });
      } catch {}
    }, 3000);
    localPollsRef.current.set(sessionId, interval);
  };

  // Sid 生成
  function generateSid(): string {
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let out = '';
    for (let i = 0; i < 10; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
  }

  // ライセンス遮断
  function handleLicenseBlocking(kind: 'missing' | 'invalid', imageId?: string, sessionKey?: string, envKey?: string) {
    setLicenseBlocked(true);
    setLicenseBlockedReason(kind);
    const message =
      kind === 'missing'
        ? 'ライセンスが未有効化のため Relay へ接続できません。設定画面でライセンスコードを有効化してから再試行してください。'
        : '保存済みのライセンス情報が無効になっています。設定画面でライセンスを再有効化してください。';
    const bannerMessage = kind === 'missing' ? 'ライセンスを有効化してから再試行してください' : 'ライセンス情報を再有効化してください';
    if (!licenseAlertShownRef.current) {
      try { alert(message); } catch {}
      licenseAlertShownRef.current = true;
    }
    setBanner(bannerMessage);
    debug(kind === 'missing' ? 'missing device token' : 'invalid device token');

    if (imageId && sessionKey && envKey) {
      const existing = sessionsRef.current.get(imageId);
      if (existing && existing.sessionId) {
        cancelFallbackForSession(existing.sessionId);
        sessionByIdRef.current.delete(existing.sessionId);
      }
      updateSessions((prev) => {
        const current = prev.get(imageId);
        if (current && (current as any).blockedReason === kind) return prev;
        const next = new Map(prev);
        const placeholder: QrSession = {
          imageId,
          sessionId: '',
          qrCode: '',
          connected: false,
          envKey,
          blockedReason: kind,
        };
        (placeholder as any).sessionKey = sessionKey;
        next.set(imageId, placeholder);
        return next;
      });
    }
  }

  function handleGeneralFailure(message: string, imageId: string, sessionKey: string, envKey: string) {
    setBanner(message);
    if (!generalAlertShownRef.current) {
      try { alert(message); } catch {}
      generalAlertShownRef.current = true;
    }
    const existing = sessionsRef.current.get(imageId);
    if (existing && existing.sessionId) {
      cancelFallbackForSession(existing.sessionId);
      sessionByIdRef.current.delete(existing.sessionId);
    }
    updateSessions((prev) => {
      const next = new Map(prev);
      const placeholder: QrSession = {
        imageId,
        sessionId: '',
        qrCode: '',
        connected: false,
        envKey,
        blockedReason: 'error',
        errorMessage: message,
      };
      (placeholder as any).sessionKey = sessionKey;
      next.set(imageId, placeholder);
      return next;
    });
  }

  // UI
  return (
    <ErrorBoundary>
      <div className={styles.container}>
        <h1 className={styles.title}>QRコード - ぬりえもん</h1>

        {(() => {
          const displayBanner = missingRelay ? 'Relay設定が不足しています（イベントID/PCID）。設定画面で確認してください。' : banner;
          return displayBanner ? <div className={styles.banner}>{displayBanner}</div> : null;
        })()}

        <div className={styles.controls}>
          <button onClick={regenerateAll} style={{ fontSize: 12 }}>すべて再生成</button>
        </div>

        <div className={styles.imageGrid}>
          {processedImages.length === 0 ? (
            <div className={styles.noImages}>画像がありません</div>
          ) : (
            processedImages.map((image) => (
              <ImageQrItem
                key={image.id}
                image={image}
                session={sessions.get(image.id)}
                onGenerateQr={() => generateQr(image.id)}
                ready={uiReady}
                serverPort={serverPort}
                thumbUrl={thumbs.get(image.id) || ''}
                onVisible={onVisibleChange}
              />
            ))
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
};

// --- ErrorBoundary ---
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; message?: string }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(err: any) { return { hasError: true, message: err?.message || String(err) }; }
  componentDidCatch(error: any, info: any) { console.error('[QrDisplayWindow/ErrorBoundary]', error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16, color: '#fff', background: '#300', minHeight: '100vh' }}>
          <h2>QR画面でエラーが発生しました</h2>
          <p>{this.state.message}</p>
          <p>アプリを再起動するか、設定を見直してください。</p>
        </div>
      );
    }
    return this.props.children as any;
  }
}

// --- Image + QR item ---
interface ImageQrItemProps {
  image: any;
  session?: QrSession;
  onGenerateQr: () => void;
  ready: boolean;
  serverPort: number | null;
  thumbUrl?: string;
  onVisible: (id: string, visible: boolean) => void;
}

const ImageQrItem: React.FC<ImageQrItemProps> = ({ image, session, onGenerateQr, serverPort, ready, thumbUrl, onVisible }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => onVisible(image.id, entry.isIntersecting));
    }, { root: null, threshold: 0.1 });
    io.observe(el);
    return () => { try { io.disconnect(); } catch {} };
  }, [image.id, onVisible]);

  return (
    <div className={styles.imageQrItem} ref={ref}>
      <div className={styles.imageSection}>
        <img
          src={serverPort ? `http://127.0.0.1:${serverPort}/image/${image.id}` : (thumbUrl || '')}
          alt={image.originalFileName}
        />
        <div className={styles.imageName}>{image.originalFileName}</div>
      </div>

      <div className={styles.qrSection}>
        {session ? (
          session.blockedReason ? (
            <div className={styles.qrLoading}>
              {session.blockedReason === 'missing'
                ? 'ライセンスが未有効化です'
                : session.blockedReason === 'invalid'
                ? 'ライセンス情報が無効です'
                : (session.errorMessage || 'QRの生成に失敗しました')}
              <div style={{ marginTop: 6 }}>
                <button onClick={onGenerateQr} disabled={!ready} style={{ fontSize: 12 }}>再試行</button>
              </div>
            </div>
          ) : (
            <>
              <QrCodeDisplay qrCode={session.qrCode} />
              <div className={styles.qrStatus}>
                {session.connected ? <span className={styles.connected}>接続済み</span> : <span className={styles.timer}>接続待ち</span>}
              </div>
              <div style={{ marginTop: 6 }}>
                <button onClick={onGenerateQr} disabled={!ready} style={{ fontSize: 12 }}>QR再生成</button>
              </div>
            </>
          )
        ) : (
          <div className={styles.qrLoading}>
            QR生成中...
            <div style={{ marginTop: 6 }}>
              <button onClick={onGenerateQr} disabled={!ready} style={{ fontSize: 12 }}>手動生成</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// --- QR ---
const QrCodeDisplay: React.FC<{ qrCode: string }> = ({ qrCode }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = '';
      const img = document.createElement('img');
      img.src = qrCode;
      img.style.width = '100%';
      img.style.height = '100%';
      ref.current.appendChild(img);
    }
  }, [qrCode]);
  return <div ref={ref} className={styles.qrCode} />;
};
