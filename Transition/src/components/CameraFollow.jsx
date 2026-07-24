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
    let xTo = null, yTo = null, sTo = null;
    let parked = false;
    let holdBase = null; // stage x/y while drifting around the modal's held zoom
    // Ownership changes (modal flight, doClose) kill our quickTo tweens on
    // the stage — a killed quickTo is dead forever. Track the mode and force
    // fresh quickTos (stage = null → bind() rebuilds) on every transition.
    let mode = "free";
    const setMode = (m) => {
      if (m === mode) return;
      mode = m;
      stage = null;
      holdBase = null;
    };

    // Cursor in the CONTENT → the camera visibly zooms IN and pans with it.
    // Cursor up on the header/chrome → it visibly zooms back OUT to rest.
    const ZOOM = 1.08;
    const PAN_X = 24, PAN_Y = 14; // stays well inside the 8% zoom slack

    // Any overlay that renders INSIDE the stage (kanban full view, dashboard
    // "show all", settings, …) positions itself with position:fixed — which a
    // transformed ancestor breaks (cut-off modals). So while such an overlay
    // is open, the camera PARKS: transform dropped entirely, native behaviour
    // restored; it resumes when the overlay closes.
    //
    // EXCEPTION — the task modal (html.wf-modal-open): its OWN camera drives
    // the stage (the zoom-to-card flight). We must neither park (that would
    // kill its tweens and erase the zoom-in) nor write — hands off entirely.
    const OVERLAYS = ".modal-overlay,.custom-modal-overlay,.settings-overlay,.announcement-overlay,.profile-popover-overlay,.notif-modal-overlay,.notes-fullscreen-overlay,.handbook-overlay";
    const modalOwnsStage = () => document.documentElement.classList.contains("wf-modal-open");
    const overlayOpen = () => !!document.querySelector(OVERLAYS);

    // .view-stage remounts on every view switch (key={currentView}) — rebind
    // the tweens whenever the node changes.
    const bind = () => {
      const el = document.querySelector(".view-stage");
      if (!el) return null;
      if (el !== stage) {
        stage = el;
        // NOTE: never set transformOrigin here — in hold mode the task
        // modal's card-centred origin must survive; in free mode the origin
        // is the (default/cleared) centre already.
        xTo = gsap.quickTo(stage, "x", { duration: 0.9, ease: "power2.out" });
        yTo = gsap.quickTo(stage, "y", { duration: 0.9, ease: "power2.out" });
        sTo = gsap.quickTo(stage, "scale", { duration: 0.7, ease: "power2.out" });
      }
      return stage;
    };

    const rest = () => {
      if (!stage) return;
      xTo(0); yTo(0); sTo(1);
    };

    const park = () => {
      const el = stage || document.querySelector(".view-stage");
      if (!parked && el) { gsap.killTweensOf(el); gsap.set(el, { clearProps: "transform" }); }
      parked = true;
    };

    // Park the INSTANT an overlay mounts — not on the next mousemove. (An
    // overlay opened via click, cursor then held still, must never sit over
    // a frozen mid-pan stage.) rAF-debounced; childList-only, so cheap.
    let moRaf = 0;
    const mo = new MutationObserver(() => {
      if (moRaf) return;
      moRaf = requestAnimationFrame(() => {
        moRaf = 0;
        if (!prefs.cameraFollow) return;
        if (modalOwnsStage()) return; // task modal's camera — hands off
        if (overlayOpen()) park();
        else parked = false; // camera resumes on the next mousemove
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });

    const onMove = (e) => {
      if (!prefs.cameraFollow) return;
      if (modalOwnsStage()) {
        // The modal camera owns scale/origin. Once its flight has settled,
        // keep the world alive behind the dim: a gentle PAN-ONLY drift
        // around the held state — never touching scale.
        setMode("hold");
        if (!bind()) return;
        if (!holdBase) {
          if (gsap.isTweening(stage)) return; // flight still in motion
          holdBase = {
            x: Number(gsap.getProperty(stage, "x")) || 0,
            y: Number(gsap.getProperty(stage, "y")) || 0,
          };
        }
        const hx = e.clientX / window.innerWidth - 0.5;
        const hy = e.clientY / window.innerHeight - 0.5;
        xTo(holdBase.x - hx * 8);
        yTo(holdBase.y - hy * 5);
        return;
      }
      if (overlayOpen()) { park(); setMode("off"); return; }
      setMode("free");
      parked = false;
      if (!bind()) return;
      // Where is the cursor: over the content stage, or up on the chrome?
      // (elementFromPoint is scroll- and sticky-proof; the robo layer and
      // other pointer-events:none layers are transparent to it.)
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const inContent = !!(under && under.closest(".view-stage"));
      if (inContent) {
        // Visible zoom IN, panning toward the cursor (scene slides opposite).
        sTo(ZOOM);
        const nx = e.clientX / window.innerWidth - 0.5;
        const ny = e.clientY / window.innerHeight - 0.5;
        xTo(-nx * PAN_X);
        yTo(-ny * PAN_Y);
      } else {
        // Header side — visible zoom back OUT to rest.
        sTo(1); xTo(0); yTo(0);
      }
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
      mo.disconnect();
      if (moRaf) cancelAnimationFrame(moRaf);
      if (stage) {
        gsap.killTweensOf(stage);
        gsap.set(stage, { clearProps: "transform" });
      }
    };
  }, []);

  return null;
}
