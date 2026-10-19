/**
 * Handbook motion: the panel opening out of (and folding back into) the
 * header's Handbook button, blocks rising as they scroll into view, the
 * highlight when you jump to a section, and FLIP glides when blocks move in
 * the editor.
 *
 * Everything that moves is a Web Animation on transform / opacity — the
 * compositor plays those off the main thread — or a CSS animation keyed off
 * the attributes set here (styles/handbook-motion.css). Layout is read once
 * per gesture (open, close, a move), never per frame. With
 * prefers-reduced-motion everything simply appears in place.
 */

export const reducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

const canAnimate = (el) => !!el && typeof el.animate === "function";

// A damped spring (zeta = damping ratio, v0 = initial velocity) sampled into
// a CSS linear() easing; settles at t = 1. Browsers without linear() get a
// close cubic-bezier. The same curves live in handbook-motion.css as
// --hbm-soft / --hbm-spring / --hbm-pop.
function springCurve(zeta, v0, steps = 30) {
  const w = 6.5 / zeta;
  const wd = w * Math.sqrt(1 - zeta * zeta);
  const b = (v0 - zeta * w) / wd;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push(i === steps ? 1 : +(1 + Math.exp(-zeta * w * t) * (-Math.cos(wd * t) + b * Math.sin(wd * t))).toFixed(4));
  }
  return `linear(${pts.join(", ")})`;
}
const LINEAR_OK = typeof CSS !== "undefined" && !!CSS.supports?.("transition-timing-function", "linear(0, 1)");

export const EASE = {
  soft: LINEAR_OK ? springCurve(0.8, 3) : "cubic-bezier(0.22, 1.1, 0.36, 1)", // ~2% overshoot — big surfaces
  spring: LINEAR_OK ? springCurve(0.7, 4) : "cubic-bezier(0.34, 1.32, 0.64, 1)", // ~5% — blocks
  pop: LINEAR_OK ? springCurve(0.58, 5) : "cubic-bezier(0.34, 1.56, 0.64, 1)", // ~12% — small things
  exit: "cubic-bezier(0.4, 0, 0.9, 0.55)",
};

const settle = (anim, ms) =>
  Promise.race([anim?.finished?.then(() => {}, () => {}) ?? Promise.resolve(), new Promise((r) => setTimeout(r, ms))]);

// ── Open / close ────────────────────────────────────────────────────────────
const onScreen = (r) =>
  !!r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
const mentionsHandbook = (el) =>
  /handbook/i.test(`${el.textContent || ""} ${el.getAttribute("title") || ""} ${el.getAttribute("aria-label") || ""}`);

/** Where the header's Handbook button is on screen (the panel grows out of it), or null. */
export function launcherRect() {
  if (typeof document === "undefined") return null;
  const candidates = [
    document.querySelector("[data-handbook-launcher]"),
    document.activeElement?.closest?.("button"),
    ...document.querySelectorAll("header button"),
  ];
  for (const el of candidates) {
    if (!el || el.closest(".handbook-overlay")) continue;
    if (!el.hasAttribute("data-handbook-launcher") && !mentionsHandbook(el)) continue;
    const r = el.getBoundingClientRect();
    if (onScreen(r)) return r;
  }
  return null;
}

// The panel tilts up like a page while it grows out of the button, or slides
// in from the right when there's no button to grow from.
function panelPose(panel) {
  const L = launcherRect();
  if (!L) return { origin: "", hidden: "translateX(64px) scale(0.97)", shown: "translateX(0px) scale(1)" };
  const P = panel.getBoundingClientRect();
  return {
    origin: `${L.left + L.width / 2 - P.left}px ${L.top + L.height / 2 - P.top}px`,
    hidden: "perspective(1800px) rotateX(9deg) scale(0.42)",
    shown: "perspective(1800px) rotateX(0deg) scale(1)",
  };
}

/** Plays the entrance; returns a cancel function (use it as the layout effect's cleanup). */
export function playOpen(overlay, panel) {
  if (!canAnimate(overlay) || !canAnimate(panel) || reducedMotion()) return undefined;
  const pose = panelPose(panel);
  const fade = overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "cubic-bezier(0.32, 0.72, 0, 1)" });
  panel.style.transformOrigin = pose.origin;
  const a = panel.animate(
    [{ transform: pose.hidden, opacity: 0 }, { opacity: 1, offset: 0.28 }, { transform: pose.shown, opacity: 1 }],
    { duration: 520, easing: EASE.soft },
  );
  const clear = () => { panel.style.transformOrigin = ""; };
  a.onfinish = clear;
  a.oncancel = clear;
  return () => {
    fade.cancel();
    a.cancel();
  };
}

/** The quick reverse: fold back into the button (or slide away), then resolve. */
export function playClose(overlay, panel) {
  if (!canAnimate(overlay) || !canAnimate(panel) || reducedMotion()) return Promise.resolve();
  overlay.style.pointerEvents = "none";
  const pose = panelPose(panel);
  panel.style.transformOrigin = pose.origin;
  const a = panel.animate(
    [{ transform: pose.shown, opacity: 1 }, { opacity: 1, offset: 0.3 }, { transform: pose.hidden.replace("scale(0.42)", "scale(0.5)"), opacity: 0 }],
    { duration: 240, easing: EASE.exit, fill: "forwards" },
  );
  overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, delay: 30, easing: "ease-in", fill: "forwards" });
  return settle(a, 420);
}

// ── Blocks rise into view (once each) ───────────────────────────────────────
const REVEAL_FROM = { opacity: 0, transform: "translateY(22px) scale(0.985)" };
const STAGGER_MS = 55;
const STAGGER_CAP = 7;

