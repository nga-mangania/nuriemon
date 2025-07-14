import { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { loadSettings, saveSettings, getSaveLocationName, AppSettings } from '../services/settings';
import { addDirectoryScope } from '../services/fileScope';
import styles from './Settings.module.scss';

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: (settings: AppSettings) => void;
}

export function Settings({ isOpen, onClose, onSave }: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings>({
    saveLocation: 'appData',
    autoSave: true,
  });
  const [customPath, setCustomPath] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  // 設定を読み込む
  useEffect(() => {
    if (isOpen) {
      loadSettings().then(loaded => {
        setSettings(loaded);
        setCustomPath(loaded.customPath || '');
      });
    }
  }, [isOpen]);

  // カスタムパスを選択
  const handleSelectCustomPath = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: '画像の保存先を選択',
    });

    if (selected && typeof selected === 'string') {
      // ディレクトリへのアクセス権限を追加
      try {
        await addDirectoryScope(selected);
      } catch (error) {
        console.error('Settings: ディレクトリスコープ追加エラー', error);
      }
      
      setCustomPath(selected);
      setSettings(prev => ({
        ...prev,
        saveLocation: 'custom',
        customPath: selected,
      }));
    }
  };

  // 設定を保存
  const handleSave = async () => {
    setIsSaving(true);
    try {
      const finalSettings = {
        ...settings,
        customPath: settings.saveLocation === 'custom' ? customPath : undefined,
      };
      
      await saveSettings(finalSettings);
      
      if (onSave) {
        onSave(finalSettings);
      }
      
      onClose();
    } catch (error) {
      console.error('設定保存エラー:', error);
      alert('設定の保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <h2 className={styles.title}>設定</h2>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>画像の保存先</h3>
          
          <div className={styles.options}>
            {(['appData', 'pictures', 'downloads', 'documents', 'custom'] as const).map(location => (
              <label key={location} className={styles.option}>
                <input
                  type="radio"
                  name="saveLocation"
                  value={location}
                  checked={settings.saveLocation === location}
                  onChange={() => setSettings(prev => ({ ...prev, saveLocation: location }))}
                />
                <span>{getSaveLocationName(location)}</span>
                {location === 'custom' && customPath && (
                  <span className={styles.customPath}>{customPath}</span>
                )}
              </label>
            ))}
          </div>

          {settings.saveLocation === 'custom' && (
            <button
              className={styles.selectButton}
              onClick={handleSelectCustomPath}
            >
              フォルダを選択...
            </button>
          )}
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>その他の設定</h3>
          
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={settings.autoSave}
              onChange={e => setSettings(prev => ({ ...prev, autoSave: e.target.checked }))}
            />
            <span>画像を選択時に自動保存</span>
          </label>
        </div>

        <div className={styles.actions}>
          <button
            className={styles.cancelButton}
            onClick={onClose}
            disabled={isSaving}
          >
            キャンセル
          </button>
          <button
            className={styles.saveButton}
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}