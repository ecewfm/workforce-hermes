import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation } from "../data/react";
import { api } from "../data/api";
import { useWorkspace } from "../utils/workspaceContext";
import { resolveColumns, taskInColumn } from "../utils/columns";
import { isTechWorkspace } from "../utils/workspaceTerms";
import { workspaceLabel } from "../utils/departments";
import Select from "./ui/Select";
import "../styles/notebook.css";

// A taken idea becomes a new project, which starts with this status.
const NEW_PROJECT_STATUS = "todo";

const SORTS = [
  { value: "new", label: "Newest first" },
  { value: "old", label: "Oldest first" },
  { value: "az", label: "A to Z" },
];

// Pros / cons are free text, one point per line. Numbered lines ("1. Faster
// approvals") start a point and the lines under them become its details;
// without numbers every line is its own point. A first line that just says
// "Pros" / "Cons" is dropped, and typed bullets (•, ✓, -) are stripped.
function parsePoints(text, heading) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^(?:[•·✓✔✗✘]\s*|[-*]\s+)/, "").trim())
    .filter(Boolean);
  if (lines.length && new RegExp(`^${heading}:?$`, "i").test(lines[0])) lines.shift();
  const numbered = /^\d+[.)]\s+/;
  if (!lines.some((l) => numbered.test(l))) return lines.map((head) => ({ head, items: [] }));
  const out = [];
  for (const l of lines) {
    if (numbered.test(l)) out.push({ head: l.replace(numbered, ""), items: [] });
    else if (out.length) out[out.length - 1].items.push(l);
    else out.push({ head: l, items: [] });
  }
  return out;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const shortDate = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
function ago(ms) {
  const d = Math.floor((Date.now() - ms) / 86400000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  const m = Math.round(d / 30.4);
  if (m < 12) return `${plural(m, "month")} ago`;
  return `${plural(Math.round(d / 365), "year")} ago`;
}

const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
const onScreen = (r) => r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
// The transform (origin 0 0) that draws a box laid out at F over screen rect R.
const placeAt = (F, R) => `translate(${R.left - F.left}px, ${R.top - F.top}px) scale(${R.width / F.width}, ${R.height / F.height})`;

function BulbIcon({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" />
    </svg>
  );
}

/**
 * The big two-panel sheet an idea opens in (and the New idea form). It grows
 * out of whatever was clicked — the idea's card, or the New idea button — and
 * shrinks back into it on close (or fades, if that's gone). Rendered on
 * <body>: the view stage gets transformed by the camera, which would trap a
 * position:fixed overlay inside it.
 */
function NbSheet({ origin, returnTo, label, tone = "", onCloseStart, onClosed, guardClose, children }) {
  const overlayRef = useRef(null);
  const shellRef = useRef(null);
  const closing = useRef(false);

  useLayoutEffect(() => {
    const box = shellRef.current;
    if (!box || reducedMotion()) return;
    // Measure the laid-out box, not one already mid-flight (StrictMode runs this twice in dev).
    box.getAnimations().forEach((x) => x.cancel());
    overlayRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: "ease-out" });
    const F = box.getBoundingClientRect();
    if (origin && origin.width && F.width) {
      box.style.transformOrigin = "0 0";
      box.animate(
        [{ transform: placeAt(F, origin), opacity: 0.4 }, { transform: "none", opacity: 1 }],
        { duration: 480, easing: "cubic-bezier(0.3, 0, 0.1, 1)" },
      ).finished.then(() => { box.style.transformOrigin = ""; }, () => {});
    } else {
      box.animate(
        [{ opacity: 0, transform: "translateY(24px) scale(0.95)" }, { opacity: 1, transform: "none" }],
        { duration: 420, easing: "cubic-bezier(0.34, 1.25, 0.64, 1)" },
      );
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const box = shellRef.current;
    const target = returnTo ? document.querySelector(returnTo) : null;
    onCloseStart?.();
    if (!box || reducedMotion()) { onClosed(); return; }
    box.getAnimations().forEach((a) => a.cancel());
    const F = box.getBoundingClientRect();
    const C = target?.getBoundingClientRect();
    let anim;
    if (onScreen(C)) {
      box.style.transformOrigin = "0 0";
      anim = box.animate(
        [{ transform: "none", opacity: 1 }, { transform: placeAt(F, C), opacity: 0.15 }],
        { duration: 380, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" },
      );
      // The card comes back as the sheet lands on it.
      target.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: 260, easing: "ease-out", fill: "backwards" });
    } else {
      anim = box.animate(
        [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(16px) scale(0.96)" }],
        { duration: 240, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" },
      );
    }
    overlayRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: "ease", fill: "forwards" });
    anim.finished.then(onClosed, onClosed);
  }, [returnTo, onCloseStart, onClosed]);

  // Asking to close (×, Esc, backdrop) may need a confirm first (unsaved form).
  const requestClose = useCallback(() => {
    if (closing.current) return;
    if (guardClose && !guardClose(close)) return;
    close();
  }, [guardClose, close]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || document.querySelector(".custom-modal-overlay, .ui-popover")) return;
      e.stopPropagation();
      requestClose();
    };
    window.addEventListener("keydown", onKey, true); // before anything below can swallow it
    return () => window.removeEventListener("keydown", onKey, true);
  }, [requestClose]);

  return createPortal(
    <div
      ref={overlayRef}
      className="modal-overlay nb-overlay"
      onMouseDown={(e) => { overlayRef.current.dataset.downOnBackdrop = String(e.target === e.currentTarget); }}
      onClick={(e) => { if (e.target === e.currentTarget && overlayRef.current.dataset.downOnBackdrop === "true") requestClose(); }}
    >
      <div ref={shellRef} className={`nb-shell ${tone}`} role="dialog" aria-modal="true" aria-label={label}>
        {children({ close, requestClose })}
      </div>
    </div>,
    document.body,
  );
}

