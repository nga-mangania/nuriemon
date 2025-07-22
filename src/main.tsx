import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AnimationWindow from "./windows/AnimationWindow";
import "./styles/reset.scss";

// URLのハッシュに基づいて適切なコンポーネントを表示
const hash = window.location.hash;
const isAnimationWindow = hash === '#/animation';

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isAnimationWindow ? <AnimationWindow /> : <App />}
  </React.StrictMode>,
);
