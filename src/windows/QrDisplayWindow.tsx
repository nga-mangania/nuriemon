import React, { useEffect, useState, useRef } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useWorkspaceStore, loadStateFromFile } from '../stores/workspaceStore';
import styles from './QrDisplayWindow.module.scss';

interface QrSession {
  imageId: string;
  sessionId: string;
  qrCode: string;
  connected: boolean;
  remainingSeconds: number;
}

export const QrDisplayWindow: React.FC = () => {
  console.log('[QrDisplayWindow] Component rendering...'); // ログ1: コンポーネントがレンダリングされているか
  
  const images = useWorkspaceStore(state => state.images);
  console.log('[QrDisplayWindow] Images from Zustand:', images); // ログ2: ストアから取得した直後のデータ
  
  const [sessions, setSessions] = useState<Map<string, QrSession>>(new Map());
  const [isServerStarted, setIsServerStarted] = useState(false);
  const [serverPort, setServerPort] = useState<number | null>(null);
  
  // メタデータから表示用データを生成
  const processedImages = images.filter(img => img.type === 'processed');

  // ウィンドウ起動時に一度だけファイルから状態を読み込む
  useEffect(() => {
    console.log('[QrDisplayWindow] Loading state from file...');
    loadStateFromFile();
  }, []);

  // メインウィンドウからの更新通知をリッスンする
  useEffect(() => {
    const unlistenPromise = listen('store-updated', () => {
      console.log('[QrDisplayWindow] Received store-updated event. Reloading state.');
      loadStateFromFile();
    });
    
    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
  }, []);

  // Webサーバーの起動
  useEffect(() => {
    const initialize = async () => {
      try {
        // Webサーバーの起動（すでに起動済みならポート番号を返す）
        const port = await invoke<number>('start_web_server');
        console.log('[QrDisplayWindow] Web server started on port:', port);
        setServerPort(port);
        setIsServerStarted(true);
      } catch (error) {
        console.error('[QrDisplayWindow] Webサーバーの起動に失敗しました:', error);
      }
    };
    
    initialize();
  }, []);


  // モバイル接続イベントのリスナー
  useEffect(() => {
    const unlisten = listen('mobile-connected', (event) => {
      const { sessionId, imageId } = event.payload as { sessionId: string; imageId: string };
      setSessions(prev => {
        const newSessions = new Map(prev);
        const session = newSessions.get(imageId);
        if (session && session.sessionId === sessionId) {
          session.connected = true;
        }
        return newSessions;
      });
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, []);

  // QRコードの生成
  const generateQr = async (imageId: string) => {
    if (!isServerStarted) {
      alert('Webサーバーが起動していません');
      return;
    }

    try {
      const result = await invoke<{ sessionId: string; qrCode: string; imageId: string }>('generate_qr_code', { imageId });
      
      const session: QrSession = {
        imageId: result.imageId,
        sessionId: result.sessionId,
        qrCode: result.qrCode,
        connected: false,
        remainingSeconds: 30
      };

      setSessions(prev => {
        const newSessions = new Map(prev);
        newSessions.set(imageId, session);
        return newSessions;
      });

      // タイマーの開始
      startTimer(imageId, result.sessionId);
    } catch (error) {
      console.error('QRコードの生成に失敗しました:', error);
    }
  };

  // タイマー処理
  const startTimer = (imageId: string, sessionId: string) => {
    const interval = setInterval(async () => {
      try {
        const status = await invoke<{ connected: boolean; remainingSeconds: number }>('get_qr_session_status', { sessionId });
        
        setSessions(prev => {
          const newSessions = new Map(prev);
          const session = newSessions.get(imageId);
          if (session) {
            session.connected = status.connected;
            session.remainingSeconds = status.remainingSeconds;
            
            if (status.remainingSeconds <= 0) {
              newSessions.delete(imageId);
              clearInterval(interval);
            }
          }
          return newSessions;
        });
      } catch (error) {
        clearInterval(interval);
        setSessions(prev => {
          const newSessions = new Map(prev);
          newSessions.delete(imageId);
          return newSessions;
        });
      }
    }, 1000);
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>QRコード - ぬりえもん</h1>
      
      {!isServerStarted ? (
        <div className={styles.loading}>
          初期化中...
        </div>
      ) : (
        <>
          {serverPort && (
            <div className={styles.serverInfo}>
              サーバーポート: {serverPort}
            </div>
          )}
          
          <div className={styles.imageGrid}>
            {processedImages.length === 0 ? (
              <div className={styles.noImages}>
                画像がありません
              </div>
            ) : (
              processedImages.map(image => (
                <ImageQrItem
                  key={image.id}
                  image={image}
                  session={sessions.get(image.id)}
                  onGenerateQr={() => generateQr(image.id)}
                  serverPort={serverPort}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
};

// 画像とQRコードを表示するアイテムコンポーネント
interface ImageQrItemProps {
  image: any;
  session?: QrSession;
  onGenerateQr: () => void;
  serverPort: number | null;
}

const ImageQrItem: React.FC<ImageQrItemProps> = ({ image, session, onGenerateQr, serverPort }) => {
  useEffect(() => {
    // 自動的にQRコードを生成
    if (!session) {
      onGenerateQr();
    }
  }, [session, onGenerateQr]);

  return (
    <div className={styles.imageQrItem}>
      <div className={styles.imageSection}>
        <img
          src={serverPort ? `http://127.0.0.1:${serverPort}/image/${image.id}` : convertFileSrc(image.file_path || image.savedFileName)}
          alt={image.originalFileName}
        />
        <div className={styles.imageName}>{image.originalFileName}</div>
      </div>
      
      <div className={styles.qrSection}>
        {session ? (
          <>
            <QrCodeDisplay qrCode={session.qrCode} />
            <div className={styles.qrStatus}>
              {session.connected ? (
                <span className={styles.connected}>接続済み</span>
              ) : (
                <span className={styles.timer}>
                  残り: {session.remainingSeconds}秒
                </span>
              )}
            </div>
          </>
        ) : (
          <div className={styles.qrLoading}>
            QR生成中...
          </div>
        )}
      </div>
    </div>
  );
};

// QRコード表示コンポーネント
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
