import { FC } from 'react';
import { invoke } from '@tauri-apps/api/core';
import styles from './Sidebar.module.scss';

interface SidebarProps {
  activeTab: 'settings' | 'upload' | 'gallery' | 'animation';
  onTabChange: (tab: 'settings' | 'upload' | 'gallery' | 'animation') => void;
  onAnimationClick: () => void;
}

export const Sidebar: FC<SidebarProps> = ({ activeTab, onTabChange, onAnimationClick }) => {
  const menuItems = [
    { id: 'settings' as const, label: '初期設定', icon: '⚙️' },
    { id: 'upload' as const, label: 'アップロード', icon: '📤' },
    { id: 'gallery' as const, label: 'ギャラリー', icon: '🖼️' },
    { id: 'animation' as const, label: 'アニメーション', icon: '🎬' },
    { id: 'qr' as const, label: 'QRコード', icon: '📱', isSpecial: true },
  ];

  const handleMenuClick = async (tabId: typeof menuItems[number]['id']) => {
    if (tabId === 'animation') {
      onAnimationClick();
    } else if (tabId === 'qr') {
      try {
        await invoke('open_qr_window');
      } catch (error) {
        console.error('QRコードウィンドウの起動に失敗しました:', error);
      }
    } else {
      onTabChange(tabId);
    }
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <img src="/img/logo.svg" alt="ぬりえもん ロゴ" className={styles.logoImg} />
      </div>
      
      <nav className={styles.navigation}>
        {menuItems.map((item) => (
          <button
            key={item.id}
            className={`${styles.menuItem} ${!item.isSpecial && activeTab === item.id ? styles.active : ''}`}
            onClick={() => handleMenuClick(item.id)}
          >
            <span className={styles.icon}>{item.icon}</span>
            <span className={styles.label}>{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
};
