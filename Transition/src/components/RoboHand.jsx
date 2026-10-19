import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { gsap } from "gsap";
import { getFxPrefs, applyFxClasses } from "../utils/fxPrefs";

/**
 * RoboHand — GREEN robotic arms that reach for the cursor when you hover a
 * nav button. The hovered button's arm leads, and to maximize randomness,
 * 1–2 arms ALSO burst out of other random nav buttons and reach across.
 * They all TRY to catch the cursor and never quite do: each stops short,
 * periodically lunges, snaps a grab just before touching — and misses.
 *
 * - Every spawn is randomized: which side of the button the arm comes from,
 *   where along that side, which way the elbow bows, how shy the reach is.
 * - Entry/exit is pure motion (no fades): hands push out from behind the
 *   button edge and retract back into it before the arm switches off.
 * - One fixed SVG layer, pointer-events: none; skipped for reduced motion.
 */

// The hand, drawn pointing +x (wrist at local 0,0) — green prosthetic
// styling. Cloned per arm; fingers/thumb are class-tagged for animation.
const HAND_MARKUP = `
  <g class="rh-inner">
    <rect x="-16" y="-6" width="7" height="12" rx="2.5" fill="url(#rh-metal)" stroke="#043326" stroke-width="0.8"/>
    <rect x="-10" y="-7" width="3.6" height="14" rx="1.4" fill="#065f46" stroke="#043326" stroke-width="0.6"/>
    <path d="M-6.5 -8.2 L7.5 -7.2 Q11 -6.8 11 -4.2 L11 4.2 Q11 6.8 7.5 7.2 L-6.5 8.2 Q-9.8 8 -9.8 5 L-9.8 -5 Q-9.8 -8 -6.5 -8.2 Z" fill="url(#rh-plate)" stroke="#043326" stroke-width="0.9"/>
    <rect x="7.2" y="-6.8" width="3.6" height="13.6" rx="1.6" fill="url(#rh-metal)" stroke="#043326" stroke-width="0.6"/>
    <rect x="-4.5" y="-4.6" width="8" height="1.4" rx="0.7" fill="#064e3b"/>
    <rect x="-4.5" y="-1.6" width="8" height="1.4" rx="0.7" fill="#064e3b"/>
    <rect x="-4.5" y="1.4" width="8" height="1.4" rx="0.7" fill="#064e3b"/>
    <circle cx="-6.8" cy="5" r="1.7" class="rh-led"/>
    <g class="rh-finger" transform="translate(10.5 -6.4) rotate(-7)">
      <rect x="0" y="-2" width="7.4" height="4" rx="1.7" fill="url(#rh-metal)" stroke="#043326" stroke-width="0.7"/>
      <rect x="7.9" y="-1.8" width="5.6" height="3.6" rx="1.5" fill="url(#rh-metal)" stroke="#043326" stroke-width="0.7"/>
      <rect x="13.9" y="-1.6" width="4" height="3.2" rx="1.5" fill="#065f46" stroke="#043326" stroke-width="0.7"/>
    </g>
    <g class="rh-finger" transform="translate(10.5 -2.2) rotate(-1)">
      <rect x="0" y="-2" width="8.1" height="4" rx="1.7" fill="url(#rh-metal)" stroke="#043326" stroke-width="0.7"/>
      <rect x="8.7" y="-1.8" width="6.2" height="3.6" rx="1.5" fill="url(#rh-metal)" stroke="#043326" stroke-width="0.7"/>
      <rect x="15.3" y="-1.6" width="4.4" height="3.2" rx="1.5" fill="#065f46" stroke="#043326" stroke-width="0.7"/>
    </g>
    <g class="rh-finger" transform="translate(10.5 2.2) rotate(4)">
      <rect x="0" y="-2" width="7.5" height="4" rx="1.7" fill="url(#rh-metal)" stroke="#043326" stroke-width="0.7"/>
      <rect x="8.1" y="-1.8" width="5.7" height="3.6" rx="1.5" fill="url(#rh-metal)" stroke="#043326" stroke-width="0.7"/>
      <rect x="14.2" y="-1.6" width="4.1" height="3.2" rx="1.5" fill="#065f46" stroke="#043326" stroke-width="0.7"/>
    </g>
    <g class="rh-finger" transform="translate(10.5 6.4) rotate(10)">
      <rect x="0" y="-2" width="6.1" height="4" rx="1.7" fill="url(#rh-metal)" stroke="#043326" stroke-width="0.7"/>
      <rect x="6.5" y="-1.8" width="4.6" height="3.6" rx="1.5" fill="url(#rh-metal)" stroke="#043326" stroke-width="0.7"/>
      <rect x="11.4" y="-1.6" width="3.3" height="3.2" rx="1.5" fill="#065f46" stroke="#043326" stroke-width="0.7"/>
    </g>
    <g class="rh-thumb" transform="translate(2 7.6) rotate(42)">
      <rect x="0" y="-2" width="6.4" height="4" rx="1.8" fill="url(#rh-metal)" stroke="#043326" stroke-width="0.7"/>
      <rect x="6.9" y="-1.7" width="4.6" height="3.4" rx="1.6" fill="#065f46" stroke="#043326" stroke-width="0.7"/>
    </g>
  </g>`;

