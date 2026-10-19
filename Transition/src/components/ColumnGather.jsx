import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * Column gather — click a board total ("8 TO DO") and that column's cards
 * lift off the board and gather to the front, in a grid, over a blurred
 * board. Close (×, Esc, or a click on the empty space) and they fly back
 * into their slots.
 *
 * The cards are the board's own cards (same look, same size), so each one
 * flies with a near-uniform transform — no stretching. A card that isn't
 * visible on the board (scrolled out of its column) rises out of the count
 * card instead. Motion is Web Animations on transform/opacity (compositor),
 * skipped for reduced motion.
 */
const SPRING = "cubic-bezier(0.34, 1.32, 0.64, 1)";
const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

function boardCard(id) {
  const sel = `.kanban-container [data-id="${CSS.escape(String(id))}"]`;
  return document.querySelector(sel);
}

// Where a card sits on the board right now — or null if you can't see it.
function boardRect(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height || r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return null;
  const clip = el.closest(".col-content")?.getBoundingClientRect();
  if (clip && (r.bottom < clip.top + 8 || r.top > clip.bottom - 8)) return null; // scrolled out of its column
  return r;
}

// The transform that draws an element laid out at `to` over the rect `from`.
function flip(from, to) {
  const s = from.width / to.width;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${s})`;
}

export default function ColumnGather({ column, tasks, renderCard, sourceEl, cardWidth, onClose }) {
  const rootRef = useRef(null);
  const backdropRef = useRef(null);
  const headRef = useRef(null);
  const gridRef = useRef(null);
  const hidden = useRef([]);
  const closing = useRef(false);

  const reveal = () => {
    hidden.current.forEach((el) => { el.style.visibility = ""; });
    hidden.current = [];
  };

  // Gather: every card leaves its board slot and flies to its spot in the grid.
  // The flight starts on the next frame, not here: rendering a big column can
  // keep the browser busy for a while after this effect (especially in dev),
  // and an animation started now would be spent before anything is painted —
  // the cards would just appear. Until then the overlay stays invisible.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    const root = rootRef.current;
    if (!grid || !root) return undefined;
    const still = reducedMotion();
    root.style.opacity = "0";
    let raf = requestAnimationFrame(() => {
      raf = 0;
      root.style.opacity = "";
      const countRect = sourceEl?.isConnected ? sourceEl.getBoundingClientRect() : null;
      [...grid.children].forEach((slot, i) => {
        const el = boardCard(slot.dataset.id);
        const from = boardRect(el);
        // Hide the whole board card (with its tucked-away hover wings) while it's up front.
        const shell = el?.closest(".tf-shell") || el;
        if (shell) { shell.style.visibility = "hidden"; hidden.current.push(shell); }
        if (still) return;
        const to = slot.getBoundingClientRect();
        const start = from
          ? { transform: flip(from, to), opacity: 1 }
          : countRect
            ? { transform: flip({ ...countRect, width: Math.min(countRect.width, to.width) * 0.5, height: countRect.height }, to), opacity: 0 }
            : { transform: "translateY(24px) scale(0.9)", opacity: 0 };
        slot.animate(
          [start, { transform: "none", opacity: 1 }],
          { duration: 640, delay: Math.min(i, 24) * 24, easing: SPRING, fill: "backwards" },
        );
      });
      if (!still) {
        backdropRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, easing: "ease-out" });
        headRef.current?.animate(
          [{ opacity: 0, transform: "translateY(-16px) scale(0.92)" }, { opacity: 1, transform: "none" }],
          { duration: 480, delay: 80, easing: SPRING, fill: "backwards" },
        );
      }
    });
    return () => { // unmount by any path: the board cards come back
      if (raf) cancelAnimationFrame(raf);
      root.style.opacity = "";
      reveal();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scatter back: each card returns to its slot on the board, then we unmount.
  function close() {
    if (closing.current) return;
    closing.current = true;
    const done = () => {
      if (rootRef.current) rootRef.current.style.visibility = "hidden";
      reveal();
      onClose();
    };
    if (reducedMotion() || !gridRef.current) { done(); return; }
    const countRect = sourceEl?.isConnected ? sourceEl.getBoundingClientRect() : null;
    const slots = [...gridRef.current.children];
    const anims = slots.map((slot, i) => {
      const to = slot.getBoundingClientRect();
      if (to.bottom < 0 || to.top > window.innerHeight) { slot.style.opacity = "0"; return null; } // off-screen in the grid
      const from = boardRect(boardCard(slot.dataset.id));
      const end = from
        ? { transform: flip(from, to), opacity: 1 }
        : countRect
          ? { transform: flip({ ...countRect, width: Math.min(countRect.width, to.width) * 0.5, height: countRect.height }, to), opacity: 0 }
          : { transform: "translateY(24px) scale(0.9)", opacity: 0 };
      return slot.animate(
        [{ transform: "none", opacity: 1 }, end],
        { duration: 440, delay: Math.min(i, 24) * 12, easing: "cubic-bezier(0.3, 0, 0.15, 1)", fill: "forwards" },
      );
    }).filter(Boolean);
    backdropRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 380, delay: 120, easing: "ease-in", fill: "forwards" });
    headRef.current?.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(-12px)" }], { duration: 200, easing: "ease-in", fill: "forwards" });
    Promise.all(anims.map((a) => a.finished)).then(done, done);
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector(".task-modal-overlay, .custom-modal-overlay")) return; // something on top owns Esc
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return createPortal(
    <div className="gather-overlay" ref={rootRef} onClick={(e) => { if (e.target === e.currentTarget || e.target === gridRef.current) close(); }}>
      <div className="gather-backdrop" ref={backdropRef} />
      <div className="gather-head" ref={headRef} style={{ "--gather-accent": column.color }}>
        <span className="gather-dot" aria-hidden="true" />
        <span className="gather-title">{column.label}</span>
        <span className="gather-count">{tasks.length} {tasks.length === 1 ? "project" : "projects"}</span>
        <button type="button" className="gather-close" onClick={close} aria-label="Put them back">×</button>
      </div>
      <div className="gather-grid" ref={gridRef} style={{ "--gather-card-w": `${cardWidth || 260}px` }}>
        {tasks.map((t) => (
          <div key={t._id} className="gather-slot" data-id={t._id}>
            {renderCard(t)}
          </div>
        ))}
        {tasks.length === 0 && <div className="gather-empty">Nothing in {column.label} right now.</div>}
      </div>
    </div>,
    document.body,
  );
}
