import { useEffect, useRef } from "react";
import { gsap } from "gsap";

/**
 * RoboHand — a realistic (vector) robotic hand that reaches out FROM BEHIND
 * the bottom of a nav button toward the cursor while you hover it: dark
 * gunmetal plates, five articulated fingers that idle-flex like they want to
 * grab the pointer, a mechanical forearm with elbow + shoulder joints.
 *
 * - Entry/exit is pure motion (no fades): the hand pushes out from under the
 *   button, and on leave it retracts down into the base and tucks away.
 * - Spawns at a random spot along the button's bottom edge with a random
 *   elbow bow each reach — no two reaches identical.
 * - One fixed SVG layer, pointer-events: none; skipped for reduced motion.
 */

// Finger layout: y offset on the palm edge, fan angle, length factor.
const FINGERS = [
  { y: -6.4, rot: -7, len: 1.0 },  // index
  { y: -2.2, rot: -1, len: 1.1 },  // middle
  { y: 2.2, rot: 4, len: 1.02 },   // ring
  { y: 6.4, rot: 10, len: 0.82 },  // pinky
];

export default function RoboHand() {
  const svgRef = useRef(null);
  const upperRef = useRef(null);
  const lowerRef = useRef(null);
  const baseRef = useRef(null);
  const elbowRef = useRef(null);
  const handRef = useRef(null); // outer: positioned + rotated along the arm
  const handInnerRef = useRef(null); // inner: pop in/out scale
  const fingerRefs = useRef([]);
  const thumbRef = useRef(null);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
    const svg = svgRef.current, upper = upperRef.current, lower = lowerRef.current;
    const base = baseRef.current, elbow = elbowRef.current;
    const handG = handRef.current, handInner = handInnerRef.current;
    const fingers = fingerRefs.current.filter(Boolean);
    const thumb = thumbRef.current;
    if (!svg || !upper || !lower || !handG || !handInner) return;

    let current = null; // the hovered .nav-btn
    const anchor = { x: 0, y: 0 }; // arm base: under the button's bottom edge
    const hand = { x: 0, y: 0 }; // smoothed wrist position
    const lastCursor = { x: 0, y: 0 };
    // It TRIES to catch the cursor but never does: the hand always stops
    // this many px short of the pointer. Lunges shrink it (almost!), then
    // it falls back and tries again.
    const shortfall = { v: 40 };
    let bendSign = 1; // which way the elbow bows — randomized per reach
    let idleTl = null;
    let grabTl = null;
    let lungeCall = null;

    // Draw the whole arm from the current smoothed state.
    const render = () => {
      const dx = hand.x - anchor.x, dy = hand.y - anchor.y;
      const dist = Math.hypot(dx, dy) || 1;
      // Fake articulation: the elbow sits at the midpoint, bulged out
      // perpendicular to the reach — bends more on longer reaches.
      const bend = Math.min(26, 6 + dist * 0.22) * bendSign;
      const ex = anchor.x + dx / 2 + (-dy / dist) * bend;
      const ey = anchor.y + dy / 2 + (dx / dist) * bend;
      upper.setAttribute("x1", anchor.x); upper.setAttribute("y1", anchor.y);
      upper.setAttribute("x2", ex); upper.setAttribute("y2", ey);
      lower.setAttribute("x1", ex); lower.setAttribute("y1", ey);
      lower.setAttribute("x2", hand.x); lower.setAttribute("y2", hand.y);
      base.setAttribute("cx", anchor.x); base.setAttribute("cy", anchor.y);
      elbow.setAttribute("cx", ex); elbow.setAttribute("cy", ey);
      // The hand rides the forearm's direction, rotating around its own
      // wrist (plain SVG transform: translate then rotate about local 0,0).
      const angle = (Math.atan2(hand.y - ey, hand.x - ex) * 180) / Math.PI;
      handG.setAttribute("transform", `translate(${hand.x} ${hand.y}) rotate(${angle})`);
    };

    const xTo = gsap.quickTo(hand, "x", { duration: 0.28, ease: "power2.out", onUpdate: render });
    const yTo = gsap.quickTo(hand, "y", { duration: 0.28, ease: "power2.out", onUpdate: render });

    // Aim the hand at a point SHORT of the cursor, along the reach line —
    // never past it, never back behind the base.
    const aim = () => {
      const dx = lastCursor.x - anchor.x, dy = lastCursor.y - anchor.y;
      const dist = Math.hypot(dx, dy) || 1;
      const reach = Math.max(dist - shortfall.v, Math.min(dist, 10));
      xTo(anchor.x + (dx / dist) * reach);
      yTo(anchor.y + (dy / dist) * reach);
    };

    // A lunge: strain almost to the cursor, snap a grab — and MISS — then
    // fall back to a (randomized) respectful distance and schedule the next
    // attempt. Endless, hopeless, adorable.
    const scheduleLunge = () => {
      lungeCall = gsap.delayedCall(0.6 + Math.random(), lunge);
    };
    const lunge = () => {
      if (!current) return;
      gsap.to(shortfall, {
        v: 7, duration: 0.13, ease: "power2.in", onUpdate: aim,
        onComplete: () => {
          if (idleTl) idleTl.pause();
          const digits = [...fingers, ...(thumb ? [thumb] : [])];
          grabTl = gsap.timeline({ onComplete: () => { if (idleTl) idleTl.resume(); } });
          grabTl.to(digits, {
            rotation: (i, el) => (el === thumb ? "+=16" : "-=18"),
            duration: 0.09, stagger: 0.012, ease: "power2.in", yoyo: true, repeat: 1,
            transformOrigin: "left center",
          });
          gsap.to(shortfall, { v: 26 + Math.random() * 14, duration: 0.38, ease: "power2.out", onUpdate: aim, onComplete: scheduleLunge });
        },
      });
    };

    const activate = (btn, e) => {
      current = btn;
      const r = btn.getBoundingClientRect();
      // The arm comes FROM BEHIND THE BOTTOM of the button — anchored just
      // under its bottom edge. Variety without uniformity: a random spot
      // along that edge and a random elbow bow, every reach.
      const t = 0.12 + Math.random() * 0.76;
      anchor.x = r.left + r.width * t;
      anchor.y = r.bottom + 4;
      bendSign = Math.random() < 0.5 ? 1 : -1;
      // NO fade-in: the layer switches on with everything collapsed at the
      // base, and the ENTRY is pure motion — the hand pushes out from under
      // the button and the arm extends up to the cursor.
      hand.x = anchor.x; hand.y = anchor.y;
      render();
      gsap.killTweensOf([svg, handInner, shortfall]);
      gsap.set(svg, { autoAlpha: 1 });
      gsap.fromTo(handInner, { scale: 0, transformOrigin: "center center" }, { scale: 1, duration: 0.3, ease: "back.out(2)" });
      lastCursor.x = e.clientX; lastCursor.y = e.clientY;
      shortfall.v = 44; // approach cautiously…
      aim();
      // Idle: fingers flex in a slow stagger, like it wants to grab the
      // cursor; the thumb answers from below.
      idleTl = gsap.timeline({ repeat: -1, yoyo: true, defaults: { duration: 0.55, ease: "sine.inOut" } });
      fingers.forEach((f, i) => idleTl.to(f, { rotation: "-=6", transformOrigin: "left center" }, i * 0.07));
      if (thumb) idleTl.to(thumb, { rotation: "+=7", transformOrigin: "left center" }, 0.05);
      scheduleLunge(); // …then start trying (and failing) to catch it
    };

    const deactivate = () => {
      current = null;
      if (idleTl) { idleTl.kill(); idleTl = null; }
      if (grabTl) { grabTl.kill(); grabTl = null; }
      if (lungeCall) { lungeCall.kill(); lungeCall = null; }
      gsap.killTweensOf(shortfall);
      // NO fade-out either: the arm RETRACTS — the hand travels back down
      // into the base, tucks itself away, and only once everything has
      // collapsed behind the button's bottom does the layer switch off.
      xTo(anchor.x); yTo(anchor.y);
      gsap.to(handInner, { scale: 0, duration: 0.16, ease: "back.in(1.8)", delay: 0.1 });
      gsap.set(svg, { autoAlpha: 0, delay: 0.3 });
    };

    const onOver = (e) => {
      const btn = e.target.closest?.(".nav-btn");
      if (!btn || btn === current) return;
      activate(btn, e);
    };
    const onOut = (e) => {
      if (!current) return;
      if (e.relatedTarget && current.contains(e.relatedTarget)) return;
      if (e.target.closest?.(".nav-btn") === current) deactivate();
    };
    const onMove = (e) => {
      if (!current) return;
      lastCursor.x = e.clientX; lastCursor.y = e.clientY;
      aim();
    };

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("mousemove", onMove);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("mousemove", onMove);
      if (idleTl) idleTl.kill();
      if (grabTl) grabTl.kill();
      if (lungeCall) lungeCall.kill();
      gsap.killTweensOf(shortfall);
    };
  }, []);

  return (
    <svg ref={svgRef} className="robo-hand-layer" aria-hidden="true">
      <defs>
        {/* gunmetal shading, top-lit like the reference */}
        <linearGradient id="rh-metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a5468" />
          <stop offset="0.45" stopColor="#2b3342" />
          <stop offset="1" stopColor="#141a24" />
        </linearGradient>
        <linearGradient id="rh-plate" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#39424f" />
          <stop offset="1" stopColor="#0e1219" />
        </linearGradient>
      </defs>

      {/* mechanical arm: shoulder → elbow → wrist */}
      <line ref={upperRef} className="robo-arm-seg" strokeWidth="6.5" />
      <line ref={lowerRef} className="robo-arm-seg" strokeWidth="5" />
      <circle ref={baseRef} r="5.5" className="robo-joint" />
      <circle ref={elbowRef} r="4" className="robo-joint" />

      {/* the hand, drawn pointing +x; outer g follows the forearm each frame,
          inner g handles the pop in/out */}
      <g ref={handRef}>
        <g ref={handInnerRef} className="robo-hand">
          {/* wrist collar + forearm cuff */}
          <rect x="-16" y="-6" width="7" height="12" rx="2.5" fill="url(#rh-metal)" stroke="#0a0d12" strokeWidth="0.8" />
          <rect x="-10" y="-7" width="3.6" height="14" rx="1.4" fill="#10151d" stroke="#0a0d12" strokeWidth="0.6" />
          {/* palm: rounded plate, knuckle ridge at the finger edge */}
          <path
            d="M-6.5 -8.2 L7.5 -7.2 Q11 -6.8 11 -4.2 L11 4.2 Q11 6.8 7.5 7.2 L-6.5 8.2 Q-9.8 8 -9.8 5 L-9.8 -5 Q-9.8 -8 -6.5 -8.2 Z"
            fill="url(#rh-plate)" stroke="#0a0d12" strokeWidth="0.9"
          />
          <rect x="7.2" y="-6.8" width="3.6" height="13.6" rx="1.6" fill="url(#rh-metal)" stroke="#0a0d12" strokeWidth="0.6" />
          {/* back-of-hand vents + sensor LED (accent-coloured) */}
          <rect x="-4.5" y="-4.6" width="8" height="1.4" rx="0.7" fill="#0d1117" />
          <rect x="-4.5" y="-1.6" width="8" height="1.4" rx="0.7" fill="#0d1117" />
          <rect x="-4.5" y="1.4" width="8" height="1.4" rx="0.7" fill="#0d1117" />
          <circle cx="-6.8" cy="5" r="1.7" className="rh-led" />
          {/* four articulated fingers, fanned; each flexes at its knuckle */}
          {FINGERS.map((f, i) => (
            <g key={i} ref={(el) => { fingerRefs.current[i] = el; }} transform={`translate(10.5 ${f.y}) rotate(${f.rot})`}>
              <rect x="0" y="-2" width={7.4 * f.len} height="4" rx="1.7" fill="url(#rh-metal)" stroke="#0a0d12" strokeWidth="0.7" />
              <rect x={7.9 * f.len} y="-1.8" width={5.6 * f.len} height="3.6" rx="1.5" fill="url(#rh-metal)" stroke="#0a0d12" strokeWidth="0.7" />
              <rect x={13.9 * f.len} y="-1.6" width={4 * f.len} height="3.2" rx="1.5" fill="#1a212c" stroke="#0a0d12" strokeWidth="0.7" />
            </g>
          ))}
          {/* thumb, reaching from the palm's lower edge */}
          <g ref={thumbRef} transform="translate(2 7.6) rotate(42)">
            <rect x="0" y="-2" width="6.4" height="4" rx="1.8" fill="url(#rh-metal)" stroke="#0a0d12" strokeWidth="0.7" />
            <rect x="6.9" y="-1.7" width="4.6" height="3.4" rx="1.6" fill="#1a212c" stroke="#0a0d12" strokeWidth="0.7" />
          </g>
        </g>
      </g>
    </svg>
  );
}
