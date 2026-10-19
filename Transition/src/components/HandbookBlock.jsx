import { useState } from "react";
import Select from "./ui/Select";
import { Icon } from "./handbookIcons";
import HandbookChart from "./HandbookChart";
import { accessExampleFor } from "./handbookBlocks";
import { useWorkspace } from "../utils/workspaceContext";

const WIDTH_OPTS = [
  { w: 1, label: "¼" },
  { w: 2, label: "⅓" },
  { w: 3, label: "½" },
  { w: 4, label: "⅔" },
  { w: 9, label: "¾" },
  { w: 6, label: "Full" },
];

const HEADING_ICONS = ["book", "layers", "steps", "timeline", "callout", "cardgrid", "kpi", "chart"];

const TEXT_COLORS = ["#0f172a", "#475569", "#10b981", "#059669", "#6366f1", "#f59e0b", "#f43f5e", "#06b6d4", "#8b5cf6", "#ffffff"];

/* Inline text-color picker: preset swatches + native picker + reset to theme default. */
function ColorRow({ value, onChange }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div className="hb-mini-label">Text color</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <button
          type="button"
          title="Theme default"
          onClick={() => onChange(undefined)}
          style={{ width: 22, height: 22, borderRadius: 6, cursor: "pointer", border: !value ? "2px solid var(--color-accent)" : "1px solid var(--glass-border)", background: "var(--color-bg-subtle)", fontSize: 10, fontWeight: 800, color: "var(--color-text-secondary)" }}
        >A</button>
        {TEXT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            onClick={() => onChange(c)}
            style={{ width: 22, height: 22, borderRadius: 6, cursor: "pointer", background: c, border: value === c ? "2px solid var(--color-accent)" : "1px solid var(--glass-border)" }}
          />
        ))}
        <label title="Custom color" style={{ width: 22, height: 22, borderRadius: 6, overflow: "hidden", border: "1px solid var(--glass-border)", cursor: "pointer", position: "relative", display: "inline-flex" }}>
          <span style={{ fontSize: 12, lineHeight: "20px", width: "100%", textAlign: "center" }}>🎨</span>
          <input type="color" value={value || "#10b981"} onChange={(e) => onChange(e.target.value)} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} />
        </label>
      </div>
    </div>
  );
}

export default function HandbookBlock({
  block, editing, index, total, isDragOver, inSidebar,
  onUpdate, onSetWidth, onRemove, onDuplicate, onMove, onToggleCol,
  onDragStart, onDragEnterBlock, onDropBlock, onDragEnd,
}) {
  const { type, props } = block;
  const isBanner = type === "banner";

  return (
    <div
      className={`hb-block w-${block.w} ${isBanner ? "hb-banner" : ""} ${type === "callout" ? "hb-callout" : ""} ${isDragOver ? "drag-over" : ""}`}
      data-block-id={block.id}
      data-block-type={type}
      onDragOver={editing ? (e) => e.preventDefault() : undefined}
      onDragEnter={editing ? onDragEnterBlock : undefined}
      onDrop={editing ? (e) => { e.preventDefault(); onDropBlock(); } : undefined}
    >
      {editing && (
        <div className="hb-block-toolbar">
          <button
            className="hb-tool-btn hb-drag-handle"
            title="Drag to reorder"
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          ><Icon name="grip" size={14} /></button>
          {!inSidebar && (
            <div className="hb-width-seg" title="Block width">
              {WIDTH_OPTS.map((o) => (
                <button key={o.w} className={block.w === o.w ? "active" : ""} onClick={() => onSetWidth(o.w)}>{o.label}</button>
              ))}
            </div>
          )}
          {onToggleCol && (
            <button className="hb-tool-btn" title="Move to next column (main → right → third)" onClick={onToggleCol}>
              <Icon name="columns" size={13} />
            </button>
          )}
          <button className="hb-tool-btn" title="Move up" disabled={index === 0} onClick={() => onMove(-1)}><Icon name="up" size={14} /></button>
          <button className="hb-tool-btn" title="Move down" disabled={index === total - 1} onClick={() => onMove(1)}><Icon name="down" size={14} /></button>
          <button className="hb-tool-btn" title="Duplicate" onClick={onDuplicate}><Icon name="copy" size={13} /></button>
          <button className="hb-tool-btn danger" title="Delete" onClick={onRemove}><Icon name="trash" size={13} /></button>
        </div>
      )}

      <BlockContent type={type} props={props} editing={editing} onUpdate={onUpdate} />
    </div>
  );
}

