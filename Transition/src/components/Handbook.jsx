import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  BLOCK_GROUPS,
  TEMPLATES,
  STARTER_BLOCKS,
  makeBlock,
  cloneTemplate,
} from "./handbookBlocks";
import { Icon } from "./handbookIcons";
import HandbookBlock from "./HandbookBlock";

/**
 * Handbook — a shared, Admin+ editable team handbook rendered as a structured
 * grid of layout blocks. Viewers see a read-only page; Admin+ users can toggle
 * an edit mode with a block palette, layout templates, inline editing, width
 * controls and drag-to-reorder.
 */
export default function Handbook({ onClose, canEdit, userName, showModal }) {
  const data = useQuery(api.handbook.getHandbook);
  const saveHandbook = useMutation(api.handbook.saveHandbook);

  const [blocks, setBlocks] = useState(null); // null = loading
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [paletteTab, setPaletteTab] = useState("blocks"); // "blocks" | "templates"

  const dragIndex = useRef(null);
  const [dragOver, setDragOver] = useState(null);

  // Hydrate local working copy once the query resolves.
  useEffect(() => {
    if (data === undefined) return; // still loading
    if (blocks === null) {
      setBlocks(data?.blocks?.length ? data.blocks : []);
    }
  }, [data, blocks]);

  const isEmpty = !blocks || blocks.length === 0;

  function markDirty(next) {
    setBlocks(next);
    setDirty(true);
  }

  // ---- Block mutations ----
  function addBlock(type) {
    markDirty([...(blocks || []), makeBlock(type)]);
  }
  function addTemplate(templateId) {
    const tpl = TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;
    markDirty([...(blocks || []), ...cloneTemplate(tpl)]);
  }
  function updateBlock(id, patch) {
    markDirty(blocks.map((b) => (b.id === id ? { ...b, props: { ...b.props, ...patch } } : b)));
  }
  function setWidth(id, w) {
    markDirty(blocks.map((b) => (b.id === id ? { ...b, w } : b)));
  }
  function removeBlock(id) {
    markDirty(blocks.filter((b) => b.id !== id));
  }
  function moveBlock(index, dir) {
    const target = index + dir;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    markDirty(next);
  }
  function duplicateBlock(id) {
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx === -1) return;
    const copy = { ...blocks[idx], id: makeBlock(blocks[idx].type).id, props: JSON.parse(JSON.stringify(blocks[idx].props)) };
    const next = [...blocks];
    next.splice(idx + 1, 0, copy);
    markDirty(next);
  }

  // ---- Drag reorder ----
  function handleDrop(targetIndex) {
    const from = dragIndex.current;
    setDragOver(null);
    dragIndex.current = null;
    if (from === null || from === targetIndex) return;
    const next = [...blocks];
    const [moved] = next.splice(from, 1);
    next.splice(targetIndex, 0, moved);
    markDirty(next);
  }

  // ---- Save / cancel ----
  async function handleSave() {
    setSaving(true);
    try {
      await saveHandbook({ blocks: blocks || [], updatedBy: userName || "" });
      setDirty(false);
      setEditing(false);
      showModal?.({ title: "Handbook Saved", message: "Your changes are now live for the whole team.", type: "success" });
    } catch (err) {
      showModal?.({ title: "Save Failed", message: err?.message || "Could not save the handbook.", type: "alert" });
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
          setBlocks(data?.blocks?.length ? data.blocks : []);
          setDirty(false);
          setEditing(false);
        },
      });
    } else {
      setEditing(false);
    }
  }

  function handleClose() {
    if (editing && dirty) {
      showModal?.({
        title: "Discard Changes?",
        message: "You have unsaved handbook changes. Close without saving?",
        type: "confirm",
        onConfirm: onClose,
      });
    } else {
      onClose();
    }
  }

  const lastUpdated = useMemo(() => {
    if (!data?.updatedAt) return null;
    const d = new Date(data.updatedAt);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }, [data]);

  return (
    <div className="handbook-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="handbook-panel" onMouseDown={(e) => e.stopPropagation()}>
        {/* Top bar */}
        <div className="handbook-topbar">
          <h2>
            <Icon name="book" size={20} />
            Programming Handbook
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
                BLOCK_GROUPS.map((grp) => (
                  <div className="hb-palette-section" key={grp.group}>
                    <h4>{grp.group}</h4>
                    {grp.items.map((def) => (
                      <button key={def.type} className="hb-palette-item" onClick={() => addBlock(def.type)}>
                        <Icon name={def.icon} size={16} />
                        {def.label}
                      </button>
                    ))}
                  </div>
                ))
              ) : (
                <div className="hb-palette-section">
                  <h4>Insert a template</h4>
                  {TEMPLATES.map((tpl) => (
                    <button key={tpl.id} className="hb-template-card" onClick={() => addTemplate(tpl.id)}>
                      <div className="tc-name">{tpl.name}</div>
                      <div className="tc-desc">{tpl.desc}</div>
                    </button>
                  ))}
                </div>
              )}
            </aside>
          )}

          {/* Canvas */}
          <div className={`handbook-canvas ${editing ? "is-editing" : ""}`}>
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
                      <button className="hb-btn hb-btn-solid" onClick={() => markDirty(STARTER_BLOCKS())}>
                        <Icon name="layers" size={14} /> Use starter layout
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="hb-grid">
                {blocks.map((block, index) => (
                  <HandbookBlock
                    key={block.id}
                    block={block}
                    editing={editing}
                    index={index}
                    total={blocks.length}
                    isDragOver={dragOver === index}
                    onUpdate={(patch) => updateBlock(block.id, patch)}
                    onSetWidth={(w) => setWidth(block.id, w)}
                    onRemove={() => removeBlock(block.id)}
                    onDuplicate={() => duplicateBlock(block.id)}
                    onMove={(dir) => moveBlock(index, dir)}
                    onDragStart={() => { dragIndex.current = index; }}
                    onDragEnterBlock={() => setDragOver(index)}
                    onDropBlock={() => handleDrop(index)}
                    onDragEnd={() => { dragIndex.current = null; setDragOver(null); }}
                  />
                ))}
              </div>
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
