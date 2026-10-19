import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { morphOriginFrom } from "../utils/modalOrigin";

/**
 * Header search — a spotlight that springs out of the magnifier.
 *
 * Click the icon (or press Ctrl/⌘+K) → a panel grows from the button, the
 * input is focused, and results cascade in as you type, with the matching
 * text highlighted. ↑/↓ move, Enter opens, Esc closes. People open their
 * board filter; projects open the task modal, growing out of the result row.
 * Motion is transform/opacity only (Web Animations) and skipped for reduced
 * motion.
 */
const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

function Highlight({ text, query }) {
  const t = String(text || "");
  const i = query ? t.toLowerCase().indexOf(query) : -1;
  if (i < 0) return t;
  return (
    <>
      {t.slice(0, i)}
      <mark className="hs-mark">{t.slice(i, i + query.length)}</mark>
      {t.slice(i + query.length)}
    </>
  );
}

export default function HeaderSearch({ staff, tasks, onPickStaff, onPickTask, onQueryChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const closing = useRef(false);

  const query = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (!query) return [];
    const people = (staff || [])
      .filter((s) => (s.name || "").toLowerCase().includes(query) || (s.email || "").toLowerCase().includes(query))
      .slice(0, 5)
      .map((s) => ({ kind: "person", key: `p:${s.email}`, s }));
    const projects = (tasks || [])
      .filter((t) =>
        (t.title || "").toLowerCase().includes(query) ||
        (query === "priority" && t.isPrioritized) ||
        (t.account || "").toLowerCase().includes(query) ||
        (t.assignee || "").toLowerCase().includes(query))
      .slice(0, 8)
      .map((t) => ({ kind: "task", key: `t:${t._id}`, t }));
    return [...people, ...projects];
  }, [query, staff, tasks]);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { onQueryChange?.(q); /* the board dims non-matching cards */ }, [q, onQueryChange]);

  function openSearch() {
    closing.current = false;
    setOpen(true);
  }

  function close(immediate) {
    if (!open || closing.current) return;
    const panel = panelRef.current;
    const done = () => { closing.current = false; setOpen(false); setQ(""); };
    if (immediate || !panel || reducedMotion()) { done(); return; }
    closing.current = true;
    panel.animate(
      [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-6px) scale(0.92)" }],
      { duration: 150, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" },
    ).finished.then(done, done);
  }

  // Grow out of the magnifier.
  useLayoutEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    if (reducedMotion() || !panelRef.current) return;
    panelRef.current.animate(
      [{ opacity: 0, transform: "translateY(-8px) scale(0.55)" }, { opacity: 1, transform: "none" }],
      { duration: 420, easing: SPRING },
    );
  }, [open]);

  // Results cascade in whenever the query changes.
  useLayoutEffect(() => {
    if (!open || reducedMotion() || !listRef.current) return;
    [...listRef.current.children].slice(0, 12).forEach((el, i) => {
      el.animate(
        [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }],
        { duration: 260, delay: i * 28, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "backwards" },
      );
    });
  }, [query, open]);

  // Outside click closes; Ctrl/⌘+K toggles from anywhere.
  useEffect(() => {
    const onDown = (e) => { if (open && rootRef.current && !rootRef.current.contains(e.target)) close(); };
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) close(); else openSearch();
      }
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); window.removeEventListener("keydown", onKey); };
  });

  function pick(r, el) {
    if (r.kind === "person") {
      close(true);
      onPickStaff?.(r.s);
    } else {
      const origin = el ? morphOriginFrom(el) : null;
      close(true);
      onPickTask?.(r.t, origin);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (!results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % results.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + results.length) % results.length); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const el = listRef.current?.children?.[active];
      pick(results[active], el);
    }
  }

  // Keep the highlighted row in view while arrowing.
  useEffect(() => {
    listRef.current?.children?.[active]?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  return (
    <div className="header-search" ref={rootRef}>
      <button
        type="button"
        className={`header-search-btn ${open ? "open" : ""}`}
        onClick={() => (open ? close() : openSearch())}
        title="Search (Ctrl+K)"
        aria-expanded={open}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>
      {open && (
        <div className="header-search-panel" ref={panelRef} role="dialog" aria-label="Search">
          <div className="hs-input-row">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search projects, people, accounts…"
              aria-label="Search"
            />
            {q ? (
              <button type="button" className="hs-clear" onClick={() => { setQ(""); inputRef.current?.focus(); }} aria-label="Clear">×</button>
            ) : (
              <kbd className="hs-kbd">Esc</kbd>
            )}
          </div>
          {query ? (
            results.length ? (
              <div className="hs-results" ref={listRef} role="listbox">
                {results.map((r, i) => (
                  <div
                    key={r.key}
                    role="option"
                    aria-selected={i === active}
                    className={`hs-item ${i === active ? "active" : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={(e) => pick(r, e.currentTarget)}
                  >
                    {r.kind === "person" ? (
                      <>
                        {r.s.avatarUrl ? (
                          <img className="hs-avatar" src={r.s.avatarUrl} alt="" />
                        ) : (
                          <span className="hs-avatar hs-avatar-fallback">{(r.s.name || "?").charAt(0)}</span>
                        )}
                        <span className="hs-text">
                          <span className="hs-title"><Highlight text={r.s.name} query={query} /></span>
                          <span className="hs-sub">View their projects</span>
                        </span>
                        <span className="hs-kind">Person</span>
                      </>
                    ) : (
                      <>
                        <span className={`hs-dot ${r.t.isPrioritized ? "prio" : ""}`} aria-hidden="true" />
                        <span className="hs-text">
                          <span className="hs-title"><Highlight text={r.t.title} query={query} /></span>
                          <span className="hs-sub">
                            {r.t.account ? <><Highlight text={r.t.account} query={query} /> · </> : null}
                            <Highlight text={r.t.assignee || "Unassigned"} query={query} />
                          </span>
                        </span>
                        <span className="hs-kind">Project</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="hs-empty">
                <span className="hs-empty-icon" aria-hidden="true">🔍</span>
                No matches for “{q.trim()}”
              </div>
            )
          ) : (
            <div className="hs-hint">Type to search · ↑ ↓ to move · Enter to open · try “priority”</div>
          )}
        </div>
      )}
    </div>
  );
}