/**
 * Watches the canvas's blocks and reveals each the first time it scrolls into
 * view, in reading order with a capped stagger. Revealed blocks get
 * [data-hbm-in] (CSS keeps unrevealed ones hidden and cascades their inner
 * items off it) and an inline --hbm-d = the delay they waited.
 */
export function createRevealer() {
  const born = performance.now();
  let io = null;

  function onEntries(entries) {
    const hits = entries
      .filter((e) => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left);
    // The first batch waits for the panel to land.
    const base = performance.now() - born < 420 ? 150 : 0;
    hits.forEach((e, i) => {
      const el = e.target;
      io?.unobserve(el);
      const delay = base + Math.min(i, STAGGER_CAP) * STAGGER_MS;
      el.style.setProperty("--hbm-d", `${delay}ms`);
      el.setAttribute("data-hbm-in", "");
      el.animate([REVEAL_FROM, { opacity: 1, transform: "none" }], { duration: 560, delay, easing: EASE.spring, fill: "backwards" });
    });
  }

  return {
    scan(root) {
      if (!root) return;
      const fresh = root.querySelectorAll(".hb-block:not([data-hbm-in])");
      if (!fresh.length) return;
      if (reducedMotion() || typeof IntersectionObserver === "undefined" || !canAnimate(fresh[0])) {
        fresh.forEach((el) => el.setAttribute("data-hbm-in", ""));
        return;
      }
      if (!io) io = new IntersectionObserver(onEntries, { rootMargin: "0px 0px -5% 0px" });
      fresh.forEach((el) => io.observe(el));
    },
    disconnect() {
      io?.disconnect();
      io = null;
    },
  };
}

// ── FLIP: blocks glide to their new spot when the layout changes ────────────
export function measureBlocks(root) {
  const m = new Map();
  root?.querySelectorAll("[data-block-id]").forEach((el) => m.set(el.getAttribute("data-block-id"), el.getBoundingClientRect()));
  return m;
}

export function playFlip(root, before) {
  if (!root || !before || reducedMotion()) return;
  const moves = [];
  root.querySelectorAll("[data-block-id]").forEach((el) => {
    const a = before.get(el.getAttribute("data-block-id"));
    if (!a || !canAnimate(el)) return;
    const b = el.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) moves.push([el, dx, dy]);
  });
  // All reads first, then the writes — one layout.
  moves.slice(0, 40).forEach(([el, dx, dy]) => {
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 480, easing: EASE.spring });
  });
}

/** A block shrinking away before it's removed. */
export function playLeave(el) {
  if (!canAnimate(el) || reducedMotion()) return Promise.resolve();
  const a = el.animate(
    [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(6px) scale(0.94)" }],
    { duration: 190, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" },
  );
  return settle(a, 320);
}

// ── Jumping to a section ────────────────────────────────────────────────────
const COLUMNS = ".hb-col-main, .hb-col-side";

/** Scroll the block's own column (they scroll independently) so it sits near the top — or centered. Returns the distance. */
export function scrollToBlock(el, { center = false } = {}) {
  const col = el?.closest(COLUMNS);
  if (!col) return 0;
  const c = col.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  let top = col.scrollTop + (r.top - c.top) - 12;
  if (center) top -= Math.max(0, (c.height - r.height) / 2 - 12);
  top = Math.max(0, Math.min(top, col.scrollHeight - col.clientHeight));
  const dist = Math.abs(top - col.scrollTop);
  if (dist >= 1) col.scrollTo({ top, behavior: reducedMotion() ? "auto" : "smooth" });
  return dist;
}

/** Resolves once that smooth scroll has landed. */
export function afterScroll(el, dist) {
  const col = el?.closest(COLUMNS);
  return new Promise((resolve) => {
    if (!col || dist < 2 || reducedMotion()) { resolve(); return; }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      col.removeEventListener("scrollend", finish);
      resolve();
    };
    if ("onscrollend" in window) col.addEventListener("scrollend", finish);
    setTimeout(finish, Math.min(900, 260 + dist * 0.6));
  });
}

const PSEUDO_OK = typeof KeyframeEffect !== "undefined" && "pseudoElement" in KeyframeEffect.prototype;

/** An accent ring glows on the block (its ::after) while it gives a small pop. */
export function flashBlock(el, { delay = 0 } = {}) {
  if (!canAnimate(el) || reducedMotion()) return;
  if (PSEUDO_OK) {
    el.animate(
      [{ opacity: 0 }, { opacity: 1, offset: 0.16 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }],
      { duration: 1500, delay, easing: "ease-out", pseudoElement: "::after" },
    );
  }
  el.animate(
    [{ transform: "none" }, { transform: "scale(1.012)", offset: 0.35 }, { transform: "none" }],
    { duration: 560, delay, easing: "ease-in-out" },
  );
}

/** Highlight a section: ring on its heading, then a soft wave through the blocks under it. */
export function highlightSection(headingEl) {
  flashBlock(headingEl);
  let n = headingEl?.nextElementSibling;
  for (let i = 0; n && i < 4 && n.getAttribute("data-block-type") !== "heading"; n = n.nextElementSibling) {
    if (!n.hasAttribute("data-block-id") || !canAnimate(n) || reducedMotion()) continue;
    n.animate(
      [{ transform: "none" }, { transform: "translateY(-4px)", offset: 0.4 }, { transform: "none" }],
      { duration: 520, delay: 120 + i * 70, easing: "ease-in-out" },
    );
    i++;
  }
}
