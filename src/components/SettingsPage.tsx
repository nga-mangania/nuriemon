import React, { useState, useEffect } from 'react';
import { open, confirm } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { AudioSettings } from './AudioSettings';
import { GroundSetting } from './GroundSetting';
import { 
  AppSettingsService
} from '../services/database';
import { emit } from '@tauri-apps/api/event';
import { getAllMetadata, loadImage, deleteImage, saveBackgroundFile } from '../services/imageStorage';
import { WorkspaceManager } from '../services/workspaceManager';
import styles from './SettingsPage.module.scss';

export function SettingsPage() {
  const [currentWorkspace, setCurrentWorkspace] = useState<string>('');
  const [groundPosition, setGroundPosition] = useState(80);
  const [deletionTime, setDeletionTime] = useState('unlimited');
  const [isAnimationWindowOpen, setIsAnimationWindowOpen] = useState(false);
  const [currentBackground, setCurrentBackground] = useState<{url: string, type: 'image' | 'video'} | null>(null);
  const [isChangingWorkspace, setIsChangingWorkspace] = useState(false);
  
  // 背景アップロード関連のstate
  const [uploadingBackground, setUploadingBackground] = useState(false);
  const [backgroundProgress, setBackgroundProgress] = useState(0);

  useEffect(() => {
    const init = async () => {
      // 初回起動時に統合的な初期化処理を実行
      try {
        // まずマイグレーションを実行（file_pathを確保）
        const { migrateFilePaths } = await import('../services/migration');
        await migrateFilePaths();
        console.log('[SettingsPage] マイグレーション完了');
        
        // 次にクリーンアップを実行
        const { cleanupDatabase, removeDuplicateFiles } = await import('../services/cleanupDatabase');
        await removeDuplicateFiles();
        // クリーンアップは一時的に無効化（ファイルパスの不整合を修正するまで）
        // await cleanupDatabase();
        // console.log('[SettingsPage] データベースのクリーンアップ完了');
        
        // 最後に設定を読み込み
        await loadSettings();
      } catch (error) {
        console.error('[SettingsPage] 初期化エラー:', error);
        // エラー時でも設定は読み込む
        await loadSettings();
      }
    };
    init();
  }, []);

  const loadSettings = async () => {
    try {
      // ワークスペース情報を取得
      const manager = WorkspaceManager.getInstance();
      const workspace = manager.getCurrentWorkspace();
      if (workspace) {
        setCurrentWorkspace(workspace);
      }
      
      // 全ての設定を一括で取得（パフォーマンス向上）
      const allSettings = await AppSettingsService.getAllSettings();
      
      setGroundPosition(allSettings.groundPosition);
      setDeletionTime(allSettings.deletionTime);
      
      console.log('[SettingsPage] 設定を読み込みました:', allSettings);
    } catch (error) {
      console.error('[SettingsPage] 設定の読み込みに失敗しました:', error);
      // エラー時はデフォルト値を設定
      setGroundPosition(80);
      setDeletionTime('unlimited');
    }
    
    // 背景画像の読み込み
    try {
      const metadata = await getAllMetadata();
      const background = metadata.find(m => (m as any).image_type === 'background');
      if (background) {
        console.log('[SettingsPage] Loading background:', background);
        const backgroundData = await loadImage(background);
        console.log('[SettingsPage] Background loaded, data URL length:', backgroundData.length);
        setCurrentBackground({
          url: backgroundData,
          type: background.originalFileName.match(/\.(mp4|mov)$/i) ? 'video' : 'image'
        });
      } else {
        console.log('[SettingsPage] No background found in metadata');
      }
    } catch (error) {
      console.error('背景画像の読み込みエラー:', error);
    }
  };

  const handleGroundPositionChange = async (value: number) => {
    setGroundPosition(value);
    await AppSettingsService.updateGroundPosition(value);
    emit('ground-position-change', value);
  };

  const handleDeletionTimeChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newTime = e.target.value;
    setDeletionTime(newTime);
    await AppSettingsService.saveDeletionTime(newTime);
  };

  const handleBackgroundSelect = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: '背景ファイル',
          extensions: ['png', 'jpg', 'jpeg', 'mp4', 'mov']
        }]
      });

      if (selected) {
        setUploadingBackground(true);
        setBackgroundProgress(0);
        
        const fileData = await readFile(selected as string);
        const base64 = btoa(
          new Uint8Array(fileData).reduce(
            (data, byte) => data + String.fromCharCode(byte),
            ''
          )
        );
        
        const fileName = (selected as string).split(/[/\\]/).pop() || 'unknown';
        const extension = fileName.split('.').pop()?.toLowerCase();
        const isVideo = extension === 'mp4' || extension === 'mov';
        const mimeType = isVideo 
          ? (extension === 'mp4' ? 'video/mp4' : 'video/quicktime')
          : (extension === 'png' ? 'image/png' : 'image/jpeg');
        
        const dataUrl = `data:${mimeType};base64,${base64}`;
        
        // 即時アップロードを実行
        await handleBackgroundUploadInternal(dataUrl, fileName);
      }
    } catch (error) {
      console.error('背景ファイル選択エラー:', error);
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      alert(`背景ファイルの選択に失敗しました: ${errorMessage}`);
    } finally {
      setUploadingBackground(false);
      setBackgroundProgress(0);
    }
  };

  // 内部アップロード関数（即時アップロード用）
  const handleBackgroundUploadInternal = async (dataUrl: string, fileName: string) => {
    try {
      setBackgroundProgress(30);
      
      // 既存の背景を削除
      const metadata = await getAllMetadata();
      const existingBackground = metadata.find(m => (m as any).image_type === 'background');
      if (existingBackground) {
        await deleteImage(existingBackground);
      }

      setBackgroundProgress(60);
      
      // 新しい背景を保存
      await saveBackgroundFile(dataUrl, fileName);
      
      setBackgroundProgress(100);
      
      // 背景を再読み込み
      await loadSettings();
      emit('background-change');
      
      // 成功メッセージを一時的に表示
      console.log('[SettingsPage] 背景アップロード成功');
      setTimeout(() => {
        setBackgroundProgress(0);
      }, 1500);
    } catch (error) {
      console.error('背景アップロードエラー:', error);
      alert(`背景のアップロードに失敗しました: ${error instanceof Error ? error.message : String(error)}`);
      setBackgroundProgress(0);
    }
  };


  const handleRemoveBackground = async () => {
    if (!currentBackground) return;
    
    const confirmed = await confirm('現在の背景を削除しますか？');
    if (!confirmed) return;

    try {
      const metadata = await getAllMetadata();
      const background = metadata.find(m => (m as any).image_type === 'background');
      if (background) {
        await deleteImage(background);
        setCurrentBackground(null);
        emit('background-change');
      }
    } catch (error) {
      console.error('背景削除エラー:', error);
      alert('背景の削除に失敗しました');
    }
  };

  const openAnimationWindow = async () => {
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      
      const animationWindow = new WebviewWindow('animation', {
        url: '/animation',
        title: 'ぬりえもん - アニメーション',
        width: 1200,
        height: 800,
        resizable: true,
        alwaysOnTop: false,
      });

      animationWindow.once('tauri://created', () => {
        setIsAnimationWindowOpen(true);
      });

      animationWindow.once('tauri://destroyed', () => {
        setIsAnimationWindowOpen(false);
      });
    } catch (error) {
      console.error('[SettingsPage] アニメーションウィンドウのオープンに失敗しました:', error);
      alert('アニメーションウィンドウを開けませんでした');
    }
  };

  const handleChangeWorkspace = async () => {
    try {
      setIsChangingWorkspace(true);
      const selected = await open({
        directory: true,
        multiple: false,
        title: '新しいワークスペースフォルダを選択'
      });

      if (selected && typeof selected === 'string') {
        // ワークスペースを切り替え
        await WorkspaceManager.getInstance().switchWorkspace(selected);
        
        // ワークスペース情報を更新
        setCurrentWorkspace(selected);
        
        // 設定を再読み込み
        await loadSettings();
      }
    } catch (error) {
      console.error('ワークスペース変更エラー:', error);
      alert('フォルダの変更に失敗しました');
    } finally {
      setIsChangingWorkspace(false);
    }
  };

  return (
    <div className={styles.settingsPage}>
      <h1>初期設定</h1>

      {/* ステップ1: ワークスペース */}
      <section className={styles.section}>
        <h2>ステップ1: 現在のワークスペース</h2>
        <div className={styles.workspaceInfo}>
          <p>現在の作業フォルダ:</p>
          <div className={styles.workspacePath}>
            {currentWorkspace || 'ワークスペースが選択されていません'}
          </div>
          <button 
            className={styles.changeWorkspaceButton}
            onClick={handleChangeWorkspace}
            disabled={isChangingWorkspace}
          >
            {isChangingWorkspace ? '変更中...' : 'フォルダを変更'}
          </button>
          <div className={styles.note}>
            <p>※ 作業フォルダを変更すると、そのフォルダに保存されているデータが読み込まれます。</p>
          </div>
        </div>
      </section>

      {/* ステップ2: 背景の設定 */}
      <section className={styles.section}>
        <h2>ステップ2: 背景の設定</h2>
        <div className={styles.backgroundUpload}>
          <div className={styles.uploadBox}>
            <div className={styles.uploadControls}>
              <button
                className={styles.fileInputLabel}
                onClick={handleBackgroundSelect}
                disabled={uploadingBackground}
              >
                {uploadingBackground ? 'アップロード中...' : '背景を選択'}
              </button>
            </div>
            
            {uploadingBackground && (
              <div className={styles.progressBarContainer}>
                <div className={styles.progressBar} style={{ width: `${backgroundProgress}%` }}>
                  <span className={styles.progressText}>{Math.round(backgroundProgress)}%</span>
                </div>
              </div>
            )}
            
            {currentBackground && (
              <div className={styles.currentBackground}>
                <h4>現在の背景</h4>
                <div className={styles.backgroundPreview}>
                  {currentBackground.type === 'video' ? (
                    <video 
                      src={currentBackground.url} 
                      className={styles.previewVideo}
                      autoPlay
                      loop
                      muted
                    />
                  ) : (
                    <img 
                      src={currentBackground.url} 
                      alt="現在の背景" 
                      className={styles.previewImage}
                    />
                  )}
                  <button 
                    className={styles.removeButton}
                    onClick={handleRemoveBackground}
                  >
                    背景を削除
                  </button>
                </div>
              </div>
            )}
          </div>
          
          <div className={styles.note}>
            <p>対応ファイル：jpg、png、mp4、mov（50MB以下）</p>
            <p>※アニメーションの背景に使用されます。</p>
          </div>
        </div>
      </section>

      {/* ステップ3: 地面の位置設定 */}
      <section className={styles.section}>
        <h2>ステップ3: 地面の位置設定</h2>
        <GroundSetting
          backgroundUrl={currentBackground?.url}
          backgroundType={currentBackground?.type}
          onGroundPositionChange={handleGroundPositionChange}
          initialGroundPosition={groundPosition}
        />
        <div className={styles.note}>
          <p>赤線をドラッグして地面の位置を調整して下さい。(スマートフォンの場合はタップして下さい。)</p>
        </div>
      </section>

      {/* ステップ4: 音楽の設定 */}
      <section className={styles.section}>
        <h2>ステップ4: 音楽の設定</h2>
        <AudioSettings />
        <div className={styles.note}>
          <p>対応ファイル：mp3、mp4(BGM50MB・効果音1MB以下)</p>
          <p>※効果音は新規画像がスクリーンに登場した時に再生されます。</p>
        </div>
      </section>

      {/* ステップ5: 非表示までの時間設定 */}
      <section className={styles.section}>
        <h2>ステップ5: 非表示までの時間設定</h2>
        <select value={deletionTime} onChange={handleDeletionTimeChange}>
          <option value="unlimited">無制限</option>
          <option value="1">1分</option>
          <option value="2">2分</option>
          <option value="3">3分</option>
          <option value="4">4分</option>
          <option value="5">5分</option>
          <option value="6">6分</option>
          <option value="7">7分</option>
          <option value="8">8分</option>
          <option value="9">9分</option>
          <option value="10">10分</option>
          <option value="15">15分</option>
          <option value="20">20分</option>
          <option value="30">30分</option>
        </select>
        <div className={styles.note}>
          <p>アップロードされたお絵描きが表示されてから消えるまでの時間を設定できます。</p>
          <p>例：「1分」に設定すると、画像はアップロードから1分後にスクリーンから消えます。</p>
          <p>※「無制限」に設定すると、お絵描き一覧から削除するまでスクリーンに残り続けます。</p>
          <p>※設定を途中で変更する場合は、 <a href="/gallery">お絵描き一覧</a> からすべての画像を削除した後に変更してください。</p>
        </div>
      </section>

      {/* ステップ6: スクリーンを表示 */}
      <section className={styles.section}>
        <h2>ステップ6: スクリーンを表示</h2>
        <button 
          onClick={openAnimationWindow}
          disabled={isAnimationWindowOpen}
          className={styles.animationButton}
        >
          {isAnimationWindowOpen ? 'アニメーション表示中' : 'アニメーションを表示'}
        </button>
      </section>
      
      {/* デバッグセクション */}
      <section className={styles.section}>
        <h2>データベース管理</h2>
        <button 
          onClick={async () => {
            const confirmed = await confirm('データベースをクリーンアップしますか？\n\n重複ファイルや存在しないファイルへの参照が削除されます。');
            if (confirmed) {
              try {
                const { cleanupDatabase, removeDuplicateFiles } = await import('../services/cleanupDatabase');
                await removeDuplicateFiles();
                await cleanupDatabase();
                // Tauriのメッセージダイアログを使用
                const { message } = await import('@tauri-apps/plugin-dialog');
                await message('クリーンアップが完了しました。', { title: '完了' });
                await loadSettings();
              } catch (error) {
                console.error('クリーンアップエラー:', error);
                const { message } = await import('@tauri-apps/plugin-dialog');
                await message('クリーンアップ中にエラーが発生しました。', { title: 'エラー', kind: 'error' });
              }
            }
          }}
          className={styles.animationButton}
          style={{ backgroundColor: '#ff6b6b' }}
        >
          データベースをクリーンアップ
        </button>
        <div className={styles.note}>
          <p>※重複したファイルや存在しないファイルへの参照を削除します。</p>
          <p>※問題が発生した場合のみ実行してください。</p>
        </div>
      </section>
    </div>
  );
}

