import { FC } from 'react';
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
  ];

  const handleMenuClick = (tabId: typeof menuItems[number]['id']) => {
    if (tabId === 'animation') {
      onAnimationClick();
    } else {
      onTabChange(tabId);
    }
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <h1>ぬりえもん</h1>
      </div>
      
      <nav className={styles.navigation}>
        {menuItems.map((item) => (
          <button
            key={item.id}
            className={`${styles.menuItem} ${activeTab === item.id ? styles.active : ''}`}
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