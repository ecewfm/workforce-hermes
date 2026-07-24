import { useEffect } from "react";
import { gsap } from "gsap";
import { getFxPrefs } from "../utils/fxPrefs";

/**
 * CameraFollow — YOUR VIEW pans toward the cursor, like a camera adjusting
 * its aim: the content stage is held at a whisper of extra zoom (the scene
 * is slightly larger than the window) and the "camera" looks around it —
 * content slides gently OPPOSITE the cursor, exactly how a real pan reads.
 * No 3D tilt, no perspective — a flat, smooth, weighty camera move.
 *
 * Deliberately scoped to .view-stage, NOT #root: transforming #root breaks
 * position:fixed for everything inside it (Caddy, overlays, the robo-hand
 * layer) and pulls the app's edges off the viewport. The header and nav
 * never move. The zoom cushion guarantees the stage's edges stay outside
 * the viewport even with the cursor in a corner.
 *
 * Pauses while a task modal is open (html.wf-modal-open) — the modal's own
 * camera owns the stage then. Toggleable in Settings; off for reduced motion.
 */
export default function CameraFollow() {
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;

    let prefs = getFxPrefs();
    let stage = null;
    let xTo = null, yTo = null;

    // The scene is 2.2% larger than the window; the camera pans inside that
    // slack (±14px x / ±7px y), so edges can never show.
    const CUSHION = 1.022;
    const PAN_X = 14, PAN_Y = 7;

    // .view-stage remounts on every view switch (key={currentView}) — rebind
    // the tweens whenever the node changes.
    const bind = () => {
      const el = document.querySelector(".view-stage");
      if (!el) return null;
      if (el !== stage) {
        stage = el;
        xTo = gsap.quickTo(stage, "x", { duration: 0.9, ease: "power2.out" });
        yTo = gsap.quickTo(stage, "y", { duration: 0.9, ease: "power2.out" });
      }
      return stage;
    };

    const rest = () => {
      if (!stage) return;
      xTo(0); yTo(0);
    };

    const onMove = (e) => {
      if (!prefs.cameraFollow) return;
      // Hands off while the task modal's own camera holds the stage.
      if (document.documentElement.classList.contains("wf-modal-open")) return;
      if (!bind()) return;
      // Re-apply the cushion after anything cleared it (modal clearProps).
      if ((Number(gsap.getProperty(stage, "scaleX")) || 1) < 1.005) gsap.set(stage, { scale: CUSHION, transformOrigin: "50% 50%" });
      const nx = e.clientX / window.innerWidth - 0.5;
      const ny = e.clientY / window.innerHeight - 0.5;
      // Camera pans TOWARD the cursor → the scene slides the opposite way.
      xTo(-nx * PAN_X);
      yTo(-ny * PAN_Y);
    };
    const onLeave = () => rest();
    const onPrefs = (e) => {
      prefs = e.detail;
      if (!prefs.cameraFollow && stage) {
        gsap.killTweensOf(stage);
        gsap.set(stage, { clearProps: "transform" });
      }
    };

    window.addEventListener("mousemove", onMove);
    document.documentElement.addEventListener("mouseleave", onLeave);
    window.addEventListener("wf-fx-prefs", onPrefs);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("wf-fx-prefs", onPrefs);
      if (stage) {
        gsap.killTweensOf(stage);
        gsap.set(stage, { clearProps: "transform" });
      }
    };
  }, []);

  return null;
}
