import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation } from "../data/react";
import { api } from "../data/api";
import { useWorkspace } from "../utils/workspaceContext";
import { sanitizeHtml } from "../utils/sanitizeHtml";
import { workspaceLabel } from "../utils/departments";

const BELL = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

const fmtWhen = (ms, withYear = false) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), hour: "2-digit", minute: "2-digit" });

// An empty contenteditable still holds a <br> or an empty <div>.
const isBlankHtml = (html) => !html || !html.replace(/<br\s*\/?>|<div>|<\/div>|&nbsp;|\s/gi, "");

/**
 * Settings → Announcements (Admin+ and Managers). Write one with a small
 * rich-text editor, preview it exactly as people will see it, and post it to
 * everyone in this workspace. Below: what's been posted here, who has seen
 * each one, and delete.
 */
export default function AnnouncementComposer({ showModal, staff = [] }) {
  const workspace = useWorkspace();
  const label = workspaceLabel(workspace);
  const [title, setTitle] = useState("");
  const [hasBody, setHasBody] = useState(false);
  const [posting, setPosting] = useState(false);
  const [justPosted, setJustPosted] = useState(false);
  // What the detail popup shows: a posted announcement, or { preview: true, … } for the draft.
  const [viewing, setViewing] = useState(null);
  const editorRef = useRef(null);
  const announcements = useQuery(api.announcements.getAnnouncements, { workspace });
  const postAnnouncement = useMutation(api.announcements.postAnnouncement);
  const deleteAnnouncement = useMutation(api.announcements.deleteAnnouncement);
  const userEmail = localStorage.getItem("wf_email") || "";

  // Seen-by lists hold emails; show people's names where we know them.
  const nameOf = (email) => staff.find((s) => (s.email || "").toLowerCase() === String(email).toLowerCase())?.name || email;

  // Esc closes the detail popup (before Settings itself — capture phase).
  useEffect(() => {
    if (!viewing) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape" || document.querySelector(".custom-modal-overlay")) return;
      e.stopPropagation();
      setViewing(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [viewing]);

  useEffect(() => {
    if (!justPosted) return undefined;
    const t = setTimeout(() => setJustPosted(false), 5000);
    return () => clearTimeout(t);
  }, [justPosted]);

  function execCmd(cmd) {
    document.execCommand(cmd, false, null);
    editorRef.current?.focus();
    setHasBody(!isBlankHtml(editorRef.current?.innerHTML));
  }

  // Pasted content can carry scripts / handlers — only clean HTML is used.
  const draftBody = () => sanitizeHtml(editorRef.current?.innerHTML || "").trim();
  const ready = !!title.trim() && hasBody;

  function handlePreview() {
    setViewing({ preview: true, title: title.trim() || "Untitled announcement", body: draftBody(), postedBy: "You", createdAt: Date.now() });
  }

  async function handlePost() {
    const body = draftBody();
    if (!title.trim() || isBlankHtml(body)) {
      showModal({ title: "Almost there", message: "Give the announcement a title and a message.", type: "alert" });
      return;
    }
    if (posting) return;
    setPosting(true);
    try {
      await postAnnouncement({ workspace, title: title.trim(), body, postedByEmail: userEmail });
      setTitle("");
      if (editorRef.current) editorRef.current.innerHTML = "";
      setHasBody(false);
      setViewing(null);
      setJustPosted(true);
    } catch (err) {
      showModal({ title: "Couldn't post it", message: err.message || "Please try again.", type: "alert" });
    } finally {
      setPosting(false);
    }
  }

  function handleDelete(a) {
    showModal({
      title: "Delete announcement?",
      message: `"${a.title}" will be removed for everyone in ${label}. This can't be undone.`,
      type: "confirm",
      onConfirm: async () => {
        try {
          await deleteAnnouncement({ announcementId: a._id });
          setViewing((v) => (v && v._id === a._id ? null : v));
        } catch (err) {
          showModal({ title: "Couldn't delete it", message: err.message || "Please try again.", type: "alert" });
        }
      },
    });
  }

  const list = Array.isArray(announcements) ? announcements : [];

  return (
    <div className="ann-panel">
      {/* ── Write one ── */}
      <div className="settings-card ann-composer">
        <label className="settings-field-label" htmlFor="ann-title">Title</label>
        <input
          id="ann-title"
          type="text"
          className="settings-input ann-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. New: plan projects to a deadline"
          maxLength={140}
        />

        <label className="settings-field-label" style={{ marginTop: 16 }}>Message</label>
        <div className="ann-editor">
          <div className="composer-toolbar" role="toolbar" aria-label="Formatting">
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execCmd("bold")} title="Bold" className="toolbar-btn"><strong>B</strong></button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execCmd("italic")} title="Italic" className="toolbar-btn"><em>I</em></button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execCmd("underline")} title="Underline" className="toolbar-btn"><u>U</u></button>
            <span className="ann-toolbar-sep" aria-hidden="true" />
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execCmd("insertUnorderedList")} title="Bullet list" className="toolbar-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </button>
          </div>
          <div
            ref={editorRef}
            className="composer-editor"
            contentEditable
            role="textbox"
            aria-multiline="true"
            aria-label="Announcement message"
            data-placeholder="What should everyone know? Bold, italics, underline and bullet lists work."
            onInput={(e) => setHasBody(!isBlankHtml(e.currentTarget.innerHTML))}
          />
        </div>

        <div className="ann-compose-foot">
          <span className={`ann-reach ${justPosted ? "posted" : ""}`} aria-live="polite">
            {justPosted
              ? "Posted. It's popping up for everyone in " + label + " now."
              : `Pops up for everyone in ${label}: right away if they're online, otherwise the next time they open Hermes.`}
          </span>
          <button type="button" className="settings-btn-outline" onClick={handlePreview} disabled={!ready}>Preview</button>
          <button type="button" className="settings-btn-primary" onClick={handlePost} disabled={!ready || posting}>
            {posting ? "Posting…" : "Post announcement"}
          </button>
        </div>
      </div>

      {/* ── What's been posted here ── */}
      <div className="ann-history-head">
        <span className="settings-field-label" style={{ margin: 0 }}>Posted in {label}</span>
        {list.length > 0 && <span className="ann-count">{list.length}</span>}
      </div>

      {announcements === undefined ? (
        <div className="ann-list">
          {[0, 1].map((i) => <div key={i} className="ann-row ann-row--loading" />)}
        </div>
      ) : list.length === 0 ? (
        <div className="ann-empty">Nothing posted in {label} yet. Your first announcement will show up here.</div>
      ) : (
        <div className="ann-list">
          {list.map((a, i) => (
            <div
              key={a._id}
              className="ann-row announcement-history-card"
              style={{ "--i": Math.min(i, 8) }}
              role="button"
              tabIndex={0}
              onClick={() => setViewing(a)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setViewing(a); } }}
            >
              <div className="ann-row-top">
                <div className="ann-row-title">{a.title}</div>
                <button
                  type="button"
                  className="ann-row-delete"
                  title="Delete announcement"
                  aria-label={`Delete "${a.title}"`}
                  onClick={(e) => { e.stopPropagation(); handleDelete(a); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                </button>
              </div>
              <div className="ann-row-meta">
                <span>{a.postedBy}</span>
                <span aria-hidden="true">·</span>
                <span>{fmtWhen(a.createdAt)}</span>
                <span className="ann-seen" title={a.seenBy?.length ? a.seenBy.map(nameOf).join(", ") : "No one yet"}>
                  {a.seenBy?.length || 0} seen
                </span>
              </div>
              <div className="ann-row-body" dangerouslySetInnerHTML={{ __html: sanitizeHtml(a.body) }} />
            </div>
          ))}
        </div>
      )}

      {/* ── The announcement as people see it (also the draft preview). On
          <body>, above Settings, like the real pop-up. ── */}
      {viewing && createPortal(
        <div className="announcement-overlay ann-view-overlay" onClick={() => setViewing(null)}>
          <div className="announcement-popup ann-view" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={viewing.title}>
            <div className="announcement-popup-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {BELL}
                <span>{viewing.preview ? "PREVIEW · HOW IT WILL POP UP" : "ANNOUNCEMENT"}</span>
              </div>
              <button className="announcement-close-btn" onClick={() => setViewing(null)} aria-label="Close">×</button>
            </div>

            <h2 className="announcement-popup-title">{viewing.title}</h2>
            <div className="announcement-popup-body" dangerouslySetInnerHTML={{ __html: sanitizeHtml(viewing.body) }} />

            {!viewing.preview && (
              <div className="ann-seen-by">
                <span className="ann-seen-by-label">Seen by {viewing.seenBy?.length || 0}</span>
                {viewing.seenBy?.length ? (
                  <div className="ann-seen-chips">
                    {viewing.seenBy.map((e) => <span key={e} className="ann-seen-chip">{nameOf(e)}</span>)}
                  </div>
                ) : (
                  <span className="ann-seen-none">No one yet.</span>
                )}
              </div>
            )}

            <div className="announcement-popup-footer">
              <span className="announcement-popup-meta">
                {viewing.preview ? <>Goes to everyone in <strong>{label}</strong></> : <>Posted by <strong>{viewing.postedBy}</strong> · {fmtWhen(viewing.createdAt, true)}</>}
              </span>
              {viewing.preview ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="settings-btn-ghost" onClick={() => setViewing(null)}>Keep editing</button>
                  <button className="announcement-dismiss-btn" onClick={handlePost} disabled={posting}>{posting ? "Posting…" : "Post it"}</button>
                </div>
              ) : (
                <button className="announcement-dismiss-btn" onClick={() => setViewing(null)}>Close</button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