function PointList({ groups, kind }) {
  return (
    <ul className={`nb-points ${kind}`}>
      {groups.map((g, i) => (
        <li key={i}>
          <span className="nb-point-head">{g.head}</span>
          {g.items.length > 0 && (
            <ul className="nb-point-items">
              {g.items.map((it, j) => <li key={j}>{it}</li>)}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function IdeaView({ idea, canTake, canDelete, onTake, onDelete, requestClose }) {
  const pros = parsePoints(idea.pros, "pros");
  const cons = parsePoints(idea.cons, "cons");
  const taken = !!idea.taker;
  return (
    <>
      <aside className="nb-hero">
        <div className="nb-hero-orb" aria-hidden="true" />
        <div className="nb-hero-icon"><BulbIcon /></div>
        <div className="nb-hero-eyebrow">Idea · {taken ? "Taken" : "Open for takers"}</div>
        <h2 className="nb-hero-title">{idea.name}</h2>
        <dl className="nb-meta">
          <div><dt>Added</dt><dd>{shortDate(idea._creationTime)} <span>{ago(idea._creationTime)}</span></dd></div>
          <div><dt>Status</dt><dd>{taken ? `Taken by ${idea.taker}` : "Open: nobody has taken it yet"}</dd></div>
          <div><dt>Weighed up</dt><dd>{plural(pros.length, "pro")} · {plural(cons.length, "con")}</dd></div>
        </dl>
        {canTake && !taken && (
          <p className="nb-hero-note">Taking it turns it into a project assigned to you, and it leaves the notebook.</p>
        )}
      </aside>

      <section className="nb-main">
        <button type="button" className="nb-close" onClick={requestClose} aria-label="Close">×</button>
        <div className="nb-scroll">
          <div className="nb-label">What it does</div>
          <p className="nb-desc">{idea.description || "No description."}</p>

          {idea.details && (
            <>
              <div className="nb-label">Further details</div>
              <div className="nb-details">{idea.details}</div>
            </>
          )}

          {(pros.length > 0 || cons.length > 0) && (
            <>
              <div className="nb-label">Pros and cons</div>
              <div className="nb-pc">
                <div className="nb-pc-col pro">
                  <div className="nb-pc-head"><span className="nb-pc-mark">✓</span>Pros<span className="nb-pc-count">{pros.length}</span></div>
                  {pros.length ? <PointList groups={pros} kind="pro" /> : <div className="nb-pc-none">None listed.</div>}
                </div>
                <div className="nb-pc-col con">
                  <div className="nb-pc-head"><span className="nb-pc-mark">✗</span>Cons<span className="nb-pc-count">{cons.length}</span></div>
                  {cons.length ? <PointList groups={cons} kind="con" /> : <div className="nb-pc-none">None listed.</div>}
                </div>
              </div>
            </>
          )}
        </div>

        <footer className="nb-footer">
          {canDelete && (
            <button type="button" className="nb-btn danger" onClick={onDelete}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
              Delete
            </button>
          )}
          <span className="nb-footer-space" />
          <button type="button" className="nb-btn ghost" onClick={requestClose}>Close</button>
          {canTake && !taken && (
            <button type="button" className="nb-btn primary" onClick={onTake}>
              Take this idea
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
            </button>
          )}
        </footer>
      </section>
    </>
  );
}

const TIPS = [
  "Name it so anyone gets it at a glance.",
  "Say what it would do and who it helps.",
  "Pros and cons go one per line. Number the main points (1. 2. 3.) to group details under them.",
];

function IdeaForm({ draft, setDraft, saving, onSave, requestClose }) {
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const ready = draft.name.trim() && draft.description.trim();
  const words = draft.description.trim() ? draft.description.trim().split(/\s+/).length : 0;
  const pros = parsePoints(draft.pros, "pros").length;
  const cons = parsePoints(draft.cons, "cons").length;
  const onKeyDown = (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && ready && !saving) { e.preventDefault(); onSave(); }
  };
  return (
    <>
      <aside className="nb-hero">
        <div className="nb-hero-orb" aria-hidden="true" />
        <div className="nb-hero-icon"><BulbIcon /></div>
        <div className="nb-hero-eyebrow">New idea</div>
        <h2 className={`nb-hero-title ${draft.name.trim() ? "" : "placeholder"}`}>{draft.name.trim() || "A new idea"}</h2>
        <ul className="nb-tips">{TIPS.map((t) => <li key={t}>{t}</li>)}</ul>
      </aside>

      <section className="nb-main" onKeyDown={onKeyDown}>
        <button type="button" className="nb-close" onClick={requestClose} aria-label="Close">×</button>
        <div className="nb-scroll">
          <label className="nb-label" htmlFor="nb-name">Idea name<span className="nb-req">*</span></label>
          <input id="nb-name" className="nb-title-input" type="text" value={draft.name} onChange={set("name")} placeholder="e.g. Auto-approve low-risk leave requests" autoFocus maxLength={120} />

          <label className="nb-label" htmlFor="nb-desc">
            What does it do?<span className="nb-req">*</span>
            <span className="nb-count">{words ? plural(words, "word") : ""}</span>
          </label>
          <textarea id="nb-desc" className="nb-input" rows={4} value={draft.description} onChange={set("description")} placeholder="What it would do, and who it helps." />

          <div className="nb-pc-inputs">
            <div>
              <label className="nb-label pro" htmlFor="nb-pros">Pros<span className="nb-count">{pros ? plural(pros, "point") : "optional"}</span></label>
              <textarea id="nb-pros" className="nb-input pro" rows={6} value={draft.pros} onChange={set("pros")} placeholder={"One per line, e.g.\nSaves RTAs an hour a day\nFewer missed requests"} />
            </div>
            <div>
              <label className="nb-label con" htmlFor="nb-cons">Cons<span className="nb-count">{cons ? plural(cons, "point") : "optional"}</span></label>
              <textarea id="nb-cons" className="nb-input con" rows={6} value={draft.cons} onChange={set("cons")} placeholder={"One per line, e.g.\nNeeds a staffing check first\nHarder to audit"} />
            </div>
          </div>

          <label className="nb-label" htmlFor="nb-details">Further details<span className="nb-count">optional</span></label>
          <textarea id="nb-details" className="nb-input" rows={3} value={draft.details} onChange={set("details")} placeholder="Anything else worth knowing: links, numbers, who asked for it." />
        </div>

        <footer className="nb-footer">
          <span className="nb-footer-hint">{ready ? "Ctrl + Enter saves" : "Add a name and what it does to save"}</span>
          <span className="nb-footer-space" />
          <button type="button" className="nb-btn ghost" onClick={requestClose}>Cancel</button>
          <button type="button" className="nb-btn primary" onClick={onSave} disabled={!ready || saving}>
            {saving && <span className="nb-spinner" aria-hidden="true" />}
            {saving ? "Saving…" : "Save idea"}
          </button>
        </footer>
      </section>
    </>
  );
}

const EMPTY_DRAFT = { name: "", description: "", pros: "", cons: "", details: "" };

export default function Notebook({ userRole, userName, showModal, showInputModal }) {
  const workspace = useWorkspace();
  const label = workspaceLabel(workspace);
  const ideas = useQuery(api.notebook.getIdeas, { workspace });
  const appConfig = useQuery(api.appConfig.getAppConfig, { workspace });
  const addIdea = useMutation(api.notebook.addIdea);
  const deleteIdeaMut = useMutation(api.notebook.deleteIdea);
  const takeIdeaMut = useMutation(api.notebook.takeIdea);

  // Workforce: only programmers take ideas (unchanged). Operations/Executives:
  // any signed-in member of the workspace can. Adding and deleting stay with
  // the Admin view.
  const canTakeIdeas = isTechWorkspace(workspace) ? userRole === "Programmer" : true;
  const canManage = userRole === "Admin";

  // The board column a new project lands in — the column matching its status,
  // else the first column (the same fallback the board uses).
  const boardColumns = resolveColumns(appConfig?.columns, workspace);
  const landingColumn = boardColumns.find((c) => taskInColumn(NEW_PROJECT_STATUS, c.id)) || boardColumns[0];

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("new");
  // { mode: "view", idea, origin } | { mode: "add", origin } | null
  const [sheet, setSheet] = useState(null);
  const [hiddenId, setHiddenId] = useState(null); // the card that became the open sheet
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [freshIds, setFreshIds] = useState(() => new Set());

  const list = useMemo(() => (Array.isArray(ideas) ? ideas : []), [ideas]);

  // Ideas that arrive after the page loaded (yours or a teammate's) pop in.
  const known = useRef(null);
  useEffect(() => {
    if (!Array.isArray(ideas)) return undefined;
    if (!known.current) { known.current = new Set(ideas.map((i) => i._id)); return undefined; }
    const fresh = ideas.filter((i) => !known.current.has(i._id)).map((i) => i._id);
    fresh.forEach((id) => known.current.add(id));
    if (!fresh.length) return undefined;
    setFreshIds((s) => new Set([...s, ...fresh]));
    setTimeout(() => setFreshIds((s) => { const n = new Set(s); fresh.forEach((id) => n.delete(id)); return n; }), 2600);
    return undefined;
  }, [ideas]);

  const counts = useMemo(() => ({
    all: list.length,
    open: list.filter((i) => !i.taker).length,
    taken: list.filter((i) => i.taker).length,
  }), [list]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = list.filter((i) =>
      (filter === "all" || (filter === "open" ? !i.taker : !!i.taker)) &&
      (!q || [i.name, i.description, i.pros, i.cons, i.details, i.taker].some((t) => String(t || "").toLowerCase().includes(q))));
    if (sort === "az") out.sort((a, b) => a.name.localeCompare(b.name));
    else out.sort((a, b) => (sort === "old" ? a._creationTime - b._creationTime : b._creationTime - a._creationTime));
    return out;
  }, [list, query, filter, sort]);

  // The Taken filter only matters while old taken ideas are still around.
  useEffect(() => { if (filter === "taken" && counts.taken === 0) setFilter("all"); }, [filter, counts.taken]);

  function openIdea(idea, el) {
    const r = el?.getBoundingClientRect();
    setSheet({ mode: "view", idea, origin: r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null });
    setHiddenId(idea._id);
  }

  function openForm(el) {
    const r = el?.getBoundingClientRect();
    setSheet({ mode: "add", origin: r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null });
  }

  const onCloseStart = useCallback(() => setHiddenId(null), []);
  const onClosed = useCallback(() => setSheet(null), []);

  // Closing the form with something typed asks first.
  const draftDirty = Object.values(draft).some((v) => v.trim());
  const guardForm = useCallback((close) => {
    if (!draftDirty || saving) return true;
    showModal({
      title: "Discard this idea?",
      message: "What you've typed will be lost.",
      type: "confirm",
      onConfirm: () => { setDraft(EMPTY_DRAFT); close(); },
    });
    return false;
  }, [draftDirty, saving, showModal]);

  async function saveIdea(close) {
    if (saving) return;
    setSaving(true);
    try {
      await addIdea({
        workspace,
        name: draft.name.trim(),
        description: draft.description.trim(),
        pros: draft.pros.trim(),
        cons: draft.cons.trim(),
        details: draft.details.trim(),
      });
      setDraft(EMPTY_DRAFT);
      // Make sure the new card is on screen to pop in.
      setQuery("");
      setFilter("all");
      if (sort === "old") setSort("new");
      close();
    } catch (err) {
      showModal({ title: "Couldn't save the idea", message: err.message || "Please try again.", type: "alert" });
    } finally {
      setSaving(false);
    }
  }

  function deleteIdea(idea, close) {
    showModal({
      title: "Delete this idea?",
      message: `"${idea.name}" will be removed from the notebook for everyone.`,
      type: "confirm",
      onConfirm: async () => {
        try {
          await deleteIdeaMut({ ideaId: idea._id });
          close();
        } catch (err) {
          showModal({ title: "Couldn't delete it", message: err.message || "Please try again.", type: "alert" });
        }
      },
    });
  }

  // Taking an idea makes it a project assigned to you — every project needs a
  // start date (today or earlier → it starts right away in Pending).
  function takeIdea(idea, close) {
    const today = new Date().toLocaleDateString("en-CA");
    showInputModal({
      title: "Take this idea",
      message: "It will leave the notebook and become a project assigned to you. When does it start? If it's today (or earlier) it goes straight to Pending; otherwise it moves there on its start date.",
      fields: [{ name: "start", label: "Start date", type: "date", initialValue: today }],
      onConfirm: async (d) => {
        const start = (d.start || "").trim();
        if (!start) {
          showModal({ title: "Start date needed", message: "Pick a start date to take this idea.", type: "alert" });
          return;
        }
        try {
          await takeIdeaMut({ ideaId: idea._id, takerName: userName, workspace, startDate: start });
          close();
          const startsNow = start <= today;
          showModal({
            title: "Added to Projects",
            message: startsNow
              ? `"${idea.name}" is now a project assigned to you. It's in Pending: its start date has arrived, so its clock is running.`
              : `"${idea.name}" is now a project assigned to you. It's in ${landingColumn ? landingColumn.label : "To Do"} and moves to Pending by itself on ${new Date(`${start}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.`,
            type: "success",
          });
        } catch (err) {
          showModal({ title: "Couldn't take it", message: err.message || "Could not take this idea.", type: "alert" });
        }
      },
    });
  }

  const loading = ideas === undefined;
  const lede = canTakeIdeas
    ? "Open an idea to read it through. Take it, and it becomes your project."
    : canManage
      ? "Write ideas down here so the team can pick them up later."
      : "Ideas the team could build next.";

  return (
    <div id="notebook-view" className="view-section">
      <div className="container nb-page">
        <div className="nb-head">
          <div className="nb-head-text">
            <div className="nb-eyebrow">Notebook · {label}</div>
            <h1 className="nb-title">Ideas &amp; concepts</h1>
            <p className="nb-lede">
              {loading ? "Loading ideas…" : list.length ? <><b>{plural(counts.all, "idea")}</b>{counts.taken > 0 && <>, {counts.open} open</>}. {lede}</> : lede}
            </p>
          </div>
          {canManage && (
            <button type="button" className="nb-new-btn" onClick={(e) => openForm(e.currentTarget)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              New idea
            </button>
          )}
        </div>

        {list.length > 0 && (
          <div className="nb-toolbar">
            <label className="nb-search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search ideas, pros, cons…" aria-label="Search ideas" />
              {query && <button type="button" className="nb-search-clear" onClick={() => setQuery("")} aria-label="Clear search">×</button>}
            </label>
            {counts.taken > 0 && (
              <div className="nb-chips" role="tablist" aria-label="Show">
                {[["all", "All"], ["open", "Open"], ["taken", "Taken"]].map(([id, text]) => (
                  <button key={id} type="button" role="tab" aria-selected={filter === id} className={`nb-chip ${filter === id ? "on" : ""}`} onClick={() => setFilter(id)}>
                    {text}<span>{counts[id]}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="nb-sort">
              <Select size="sm" value={sort} onChange={setSort} options={SORTS} ariaLabel="Sort ideas" />
            </div>
          </div>
        )}

        {loading ? (
          <div className="nb-grid">
            {[0, 1, 2].map((i) => <div key={i} className="nb-card nb-card--loading" />)}
          </div>
        ) : list.length === 0 ? (
          <div className="nb-empty">
            <div className="nb-empty-icon"><BulbIcon size={34} /></div>
            <h2>No ideas yet</h2>
            <p>{canManage ? "Write down the first one: what it would do, and its pros and cons." : "When someone adds an idea, it shows up here."}</p>
            {canManage && <button type="button" className="nb-new-btn" onClick={(e) => openForm(e.currentTarget)}>Add the first idea</button>}
          </div>
        ) : shown.length === 0 ? (
          <div className="nb-empty small">
            <p>No ideas match{query.trim() ? <> "<b>{query.trim()}</b>"</> : ""}.</p>
            <button type="button" className="nb-btn ghost" onClick={() => { setQuery(""); setFilter("all"); }}>Show all ideas</button>
          </div>
        ) : (
          <div className="nb-grid">
            {shown.map((i, n) => {
              const pros = parsePoints(i.pros, "pros").length;
              const cons = parsePoints(i.cons, "cons").length;
              return (
                <button
                  key={i._id}
                  type="button"
                  data-idea-id={i._id}
                  className={`idea-card nb-card ${i.taker ? "taken" : ""} ${freshIds.has(i._id) ? "fresh" : ""}`}
                  style={{ "--i": Math.min(n, 12), visibility: hiddenId === i._id ? "hidden" : undefined }}
                  onClick={(e) => openIdea(i, e.currentTarget)}
                >
                  <span className="nb-card-top">
                    <span className={`nb-status ${i.taker ? "taken" : "open"}`}>{i.taker ? `Taken · ${i.taker}` : "Open"}</span>
                    <span className="nb-card-date" title={i.date}>{shortDate(i._creationTime)}</span>
                  </span>
                  <span className="nb-card-title">{i.name}</span>
                  <span className="nb-card-desc">{i.description}</span>
                  <span className="nb-card-foot">
                    {pros > 0 && <span className="nb-pill pro">+{plural(pros, "pro")}</span>}
                    {cons > 0 && <span className="nb-pill con">−{plural(cons, "con")}</span>}
                    {i.details && <span className="nb-pill">Details</span>}
                    <span className="nb-card-open">
                      Open
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {sheet?.mode === "view" && (
        <NbSheet
          origin={sheet.origin}
          returnTo={`[data-idea-id="${sheet.idea._id}"]`}
          label={sheet.idea.name}
          tone="nb-auto"
          onCloseStart={onCloseStart}
          onClosed={onClosed}
        >
          {({ close, requestClose }) => (
            <IdeaView
              idea={sheet.idea}
              canTake={canTakeIdeas}
              canDelete={canManage}
              onTake={() => takeIdea(sheet.idea, close)}
              onDelete={() => deleteIdea(sheet.idea, close)}
              requestClose={requestClose}
            />
          )}
        </NbSheet>
      )}

      {sheet?.mode === "add" && (
        <NbSheet
          origin={sheet.origin}
          returnTo=".nb-head .nb-new-btn"
          label="New idea"
          tone="nb-form"
          onClosed={onClosed}
          guardClose={guardForm}
        >
          {({ close, requestClose }) => (
            <IdeaForm draft={draft} setDraft={setDraft} saving={saving} onSave={() => saveIdea(close)} requestClose={requestClose} />
          )}
        </NbSheet>
      )}
    </div>
  );
}
