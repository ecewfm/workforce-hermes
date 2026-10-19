import { gsap } from "gsap";
import { getFxPrefs } from "./fxPrefs";

// ── Task-modal motion: a container transform ─────────────────────────────────
// OPEN: the clicked card itself becomes the modal. On the first frame the box
// is exactly the card (its rect, its corners, a copy of its content on top);
// it then grows into the modal while the card's copy fades and the modal's
// content fades in, and the board behind pushes in toward the card (the
// "camera"). CLOSE plays it back into wherever that card sits now.
//
// Everything that moves is a Web Animation on transform/opacity, which
// Chrome's compositor plays OFF the main thread — React mounting the modal or
// the full task arriving mid-flight can't make it stutter. Only the corner
// radius needs JS per frame: the box grows with a non-uniform scale, which
// would squash a CSS radius, so it's counter-scaled each frame (if the main
// thread hitches, the corners lag a frame; the motion doesn't).

const OPEN_MS = 480;
const CLOSE_MS = 400;
const CURVE = [0.3, 0, 0.1, 1]; // brisk start, long soft landing
const EASING = `cubic-bezier(${CURVE.join(", ")})`;
const CAMERA_ZOOM = 1.35;
const GHOST_STEPS = 16; // keyframes for the card copy's (non-linear) counter-scale

const ease = cubicBezier(...CURVE);
const html = () => document.documentElement;
const lerp = (a, b, p) => a + (b - a) * p;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const rectOf = (r) => ({ left: r.left, top: r.top, width: r.width, height: r.height });
const mix = (A, B, p) => ({ left: lerp(A.left, B.left, p), top: lerp(A.top, B.top, p), width: lerp(A.width, B.width, p), height: lerp(A.height, B.height, p) });
const shrink = (R, k) => ({ left: R.left + (R.width * (1 - k)) / 2, top: R.top + (R.height * (1 - k)) / 2, width: R.width * k, height: R.height * k });
// The transform (origin 0 0) that draws a box laid out at F over screen rect R.
const placeAt = (F, R) => `translate(${R.left - F.left}px, ${R.top - F.top}px) scale(${R.width / F.width}, ${R.height / F.height})`;
// A screen-space radius r on a box drawn at R, in the box's own (scaled) units.
const radiusAt = (F, R, r) => `${(r * F.width) / R.width}px / ${(r * F.height) / R.height}px`;
const onScreen = (r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (s) => ((ax * s + bx) * s + cx) * s;
  const Y = (s) => ((ay * s + by) * s + cy) * s;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1, s = x;
    for (let i = 0; i < 24; i++) { // bisection: monotonic in x, always converges
      if (X(s) < x) lo = s; else hi = s;
      s = (lo + hi) / 2;
    }
    return Y(s);
  };
}

// A visual copy of the card, pinned to the box's top-left corner. Skins pin
// card surfaces with !important, hence the !important inline styles.
function makeGhost(card, box, look) {
  const g = card.cloneNode(true);
  for (const a of ["data-id", "id", "draggable"]) g.removeAttribute(a);
  g.setAttribute("aria-hidden", "true");
  g.classList.add("tm-ghost");
  if (look.hovered) g.classList.add("tm-hover-face"); // the face you clicked, not the resting one
  const cs = getComputedStyle(card);
  const w = card.offsetWidth || look.width, h = card.offsetHeight || look.height;
  const set = (k, v) => g.style.setProperty(k, v, "important");
  set("position", "absolute");
  set("left", `${-box.clientLeft}px`);
  set("top", `${-box.clientTop}px`);
  set("width", `${w}px`);
  set("height", `${h}px`);
  set("margin", "0");
  set("box-sizing", "border-box");
  set("transform-origin", "0 0");
  set("pointer-events", "none");
  set("z-index", "5");
  set("visibility", "visible");
  set("transition", "none");
  set("animation", "none");
  set("box-shadow", "none");
  set("backdrop-filter", "none");
  set("-webkit-backdrop-filter", "none");
  set("background", look.background || cs.backgroundColor);
  // Text inherits from the box now, not the board column — keep the card's.
  for (const k of ["font-family", "font-size", "line-height", "color", "letter-spacing"]) set(k, cs.getPropertyValue(k));
  box.appendChild(g);
  return { el: g, width: w };
}

// The copy keeps the card's own proportions at the box's current width
// ("fit width"), anchored top-left — so it never looks stretched. Inside the
// non-uniformly scaled box that means a counter-scale that varies non-linearly
// with progress: baked into keyframes on the same easing as the box.
function ghostFrames(F, A, B, w) {
  const frames = [];
  for (let i = 0; i <= GHOST_STEPS; i++) {
    const p = i / GHOST_STEPS;
    const R = mix(A, B, p);
    frames.push({ offset: p, transform: `scale(${F.width / w}, ${(R.width * F.height) / (w * R.height)})` });
  }
  return frames;
}

