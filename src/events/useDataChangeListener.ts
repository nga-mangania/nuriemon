import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useEffect, useRef } from 'react';

// イベントデータの型定義
export interface DataChangeEvent {
  type: 'ImageAdded' | 'ImageDeleted' | 'AudioUpdated' | 'BackgroundChanged' | 
        'AnimationSettingsChanged' | 'GroundPositionChanged' | 'DeletionTimeChanged' | 
        'AppSettingChanged';
  data: any;
}

export interface DataChangeCallbacks {
  onImageAdded?: (id: string) => void;
  onImageDeleted?: (id: string) => void;
  onAudioUpdated?: (audioType: string) => void;
  onBackgroundChanged?: () => void;
  onAnimationSettingsChanged?: (imageId: string) => void;
  onGroundPositionChanged?: (position: number) => void;
  onDeletionTimeChanged?: (time: string) => void;
  onAppSettingChanged?: (key: string, value: string) => void;
}

/**
 * データ変更イベントをリッスンするカスタムフック
 * @param callbacks イベント発生時に呼び出されるコールバック関数のセット
 */
export function useDataChangeListener(callbacks: DataChangeCallbacks) {
  // コールバック関数をRefに保存することで、リスナーの再登録を防ぎつつ、
  // 常に最新のコールバックを呼び出せるようにする
  const callbacksRef = useRef(callbacks);

  // callbacksオブジェクトが変更されたら、Refの内容も更新する
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  useEffect(() => {
    let unlisten: UnlistenFn;

    const setupListener = async () => {
      try {
        unlisten = await listen<DataChangeEvent>('data-changed', (event) => {
          const { type, data } = event.payload;
        
          switch (type) {
            case 'ImageAdded':
              callbacksRef.current.onImageAdded?.(data.id);
              break;
            case 'ImageDeleted':
              callbacksRef.current.onImageDeleted?.(data.id);
              break;
            case 'AudioUpdated':
              callbacksRef.current.onAudioUpdated?.(data.audio_type);
              break;
            case 'BackgroundChanged':
              callbacksRef.current.onBackgroundChanged?.();
              break;
            case 'AnimationSettingsChanged':
              callbacksRef.current.onAnimationSettingsChanged?.(data.image_id);
              break;
            case 'GroundPositionChanged':
              callbacksRef.current.onGroundPositionChanged?.(data.position);
              break;
            case 'DeletionTimeChanged':
              callbacksRef.current.onDeletionTimeChanged?.(data.time);
              break;
            case 'AppSettingChanged':
              callbacksRef.current.onAppSettingChanged?.(data.key, data.value);
              break;
          }
        });
      } catch (error) {
        console.error('Failed to setup tauri event listener:', error);
      }
    };

    setupListener();

    // コンポーネントのアンマウント時にリスナーを解除する
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []); // 依存配列を空にすることで、リスナーの登録・解除は初回マウント時とアンマウント時にのみ実行される
}
