// Where a task modal opens FROM: the clicked element's on-screen rect (as it
// looks right now — hover pop and camera included), the element itself (the
// card→modal morph clones it), and the look of its corners and surface, read
// at click time because the element may unmount on the same click.
export function morphOriginFrom(el) {
  if (!el || typeof el.getBoundingClientRect !== "function") return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const cs = getComputedStyle(el);
  const k = el.offsetWidth ? r.width / el.offsetWidth : 1; // on-screen scale
  return {
    left: r.left, top: r.top, width: r.width, height: r.height, node: el,
    radius: (parseFloat(cs.borderTopLeftRadius) || 0) * k,
    background: cs.backgroundColor,
    opacity: parseFloat(cs.opacity) || 1,
    hovered: !!el.closest?.(".tf-shell")?.matches(":hover"), // board card showing its hover face
  };
}
