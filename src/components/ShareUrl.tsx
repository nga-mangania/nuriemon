import { useState, useEffect } from 'react';
import { saveSettings, loadSettings } from '../services/settings';
import styles from './ShareUrl.module.scss';

interface ShareUrlProps {
  showTooltip?: boolean;
}

export function ShareUrl({ showTooltip = false }: ShareUrlProps) {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showCopied, setShowCopied] = useState(false);

  useEffect(() => {
    loadShareUrl();
  }, []);

  const loadShareUrl = async () => {
    const settings = await loadSettings();
    if (settings?.shareUrl) {
      setShareUrl(settings.shareUrl);
    }
  };

  const generateShareUrl = async () => {
    setIsGenerating(true);
    try {
      // シンプルなランダムIDを生成
      const randomId = Math.random().toString(36).substring(2, 15) + 
                      Math.random().toString(36).substring(2, 15);
      const newShareUrl = `${window.location.origin}/share/${randomId}`;
      
      const currentSettings = await loadSettings();
      await saveSettings({ ...currentSettings, shareUrl: newShareUrl, shareId: randomId });
      setShareUrl(newShareUrl);
    } catch (error) {
      console.error('共有URL生成エラー:', error);
      alert('共有URLの生成に失敗しました');
    } finally {
      setIsGenerating(false);
    }
  };

  const deleteShareUrl = async () => {
    if (!confirm('共有URLを削除しますか？')) return;
    
    try {
      const currentSettings = await loadSettings();
      await saveSettings({ ...currentSettings, shareUrl: null, shareId: null });
      setShareUrl(null);
    } catch (error) {
      console.error('共有URL削除エラー:', error);
      alert('共有URLの削除に失敗しました');
    }
  };

  const copyToClipboard = async () => {
    if (!shareUrl) return;
    
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShowCopied(true);
      setTimeout(() => setShowCopied(false), 2000);
    } catch (error) {
      console.error('クリップボードコピーエラー:', error);
      alert('URLのコピーに失敗しました');
    }
  };

  return (
    <div className={styles.shareUrlContainer}>
      {!shareUrl ? (
        <button 
          className={styles.generateButton}
          onClick={generateShareUrl}
          disabled={isGenerating}
        >
          {isGenerating ? '生成中...' : '共有URLを生成'}
        </button>
      ) : (
        <div className={styles.shareUrlDisplay}>
          <input 
            type="text" 
            value={shareUrl} 
            readOnly 
            className={styles.shareUrlInput}
          />
          <div className={styles.shareUrlActions}>
            <button 
              className={styles.copyButton}
              onClick={copyToClipboard}
              title="URLをコピー"
            >
              <i className="fa-regular fa-copy"></i>
            </button>
            <button 
              className={styles.deleteButton}
              onClick={deleteShareUrl}
              title="URLを削除"
            >
              <i className="fa-regular fa-trash-alt"></i>
            </button>
          </div>
          {showCopied && (
            <div className={styles.copiedTooltip}>
              コピーしました！
            </div>
          )}
        </div>
      )}
      
      {showTooltip && (
        <div className={styles.tooltip}>
          <p>共有URLを生成すると、ログインなしでスクリーンを閲覧できます。</p>
        </div>
      )}
    </div>
  );
}