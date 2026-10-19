import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPosition, useOutsideClose, animatePopIn, reducedMotion } from "./Popover";

/**
 * The app's own dropdown (instead of the browser's <select>).
 *
 *   <Select value={v} onChange={setV} options={[{ value, label, hint?, disabled? }]} />
 *
 * Opens a list that springs out of the button; ↑/↓ move, Enter picks, Esc
 * closes, typing a letter jumps to the first option starting with it.
 * `size`: "md" (form field) | "sm" (compact pill). An option with
 * `action: true` is styled as a command (e.g. "+ New account…").
 */
export default function Select({
  value, onChange, options = [], placeholder = "Select…", size = "md", className = "",
  disabled = false, ariaLabel, id, menuWidth, required = false, name,
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const listRef = useRef(null);
  const typed = useRef({ text: "", at: 0 });
  const [pos] = useAnchoredPosition(open, btnRef, popRef, { width: menuWidth });
  useOutsideClose(open, [btnRef, popRef], () => setOpen(false));

  const selected = options.find((o) => String(o.value) === String(value ?? ""));
  const enabled = options.map((o, i) => (o.disabled || o.divider ? -1 : i)).filter((i) => i >= 0);

  const openMenu = () => {
    if (disabled) return;
    const idx = options.findIndex((o) => String(o.value) === String(value ?? ""));
    setActive(idx >= 0 ? idx : enabled[0] ?? -1);
    setOpen(true);
  };
  const pick = (o) => {
    if (!o || o.disabled || o.divider) return;
    setOpen(false);
    btnRef.current?.focus();
    if (String(o.value) !== String(value ?? "") || o.action) onChange?.(o.value, o);
  };
  const move = (dir) => {
    if (!enabled.length) return;
    const at = enabled.indexOf(active);
    setActive(enabled[(at + dir + enabled.length) % enabled.length] ?? enabled[0]);
  };

  // Pop in once positioned; the options ripple in.
  useLayoutEffect(() => {
    if (!open || !pos || !popRef.current || popRef.current.dataset.shown) return;
    popRef.current.dataset.shown = "1";
    animatePopIn(popRef.current, pos.up);
    if (!reducedMotion()) {
      [...(listRef.current?.children || [])].slice(0, 10).forEach((el, i) =>
        el.animate([{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }],
          { duration: 200, delay: 30 + i * 14, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "backwards" }));
    }
  }, [open, pos]);
  useLayoutEffect(() => {
    if (open) listRef.current?.children?.[active]?.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);

  function onKeyDown(e) {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); openMenu(); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
    if (e.key === "Tab") { setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); move(-1); return; }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(options[active]); return; }
    if (e.key.length === 1) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
      const hit = options.findIndex((o) => !o.disabled && !o.divider && String(o.label).toLowerCase().startsWith(typed.current.text));
      if (hit >= 0) setActive(hit);
    }
  }

  return (
    <>
      <button
        type="button"
        id={id}
        ref={btnRef}
        className={`ui-select ui-select-${size} ${open ? "open" : ""} ${selected ? "" : "placeholder"} ${className}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className="ui-select-value">{selected ? selected.label : placeholder}</span>
        <svg className="ui-select-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {required && (
        <input className="ui-hidden-input" tabIndex={-1} aria-hidden="true" name={name} value={value ?? ""} required onChange={() => {}} />
      )}
      {open && createPortal(
        <div
          ref={popRef}
          className={`ui-popover ui-select-menu ${pos?.up ? "up" : ""}`}
          style={pos ? { left: pos.left, top: pos.top, minWidth: pos.minWidth, transformOrigin: `${pos.originX}px ${pos.up ? "100%" : "0%"}` } : { visibility: "hidden" }}
          role="listbox"
          onKeyDown={onKeyDown}
        >
          <div className="ui-select-list" ref={listRef}>
            {options.map((o, i) => o.divider ? (
              <div key={`d${i}`} className="ui-select-divider" />
            ) : (
              <div
                key={`${o.value}-${i}`}
                role="option"
                aria-selected={String(o.value) === String(value ?? "")}
                aria-disabled={o.disabled || undefined}
                className={`ui-select-option ${i === active ? "active" : ""} ${String(o.value) === String(value ?? "") ? "selected" : ""} ${o.disabled ? "disabled" : ""} ${o.action ? "action" : ""}`}
                onPointerEnter={() => !o.disabled && setActive(i)}
                onClick={() => pick(o)}
              >
                <span className="ui-select-option-label">
                  {o.label}
                  {o.hint && <span className="ui-select-option-hint">{o.hint}</span>}
                </span>
                {String(o.value) === String(value ?? "") && !o.action && (
                  <svg className="ui-select-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
                )}
              </div>
            ))}
            {options.length === 0 && <div className="ui-select-empty">Nothing to choose yet</div>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
