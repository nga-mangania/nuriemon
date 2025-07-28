console.log('[main.tsx] Starting application...');

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AnimationWindow from "./windows/AnimationWindow";
import "./styles/reset.scss";

console.log('[main.tsx] Imports completed');

// URLのハッシュに基づいて適切なコンポーネントを表示
const hash = window.location.hash;
const isAnimationWindow = hash === '#/animation';

console.log('[main.tsx] Hash:', hash, 'isAnimationWindow:', isAnimationWindow);

try {
  const rootElement = document.getElementById("root");
  console.log('[main.tsx] Root element:', rootElement);
  
  if (!rootElement) {
    console.error('[main.tsx] Root element not found!');
  } else {
    ReactDOM.createRoot(rootElement as HTMLElement).render(
      <React.StrictMode>
        {isAnimationWindow ? <AnimationWindow /> : <App />}
      </React.StrictMode>,
    );
    console.log('[main.tsx] React app rendered');
  }
} catch (error) {
  console.error('[main.tsx] Error rendering app:', error);
}
