import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Text you edit in place: double-click a sentence (or focus it and press
 * Enter / F2) and it becomes a field. Enter saves (Ctrl+Enter when it's
 * multi-line), Esc cancels, clicking away saves.
 *
 *   <EditableText value={plan.title} onChange={(v) => …} as="h2" className="consult-plan-title" />
 */
export default function EditableText({
  value, onChange, as: Tag = "span", multiline = false, className = "",
  placeholder = "Double-click to add…", ariaLabel,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const ref = useRef(null);

  useEffect(() => { if (!editing) setDraft(value || ""); }, [value, editing]);

  const fit = () => {
    const el = ref.current;
    if (!el || !multiline) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(() => {
    if (!editing || !ref.current) return;
    ref.current.focus();
    ref.current.select?.();
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v !== (value || "").trim()) onChange?.(v);
  };
  const cancel = () => { setEditing(false); setDraft(value || ""); };

  if (editing) {
    const Field = multiline ? "textarea" : "input";
    return (
      <Field
        ref={ref}
        className={`editable-input ${className}`}
        value={draft}
        rows={multiline ? 1 : undefined}
        aria-label={ariaLabel}
        onChange={(e) => { setDraft(e.target.value); fit(); }}
        onBlur={commit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); }
          else if (e.key === "Enter" && (!multiline || e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
        }}
      />
    );
  }
  return (
    <Tag
      className={`editable-text ${className} ${value ? "" : "empty"}`}
      title="Double-click to edit"
      tabIndex={0}
      aria-label={ariaLabel}
      onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditing(true); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); setEditing(true); } }}
    >
      {value || placeholder}
    </Tag>
  );
}
