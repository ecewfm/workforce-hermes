import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "../data/react";
import { api } from "../data/api";
import {
  BLOCK_GROUPS,
  makeBlock,
  cloneTemplate,
  templatesFor,
  starterBlocksFor,
} from "./handbookBlocks";
import { Icon } from "./handbookIcons";
import HandbookBlock from "./HandbookBlock";
import { useWorkspace } from "../utils/workspaceContext";
import { termsFor } from "../utils/workspaceTerms";
import {
  createRevealer,
  playOpen,
  playClose,
  playLeave,
  measureBlocks,
  playFlip,
  scrollToBlock,
  afterScroll,
  flashBlock,
  highlightSection,
  reducedMotion,
} from "./handbookMotion";
import "../styles/handbook-motion.css";

const isConflict = (err) => /someone else saved/i.test(err?.message || "");
const sameBlock = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const blockSelector = (id) => `[data-block-id="${typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id}"]`;

/**
 * Handbook — a shared, Admin+ editable team handbook rendered as a structured
 * grid of layout blocks. Viewers see a read-only page; Admin+ users can toggle
 * an edit mode with a block palette, layout templates, inline editing, width
 * controls and drag-to-reorder.
 *
 * Saving is conflict-safe: the version you started from goes along with the
 * save and the server refuses to overwrite a newer one. The page is live — a
 * newer save just appears while you're reading; while you're editing, a small
 * banner offers to reload it.
 */