const ARM_MARKUP = `
  <line class="robo-arm-seg" stroke-width="6.5"/>
  <line class="robo-arm-seg" stroke-width="5"/>
  <circle class="robo-joint" r="5.5"/>
  <circle class="robo-joint" r="4"/>
  <g class="rh-hand">${HAND_MARKUP}</g>`;

const SVG_NS = "http://www.w3.org/2000/svg";

export default function RoboHand() {
  const svgRef = useRef(null);

  // Cursor grip: the app-wide robo-hand cursor (index.css) closes into a
  // fist while the mouse button is held. Not motion — runs regardless of
  // prefers-reduced-motion.
  // Bootstrap the fx classes (robo cursor on/off) from saved prefs.
  useEffect(() => { applyFxClasses(); }, []);

  // The fist is shown by marking ONLY the pressed element (.robo-fist): a
  // browser shows the cursor of the element under the pointer, so that's all
  // it takes. (A class on <html> restyled every element on the page twice
  // per click — a 20–35ms stall on each press and release.)
  useEffect(() => {
    let held = null;
    const release = () => { held?.classList.remove("robo-fist"); held = null; };
    const grab = (e) => {
      release();
      if (!document.documentElement.classList.contains("fx-robo-cursor")) return;
      held = e.target instanceof Element ? e.target : null;
      held?.classList.add("robo-fist");
    };
    document.addEventListener("pointerdown", grab);
    document.addEventListener("pointerup", release);
    document.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    return () => {
      document.removeEventListener("pointerdown", grab);
      document.removeEventListener("pointerup", release);
      document.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
      release();
    };
  }, []);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
    const svg = svgRef.current;
    if (!svg) return;

    const lastCursor = { x: 0, y: 0 };
    let hoveredBtn = null;
    let prefs = getFxPrefs();

    // ── Arm factory: each arm owns its geometry, tweens and "chase brain".
    // Motion model: every frame the hand eases toward a GOAL point (no
    // competing tweens on its position — that's what used to make it jump),
    // the base re-reads its button so it stays attached, and the hand's
    // angle turns smoothly instead of snapping.
    const makeArm = () => {
      const g = document.createElementNS(SVG_NS, "g");
      g.setAttribute("style", "display:none");
      g.innerHTML = ARM_MARKUP;
      svg.appendChild(g);
      const lines = g.querySelectorAll("line");
      const joints = g.querySelectorAll("circle.robo-joint");
      const st = {
        g,
        upper: lines[0], lower: lines[1],
        base: joints[0], elbow: joints[1],
        handG: g.querySelector(".rh-hand"),
        inner: g.querySelector(".rh-inner"),
        fingers: [...g.querySelectorAll(".rh-finger")],
        thumb: g.querySelector(".rh-thumb"),
        source: null, side: 0, along: 0.5,
        anchor: { x: 0, y: 0 },
        hand: { x: 0, y: 0 },
        angle: 0,
        outDir: [0, -1],
        mode: "off", // emerge → chase → retract → off
        modeAt: 0,
        emergeReach: 26,
        shortfall: { v: 40 }, // how far it stays SHORT of the cursor
        bendSign: 1,
        lungeMin: 0.6, lungeVar: 1.0, // per-arm lunge cadence
        active: false,
        idleTl: null, grabTl: null, lungeCall: null,
      };
      const digitEls = [...st.fingers, ...(st.thumb ? [st.thumb] : [])];
      const digitRest = digitEls.map((d) => gsap.getProperty(d, "rotation"));

      // Base point on the source button's edge (re-read every frame).
      const OUT = 5;
      st.readAnchor = () => {
        if (!st.source?.isConnected) return;
        const r = st.source.getBoundingClientRect();
        const t = st.along;
        if (st.side === 0) { st.anchor.x = r.left + r.width * t; st.anchor.y = r.top - OUT; }
        else if (st.side === 1) { st.anchor.x = r.right + OUT; st.anchor.y = r.top + r.height * t; }
        else if (st.side === 2) { st.anchor.x = r.left + r.width * t; st.anchor.y = r.bottom + OUT; }
        else { st.anchor.x = r.left - OUT; st.anchor.y = r.top + r.height * t; }
      };

      // Where the hand wants to be right now.
      st.goal = () => {
        if (st.mode === "emerge") {
          return { x: st.anchor.x + st.outDir[0] * st.emergeReach, y: st.anchor.y + st.outDir[1] * st.emergeReach };
        }
        if (st.mode === "chase") {
          // SHORT of the cursor along the reach line — never past it, never behind the base.
          const dx = lastCursor.x - st.anchor.x, dy = lastCursor.y - st.anchor.y;
          const dist = Math.hypot(dx, dy) || 1;
          const reach = Math.max(dist - st.shortfall.v, Math.min(dist, 10));
          return { x: st.anchor.x + (dx / dist) * reach, y: st.anchor.y + (dy / dist) * reach };
        }
        return { x: st.anchor.x, y: st.anchor.y }; // retract
      };

      st.render = () => {
        const dx = st.hand.x - st.anchor.x, dy = st.hand.y - st.anchor.y;
        const dist = Math.hypot(dx, dy) || 1;
        const bend = Math.min(26, 6 + dist * 0.22) * st.bendSign;
        const ex = st.anchor.x + dx / 2 + (-dy / dist) * bend;
        const ey = st.anchor.y + dy / 2 + (dx / dist) * bend;
        st.upper.setAttribute("x1", st.anchor.x); st.upper.setAttribute("y1", st.anchor.y);
        st.upper.setAttribute("x2", ex); st.upper.setAttribute("y2", ey);
        st.lower.setAttribute("x1", ex); st.lower.setAttribute("y1", ey);
        st.lower.setAttribute("x2", st.hand.x); st.lower.setAttribute("y2", st.hand.y);
        st.base.setAttribute("cx", st.anchor.x); st.base.setAttribute("cy", st.anchor.y);
        st.elbow.setAttribute("cx", ex); st.elbow.setAttribute("cy", ey);
        st.handG.setAttribute("transform", `translate(${st.hand.x} ${st.hand.y}) rotate(${st.angle})`);
        return { ex, ey, dist };
      };

      // One step per display frame (dt in seconds).
      st.step = (dt) => {
        st.readAnchor();
        const goal = st.goal();
        // Exponential ease toward the goal — frame-rate independent.
        const k = st.mode === "retract" ? 16 : st.mode === "emerge" ? 11 : 13;
        const a = 1 - Math.exp(-k * dt);
        st.hand.x += (goal.x - st.hand.x) * a;
        st.hand.y += (goal.y - st.hand.y) * a;
        const dx = st.hand.x - st.anchor.x, dy = st.hand.y - st.anchor.y;
        const dist = Math.hypot(dx, dy);
        // Hand angle: along the forearm once it's out; the push-out direction
        // while it's still close to the base (where the forearm angle is noise).
        const bend = Math.min(26, 6 + dist * 0.22) * st.bendSign;
        const ex = st.anchor.x + dx / 2 + (-dy / (dist || 1)) * bend;
        const ey = st.anchor.y + dy / 2 + (dx / (dist || 1)) * bend;
        const want = dist < 16
          ? (Math.atan2(st.outDir[1], st.outDir[0]) * 180) / Math.PI
          : (Math.atan2(st.hand.y - ey, st.hand.x - ex) * 180) / Math.PI;
        let da = ((want - st.angle + 540) % 360) - 180; // shortest turn
        st.angle += da * (1 - Math.exp(-14 * dt));
        st.render();
        if (st.mode === "emerge" && performance.now() - st.modeAt > 380) { st.mode = "chase"; st.modeAt = performance.now(); }
        if (st.mode === "retract" && dist < 1.5 && performance.now() - st.modeAt > 260) {
          st.mode = "off";
          st.g.style.display = "none";
        }
      };

      // Lunge: strain almost to the cursor, snap a grab — MISS — fall back,
      // schedule the next hopeless attempt.
      st.scheduleLunge = () => {
        st.lungeCall = gsap.delayedCall(st.lungeMin + Math.random() * st.lungeVar, st.lunge);
      };
      st.lunge = () => {
        if (!st.active) return;
        if (st.mode !== "chase") { st.scheduleLunge(); return; }
        gsap.to(st.shortfall, {
          v: 7, duration: 0.16, ease: "power2.in",
          onComplete: () => {
            if (!st.active) return;
            if (st.idleTl) st.idleTl.pause();
            const digits = [...st.fingers, ...(st.thumb ? [st.thumb] : [])];
            st.grabTl = gsap.timeline({ onComplete: () => { if (st.idleTl) st.idleTl.resume(); } });
            st.grabTl.to(digits, {
              rotation: (i, el) => (el === st.thumb ? "+=16" : "-=18"),
              duration: 0.09, stagger: 0.012, ease: "power2.in", yoyo: true, repeat: 1,
              transformOrigin: "left center",
            });
            gsap.to(st.shortfall, { v: st.restShort(), duration: 0.42, ease: "power2.out", onComplete: st.scheduleLunge });
          },
        });
      };

      st.spawn = (btn, opts = {}) => {
        // RANDOM AREA: any side of the button, random point along it.
        st.source = btn;
        st.side = Math.floor(Math.random() * 4);
        st.along = 0.12 + Math.random() * 0.76;
        st.readAnchor();
        st.outDir = [[0, -1], [1, 0], [0, 1], [-1, 0]][st.side]; // away from the button
        st.bendSign = Math.random() < 0.5 ? 1 : -1;
        st.restShort = opts.restShort || (() => 26 + Math.random() * 14);
        st.lungeMin = opts.lungeMin ?? 0.6;
        st.lungeVar = opts.lungeVar ?? 1.0;
        st.emergeReach = 20 + Math.random() * 12;
        killDigits();
        gsap.killTweensOf([st.inner, st.shortfall]);
        st.shortfall.v = opts.startShort ?? 44;
        // NO fade: switch on collapsed at the base, then pure motion out.
        st.hand.x = st.anchor.x; st.hand.y = st.anchor.y;
        st.angle = (Math.atan2(st.outDir[1], st.outDir[0]) * 180) / Math.PI;
        st.render();
        st.g.style.display = "block";
        gsap.set(st.inner, { scale: 0, transformOrigin: "center center" });
        // Phase 1 — CLIMB OUT: the hand squeezes out from behind the button
        // edge (scaling up as it pushes through) and crawls outward; then it
        // starts chasing the cursor.
        gsap.to(st.inner, { scale: 1, duration: 0.34, ease: "back.out(1.6)" });
        st.mode = "emerge";
        st.modeAt = performance.now();
        st.idleTl = gsap.timeline({ repeat: -1, yoyo: true, defaults: { duration: 0.55, ease: "sine.inOut" } });
        st.fingers.forEach((f, i) => st.idleTl.to(f, { rotation: "-=6", transformOrigin: "left center" }, i * 0.07));
        if (st.thumb) st.idleTl.to(st.thumb, { rotation: "+=7", transformOrigin: "left center" }, 0.05);
        st.active = true;
        st.scheduleLunge();
        startLoop();
      };

      // Fingers back to their drawn pose (idle/grab tweens are relative).
      const killDigits = () => {
        if (st.idleTl) { st.idleTl.kill(); st.idleTl = null; }
        if (st.grabTl) { st.grabTl.kill(); st.grabTl = null; }
        if (st.lungeCall) { st.lungeCall.kill(); st.lungeCall = null; }
        gsap.killTweensOf(digitEls);
        digitEls.forEach((d, i) => gsap.set(d, { rotation: digitRest[i], transformOrigin: "left center" }));
      };

      st.retract = () => {
        if (!st.active) return;
        st.active = false;
        killDigits();
        gsap.killTweensOf(st.shortfall);
        // NO fade: hand rides back into the base, tucks away, then off.
        st.mode = "retract";
        st.modeAt = performance.now();
        gsap.to(st.inner, { scale: 0, duration: 0.16, ease: "back.in(1.8)", delay: 0.08 });
      };

      st.destroy = () => {
        st.retract();
        gsap.killTweensOf([st.inner, st.shortfall]);
        g.remove();
      };
      return st;
    };

    // ONE arm only. (Randomness lives in where it spawns and how it moves,
    // not in how many there are.)
    const arms = [makeArm()];

    // A single rAF loop drives every visible arm; it stops when all are off.
    let loopRaf = 0;
    let lastT = 0;
    const loop = (now) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - (lastT || now)) / 1000 || 0.016));
      lastT = now;
      let any = false;
      for (const a of arms) if (a.mode !== "off") { a.step(dt); any = true; }
      loopRaf = any ? requestAnimationFrame(loop) : 0;
      if (!any) lastT = 0;
    };
    const startLoop = () => { if (!loopRaf) loopRaf = requestAnimationFrame(loop); };

    // The arm only chases while the pointer is ON the nav buttons. Crossing
    // the small gap between two buttons keeps it (no tear-down + re-grow
    // somewhere else — that was the "glitchy" teleport); leaving the button
    // row sends it straight back in.
    let leaveTimer = 0;
    const navZone = () => {
      const rs = [...document.querySelectorAll(".nav-btn")].map((b) => b.getBoundingClientRect()).filter((r) => r.width);
      if (!rs.length) return null;
      return {
        left: Math.min(...rs.map((r) => r.left)) - 4, right: Math.max(...rs.map((r) => r.right)) + 4,
        top: Math.min(...rs.map((r) => r.top)) - 4, bottom: Math.max(...rs.map((r) => r.bottom)) + 4,
      };
    };
    const inZone = (x, y) => { const z = navZone(); return !!z && x >= z.left && x <= z.right && y >= z.top && y <= z.bottom; };
    const activate = (btn, e) => {
      clearTimeout(leaveTimer);
      leaveTimer = 0;
      hoveredBtn = btn;
      lastCursor.x = e.clientX; lastCursor.y = e.clientY;
      if (arms[0].active) return; // already reaching — carry on
      // The arm comes from a DIFFERENT button than the hovered one, reaching
      // across the nav for your cursor — the button you're on never looks
      // like it's breaking open. (Falls back to itself only if it's alone.)
      const others = [...document.querySelectorAll(".nav-btn")].filter((b) => b !== btn && b.isConnected);
      const source = others.length ? others[Math.floor(Math.random() * others.length)] : btn;
      arms[0].spawn(source);
    };

    const deactivate = () => {
      clearTimeout(leaveTimer);
      leaveTimer = 0;
      hoveredBtn = null;
      arms.forEach((a) => a.retract());
    };
    // In a gap between buttons: give it a moment (an existing countdown isn't restarted).
    const deactivateSoon = () => {
      if (!leaveTimer) leaveTimer = setTimeout(() => { leaveTimer = 0; deactivate(); }, 260);
    };
    const keep = () => { clearTimeout(leaveTimer); leaveTimer = 0; };

    const onOver = (e) => {
      if (!prefs.roboArms) return; // toggled off in Settings
      const btn = e.target.closest?.(".nav-btn");
      if (!btn) return;
      if (btn === hoveredBtn) { keep(); return; }
      activate(btn, e);
    };
    const onOut = (e) => {
      if (!hoveredBtn) return;
      if (e.relatedTarget && hoveredBtn.contains(e.relatedTarget)) return;
      if (e.target.closest?.(".nav-btn") === hoveredBtn) {
        // Straight onto another nav button: handled by onOver. A gap in the
        // button row: after a beat. Anywhere else: right away.
        if (e.relatedTarget?.closest?.(".nav-btn")) return;
        if (inZone(e.clientX, e.clientY)) deactivateSoon();
        else deactivate();
      }
    };
    // rAF-gated: high-polling mice fire mousemove hundreds of times per
    // second — process at most one per display frame.
    let pendingMove = null;
    let moveRaf = 0;
    const processMove = () => {
      moveRaf = 0;
      const e = pendingMove;
      pendingMove = null;
      if (!e || !hoveredBtn) return;
      // Watchdog: if a mouseout was ever missed (portal churn, alt-tab),
      // never leave a hand stranded on screen.
      if (!hoveredBtn.isConnected) { deactivate(); return; }
      if (e.target?.closest?.(".nav-btn")) keep();
      else if (inZone(e.clientX, e.clientY)) deactivateSoon();
      else { deactivate(); return; } // off the buttons: stop chasing
      lastCursor.x = e.clientX; lastCursor.y = e.clientY;
    };
    const onMove = (e) => {
      if (!hoveredBtn) return;
      pendingMove = e;
      if (!moveRaf) moveRaf = requestAnimationFrame(processMove);
    };
    const onWindowBlur = () => { if (hoveredBtn) deactivate(); };

    const onPrefs = (e) => {
      prefs = e.detail;
      if (!prefs.roboArms && hoveredBtn) deactivate();
    };

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("mousemove", onMove);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("wf-fx-prefs", onPrefs);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("mousemove", onMove);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("wf-fx-prefs", onPrefs);
      clearTimeout(leaveTimer);
      leaveTimer = 0;
      if (moveRaf) cancelAnimationFrame(moveRaf);
      if (loopRaf) cancelAnimationFrame(loopRaf);
      arms.forEach((a) => a.destroy());
    };
  }, []);

  // Portaled to <body>: the layer must never sit inside a transformed
  // ancestor (the cursor-camera transforms .view-stage) — a transform breaks
  // position:fixed and the layer would scroll/drift with the page.
  return createPortal(
    <svg ref={svgRef} className="robo-hand-layer" aria-hidden="true">
      <defs>
        {/* emerald metal, top-lit */}
        <linearGradient id="rh-metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6ee7b7" />
          <stop offset="0.45" stopColor="#10b981" />
          <stop offset="1" stopColor="#047857" />
        </linearGradient>
        <linearGradient id="rh-plate" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#34d399" />
          <stop offset="1" stopColor="#065f46" />
        </linearGradient>
      </defs>
    </svg>,
    document.body
  );
}