function BlockContent({ type, props, editing, onUpdate }) {
  switch (type) {
    case "banner":
      return editing ? (
        <>
          <input className="hb-edit-input" style={{ fontSize: "1.3rem", fontWeight: 900, marginBottom: 8 }} value={props.title} placeholder="Banner title" onChange={(e) => onUpdate({ title: e.target.value })} />
          <input className="hb-edit-input" value={props.subtitle} placeholder="Subtitle" onChange={(e) => onUpdate({ subtitle: e.target.value })} />
          <ColorRow value={props.color} onChange={(c) => onUpdate({ color: c })} />
        </>
      ) : (
        <>
          <h1 style={props.color ? { color: props.color } : undefined}><Icon name="layers" size={22} />{props.title}</h1>
          {props.subtitle ? <p>{props.subtitle}</p> : null}
        </>
      );

    case "heading":
      return editing ? (
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Select size="sm" className="hb-icon-select" value={props.icon || "book"} onChange={(v) => onUpdate({ icon: v })}
              options={HEADING_ICONS.map((ic) => ({ value: ic, label: ic }))} ariaLabel="Heading icon" />
            <input className="hb-edit-input" style={{ fontWeight: 800 }} value={props.text} placeholder="Heading text" onChange={(e) => onUpdate({ text: e.target.value })} />
          </div>
          <ColorRow value={props.color} onChange={(c) => onUpdate({ color: c })} />
        </div>
      ) : (
        <h3 className="hb-heading" style={props.color ? { color: props.color } : undefined}><Icon name={props.icon || "book"} size={20} />{props.text}</h3>
      );

    case "text":
      return editing ? (
        <>
          <textarea className="hb-edit-area" rows={5} value={props.body} placeholder="Write your content…" onChange={(e) => onUpdate({ body: e.target.value })} />
          <div className="hb-mini-label" style={{ marginTop: 6 }}>Tip: wrap sensitive text in double pipes — ||likeThis|| — to mask it with hover-to-reveal and copy.</div>
          <ColorRow value={props.color} onChange={(c) => onUpdate({ color: c })} />
        </>
      ) : (
        <TextWithSecrets body={props.body} style={props.color ? { color: props.color } : undefined} />
      );

    case "callout":
      return editing ? (
        <div style={{ flex: 1 }}>
          <div className="hb-mini-label">Callout title</div>
          <input className="hb-edit-input" value={props.title} placeholder="Title" onChange={(e) => onUpdate({ title: e.target.value })} />
          <div className="hb-mini-label">Body</div>
          <textarea className="hb-edit-area" rows={2} value={props.body} placeholder="Reminder text" onChange={(e) => onUpdate({ body: e.target.value })} />
          <ColorRow value={props.color} onChange={(c) => onUpdate({ color: c })} />
        </div>
      ) : (
        <>
          <span className="ic"><Icon name="callout" size={20} /></span>
          <div>
            <div className="hb-callout-title" style={props.color ? { color: props.color } : undefined}>{props.title}</div>
            <div className="hb-callout-body" style={props.color ? { color: props.color } : undefined}>{props.body}</div>
          </div>
        </>
      );

    case "quote":
      return editing ? (
        <div>
          <div className="hb-mini-label">Quote</div>
          <textarea className="hb-edit-area" rows={3} value={props.text} placeholder="Quote text" onChange={(e) => onUpdate({ text: e.target.value })} />
          <div className="hb-mini-label">Attribution</div>
          <input className="hb-edit-input" value={props.author} placeholder="Author / source" onChange={(e) => onUpdate({ author: e.target.value })} />
          <ColorRow value={props.color} onChange={(c) => onUpdate({ color: c })} />
        </div>
      ) : (
        <blockquote className="hb-quote" style={props.color ? { color: props.color } : undefined}>
          <span className="hb-quote-mark">“</span>
          <span className="hb-quote-text">{props.text}</span>
          {props.author ? <cite className="hb-quote-author">— {props.author}</cite> : null}
        </blockquote>
      );

    case "checklist":
      return <ChecklistBlock props={props} editing={editing} onUpdate={onUpdate} />;

    case "timeline":
      return <ListEditor
        editing={editing}
        items={props.items || []}
        fields={[{ key: "title", placeholder: "Step title" }, { key: "desc", placeholder: "Description", area: true }]}
        onChange={(items) => onUpdate({ items })}
        render={(items) => (
          <ul className="hb-timeline">
            {items.map((it, i) => (
              <li key={i} className="hb-timeline-item" style={{ "--i": i }}>
                <div className="hb-timeline-title">{it.title}</div>
                <div className="hb-timeline-desc">{it.desc}</div>
              </li>
            ))}
          </ul>
        )}
        newItem={{ title: "New step", desc: "" }}
      />;

    case "steps":
      return <ListEditor
        editing={editing}
        items={props.items || []}
        fields={[{ key: "title", placeholder: "Step title" }, { key: "desc", placeholder: "Description", area: true }]}
        onChange={(items) => onUpdate({ items })}
        render={(items) => (
          <div className="hb-steps">
            {items.map((it, i) => (
              <div key={i} className="hb-step" style={{ "--i": i }}>
                <div className="hb-step-num">{i + 1}</div>
                <div>
                  <div className="hb-step-title">{it.title}</div>
                  <div className="hb-step-desc">{it.desc}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        newItem={{ title: "New step", desc: "" }}
      />;

    case "cardgrid":
      return <ListEditor
        editing={editing}
        items={props.columns || []}
        fields={[{ key: "title", placeholder: "Card title" }, { key: "body", placeholder: "Card body", area: true }]}
        onChange={(columns) => onUpdate({ columns })}
        render={(columns) => (
          <div className="hb-cardgrid">
            {columns.map((c, i) => (
              <div key={i} className="hb-subcard" style={{ "--i": i }}>
                <div className="sc-icon"><Icon name={c.icon || "layers"} size={20} /></div>
                <div className="sc-title">{c.title}</div>
                <div className="sc-body">{c.body}</div>
              </div>
            ))}
          </div>
        )}
        newItem={{ icon: "layers", title: "New Card", body: "" }}
      />;

    case "kpis":
      return <ListEditor
        editing={editing}
        items={props.items || []}
        fields={[{ key: "value", placeholder: "Value" }, { key: "label", placeholder: "Label" }]}
        onChange={(items) => onUpdate({ items })}
        render={(items) => (
          <div className="hb-kpis">
            {items.map((k, i) => (
              <div key={i} className="hb-kpi" style={{ "--i": i }}>
                <div className="hb-kpi-value">{k.value}</div>
                <div className="hb-kpi-label">{k.label}</div>
              </div>
            ))}
          </div>
        )}
        newItem={{ value: "0", label: "Metric" }}
      />;

    case "chart":
      return <ChartEditor props={props} editing={editing} onUpdate={onUpdate} />;

    case "image":
      return editing ? (
        <div>
          <div className="hb-mini-label">Image URL</div>
          <input className="hb-edit-input" value={props.url} placeholder="https://…" onChange={(e) => onUpdate({ url: e.target.value })} />
          <div className="hb-mini-label">Alt text</div>
          <input className="hb-edit-input" value={props.alt} placeholder="Describe the image" onChange={(e) => onUpdate({ alt: e.target.value })} />
          {props.url ? <div className="hb-image-wrap" style={{ marginTop: 10 }}><img src={props.url} alt={props.alt} /></div> : null}
        </div>
      ) : props.url ? (
        <div className="hb-image-wrap"><img src={props.url} alt={props.alt} /></div>
      ) : (
        <div className="hb-image-empty"><Icon name="image" size={28} />No image set</div>
      );

    case "access":
      return <AccessBlock props={props} editing={editing} onUpdate={onUpdate} />;

    case "divider":
      return <hr className="hb-divider-line" />;

    default:
      return <div className="hb-text">{JSON.stringify(props)}</div>;
  }
}

/* A value masked as dots; hover reveals it and shows a copy button. */
export function SecretValue({ value }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="hb-secret-empty">—</span>;
  return (
    <span className="hb-secret" onMouseEnter={() => setRevealed(true)} onMouseLeave={() => setRevealed(false)}>
      <span className="hb-secret-value">{revealed ? value : "•".repeat(Math.min(Math.max(value.length, 8), 14))}</span>
      <button
        type="button"
        className={`hb-secret-copy ${copied ? "copied" : ""}`}
        title="Copy"
        onClick={() => {
          navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        <Icon name={copied ? "check" : "copy"} size={11} />
      </button>
    </span>
  );
}

/* Access column: an optional heading with any number of credential cards
   stacked inside one block — designed to sit as a ¼-width sidebar. */
function AccessBlock({ props, editing, onUpdate }) {
  const workspace = useWorkspace();
  // Normalize the earlier single-card shape ({title, items}) into cards[].
  const cards = props.cards || (props.items ? [{ title: props.title || "Access", items: props.items }] : []);

  if (!editing) {
    return (
      <div>
        {props.heading ? <div className="hb-access-col-heading"><Icon name="lock" size={13} />{props.heading}</div> : null}
        <div className="hb-access-cards">
          {cards.map((card, ci) => (
            <div key={ci} className="hb-access-card" style={{ "--i": ci }}>
              <div className="hb-access-title"><Icon name="lock" size={12} />{card.title}</div>
              {(card.items || []).map((it, i) => (
                <div key={i} className="hb-access-row">
                  <span className="hb-access-label">{it.label}</span>
                  <SecretValue value={it.value} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  function patchCards(next) { onUpdate({ cards: next }); }
  function patchCard(ci, patch) { patchCards(cards.map((c, i) => (i === ci ? { ...c, ...patch } : c))); }
  function moveCard(ci, dir) {
    const t = ci + dir;
    if (t < 0 || t >= cards.length) return;
    const next = cards.map((c) => c);
    [next[ci], next[t]] = [next[t], next[ci]];
    patchCards(next);
  }
  function patchItem(ci, ii, key, val) {
    patchCard(ci, { items: cards[ci].items.map((it, i) => (i === ii ? { ...it, [key]: val } : it)) });
  }

  return (
    <div>
      <div className="hb-mini-label">Column heading</div>
      <input className="hb-edit-input" style={{ marginBottom: 10 }} value={props.heading || ""} placeholder="e.g. Universal Access Information" onChange={(e) => onUpdate({ heading: e.target.value })} />
      <div className="hb-mini-label">Access cards</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {cards.map((card, ci) => (
          <div key={ci} style={{ border: "1px dashed var(--glass-border)", borderRadius: 10, padding: 10 }}>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginBottom: 6 }}>
              <button className="hb-tool-btn" title="Up" disabled={ci === 0} onClick={() => moveCard(ci, -1)}><Icon name="up" size={12} /></button>
              <button className="hb-tool-btn" title="Down" disabled={ci === cards.length - 1} onClick={() => moveCard(ci, 1)}><Icon name="down" size={12} /></button>
              <button className="hb-tool-btn danger" title="Remove card" onClick={() => patchCards(cards.filter((_, i) => i !== ci))}><Icon name="trash" size={12} /></button>
            </div>
            <input className="hb-edit-input" style={{ marginBottom: 6, fontWeight: 800 }} value={card.title || ""} placeholder={`Card title (e.g. ${accessExampleFor(workspace)})`} onChange={(e) => patchCard(ci, { title: e.target.value })} />
            {(card.items || []).map((it, ii) => (
              <div key={ii} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <input className="hb-edit-input" style={{ flex: 1 }} value={it.label || ""} placeholder="Label" onChange={(e) => patchItem(ci, ii, "label", e.target.value)} />
                <input className="hb-edit-input" style={{ flex: 2 }} value={it.value || ""} placeholder="Secret value" onChange={(e) => patchItem(ci, ii, "value", e.target.value)} />
                <button className="hb-tool-btn danger" title="Remove row" onClick={() => patchCard(ci, { items: card.items.filter((_, i) => i !== ii) })}><Icon name="trash" size={12} /></button>
              </div>
            ))}
            <button className="hb-btn hb-btn-ghost" style={{ justifyContent: "center", width: "100%" }} onClick={() => patchCard(ci, { items: [...(card.items || []), { label: "Label", value: "" }] })}>
              <Icon name="plus" size={13} /> Add row
            </button>
          </div>
        ))}
        <button className="hb-btn hb-btn-ghost" style={{ justifyContent: "center" }} onClick={() => patchCards([...cards, { title: "New Tool", items: [{ label: "User ID", value: "" }, { label: "Password", value: "" }] }])}>
          <Icon name="plus" size={14} /> Add access card
        </button>
      </div>
    </div>
  );
}

/* Text block body with ||secret|| segments rendered as masked SecretValues. */
function TextWithSecrets({ body, style }) {
  const parts = String(body || "").split(/\|\|([^|]+)\|\|/g);
  if (parts.length === 1) return <div className="hb-text" style={style}>{body}</div>;
  return (
    <div className="hb-text" style={style}>
      {parts.map((part, i) => (i % 2 === 1 ? <SecretValue key={i} value={part} /> : part))}
    </div>
  );
}

/* Generic add/remove/edit list of objects with text fields. */
function ListEditor({ editing, items, fields, onChange, render, newItem }) {
  if (!editing) return render(items);

  function patch(i, key, val) {
    const next = items.map((it, idx) => (idx === i ? { ...it, [key]: val } : it));
    onChange(next);
  }
  function remove(i) { onChange(items.filter((_, idx) => idx !== i)); }
  function add() { onChange([...items, { ...newItem }]); }
  function move(i, dir) {
    const t = i + dir;
    if (t < 0 || t >= items.length) return;
    const next = [...items];
    [next[i], next[t]] = [next[t], next[i]];
    onChange(next);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((it, i) => (
        <div key={i} style={{ border: "1px dashed var(--glass-border)", borderRadius: 10, padding: 10, position: "relative" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginBottom: 6 }}>
            <button className="hb-tool-btn" title="Up" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" size={12} /></button>
            <button className="hb-tool-btn" title="Down" disabled={i === items.length - 1} onClick={() => move(i, 1)}><Icon name="down" size={12} /></button>
            <button className="hb-tool-btn danger" title="Remove" onClick={() => remove(i)}><Icon name="trash" size={12} /></button>
          </div>
          {fields.map((f) => (
            f.area ? (
              <textarea key={f.key} className="hb-edit-area" style={{ marginBottom: 6 }} rows={2} value={it[f.key] || ""} placeholder={f.placeholder} onChange={(e) => patch(i, f.key, e.target.value)} />
            ) : (
              <input key={f.key} className="hb-edit-input" style={{ marginBottom: 6 }} value={it[f.key] || ""} placeholder={f.placeholder} onChange={(e) => patch(i, f.key, e.target.value)} />
            )
          ))}
        </div>
      ))}
      <button className="hb-btn hb-btn-ghost" style={{ justifyContent: "center" }} onClick={add}><Icon name="plus" size={14} /> Add item</button>
    </div>
  );
}

function ChecklistBlock({ props, editing, onUpdate }) {
  const items = props.items || [];
  if (!editing) {
    return (
      <div>
        {props.title ? <div className="hb-heading" style={{ fontSize: "0.95rem", marginBottom: 12 }}><Icon name="check" size={18} />{props.title}</div> : null}
        <div className="hb-checklist">
          {items.map((it, i) => (
            <div key={i} className={`hb-check-item ${it.done ? "done" : ""}`} style={{ "--i": i }}>
              <span className="hb-check-box">{it.done ? <Icon name="check" size={12} className="hbm-draw" /> : null}</span>
              <span className="hb-check-text">{it.text}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  function patch(i, key, val) { onUpdate({ items: items.map((it, idx) => (idx === i ? { ...it, [key]: val } : it)) }); }
  function remove(i) { onUpdate({ items: items.filter((_, idx) => idx !== i) }); }
  function add() { onUpdate({ items: [...items, { text: "New item", done: false }] }); }
  return (
    <div>
      <div className="hb-mini-label">Checklist title</div>
      <input className="hb-edit-input" value={props.title || ""} placeholder="Title (optional)" onChange={(e) => onUpdate({ title: e.target.value })} />
      <div className="hb-mini-label">Items</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((it, i) => (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button className={`hb-tool-btn hbm-tick ${it.done ? "is-on" : ""}`} title="Toggle done" onClick={() => patch(i, "done", !it.done)}
              style={{ background: it.done ? "var(--color-accent)" : "var(--color-bg-subtle)", color: it.done ? "#fff" : "var(--color-text-secondary)", flexShrink: 0 }}>
              {/* Re-keyed so ticking mounts a fresh check that draws itself in. */}
              <Icon key={it.done ? "on" : "off"} name="check" size={12} className={it.done ? "hbm-draw hbm-draw-now" : undefined} />
            </button>
            <input className="hb-edit-input" value={it.text} placeholder="Item text" onChange={(e) => patch(i, "text", e.target.value)} />
            <button className="hb-tool-btn danger" onClick={() => remove(i)}><Icon name="trash" size={12} /></button>
          </div>
        ))}
        <button className="hb-btn hb-btn-ghost" style={{ justifyContent: "center" }} onClick={add}><Icon name="plus" size={14} /> Add item</button>
      </div>
    </div>
  );
}

function ChartEditor({ props, editing, onUpdate }) {
  if (!editing) return <HandbookChart kind={props.kind} title={props.title} data={props.data} />;

  const data = props.data || [];
  function patch(i, key, val) {
    onUpdate({ data: data.map((d, idx) => (idx === i ? { ...d, [key]: key === "value" ? val : val } : d)) });
  }
  function remove(i) { onUpdate({ data: data.filter((_, idx) => idx !== i) }); }
  function add() { onUpdate({ data: [...data, { label: "Item", value: 1 }] }); }

  return (
    <div>
      <div className="hb-mini-label">Chart title</div>
      <input className="hb-edit-input" value={props.title || ""} placeholder="Chart title" onChange={(e) => onUpdate({ title: e.target.value })} />
      <div className="hb-mini-label">Chart type</div>
      <Select value={props.kind} onChange={(v) => onUpdate({ kind: v })} ariaLabel="Chart type" options={[
        { value: "bar", label: "Bar (vertical)" },
        { value: "hbar", label: "Bar (horizontal)" },
        { value: "line", label: "Line" },
        { value: "area", label: "Area" },
        { value: "pie", label: "Pie" },
        { value: "donut", label: "Donut" },
        { value: "progress", label: "Progress bars" },
        { value: "radial", label: "Radial rings" },
      ]} />
      <div className="hb-mini-label">Data points</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: "flex", gap: 6 }}>
            <input className="hb-edit-input" style={{ flex: 2 }} value={d.label} placeholder="Label" onChange={(e) => patch(i, "label", e.target.value)} />
            <input className="hb-edit-input" style={{ flex: 1 }} type="number" value={d.value} placeholder="Value" onChange={(e) => patch(i, "value", Number(e.target.value))} />
            <button className="hb-tool-btn danger" onClick={() => remove(i)}><Icon name="trash" size={12} /></button>
          </div>
        ))}
        <button className="hb-btn hb-btn-ghost" style={{ justifyContent: "center" }} onClick={add}><Icon name="plus" size={14} /> Add point</button>
      </div>
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px dashed var(--glass-border)" }}>
        <HandbookChart kind={props.kind} title={props.title} data={props.data} />
      </div>
    </div>
  );
}