export default function Handbook({ onClose, canEdit, userName, showModal }) {
  const workspace = useWorkspace();
  const terms = termsFor(workspace);
  const templates = templatesFor(workspace);
  const data = useQuery(api.handbook.getHandbook, { workspace });
  const saveHandbook = useMutation(api.handbook.saveHandbook);

  const [blocks, setBlocks] = useState(null); // null = loading
  const [base, setBase] = useState(null); // version (ms) the working copy started from; 0 = nothing saved yet
  const [incoming, setIncoming] = useState(null); // { updatedAt, updatedBy, dismissed } — a newer save that landed mid-edit
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [paletteTab, setPaletteTab] = useState("blocks"); // "blocks" | "templates"
  const [opening, setOpening] = useState(true); // first ~second: the top bar / nav entrance delays apply

  const dragIndex = useRef(null);
  const [dragOver, setDragOver] = useState(null);

  const overlayRef = useRef(null);
  const panelRef = useRef(null);
  const canvasRef = useRef(null);
  const closingRef = useRef(false);
  const dataRef = useRef(data);
  const flipRef = useRef(null); // block rects from just before a layout change (FLIP glide)
  const scrollToRef = useRef(null); // a just-added block to bring into view
  const flashIdsRef = useRef(null); // blocks a newer version changed — glow once rendered
  const [revealer] = useState(createRevealer);

  useEffect(() => { dataRef.current = data; }, [data]);

  // Switching workspace while open: start over with that workspace's handbook.
  const wsRef = useRef(workspace);
  useEffect(() => {
    if (wsRef.current === workspace) return;
    wsRef.current = workspace;
    setBlocks(null);
    setBase(null);
    setIncoming(null);
    setEditing(false);
    setDirty(false);
  }, [workspace]);

  // Show a version: glow the blocks it changed, glide the ones it moved.
  function showVersion(next) {
    const nextBlocks = next?.blocks?.length ? next.blocks : [];
    const prev = new Map((blocks || []).map((b) => [b.id, b]));
    flashIdsRef.current = nextBlocks.filter((b) => prev.has(b.id) && !sameBlock(prev.get(b.id), b)).map((b) => b.id).slice(0, 6);
    flipRef.current = measureBlocks(canvasRef.current);
    setBlocks(nextBlocks);
    setBase(next?.updatedAt ?? 0);
    setIncoming(null);
  }

  // Hydrate the working copy, then follow live updates.
  useEffect(() => {
    if (data === undefined) return; // still loading
    const version = data?.updatedAt ?? 0;
    if (blocks === null) {
      setBlocks(data?.blocks?.length ? data.blocks : []);
      setBase(version);
      return;
    }
    // Our own save (or anything older than what we hold) — nothing new.
    if (saving || base === null || version <= base) return;
    if (editing) {
      setIncoming((prev) => (prev?.updatedAt === version ? prev : { updatedAt: version, updatedBy: data?.updatedBy || "", dismissed: false }));
    } else {
      showVersion(data);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, blocks, base, editing, saving]);

  // ── Motion ─────────────────────────────────────────────────────────────────
  useLayoutEffect(() => playOpen(overlayRef.current, panelRef.current), []);
  // The entrance delays stay on until the content that arrived with the data
  // has finished cascading in (removing them mid-animation would make it jump).
  const hydrated = blocks !== null;
  useEffect(() => {
    if (!hydrated) return undefined;
    const t = setTimeout(() => setOpening(false), 1200);
    return () => clearTimeout(t);
  }, [hydrated]);
  // Blocks rise in the first time they scroll into view (new ones included).
  useLayoutEffect(() => { revealer.scan(canvasRef.current); });
  useEffect(() => () => revealer.disconnect(), [revealer]);
  // After a layout change: glide moved blocks, bring a new block into view,
  // glow what a live update changed.
  useLayoutEffect(() => {
    const root = canvasRef.current;
    if (flipRef.current) {
      playFlip(root, flipRef.current);
      flipRef.current = null;
    }
    if (scrollToRef.current) {
      const el = root?.querySelector(blockSelector(scrollToRef.current));
      scrollToRef.current = null;
      if (el) scrollToBlock(el, { center: true });
    }
    if (flashIdsRef.current) {
      const ids = flashIdsRef.current;
      flashIdsRef.current = null;
      ids.forEach((id, i) => flashBlock(root?.querySelector(blockSelector(id)), { delay: 200 + i * 80 }));
    }
  });

  const isEmpty = !blocks || blocks.length === 0;

  function markDirty(next, { flip = false } = {}) {
    if (flip) flipRef.current = measureBlocks(canvasRef.current);
    setBlocks(next);
    setDirty(true);
  }

  // ---- Block mutations ----
  function addBlock(type) {
    const block = makeBlock(type, workspace);
    scrollToRef.current = block.id;
    markDirty([...(blocks || []), block]);
  }
  function addTemplate(templateId) {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    const added = cloneTemplate(tpl);
    scrollToRef.current = added[0]?.id || null;
    markDirty([...(blocks || []), ...added]);
  }
  function updateBlock(id, patch) {
    markDirty(blocks.map((b) => (b.id === id ? { ...b, props: { ...b.props, ...patch } } : b)));
  }
  function setWidth(id, w) {
    markDirty(blocks.map((b) => (b.id === id ? { ...b, w } : b)), { flip: true });
  }
  function removeBlock(id) {
    const el = canvasRef.current?.querySelector(blockSelector(id));
    if (el?.hasAttribute("data-hbm-leaving")) return;
    el?.setAttribute("data-hbm-leaving", "");
    // Shrink away first, then the rest glide up into the gap.
    playLeave(el).then(() => markDirty((prev) => (prev || []).filter((b) => b.id !== id), { flip: true }));
  }
  // Which visual region a block lives in: full-width banner strip, the main
  // (left) column, or one of the two sidebar columns.
  function colKey(b) {
    if (b.col === "side" || b.col === "side2") return b.col;
    return b.type === "banner" ? "banner" : "main";
  }
  // Cycle a block through the columns: main → right → third → main.
  const NEXT_COL = { undefined: "side", side: "side2", side2: undefined };
  function toggleCol(id) {
    markDirty(blocks.map((b) => (b.id === id ? { ...b, col: NEXT_COL[b.col] } : b)), { flip: true });
  }
  function moveBlock(index, dir) {
    // Swap with the nearest block in the same visual column so moves stay intuitive.
    const key = colKey(blocks[index]);
    let target = index + dir;
    while (target >= 0 && target < blocks.length && colKey(blocks[target]) !== key) target += dir;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    markDirty(next, { flip: true });
  }
  function duplicateBlock(id) {
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx === -1) return;
    const copy = { ...blocks[idx], id: makeBlock(blocks[idx].type).id, props: JSON.parse(JSON.stringify(blocks[idx].props)) };
    const next = [...blocks];
    next.splice(idx + 1, 0, copy);
    markDirty(next, { flip: true });
  }

  // ---- Drag reorder ----
  function handleDrop(targetIndex) {
    const from = dragIndex.current;
    setDragOver(null);
    dragIndex.current = null;
    if (from === null || from === targetIndex) return;
    const tc = blocks[targetIndex]?.col;
    const targetCol = tc === "side" || tc === "side2" ? tc : undefined;
    const next = [...blocks];
    const [moved] = next.splice(from, 1);
    // Dropping onto a block also adopts its column, so dragging between the
    // parts just works.
    next.splice(targetIndex, 0, { ...moved, col: targetCol });
    markDirty(next, { flip: true });
  }
  function handleDropToSide(col) {
    const from = dragIndex.current;
    setDragOver(null);
    dragIndex.current = null;
    if (from === null) return;
    const next = [...blocks];
    const [moved] = next.splice(from, 1);
    next.push({ ...moved, col });
    markDirty(next, { flip: true });
  }

  // ---- Save / cancel / reload ----
  async function loadLatest() {
    let fresh = dataRef.current;
    try {
      fresh = await api.handbook.getHandbook.run({ workspace });
    } catch {
      /* keep what the live query already has */
    }
    showVersion(fresh);
    setDirty(false);
  }

  function reloadLatest() {
    if (!dirty) {
      loadLatest();
      return;
    }
    showModal?.({
      title: "Reload Latest Version?",
      message: "This replaces your unsaved edits with the version that was just saved. Continue?",
      type: "confirm",
      onConfirm: () => loadLatest(),
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const version = Number(await saveHandbook({ workspace, blocks: blocks || [], baseUpdatedAt: base ?? undefined, updatedBy: userName || "" }));
      if (Number.isFinite(version) && version > 0) setBase(version);
      setDirty(false);
      setEditing(false);
      setIncoming(null);
      showModal?.({ title: "Handbook Saved", message: "Your changes are now live for the whole team.", type: "success" });
    } catch (err) {
      if (isConflict(err)) {
        // Keep the banner up so they can reload later if they cancel now.
        setIncoming((prev) => ({ ...(prev || { updatedAt: null, updatedBy: "" }), dismissed: false }));
        showModal?.({
          title: "Someone Else Saved First",
          message: "Someone else saved the handbook while you were editing, so your changes were NOT saved (and theirs weren't overwritten). Reload the latest version now? That discards your unsaved edits — choose Cancel to keep them on screen and reload later from the banner.",
          type: "confirm",
          onConfirm: () => loadLatest(),
        });
      } else {
        showModal?.({ title: "Save Failed", message: err?.message || "Could not save the handbook.", type: "alert" });
      }
    } finally {
      setSaving(false);
    }
  }

  function exitEditing() {
    if (dirty) {
      showModal?.({
        title: "Discard Changes?",
        message: "You have unsaved handbook changes. Discard them?",
        type: "confirm",
        onConfirm: () => {
          showVersion(dataRef.current);
          setDirty(false);
          setEditing(false);
        },
      });
    } else {
      setEditing(false);
      // A newer version arrived while editing — the live effect shows it now.
    }
  }

  // Fold back into the button, then unmount.
  function closeAnimated() {
    if (closingRef.current) return;
    closingRef.current = true;
    playClose(overlayRef.current, panelRef.current).then(() => onClose());
  }

  // Esc closes (same as ×; asks first if there are unsaved edits).
  const handleCloseRef = useRef(null);
  handleCloseRef.current = handleClose;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector(".custom-modal-overlay, .input-modal-overlay")) return; // a dialog on top handles its own Esc
      handleCloseRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function handleClose() {
    if (editing && dirty) {
      showModal?.({
        title: "Discard Changes?",
        message: "You have unsaved handbook changes. Close without saving?",
        type: "confirm",
        onConfirm: closeAnimated,
      });
    } else {
      closeAnimated();
    }
  }

  const lastUpdated = useMemo(() => {
    if (!data?.updatedAt) return null;
    const d = new Date(data.updatedAt);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }, [data]);

  const headings = useMemo(
    () => (blocks || []).filter((b) => b.type === "heading" && String(b.props?.text || "").trim()),
    [blocks],
  );
  const showStale = editing && incoming && !incoming.dismissed;

  return (
    <div ref={overlayRef} className="handbook-overlay hbm-root" onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div ref={panelRef} className={`handbook-panel ${opening ? "hbm-opening" : ""}`} onMouseDown={(e) => e.stopPropagation()}>
        {/* Top bar */}
        <div className="handbook-topbar">
          <h2>
            <Icon name="book" size={20} />
            {terms.handbookTitle}
          </h2>
          <div className="handbook-topbar-actions">
            {!editing && canEdit && (
              <button className="hb-btn hb-btn-solid" onClick={() => setEditing(true)}>
                <Icon name="edit" size={14} /> Edit Layout
              </button>
            )}
            {editing && (
              <>
                <button className="hb-btn hb-btn-light" onClick={exitEditing}>Cancel</button>
                <button className="hb-btn hb-btn-solid" disabled={saving} onClick={handleSave}>
                  <Icon name="save" size={14} /> {saving ? "Saving…" : "Save & Publish"}
                </button>
              </>
            )}
            <button className="hb-btn hb-btn-light" onClick={handleClose} title="Close">
              <Icon name="x" size={16} />
            </button>
          </div>
        </div>

        {/* Someone else saved while you were editing — non-blocking */}
        {showStale && (
          <div className="hb-stale-banner" role="status">
            <Icon name="callout" size={15} />
            <span className="hb-stale-msg">
              Updated by <b>{incoming.updatedBy || "someone else"}</b> just now — reload to see it.
            </span>
            <button className="hb-btn hb-btn-ghost" onClick={reloadLatest}>Reload</button>
            <button className="hb-tool-btn" title="Dismiss" onClick={() => setIncoming((p) => (p ? { ...p, dismissed: true } : p))}>
              <Icon name="x" size={13} />
            </button>
          </div>
        )}

        {/* Body */}
        <div className="handbook-body">
          {/* Palette (edit mode only) */}
          {editing && (
            <aside className="handbook-palette">
              <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                <button
                  className={`hb-btn ${paletteTab === "blocks" ? "hb-btn-solid" : "hb-btn-ghost"}`}
                  style={{ flex: 1, justifyContent: "center" }}
                  onClick={() => setPaletteTab("blocks")}
                >Blocks</button>
                <button
                  className={`hb-btn ${paletteTab === "templates" ? "hb-btn-solid" : "hb-btn-ghost"}`}
                  style={{ flex: 1, justifyContent: "center" }}
                  onClick={() => setPaletteTab("templates")}
                >Templates</button>
              </div>

              {paletteTab === "blocks" ? (
                (() => {
                  let n = 0; // running index → the cascade's stagger
                  return BLOCK_GROUPS.map((grp) => (
                    <div className="hb-palette-section" key={grp.group}>
                      <h4>{grp.group}</h4>
                      {grp.items.map((def) => (
                        <button key={def.type} className="hb-palette-item" style={{ "--i": n++ }} onClick={() => addBlock(def.type)}>
                          <Icon name={def.icon} size={16} />
                          {def.label}
                        </button>
                      ))}
                    </div>
                  ));
                })()
              ) : (
                <div className="hb-palette-section">
                  <h4>Insert a template</h4>
                  {templates.map((tpl, i) => (
                    <button key={tpl.id} className="hb-template-card" style={{ "--i": i }} onClick={() => addTemplate(tpl.id)}>
                      <div className="tc-name">{tpl.name}</div>
                      <div className="tc-desc">{tpl.desc}</div>
                    </button>
                  ))}
                </div>
              )}
            </aside>
          )}

          {/* Canvas */}
          <div ref={canvasRef} className={`handbook-canvas hbm-armed ${editing ? "is-editing" : ""}`}>
            {isEmpty ? (
              <div className="hb-grid">
                <div className="hb-empty-state">
                  <Icon name="book" size={48} />
                  <h3>{canEdit ? "Build your team handbook" : "The handbook is empty"}</h3>
                  <p>
                    {canEdit
                      ? "Switch to Edit Layout, then add blocks or drop in a ready-made template to document your team's processes and policies."
                      : "An administrator hasn't published the handbook yet. Check back soon."}
                  </p>
                  {canEdit && !editing && (
                    <button className="hb-btn hb-btn-solid" style={{ marginTop: 18 }} onClick={() => setEditing(true)}>
                      <Icon name="edit" size={14} /> Start building
                    </button>
                  )}
                  {canEdit && editing && (
                    <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 18, flexWrap: "wrap" }}>
                      <button className="hb-btn hb-btn-solid" onClick={() => markDirty(starterBlocksFor(workspace))}>
                        <Icon name="layers" size={14} /> Use starter layout
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              (() => {
                const renderBlock = (block, idxInCol, colTotal) => {
                  const index = blocks.findIndex((b) => b.id === block.id);
                  return (
                    <HandbookBlock
                      key={block.id}
                      block={block}
                      editing={editing}
                      index={idxInCol}
                      total={colTotal}
                      inSidebar={block.col === "side" || block.col === "side2"}
                      isDragOver={dragOver === index}
                      onUpdate={(patch) => updateBlock(block.id, patch)}
                      onSetWidth={(w) => setWidth(block.id, w)}
                      onRemove={() => removeBlock(block.id)}
                      onDuplicate={() => duplicateBlock(block.id)}
                      onMove={(dir) => moveBlock(index, dir)}
                      onToggleCol={() => toggleCol(block.id)}
                      onDragStart={() => { dragIndex.current = index; }}
                      onDragEnterBlock={() => setDragOver(index)}
                      onDropBlock={() => handleDrop(index)}
                      onDragEnd={() => { dragIndex.current = null; setDragOver(null); }}
                    />
                  );
                };
                const banners = blocks.filter((b) => colKey(b) === "banner");
                const mains = blocks.filter((b) => colKey(b) === "main");
                const sides = blocks.filter((b) => colKey(b) === "side");
                const sides2 = blocks.filter((b) => colKey(b) === "side2");
                const renderSideCol = (colBlocks, col, label) => (
                  <aside className="hb-col-side">
                    {colBlocks.map((b, i) => renderBlock(b, i, colBlocks.length))}
                    {editing && (
                      <div
                        className="hb-side-hint"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => { e.preventDefault(); handleDropToSide(col); }}
                      >
                        {label}<br />
                        Drag a block here, or click the ⇆ button on any block to cycle it across columns.
                      </div>
                    )}
                  </aside>
                );
                return (
                  <>
                    {banners.length > 0 && (
                      <div className="hb-grid hb-banner-strip">
                        {banners.map((b, i) => renderBlock(b, i, banners.length))}
                      </div>
                    )}
                    {!editing && headings.length >= 2 && <SectionNav headings={headings} canvasRef={canvasRef} />}
                    <div className="hb-columns">
                      <div className="hb-grid hb-col-main">
                        {mains.map((b, i) => renderBlock(b, i, mains.length))}
                      </div>
                      {(sides.length > 0 || editing) && renderSideCol(sides, "side", "Right column")}
                      {(sides2.length > 0 || editing) && renderSideCol(sides2, "side2", "Third column (hidden when empty)")}
                    </div>
                  </>
                );
              })()
            )}
            {!editing && lastUpdated && !isEmpty && (
              <div style={{ textAlign: "center", marginTop: 30, fontSize: "0.7rem", color: "var(--color-text-secondary)", opacity: 0.7 }}>
                Last updated {lastUpdated}{data?.updatedBy ? ` by ${data.updatedBy}` : ""}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Jump-to-section chips for the page's headings. The chip for the section
 * you're reading lights up (scroll-spy) with an underline that glides to it;
 * clicking one scrolls that heading's column to it and highlights the section.
 */
function SectionNav({ headings, canvasRef }) {
  const navRef = useRef(null);
  const inkRef = useRef(null);
  const holdRef = useRef(0); // ignore the scroll-spy until a jump's smooth scroll lands
  const [active, setActive] = useState(null);
  const key = headings.map((h) => h.id).join("|");
  const current = headings.some((h) => h.id === active) ? active : headings[0]?.id;

  // Scroll-spy: the heading that reaches the top band of its column is "where you are".
  useEffect(() => {
    const root = canvasRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver((entries) => {
      if (performance.now() < holdRef.current) return;
      const hit = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (hit) setActive(hit.target.getAttribute("data-block-id"));
    }, { rootMargin: "-6% 0px -70% 0px" });
    key.split("|").forEach((id) => {
      const el = root.querySelector(blockSelector(id));
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [key, canvasRef]);

  // The underline glides to the active chip (transform only); keep that chip in view.
  useLayoutEffect(() => {
    const nav = navRef.current;
    const ink = inkRef.current;
    const chip = nav && Array.from(nav.children).find((c) => c.getAttribute("data-toc-id") === current);
    if (!chip || !ink) return;
    ink.style.transform = `translateX(${chip.offsetLeft}px) scaleX(${chip.offsetWidth})`;
    const left = chip.offsetLeft;
    const right = left + chip.offsetWidth;
    if (left < nav.scrollLeft || right > nav.scrollLeft + nav.clientWidth) {
      nav.scrollTo({ left: Math.max(0, left - 24), behavior: reducedMotion() ? "auto" : "smooth" });
    }
  }, [current, key]);

  function jump(id) {
    const el = canvasRef.current?.querySelector(blockSelector(id));
    if (!el) return;
    setActive(id);
    holdRef.current = performance.now() + 1200;
    const dist = scrollToBlock(el);
    afterScroll(el, dist).then(() => {
      holdRef.current = performance.now() + 150;
      highlightSection(el);
    });
  }

  return (
    <nav className="hb-toc" ref={navRef} aria-label="Sections">
      {headings.map((h, i) => (
        <button
          key={h.id}
          type="button"
          data-toc-id={h.id}
          className={`hb-toc-chip ${h.id === current ? "active" : ""}`}
          style={{ "--i": i }}
          aria-current={h.id === current ? "true" : undefined}
          onClick={() => jump(h.id)}
        >
          <Icon name={h.props.icon || "book"} size={12} />
          {h.props.text}
        </button>
      ))}
      <span className="hb-toc-ink" ref={inkRef} aria-hidden="true" />
    </nav>
  );
}
