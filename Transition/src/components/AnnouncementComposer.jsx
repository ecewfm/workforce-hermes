import { useState, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useWorkspace } from "../utils/workspaceContext";

/**
 * AnnouncementComposer — visible only to Admin+ users.
 * Rich text editor using contenteditable with Bold/Italic/Underline toolbar.
 */
export default function AnnouncementComposer({ userName, showModal }) {
  const workspace = useWorkspace();
  const [title, setTitle] = useState("");
  const [selectedAnnouncement, setSelectedAnnouncement] = useState(null);
  const editorRef = useRef(null);
  const announcements = useQuery(api.announcements.getAnnouncements, { workspace });
  const postAnnouncement = useMutation(api.announcements.postAnnouncement);
  const deleteAnnouncement = useMutation(api.announcements.deleteAnnouncement);
  const userEmail = localStorage.getItem("wf_email") || "";

  function execCmd(cmd, value = null) {
    document.execCommand(cmd, false, value);
    editorRef.current?.focus();
  }

  function handlePost() {
    const body = editorRef.current?.innerHTML?.trim();
    if (!title.trim() || !body || body === "<br>" || body === "<div><br></div>") {
      showModal({ title: "Error", message: "Please enter both a title and body for the announcement.", type: "alert" });
      return;
    }
    postAnnouncement({
      workspace,
      title: title.trim(),
      body,
      postedBy: userName,
      postedByEmail: userEmail,
    });
    setTitle("");
    if (editorRef.current) editorRef.current.innerHTML = "";
    showModal({ title: "Posted!", message: "Your announcement has been sent to all users.", type: "success" });
  }

  function handleDelete(id) {
    showModal({
      title: "Delete Announcement",
      message: "Are you sure you want to permanently delete this announcement?",
      type: "confirm",
      onConfirm: () => deleteAnnouncement({ announcementId: id }),
    });
  }

  return (
    <div id="announcements-view" className="view-section">
      <div className="container">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 40 }}>

          {/* Composer */}
          <div className="section-card" style={{ padding: 35, borderRadius: "var(--radius-lg)" }}>
            <h2 style={{ fontWeight: 900, marginTop: 0, textTransform: "uppercase", fontSize: "1rem", marginBottom: 25, display: "flex", alignItems: "center", gap: 10 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              Post Announcement
            </h2>

            <div className="form-group" style={{ marginBottom: 15 }}>
              <label className="form-label" style={{ fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.5px", color: "#64748b" }}>Title</label>
              <input
                type="text"
                className="form-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Announcement title..."
                style={{ fontSize: "0.9rem", fontWeight: 700 }}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 15 }}>
              <label className="form-label" style={{ fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.5px", color: "#64748b" }}>Body</label>

              {/* Toolbar */}
              <div className="composer-toolbar">
                <button type="button" onClick={() => execCmd("bold")} title="Bold" className="toolbar-btn">
                  <strong>B</strong>
                </button>
                <button type="button" onClick={() => execCmd("italic")} title="Italic" className="toolbar-btn">
                  <em>I</em>
                </button>
                <button type="button" onClick={() => execCmd("underline")} title="Underline" className="toolbar-btn">
                  <u>U</u>
                </button>
                <div style={{ width: 1, height: 18, background: "#e2e8f0", margin: "0 4px" }} />
                <button type="button" onClick={() => execCmd("insertUnorderedList")} title="Bullet List" className="toolbar-btn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="8" y1="6" x2="21" y2="6" />
                    <line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" />
                    <line x1="3" y1="12" x2="3.01" y2="12" />
                    <line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                </button>
              </div>

              {/* Editable area */}
              <div
                ref={editorRef}
                className="composer-editor"
                contentEditable
                data-placeholder="Write your announcement here... (supports rich text)"
                onKeyDown={(e) => {
                  // Enter creates a new line — default browser behavior for contenteditable
                }}
              />
            </div>

            <button className="btn-primary" style={{ width: "100%", padding: "12px", fontSize: "0.8rem", fontWeight: 900, letterSpacing: "0.5px" }} onClick={handlePost}>
              📢 POST ANNOUNCEMENT
            </button>
          </div>

          {/* Past announcements */}
          <div className="section-card" style={{ padding: 35, borderRadius: "var(--radius-lg)" }}>
            <h2 style={{ fontWeight: 900, marginTop: 0, textTransform: "uppercase", fontSize: "1rem", marginBottom: 25 }}>
              Past Announcements
            </h2>

            {(!announcements || announcements.length === 0) ? (
              <div style={{ textAlign: "center", color: "#94a3b8", fontStyle: "italic", padding: 40 }}>
                No announcements posted yet.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: "60vh", overflowY: "auto", paddingRight: 5 }}>
                {announcements.map((a) => (
                <div key={a._id} className="announcement-history-card" onClick={() => setSelectedAnnouncement(a)} style={{ cursor: "pointer", transition: "all 0.2s ease" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <h4 style={{ margin: "0 0 4px 0", fontWeight: 800, fontSize: "0.85rem", color: "var(--color-text-primary)" }}>{a.title}</h4>
                        <span style={{ fontSize: "0.6rem", color: "#94a3b8", fontWeight: 700 }}>
                          {a.postedBy} · {new Date(a.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          {" · "}
                          <span style={{ color: "#10b981", cursor: "help" }} title={a.seenBy?.length > 0 ? a.seenBy.join(', ') : 'No one yet'}>
                            {a.seenBy?.length || 0} seen
                          </span>
                        </span>
                      </div>
                      <button
                        onClick={() => handleDelete(a._id)}
                        style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "1.1rem", padding: "2px 6px", borderRadius: 6, transition: "0.2s" }}
                        title="Delete announcement"
                        onMouseOver={(e) => e.currentTarget.style.color = "#ef4444"}
                        onMouseOut={(e) => e.currentTarget.style.color = "#94a3b8"}
                      >
                        ×
                      </button>
                    </div>
                    <div
                      className="announcement-history-body"
                      style={{ color: "var(--color-text-secondary)" }}
                      dangerouslySetInnerHTML={{ __html: a.body }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Detailed Announcement Modal */}
          {selectedAnnouncement && (
            <div className="announcement-overlay" onClick={() => setSelectedAnnouncement(null)} style={{ zIndex: 9999 }}>
              <div className="announcement-popup" onClick={(e) => e.stopPropagation()} style={{ width: "90%", maxWidth: "800px" }}>
                <div className="announcement-popup-header">
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                    <span>ANNOUNCEMENT DETAILS</span>
                  </div>
                  <button className="announcement-close-btn" onClick={() => setSelectedAnnouncement(null)}>×</button>
                </div>

                <h2 className="announcement-popup-title" style={{ color: "var(--color-text-primary)" }}>{selectedAnnouncement.title}</h2>

                <div
                  className="announcement-popup-body"
                  style={{ color: "var(--color-text-secondary)", minHeight: "200px" }}
                  dangerouslySetInnerHTML={{ __html: selectedAnnouncement.body }}
                />

                <div className="announcement-popup-footer">
                  <span className="announcement-popup-meta">
                    Posted by <strong>{selectedAnnouncement.postedBy}</strong> · {new Date(selectedAnnouncement.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <button className="announcement-dismiss-btn" onClick={() => setSelectedAnnouncement(null)}>
                    Close View
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
