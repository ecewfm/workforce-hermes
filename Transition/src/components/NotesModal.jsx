import { useState } from "react";
import { useQuery, useMutation } from "../data/react";
import { api } from "../data/api";

/**
 * Lightweight, standalone notes viewer/composer opened directly from the Kanban
 * card's note wing — WITHOUT opening the full TaskModal behind it. Shows the
 * task's updates (newest first) and lets the user post a new one.
 */
export default function NotesModal({ taskId, userName, onClose, showModal }) {
  const task = useQuery(api.tasks.getTaskById, taskId ? { taskId } : "skip");
  const addNoteToTask = useMutation(api.tasks.addNoteToTask);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);

  const notes = task?.notes || [];

  async function handleAdd() {
    const body = text.trim();
    if (!body || posting) return;
    const estDate = new Date().toLocaleString("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    setPosting(true);
    try {
      await addNoteToTask({
        taskId,
        noteText: body,
        writer: userName,
        writerEmail: (localStorage.getItem("wf_email") || "").toLowerCase(),
        date: estDate,
      });
      setText("");
    } catch (err) {
      if (showModal) showModal({ title: "Error", message: err.message || "Failed to post the update.", type: "alert" });
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="notes-fullscreen-overlay" style={{ zIndex: 3000 }} onClick={onClose}>
      <div
        className="notes-fullscreen-card"
        onClick={(e) => e.stopPropagation()}
        style={{ display: "flex", flexDirection: "column", width: "92%", maxWidth: 620, maxHeight: "82vh" }}
      >
        <div className="notes-fullscreen-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              NOTES &amp; UPDATES{task?.title ? ` · ${task.title}` : ""}
            </span>
          </div>
          <button className="announcement-close-btn" onClick={onClose}>×</button>
        </div>

        <div style={{ padding: 16, overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
          {task === undefined ? (
            <div style={{ textAlign: "center", color: "var(--color-text-secondary)", fontStyle: "italic", marginTop: 30, fontSize: "0.82rem" }}>
              Loading updates…
            </div>
          ) : notes.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--color-text-secondary)", fontStyle: "italic", marginTop: 30, fontSize: "0.82rem" }}>
              No updates yet. Be the first to post one.
            </div>
          ) : (
            notes
              .map((n, i) => ({ n, i }))
              .reverse()
              .map(({ n, i }) => (
                <div
                  key={i}
                  style={{ background: "var(--color-bg-subtle)", border: "1px solid var(--glass-border)", borderRadius: 10, padding: "10px 12px" }}
                >
                  <div style={{ fontSize: "0.62rem", fontWeight: 800, color: "var(--color-accent)", marginBottom: 4 }}>
                    {n.date}{n.writer ? ` — ${n.writer}` : ""}
                  </div>
                  <div style={{ fontSize: "0.82rem", lineHeight: 1.45, color: "var(--color-text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {n.text}
                  </div>
                </div>
              ))
          )}
        </div>

        <div style={{ padding: 16, borderTop: "1px solid var(--glass-border)", display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Share an update…  (Ctrl+Enter to post)"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleAdd(); } }}
            style={{ flex: 1, minHeight: 62, resize: "vertical", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--glass-border)", background: "var(--color-card-bg)", color: "var(--color-text-primary)", fontSize: "0.85rem", fontFamily: "inherit" }}
          />
          <button
            onClick={handleAdd}
            disabled={posting || !text.trim()}
            style={{ background: "var(--color-nav-bg)", color: "#fff", border: "none", padding: "11px 22px", borderRadius: 10, fontWeight: 800, fontSize: "0.8rem", cursor: posting || !text.trim() ? "not-allowed" : "pointer", opacity: posting || !text.trim() ? 0.55 : 1, whiteSpace: "nowrap" }}
          >
            {posting ? "Posting…" : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
}
