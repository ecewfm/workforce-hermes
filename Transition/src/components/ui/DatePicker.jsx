import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPosition, useOutsideClose, animatePopIn, reducedMotion } from "./Popover";

/**
 * The app's own date picker (instead of the browser's calendar).
 *
 *   <DatePicker value="2026-10-20" onChange={setDate} />   // "YYYY-MM-DD" or ""
 *
 * A calendar springs out of the field: ‹ › change month (the days slide),
 * quick picks (Today, Tomorrow, Next week, In 30 days), optional Clear.
 * Keyboard: arrows move a day/week, PageUp/PageDown a month, Enter picks,
 * Esc closes. `required` keeps native form validation working.
 */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const pad = (n) => String(n).padStart(2, "0");
export const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function parseISODate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export default function DatePicker({
  value, onChange, placeholder = "Pick a date", allowClear = false, min, max,
  className = "", disabled = false, id, required = false, name, size = "md", presets = true, ariaLabel,
}) {
  const selected = parseISODate(value);
  const today = new Date();
  const minD = parseISODate(min);
  const maxD = parseISODate(max);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => selected || today); // month on show
  const [focusDay, setFocusDay] = useState(() => selected || today);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const gridRef = useRef(null);
  const [pos] = useAnchoredPosition(open, btnRef, popRef, { width: 292 });
  useOutsideClose(open, [btnRef, popRef], () => setOpen(false));

  const outOfRange = (d) => (minD && d < minD) || (maxD && d > maxD);
  const openCal = () => {
    if (disabled) return;
    const start = selected || today;
    setView(start);
    setFocusDay(start);
    setOpen(true);
  };
  const choose = (d) => {
    if (!d || outOfRange(d)) return;
    onChange?.(toISODate(d));
    setOpen(false);
    btnRef.current?.focus();
  };
  const changeMonth = (dir) => {
    setView((v) => new Date(v.getFullYear(), v.getMonth() + dir, 1));
    if (gridRef.current && !reducedMotion()) {
      gridRef.current.animate(
        [{ opacity: 0.2, transform: `translateX(${dir * 26}px)` }, { opacity: 1, transform: "none" }],
        { duration: 240, easing: "cubic-bezier(0.2, 0, 0, 1)" },
      );
    }
  };

  useLayoutEffect(() => {
    if (!open || !pos || !popRef.current || popRef.current.dataset.shown) return;
    popRef.current.dataset.shown = "1";
    animatePopIn(popRef.current, pos.up);
  }, [open, pos]);

  function onKeyDown(e) {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "Enter", " "].includes(e.key)) { e.preventDefault(); openCal(); }
      return;
    }
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step) {
      e.preventDefault();
      const next = addDays(focusDay, step);
      setFocusDay(next);
      if (next.getMonth() !== view.getMonth() || next.getFullYear() !== view.getFullYear()) changeMonth(next > focusDay ? 1 : -1);
      return;
    }
    if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const dir = e.key === "PageDown" ? 1 : -1;
      setFocusDay(new Date(focusDay.getFullYear(), focusDay.getMonth() + dir, Math.min(focusDay.getDate(), 28)));
      changeMonth(dir);
      return;
    }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(focusDay); return; }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    if (e.key === "Tab") setOpen(false);
  }

  // The 6-week grid for the month on show.
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const gridStart = addDays(first, -first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const label = selected
    ? selected.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    : placeholder;

  const quick = [
    ["Today", today],
    ["Tomorrow", addDays(today, 1)],
    ["Next week", addDays(today, 7)],
    ["In 30 days", addDays(today, 30)],
  ];

  return (
    <>
      <button
        type="button"
        id={id}
        ref={btnRef}
        className={`ui-select ui-date ui-select-${size} ${open ? "open" : ""} ${selected ? "" : "placeholder"} ${className}`}
        onClick={() => (open ? setOpen(false) : openCal())}
        onKeyDown={onKeyDown}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel || (selected ? label : placeholder)}
      >
        <svg className="ui-date-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <span className="ui-select-value">{label}</span>
        {allowClear && selected && !disabled && (
          <span
            className="ui-date-clear"
            role="button"
            aria-label="Clear date"
            onClick={(e) => { e.stopPropagation(); onChange?.(""); }}
          >×</span>
        )}
      </button>
      {required && (
        <input className="ui-hidden-input" tabIndex={-1} aria-hidden="true" name={name} value={value || ""} required onChange={() => {}} />
      )}
      {open && createPortal(
        <div
          ref={popRef}
          className={`ui-popover ui-calendar ${pos?.up ? "up" : ""}`}
          style={pos ? { left: pos.left, top: pos.top, transformOrigin: `${pos.originX}px ${pos.up ? "100%" : "0%"}` } : { visibility: "hidden" }}
          role="dialog"
          aria-label="Choose a date"
          onKeyDown={onKeyDown}
        >
          <div className="ui-cal-head">
            <button type="button" className="ui-cal-nav" onClick={() => changeMonth(-1)} aria-label="Previous month">‹</button>
            <div className="ui-cal-title">{MONTHS[view.getMonth()]} <span>{view.getFullYear()}</span></div>
            <button type="button" className="ui-cal-nav" onClick={() => changeMonth(1)} aria-label="Next month">›</button>
          </div>
          <div className="ui-cal-dow">{DOW.map((d) => <span key={d}>{d}</span>)}</div>
          <div className="ui-cal-grid" ref={gridRef}>
            {days.map((d) => {
              const other = d.getMonth() !== view.getMonth();
              const off = outOfRange(d);
              return (
                <button
                  type="button"
                  key={d.toDateString()}
                  className={[
                    "ui-cal-day",
                    other && "other",
                    sameDay(d, today) && "today",
                    sameDay(d, selected) && "selected",
                    sameDay(d, focusDay) && "focus",
                    off && "disabled",
                  ].filter(Boolean).join(" ")}
                  disabled={off}
                  tabIndex={-1}
                  onClick={() => choose(d)}
                  onPointerEnter={() => setFocusDay(d)}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          {(presets || allowClear) && (
            <div className="ui-cal-foot">
              {presets && quick.filter(([, d]) => !outOfRange(d)).map(([lbl, d]) => (
                <button type="button" key={lbl} className="ui-cal-chip" onClick={() => choose(d)}>{lbl}</button>
              ))}
              {allowClear && value && (
                <button type="button" className="ui-cal-chip clear" onClick={() => { onChange?.(""); setOpen(false); }}>Clear</button>
              )}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
