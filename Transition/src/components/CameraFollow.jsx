import { useEffect } from "react";
import { gsap } from "gsap";
import { getFxPrefs } from "../utils/fxPrefs";

/**
 * CameraFollow — the whole screen behaves like a camera that keeps trying
 * to point at the cursor: #root gently pans (x/y) and tilts (3D rotate
 * with perspective) toward wherever the pointer is, with a heavy smoothed
 * lag so it feels like an operator, not a strapped-on transform.
 *
 * - Rides #root, so it can NEVER fight the task-modal camera (which owns
 *   .view-stage) — the two compose visually.
 * - The task modal itself is portaled to <body>, outside #root: it stays
 *   rock-steady while the world sways behind its dim. Intentional.
 * - Toggleable in Settings (Motion & fun); off under reduced motion.
 */
export default function CameraFollow() {
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
    const root = document.getElementById("root");
    if (!root) return;

    let prefs = getFxPrefs();
    // Perspective on <body> gives the tilt real depth. Scale/translate-only
    // siblings (the portaled modal) render identically under it.
    gsap.set(document.body, { perspective: 1600 });
    gsap.set(root, { transformOrigin: "50% 50%" });
    const xTo = gsap.quickTo(root, "x", { duration: 0.8, ease: "power2.out" });
    const yTo = gsap.quickTo(root, "y", { duration: 0.8, ease: "power2.out" });
    const rxTo = gsap.quickTo(root, "rotationX", { duration: 0.9, ease: "power2.out" });
    const ryTo = gsap.quickTo(root, "rotationY", { duration: 0.9, ease: "power2.out" });

    const rest = () => {
      xTo(0); yTo(0); rxTo(0); ryTo(0);
    };
    const onMove = (e) => {
      if (!prefs.cameraFollow) return;
      const nx = e.clientX / window.innerWidth - 0.5;
      const ny = e.clientY / window.innerHeight - 0.5;
      // Pan toward the cursor + tilt the "camera" at it. Subtle by design.
      xTo(nx * 12); yTo(ny * 9);
      ryTo(nx * 2.4); rxTo(-ny * 1.9);
    };
    const onLeave = () => rest();
    const onPrefs = (e) => {
      prefs = e.detail;
      if (!prefs.cameraFollow) {
        gsap.killTweensOf(root);
        gsap.set(root, { clearProps: "transform" });
      }
    };

    window.addEventListener("mousemove", onMove);
    document.documentElement.addEventListener("mouseleave", onLeave);
    window.addEventListener("wf-fx-prefs", onPrefs);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("wf-fx-prefs", onPrefs);
      gsap.killTweensOf(root);
      gsap.set(root, { clearProps: "transform,transformOrigin" });
      gsap.set(document.body, { clearProps: "perspective" });
    };
  }, []);

  return null;
}
