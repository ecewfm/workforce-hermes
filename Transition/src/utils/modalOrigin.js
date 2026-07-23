// Origin payload for the TaskModal GSAP morph (container transform): the
// clicked element's on-screen rect + the node itself. The modal starts its
// box exactly on this rect and clones the node as the cross-fade "ghost",
// so the modal visibly grows OUT of whatever was clicked — kanban card,
// search result, notification row — and shrinks back into it on close.
export function morphOriginFrom(el) {
  if (!el || typeof el.getBoundingClientRect !== "function") return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null; // hidden/detached source → center pop
  return { left: r.left, top: r.top, width: r.width, height: r.height, node: el };
}
