import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPosition, useOutsideClose, animatePopIn } from "./Popover";

/**
 * The app's own pick-several dropdown.
 *
 *   <MultiSelect values={ids} onChange={setIds} options={[{ value, label }]} allLabel="All accounts" />
 *
 * Ticks are drafted while the list is open and handed to `onChange` once,
 * when it closes (Done, Esc or a click outside) — one save per edit, not
 * one per tick. An empty selection shows `allLabel` (e.g. "All accounts").
 */
export default function MultiSelect({
  values = [], onChange, options = [], allLabel = "None", placeholder, size = "md",
  className = "", disabled = false, ariaLabel, menuWidth = 240, emptyText = "Nothing to choose yet.",
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(values);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const [pos] = useAnchoredPosition(open, btnRef, popRef, { width: menuWidth });

  // Refs so the outside-click handler (bound when the list opens) sees the latest ticks.
  const live = useRef({ draft, values, onChange });
  live.current = { draft, values, onChange };
  const same = (a, b) => a.length === b.length && a.every((v) => b.includes(v));
  const close = () => {
    setOpen(false);
    const { draft: d, values: v, onChange: cb } = live.current;
    if (!same(d, v)) cb?.(d);
  };
  useOutsideClose(open, [btnRef, popRef], close);

  useLayoutEffect(() => {
    if (!open || !pos || !popRef.current || popRef.current.dataset.shown) return;
    popRef.current.dataset.shown = "1";
    animatePopIn(popRef.current, pos.up);
  }, [open, pos]);

  const chosen = options.filter((o) => values.includes(o.value));
  const label = chosen.length === 0 ? (placeholder || allLabel)
    : chosen.length <= 2 ? chosen.map((o) => o.label).join(", ")
    : `${chosen[0].label} +${chosen.length - 1}`;
  const toggle = (v) => setDraft((d) => (d.includes(v) ? d.filter((x) => x !== v) : [...d, v]));

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className={`ui-select ui-select-${size} ui-multi ${open ? "open" : ""} ${chosen.length ? "" : "placeholder"} ${className}`}
        onClick={() => (open ? close() : (setDraft(values), setOpen(true)))}
        onKeyDown={(e) => { if (open && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={chosen.map((o) => o.label).join(", ") || allLabel}
      >
        <span className="ui-select-value">{label}</span>
        {chosen.length > 0 && <span className="ui-multi-count">{chosen.length}</span>}
        <svg className="ui-select-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          className={`ui-popover ui-select-menu ui-multi-menu ${pos?.up ? "up" : ""}`}
          style={pos ? { left: pos.left, top: pos.top, minWidth: pos.minWidth, transformOrigin: `${pos.originX}px ${pos.up ? "100%" : "0%"}` } : { visibility: "hidden" }}
          role="listbox"
          aria-multiselectable="true"
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }}
        >
          <div className="ui-select-list">
            {options.length === 0 && <div className="ui-select-empty">{emptyText}</div>}
            {options.map((o) => {
              const on = draft.includes(o.value);
              return (
                <button type="button" key={o.value} className={`ui-select-option ui-multi-option ${on ? "selected" : ""}`} role="option" aria-selected={on} onClick={() => toggle(o.value)}>
                  <span className={`ui-multi-box ${on ? "on" : ""}`} aria-hidden="true">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><polyline points="20 6 9 17 4 12" /></svg>
                  </span>
                  <span className="ui-select-option-label">{o.label}</span>
                </button>
              );
            })}
          </div>
          <div className="ui-multi-foot">
            <button type="button" className="ui-multi-clear" onClick={() => setDraft([])} disabled={!draft.length}>{allLabel}</button>
            <button type="button" className="ui-multi-done" onClick={close}>Done</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
