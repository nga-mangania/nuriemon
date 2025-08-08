console.log('[main.tsx] Starting application...');

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AnimationWindow from "./windows/AnimationWindow";
import { QrDisplayWindow } from "./windows/QrDisplayWindow";
import "./styles/reset.scss";

console.log('[main.tsx] Imports completed');

// ウィンドウタイプの判定
const hash = window.location.hash;
const isAnimationWindow = hash === '#/animation';
const isQrDisplayWindow = (window as any).QR_DISPLAY_WINDOW === true;

console.log('[main.tsx] Hash:', hash, 'isAnimationWindow:', isAnimationWindow, 'isQrDisplayWindow:', isQrDisplayWindow);

try {
  const rootElement = document.getElementById("root");
  console.log('[main.tsx] Root element:', rootElement);
  
  if (!rootElement) {
    console.error('[main.tsx] Root element not found!');
  } else {
    ReactDOM.createRoot(rootElement as HTMLElement).render(
      <React.StrictMode>
        {isQrDisplayWindow ? <QrDisplayWindow /> : 
         isAnimationWindow ? <AnimationWindow /> : <App />}
      </React.StrictMode>,
    );
    console.log('[main.tsx] React app rendered');
  }
} catch (error) {
  console.error('[main.tsx] Error rendering app:', error);
}
