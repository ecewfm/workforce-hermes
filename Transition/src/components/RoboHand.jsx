import { useEffect, useRef } from "react";
import { gsap } from "gsap";

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
  useEffect(() => {
    const grab = () => document.documentElement.classList.add("robo-grabbing");
    const release = () => document.documentElement.classList.remove("robo-grabbing");
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
    const pendingSpawns = [];

    // ── Arm factory: each arm owns its geometry, tweens and "chase brain".
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
        anchor: { x: 0, y: 0 },
        hand: { x: 0, y: 0 },
        shortfall: { v: 40 }, // how far it stays SHORT of the cursor
        bendSign: 1,
        lungeMin: 0.6, lungeVar: 1.0, // per-arm lunge cadence
        active: false,
        idleTl: null, grabTl: null, lungeCall: null,
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
        // Hand rotates around its own wrist: plain translate-then-rotate.
        const angle = (Math.atan2(st.hand.y - ey, st.hand.x - ex) * 180) / Math.PI;
        st.handG.setAttribute("transform", `translate(${st.hand.x} ${st.hand.y}) rotate(${angle})`);
      };
      st.xTo = gsap.quickTo(st.hand, "x", { duration: 0.28, ease: "power2.out", onUpdate: st.render });
      st.yTo = gsap.quickTo(st.hand, "y", { duration: 0.28, ease: "power2.out", onUpdate: st.render });

      // Aim SHORT of the cursor along the reach line — never past it, never
      // back behind the base.
      st.aim = () => {
        const dx = lastCursor.x - st.anchor.x, dy = lastCursor.y - st.anchor.y;
        const dist = Math.hypot(dx, dy) || 1;
        const reach = Math.max(dist - st.shortfall.v, Math.min(dist, 10));
        st.xTo(st.anchor.x + (dx / dist) * reach);
        st.yTo(st.anchor.y + (dy / dist) * reach);
      };

      // Lunge: strain almost to the cursor, snap a grab — MISS — fall back,
      // schedule the next hopeless attempt.
      st.scheduleLunge = () => {
        st.lungeCall = gsap.delayedCall(st.lungeMin + Math.random() * st.lungeVar, st.lunge);
      };
      st.lunge = () => {
        if (!st.active) return;
        gsap.to(st.shortfall, {
          v: 7, duration: 0.13, ease: "power2.in", onUpdate: st.aim,
          onComplete: () => {
            if (st.idleTl) st.idleTl.pause();
            const digits = [...st.fingers, ...(st.thumb ? [st.thumb] : [])];
            st.grabTl = gsap.timeline({ onComplete: () => { if (st.idleTl) st.idleTl.resume(); } });
            st.grabTl.to(digits, {
              rotation: (i, el) => (el === st.thumb ? "+=16" : "-=18"),
              duration: 0.09, stagger: 0.012, ease: "power2.in", yoyo: true, repeat: 1,
              transformOrigin: "left center",
            });
            gsap.to(st.shortfall, { v: st.restShort(), duration: 0.38, ease: "power2.out", onUpdate: st.aim, onComplete: st.scheduleLunge });
          },
        });
      };

      st.spawn = (btn, opts = {}) => {
        const r = btn.getBoundingClientRect();
        // RANDOM AREA: any side of the button, random point along it.
        const side = Math.floor(Math.random() * 4);
        const t = 0.12 + Math.random() * 0.76;
        const OUT = 5;
        if (side === 0) { st.anchor.x = r.left + r.width * t; st.anchor.y = r.top - OUT; }
        else if (side === 1) { st.anchor.x = r.right + OUT; st.anchor.y = r.top + r.height * t; }
        else if (side === 2) { st.anchor.x = r.left + r.width * t; st.anchor.y = r.bottom + OUT; }
        else { st.anchor.x = r.left - OUT; st.anchor.y = r.top + r.height * t; }
        st.bendSign = Math.random() < 0.5 ? 1 : -1;
        st.restShort = opts.restShort || (() => 26 + Math.random() * 14);
        st.lungeMin = opts.lungeMin ?? 0.6;
        st.lungeVar = opts.lungeVar ?? 1.0;
        st.shortfall.v = opts.startShort ?? 44;
        // NO fade: switch on collapsed at the base, then pure motion out.
        st.hand.x = st.anchor.x; st.hand.y = st.anchor.y;
        st.render();
        gsap.killTweensOf([st.g, st.inner, st.shortfall]);
        gsap.set(st.g, { display: "block", autoAlpha: 1 });
        gsap.fromTo(st.inner, { scale: 0, transformOrigin: "center center" }, { scale: 1, duration: 0.3, ease: "back.out(2)" });
        st.aim();
        st.idleTl = gsap.timeline({ repeat: -1, yoyo: true, defaults: { duration: 0.55, ease: "sine.inOut" } });
        st.fingers.forEach((f, i) => st.idleTl.to(f, { rotation: "-=6", transformOrigin: "left center" }, i * 0.07));
        if (st.thumb) st.idleTl.to(st.thumb, { rotation: "+=7", transformOrigin: "left center" }, 0.05);
        st.active = true;
        st.scheduleLunge();
      };

      st.retract = () => {
        if (!st.active) return;
        st.active = false;
        if (st.idleTl) { st.idleTl.kill(); st.idleTl = null; }
        if (st.grabTl) { st.grabTl.kill(); st.grabTl = null; }
        if (st.lungeCall) { st.lungeCall.kill(); st.lungeCall = null; }
        gsap.killTweensOf(st.shortfall);
        // NO fade: hand rides back into the base, tucks away, then off.
        st.xTo(st.anchor.x); st.yTo(st.anchor.y);
        gsap.to(st.inner, { scale: 0, duration: 0.16, ease: "back.in(1.8)", delay: 0.1 });
        gsap.set(st.g, { display: "none", delay: 0.3 });
      };

      st.destroy = () => {
        st.retract();
        gsap.killTweensOf([st.g, st.inner, st.shortfall, st.hand]);
        g.remove();
      };
      return st;
    };

    // Pool: one lead arm + up to two gatecrashers from other buttons.
    const arms = [makeArm(), makeArm(), makeArm()];

    const clearPendingSpawns = () => {
      pendingSpawns.forEach((c) => c.kill());
      pendingSpawns.length = 0;
    };

    const activate = (btn, e) => {
      hoveredBtn = btn;
      lastCursor.x = e.clientX; lastCursor.y = e.clientY;
      arms[0].spawn(btn);
      // MAXIMUM RANDOMNESS: 1–2 arms also burst out of OTHER nav buttons
      // (random ones, random delays) and reach across for the same cursor —
      // shyer (bigger shortfall) and lazier than the lead arm.
      const others = [...document.querySelectorAll(".nav-btn")].filter((b) => b !== btn);
      if (others.length) {
        const count = Math.random() < 0.45 ? 2 : 1;
        others.sort(() => Math.random() - 0.5);
        others.slice(0, count).forEach((other, i) => {
          const call = gsap.delayedCall(0.15 + Math.random() * 0.4, () => {
            if (hoveredBtn !== btn) return;
            arms[i + 1].spawn(other, {
              startShort: 90,
              restShort: () => 55 + Math.random() * 45,
              lungeMin: 1.0, lungeVar: 1.4,
            });
          });
          pendingSpawns.push(call);
        });
      }
    };

    const deactivate = () => {
      hoveredBtn = null;
      clearPendingSpawns();
      arms.forEach((a) => a.retract());
    };

    const onOver = (e) => {
      const btn = e.target.closest?.(".nav-btn");
      if (!btn || btn === hoveredBtn) return;
      if (hoveredBtn) deactivate();
      activate(btn, e);
    };
    const onOut = (e) => {
      if (!hoveredBtn) return;
      if (e.relatedTarget && hoveredBtn.contains(e.relatedTarget)) return;
      if (e.target.closest?.(".nav-btn") === hoveredBtn) deactivate();
    };
    const onMove = (e) => {
      if (!hoveredBtn) return;
      lastCursor.x = e.clientX; lastCursor.y = e.clientY;
      arms.forEach((a) => { if (a.active) a.aim(); });
    };

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("mousemove", onMove);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("mousemove", onMove);
      clearPendingSpawns();
      arms.forEach((a) => a.destroy());
    };
  }, []);

  return (
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
    </svg>
  );
}
