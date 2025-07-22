import AnimationPageSimple from "../components/AnimationPageSimple";
import "../styles/reset.scss";
import styles from "./AnimationWindow.module.scss";

function AnimationWindow() {
  return (
    <div className={styles.container}>
      <AnimationPageSimple />
    </div>
  );
}

export default AnimationWindow;