const allFinished = (anims) => Promise.all(anims.map((a) => a.finished));

export function createCardMorph() {
  let run = null; // the animations playing now: { kind, anims, main, ghost }
  let geo = null; // how the open started: { C, rC } (card rect + radius)
  let hidden = null; // the card the modal "became" (hidden while it's open)
  let flight = null; // the camera's Web Animation on the stage
  let ownsStage = false; // the camera holds the stage (zoomed in on the card)
  let morphing = null; // the box while it wears morph-only styles
  let raf = 0;
  let unfrosted = null; // the stage while its frosted-glass surfaces are switched off
  let frostTimer = 0;

  // Frosted skins (glass, liquid): every frosted card and column on the board
  // re-blurs whatever is behind it on every frame that the board or the box
  // moves — by far the biggest GPU cost of the open, and invisible under the
  // modal's own dim + blur. Switch the board's frosting off once the morph is
  // under way (a frame in, so its restyle doesn't delay the first frame; the
  // motion itself runs on the compositor) and back on as the dim fades out.
  function unfrost(stage) {
    cancelAnimationFrame(frostTimer);
    const probe = stage?.querySelector(".kanban-col, .section-card, .stat-card, .task-card");
    if (!probe || getComputedStyle(probe).backdropFilter === "none") return;
    frostTimer = requestAnimationFrame(() => {
      frostTimer = requestAnimationFrame(() => { stage.classList.add("tm-unfrost"); unfrosted = stage; });
    });
  }
  function refrost() {
    cancelAnimationFrame(frostTimer);
    clearTimeout(frostTimer);
    unfrosted?.classList.remove("tm-unfrost");
    unfrosted = null;
  }

  function unstyleBox() {
    if (!morphing) return;
    morphing.classList.remove("tm-morphing");
    morphing.style.transformOrigin = "";
    morphing.style.removeProperty("border-radius");
    morphing = null;
  }

  function stopRun() {
    cancelAnimationFrame(raf);
    raf = 0;
    if (!run) return;
    run.anims.forEach((a) => a.cancel());
    run.ghost?.remove();
    run = null;
  }

  function revealCard() {
    if (hidden) hidden.style.visibility = "";
    hidden = null;
  }

  function releaseStage(stage) {
    flight?.cancel();
    flight = null;
    html().classList.remove("wf-camera-flight");
    if (stage && ownsStage) {
      gsap.killTweensOf(stage);
      // The cursor-camera keeps the stage promoted to its own layer; only
      // drop will-change when it's off (re-promoting = a full re-raster).
      gsap.set(stage, { clearProps: getFxPrefs().cameraFollow ? "transform,transformOrigin" : "transform,transformOrigin,willChange" });
    }
    ownsStage = false;
  }

  // Corner radius, counter-scaled each frame from the box animation's clock.
  function driveRadius(box, anim, total, F, A, B, rA, rB) {
    cancelAnimationFrame(raf);
    const tick = () => {
      const p = ease(clamp01((Number(anim.currentTime) || 0) / total));
      box.style.setProperty("border-radius", radiusAt(F, mix(A, B, p), lerp(rA, rB, p)), "important");
      raf = p < 1 && anim.playState !== "idle" ? requestAnimationFrame(tick) : 0;
    };
    tick();
  }

  // Aim the stage camera at the card: switch its transform-origin to the
  // card's centre WITHOUT a visual jump (the cursor-camera may already hold a
  // small zoom/pan around the stage centre — compensate the translate).
  function aim(stage, C) {
    const w = stage.offsetWidth, h = stage.offsetHeight;
    const s0 = Number(gsap.getProperty(stage, "scaleX")) || 1;
    const x0 = Number(gsap.getProperty(stage, "x")) || 0;
    const y0 = Number(gsap.getProperty(stage, "y")) || 0;
    const sr = stage.getBoundingClientRect();
    const L = sr.left - x0 - (w * (1 - s0)) / 2; // untransformed viewport left
    const T = sr.top - y0 - (h * (1 - s0)) / 2;
    const ox = C.left + C.width / 2 - L, oy = C.top + C.height / 2 - T;
    const x = x0 + (s0 - 1) * (ox - w / 2), y = y0 + (s0 - 1) * (oy - h / 2);
    gsap.set(stage, { transformOrigin: `${ox}px ${oy}px`, x, y, willChange: "transform" });
    return { x, y, s0 };
  }

  function flyIn(stage, C) {
    flight?.cancel();
    gsap.killTweensOf(stage); // a lingering cursor-camera tween would fight the flight
    const { x, y, s0 } = aim(stage, C);
    ownsStage = true;
    html().classList.add("wf-camera-flight"); // cursor-camera: hands off until it lands
    const a = stage.animate(
      [{ transform: `translate(${x}px, ${y}px) scale(${s0})` }, { transform: `translate(${x}px, ${y}px) scale(${CAMERA_ZOOM})` }],
      { duration: OPEN_MS, easing: EASING, fill: "forwards" },
    );
    flight = a;
    a.finished.then(() => {
      if (flight !== a) return;
      gsap.set(stage, { scale: CAMERA_ZOOM }); // GSAP holds the zoom from here (the cursor-camera drifts around it)
      a.cancel();
      flight = null;
      html().classList.remove("wf-camera-flight");
    }, () => {});
  }

  /** Mount-time: grow the modal box out of `origin` (see morphOriginFrom). */
  function open({ box, backdrop, origin, stage, onSettled }) {
    stopRun();
    const settled = () => onSettled?.();
    if (!box || reducedMotion()) { settled(); return; }
    const F = rectOf(box.getBoundingClientRect());
    const kids = Array.from(box.children);
    const anims = [];
    const fadeIn = (el, delay, duration) =>
      anims.push(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration, delay, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "backwards" }));

    if (!origin || !F.width || !F.height) {
      // Nothing on screen to grow out of (search, notifications, Caddy): a
      // quiet pop in place.
      anims.push(box.animate([{ opacity: 0, transform: "scale(0.96)" }, { opacity: 1, transform: "none" }], { duration: 280, easing: "cubic-bezier(0.2, 0, 0, 1)" }));
      if (backdrop) fadeIn(backdrop, 0, 260);
      run = { kind: "open", anims, main: anims[0] };
      allFinished(anims).then(() => { run = null; settled(); }, () => {});
      return;
    }

    const C = rectOf(origin);
    const rC = origin.radius ?? 12;
    const rF = parseFloat(getComputedStyle(box).borderTopLeftRadius) || 16;
    // The thing that was clicked (board card, dashboard row…) — if it already
    // left the page (a search result, a closing list) there's nothing to copy.
    const card = origin.node?.isConnected ? origin.node : null;
    const ghost = card ? makeGhost(card, box, origin) : null;
    box.classList.add("tm-morphing");
    box.style.transformOrigin = "0 0";
    morphing = box;

    const timing = { duration: OPEN_MS, easing: EASING };
    const main = box.animate([{ transform: placeAt(F, C) }, { transform: placeAt(F, F) }], timing);
    anims.push(main);
    if (ghost) {
      anims.push(ghost.el.animate(ghostFrames(F, C, F, ghost.width), timing));
      anims.push(ghost.el.animate([{ opacity: origin.opacity ?? 1 }, { opacity: 0 }], { duration: 170, delay: 20, easing: "cubic-bezier(0.2, 0, 0.4, 1)", fill: "both" }));
    }
    kids.forEach((k) => fadeIn(k, 110, 260));
    if (backdrop) fadeIn(backdrop, 0, 340);
    // The camera push-in is part of the "camera" motion (Settings → Motion &
    // fun) — off there means the board stays put behind the modal.
    if (stage && origin.node?.isConnected && getFxPrefs().cameraFollow) flyIn(stage, C);
    // The card has become the modal — don't leave a copy of it on the board.
    if (card) { card.style.visibility = "hidden"; hidden = card; }
    unfrost(stage);

    geo = { C, rC };
    run = { kind: "open", anims, main, ghost: ghost?.el };
    driveRadius(box, main, OPEN_MS, F, C, F, rC, rF);
    allFinished(anims).then(() => {
      ghost?.el.remove();
      unstyleBox();
      run = null;
      settled();
    }, () => {});
  }

  /** Close: shrink back into `card` (its current resting spot), or fade. */
  function close({ box, backdrop, overlay, stage, card, onDone }) {
    if (!box || reducedMotion()) {
      stopRun();
      revealCard();
      releaseStage(stage);
      onDone?.();
      return;
    }
    // Read where everything is RIGHT NOW — the open may still be in flight.
    const kids = Array.from(box.children).filter((k) => !k.classList.contains("tm-ghost"));
    const kidOpacity = kids.map((k) => getComputedStyle(k).opacity);
    const bdOpacity = backdrop ? getComputedStyle(backdrop).opacity : "1";
    const camNow = stage ? getComputedStyle(stage).transform : "none";
    const pOpen = run?.kind === "open" && geo && run.main ? ease(clamp01((Number(run.main.currentTime) || 0) / OPEN_MS)) : 1;
    stopRun();
    morphing = box;
    unstyleBox();
    const F = rectOf(box.getBoundingClientRect()); // laid-out rect (open animations cancelled)
    const rF = parseFloat(getComputedStyle(box).borderTopLeftRadius) || 16;
    const A = pOpen < 1 ? mix(geo.C, F, pOpen) : F;
    const rA = pOpen < 1 ? lerp(geo.rC, rF, pOpen) : rF;

    // Camera home: measure the card's resting rect with the stage untransformed.
    const homing = !!stage && camNow !== "none";
    if (stage) {
      flight?.cancel();
      flight = null;
      gsap.killTweensOf(stage);
      if (homing) { ownsStage = true; stage.style.transform = "none"; }
    }
    let T = null;
    if (card?.isConnected) {
      const r = card.getBoundingClientRect();
      if (onScreen(r)) T = rectOf(r);
    }

    const anims = [];
    let main;
    box.style.transformOrigin = "0 0";
    box.classList.add("tm-morphing");
    morphing = box;
    kids.forEach((k, i) => anims.push(k.animate([{ opacity: kidOpacity[i] }, { opacity: 0 }], { duration: 120, easing: "linear", fill: "forwards" })));
    if (homing) {
      html().classList.add("wf-camera-flight");
      flight = stage.animate([{ transform: camNow }, { transform: "matrix(1, 0, 0, 1, 0, 0)" }], { duration: CLOSE_MS, easing: EASING, fill: "forwards" });
    }

    let ghost = null;
    if (T) {
      const rT = (parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0) * (T.width / (card.offsetWidth || T.width));
      // The box becomes the card again, so the real one stays hidden until
      // the exact frame they coincide (box, copy and camera all land at
      // once) — then they swap. A cross-fade would double-expose them: the
      // card rides the camera home while the box shrinks from far bigger.
      if (hidden !== card) { revealCard(); card.style.visibility = "hidden"; hidden = card; }
      ghost = makeGhost(card, box, {});
      const timing = { duration: CLOSE_MS, easing: EASING, fill: "forwards" };
      main = box.animate([{ transform: placeAt(F, A) }, { transform: placeAt(F, T) }], timing);
      anims.push(main);
      anims.push(ghost.el.animate(ghostFrames(F, A, T, ghost.width), timing));
      anims.push(ghost.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: CLOSE_MS * 0.4, delay: CLOSE_MS * 0.3, easing: "linear", fill: "both" }));
      if (backdrop) anims.push(backdrop.animate([{ opacity: bdOpacity }, { opacity: 0 }], { duration: CLOSE_MS * 0.85, delay: CLOSE_MS * 0.15, easing: "ease-in-out", fill: "both" }));
      run = { kind: "close", anims, main, ghost: ghost.el };
      driveRadius(box, main, CLOSE_MS, F, A, T, rA, rT);
    } else {
      // Nowhere to land (the card left the board, or it's off screen): fade.
      revealCard();
      box.style.setProperty("border-radius", radiusAt(F, A, rA), "important");
      main = box.animate([{ transform: placeAt(F, A), opacity: 1 }, { transform: placeAt(F, shrink(A, 0.96)), opacity: 0 }], { duration: 220, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
      anims.push(main);
      if (backdrop) anims.push(backdrop.animate([{ opacity: bdOpacity }, { opacity: 0 }], { duration: 260, easing: "ease-in", fill: "forwards" }));
      run = { kind: "close", anims, main };
    }

    cancelAnimationFrame(frostTimer); // closed before the frosting even went off
    if (unfrosted) frostTimer = setTimeout(refrost, CLOSE_MS * 0.5); // back on as the dim fades
    allFinished([...anims, ...(flight ? [flight] : [])]).then(() => {
      // Hide in the same frame the motion ends — React unmounts a beat later.
      if (overlay) overlay.style.visibility = "hidden";
      revealCard();
      cancelAnimationFrame(raf);
      raf = 0;
      ghost?.el.remove();
      run = null;
      geo = null;
      releaseStage(stage);
      onDone?.();
    }, () => {});
  }

  /** Unmount (any path): never leave the stage zoomed or the card hidden. */
  function dispose(stage) {
    refrost();
    stopRun();
    unstyleBox();
    revealCard();
    releaseStage(stage);
    geo = null;
  }

  return { open, close, dispose };
}
