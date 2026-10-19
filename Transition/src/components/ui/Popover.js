// Shared bits for the app's own dropdowns and calendars (no browser pickers).
import { useEffect, useLayoutEffect, useState } from "react";

export const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

/**
 * Where to put a popover for a trigger: below it (or above when there's no
 * room), never past the window edges. Re-measures on scroll/resize while open.
 */
export function useAnchoredPosition(open, anchorRef, popRef, { width = null, gap = 6 } = {}) {
  const [pos, setPos] = useState(null);
  const measure = () => {
    const a = anchorRef.current;
    if (!a) return;
    const r = a.getBoundingClientRect();
    const p = popRef.current;
    const ph = p ? p.offsetHeight : 260;
    const pw = Math.max(width || 0, p ? p.offsetWidth : r.width, r.width);
    const below = window.innerHeight - r.bottom - gap;
    const up = below < Math.min(ph, 320) && r.top > below;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8));
    setPos({
      left,
      top: up ? Math.max(8, r.top - gap - ph) : r.bottom + gap,
      minWidth: Math.max(r.width, width || 0),
      up,
      originX: Math.max(12, Math.min(pw - 12, r.left + r.width / 2 - left)),
    });
  };
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const onMove = () => measure();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => { window.removeEventListener("resize", onMove); window.removeEventListener("scroll", onMove, true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return [pos, measure];
}

/** Close when you press outside both the trigger and the popover. */
export function useOutsideClose(open, refs, onClose) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (refs.some((r) => r.current && r.current.contains(e.target))) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

/** The popover pops out of its trigger (spring), or drops in from above when flipped. */
export function animatePopIn(el, up) {
  if (!el || reducedMotion()) return;
  el.animate(
    [
      { opacity: 0, transform: `translateY(${up ? 6 : -6}px) scale(0.94)` },
      { opacity: 1, transform: "none" },
    ],
    { duration: 240, easing: "cubic-bezier(0.34, 1.4, 0.64, 1)" },
  );
}
