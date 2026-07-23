import { useEffect, useRef } from "react";
import { gsap } from "gsap";

/**
 * RoboHand — a little robotic arm that pops out of a nav button and REACHES
 * for the cursor while you hover it (base plate on the button, articulated
 * elbow, claw tracking the pointer with a soft lag). Retracts on leave.
 *
 * - Pure GSAP + one fixed SVG layer; pointer-events: none, so it never
 *   interferes with clicks.
 * - Attaches by delegation to every `.nav-btn`, present and future.
 * - Skipped entirely under prefers-reduced-motion.
 */
export default function RoboHand() {
  const svgRef = useRef(null);
  const upperRef = useRef(null);
  const lowerRef = useRef(null);
  const baseRef = useRef(null);
  const elbowRef = useRef(null);
  const clawRef = useRef(null);
  const prongTopRef = useRef(null);
  const prongBotRef = useRef(null);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
    const svg = svgRef.current, upper = upperRef.current, lower = lowerRef.current;
    const base = baseRef.current, elbow = elbowRef.current, claw = clawRef.current;
    const prongTop = prongTopRef.current, prongBot = prongBotRef.current;
    if (!svg || !upper || !lower || !claw) return;

    let current = null; // the hovered .nav-btn
    const anchor = { x: 0, y: 0 }; // arm base: randomized around the button
    const hand = { x: 0, y: 0 }; // smoothed claw position
    let bendSign = 1; // which way the elbow bows — randomized per reach
    let idleTl = null;

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
      // Claw rides the forearm's direction, palm just short of the cursor.
      const angle = (Math.atan2(hand.y - ey, hand.x - ex) * 180) / Math.PI;
      gsap.set(claw, { x: hand.x, y: hand.y, rotation: angle, svgOrigin: "0 0" });
    };

    const xTo = gsap.quickTo(hand, "x", { duration: 0.22, ease: "power3.out", onUpdate: render });
    const yTo = gsap.quickTo(hand, "y", { duration: 0.22, ease: "power3.out", onUpdate: render });

    const activate = (btn, e) => {
      current = btn;
      const r = btn.getBoundingClientRect();
      // No uniformity: the arm spawns from a RANDOM side of the button, at a
      // random point along it, and the elbow bows a random way each reach.
      const side = Math.floor(Math.random() * 4); // 0 top, 1 right, 2 bottom, 3 left
      const t = 0.15 + Math.random() * 0.7; // keep away from the sharp corners
      const OUT = 6;
      if (side === 0) { anchor.x = r.left + r.width * t; anchor.y = r.top - OUT; }
      else if (side === 1) { anchor.x = r.right + OUT; anchor.y = r.top + r.height * t; }
      else if (side === 2) { anchor.x = r.left + r.width * t; anchor.y = r.bottom + OUT; }
      else { anchor.x = r.left - OUT; anchor.y = r.top + r.height * t; }
      bendSign = Math.random() < 0.5 ? 1 : -1;
      // Hand starts tucked at the base, then reaches out to the cursor.
      hand.x = anchor.x; hand.y = anchor.y;
      render();
      gsap.killTweensOf(svg);
      gsap.to(svg, { autoAlpha: 1, duration: 0.12, ease: "power1.out" });
      gsap.fromTo(claw, { scale: 0 }, { scale: 1, duration: 0.3, ease: "back.out(2.2)" });
      xTo(e.clientX); yTo(e.clientY + 6);
      // Idle claw chatter: prongs open/close like it wants to pinch.
      idleTl = gsap.timeline({ repeat: -1, yoyo: true, defaults: { duration: 0.5, ease: "sine.inOut" } })
        .to(prongTop, { rotation: -9, transformOrigin: "left center" }, 0)
        .to(prongBot, { rotation: 9, transformOrigin: "left center" }, 0);
    };

    const deactivate = () => {
      current = null;
      if (idleTl) { idleTl.kill(); idleTl = null; }
      // Retract to the base, then blink out.
      xTo(anchor.x); yTo(anchor.y);
      gsap.to(svg, { autoAlpha: 0, duration: 0.18, ease: "power1.in", delay: 0.08 });
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
      xTo(e.clientX); yTo(e.clientY + 6);
    };

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("mousemove", onMove);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("mousemove", onMove);
      if (idleTl) idleTl.kill();
    };
  }, []);

  return (
    <svg ref={svgRef} className="robo-hand-layer" aria-hidden="true">
      {/* arm segments: shoulder→elbow→claw */}
      <line ref={upperRef} className="robo-arm-seg" />
      <line ref={lowerRef} className="robo-arm-seg" />
      <circle ref={baseRef} r="4.5" className="robo-joint" />
      <circle ref={elbowRef} r="3.2" className="robo-joint" />
      {/* claw, drawn pointing +x; rotated to the forearm's direction */}
      <g ref={clawRef} className="robo-claw">
        <rect x="-6" y="-5.5" width="9" height="11" rx="2.5" className="robo-palm" />
        <path ref={prongTopRef} d="M2 -3 Q9 -8 13 -6 Q10 -3.5 5 -0.5 Z" className="robo-prong" />
        <path ref={prongBotRef} d="M2 3 Q9 8 13 6 Q10 3.5 5 0.5 Z" className="robo-prong" />
        <circle cx="-1.5" cy="0" r="1.6" className="robo-palm-dot" />
      </g>
    </svg>
  );
}
