import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useWorkspace } from "../utils/workspaceContext";

/**
 * AnnouncementPopup — shows one unseen announcement at a time as a modal overlay.
 * Convex reactivity means this will auto-appear when an Admin+ posts a new one.
 * Scoped to the active workspace.
 */
export default function AnnouncementPopup() {
  const workspace = useWorkspace();
  const userEmail = localStorage.getItem("wf_email") || "";
  const unseen = useQuery(api.announcements.getUnseenAnnouncement, { userEmail, workspace });
  const markSeen = useMutation(api.announcements.markAnnouncementSeen);

  if (!unseen) return null;

  function handleDismiss() {
    markSeen({ announcementId: unseen._id, userEmail });
  }

  return (
    <div className="announcement-overlay" onClick={handleDismiss}>
      <div className="announcement-popup" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="announcement-popup-header">
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span>NEW ANNOUNCEMENT</span>
          </div>
          <button className="announcement-close-btn" onClick={handleDismiss}>×</button>
        </div>

        {/* Title */}
        <h2 className="announcement-popup-title">{unseen.title}</h2>

        {/* Body — rendered as HTML for rich text */}
        <div
          className="announcement-popup-body"
          dangerouslySetInnerHTML={{ __html: unseen.body }}
        />

        {/* Footer */}
        <div className="announcement-popup-footer">
          <span className="announcement-popup-meta">
            Posted by <strong>{unseen.postedBy}</strong> · {new Date(unseen.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          </span>
          <button className="announcement-dismiss-btn" onClick={handleDismiss}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
