import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { sendNotification, initNotifications } from "../utils/notifications";

/**
 * NotificationBell — sits beside the Settings gear in the header.
 * 
 * Bandwidth strategy:
 * - Unread count: Convex realtime (tiny payload, keeps badge live)
 * - Full notification list: Vercel proxy with edge cache (fetched on dropdown open)
 * - Mutations (markRead, markAllRead): Direct Convex
 */
export default function NotificationBell({ userEmail, onOpenTask }) {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState(null);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const panelRef = useRef(null);

  // Unread count and latest notification (for desktop banners)
  const unreadCount = useQuery(api.notifications.getUnreadCount, { email: userEmail || "" });
  const latestNotif = useQuery(api.notifications.getLatestNotification, { email: userEmail || "" });
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);

  const lastSeenNotifId = useRef(null);

  const [showAllModal, setShowAllModal] = useState(false);

  // Initialize browser notifications on mount
  useEffect(() => {
    initNotifications();
  }, []);

  // Trigger desktop banner when a NEW unread notification arrives
  useEffect(() => {
    if (latestNotif && !latestNotif.read && latestNotif._id !== lastSeenNotifId.current) {
      lastSeenNotifId.current = latestNotif._id;
      
      const titleByType = {
        mention: "New Mention",
        manager_overdue: "⏰ Project Overdue",
        manager_stale: "💤 Project Inactive",
        manager_bug: "🐞 New Bug Reported",
        manager_feature: "✨ Feature Update",
      };
      const title = titleByType[latestNotif.type] || "Project Update";
      sendNotification(title, {
        body: `${latestNotif.actorName} ${latestNotif.message}`,
        tag: latestNotif._id, // Unique tag per notification
      });
    }
  }, [latestNotif]);

  // Fetch full list via Vercel proxy (edge-cached, saves Convex bandwidth)
  const fetchNotifications = useCallback(async () => {
    if (!userEmail) return;
    setIsLoadingList(true);
    try {
      const resp = await fetch(`/api/getNotifications?email=${encodeURIComponent(userEmail)}`);
      if (resp.ok) {
        const data = await resp.json();
        setNotifications(data);
      }
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    } finally {
      setIsLoadingList(false);
    }
  }, [userEmail]);

  // Fetch on dropdown open
  useEffect(() => {
    if (isOpen) fetchNotifications();
  }, [isOpen, fetchNotifications]);

  // Refresh list when unread count changes (new notification arrived)
  useEffect(() => {
    if (isOpen && unreadCount !== undefined) {
      fetchNotifications();
    }
  }, [unreadCount]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  const getIcon = (type) => {
    switch (type) {
      case "mention":
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.5">
            <circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
          </svg>
        );
      case "reaction":
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" />
          </svg>
        );
      case "manager_overdue":
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5">
            <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" />
          </svg>
        );
      case "manager_stale":
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        );
      case "manager_bug":
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5">
            <rect x="8" y="6" width="8" height="14" rx="4" /><path d="M19 7l-3 2M5 7l3 2M19 13h-3M8 13H5M19 19l-3-2M5 19l3-2M12 2v4" />
          </svg>
        );
      case "manager_feature":
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5">
            <polygon points="12 2 15 9 22 9.5 17 14.5 18.5 21.5 12 17.5 5.5 21.5 7 14.5 2 9.5 9 9" />
          </svg>
        );
      default: // project_change
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" />
          </svg>
        );
    }
  };

  const formatTime = (ts) => {
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const handleNotificationClick = async (notif) => {
    if (!notif.read) {
      await markRead({ notificationId: notif._id });
      // Optimistically update local state
      setNotifications(prev => prev?.map(n => n._id === notif._id ? { ...n, read: true } : n));
    }
    if (notif.taskId && onOpenTask) {
      onOpenTask(notif.taskId);
      setIsOpen(false);
      setShowAllModal(false);
    }
  };

  const handleMarkAllRead = async () => {
    await markAllRead({ email: userEmail });
    // Optimistically update local state
    setNotifications(prev => prev?.map(n => ({ ...n, read: true })));
  };

  const displayedNotifs = notifications?.slice(0, 7) || [];
  const hasMore = (notifications?.length || 0) > 7;

  return (
    <div className="notif-bell-wrapper" ref={panelRef}>
      <button
        className="btn-settings-header notif-bell-btn"
        onClick={() => setIsOpen(!isOpen)}
        title="Notifications"
        style={{ padding: "8px", borderRadius: "50%", marginLeft: "0px", position: "relative" }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {(unreadCount || 0) > 0 && (
          <span className="notif-badge-count">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="notif-dropdown">
          {/* Header */}
          <div className="notif-dropdown-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              <span style={{ fontWeight: 900, fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Notifications
              </span>
              {(unreadCount || 0) > 0 && (
                <span style={{ 
                  background: "linear-gradient(135deg, #ef4444, #dc2626)",
                  color: "white", 
                  fontSize: "0.6rem", 
                  fontWeight: 800, 
                  padding: "2px 8px", 
                  borderRadius: 10 
                }}>
                  {unreadCount} new
                </span>
              )}
            </div>
            {(unreadCount || 0) > 0 && (
              <button className="notif-mark-all-btn" onClick={handleMarkAllRead}>
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="notif-dropdown-list">
            {isLoadingList && !notifications ? (
              <div className="notif-empty">
                <span style={{ fontSize: "0.8rem" }}>Loading...</span>
              </div>
            ) : (!notifications || notifications.length === 0) ? (
              <div className="notif-empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3, marginBottom: 8 }}>
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                <span>All caught up!</span>
                <span style={{ fontSize: "0.7rem", opacity: 0.5 }}>No notifications yet</span>
              </div>
            ) : (
              <>
                {displayedNotifs.map((notif) => (
                  <div
                    key={notif._id}
                    className={`notif-item ${!notif.read ? "notif-unread" : ""}`}
                    onClick={() => handleNotificationClick(notif)}
                  >
                    <div className="notif-item-icon">
                      {getIcon(notif.type)}
                    </div>
                    <div className="notif-item-content">
                      <div className="notif-item-text">
                        <strong>{notif.actorName}</strong>{" "}{notif.message}
                      </div>
                      <div className="notif-item-time">{formatTime(notif.createdAt)}</div>
                    </div>
                    {!notif.read && <div className="notif-unread-dot" />}
                  </div>
                ))}
                {hasMore && (
                  <button className="notif-show-more-btn" onClick={() => { setShowAllModal(true); setIsOpen(false); }}>
                    Show More
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Full Screen Modal */}
      {showAllModal && (
        <div className="notif-modal-overlay" onClick={() => setShowAllModal(false)}>
          <div className="notif-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="notif-modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ background: "var(--color-bg-subtle)", padding: 8, borderRadius: 12 }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2.5">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 900, color: "var(--color-text-primary)" }}>All Notifications</h2>
                  <p style={{ margin: 0, fontSize: "0.75rem", color: "#64748b", fontWeight: 700 }}>Recent updates from your projects</p>
                </div>
              </div>
              <button 
                className="announcement-close-btn" 
                onClick={() => setShowAllModal(false)}
                style={{ position: "static", transform: "none", width: 40, height: 40, fontSize: "1.5rem" }}
              >
                ×
              </button>
            </div>
            
            <div className="notif-modal-list">
              {notifications?.map((notif) => (
                <div
                  key={notif._id}
                  className={`notif-item ${!notif.read ? "notif-unread" : ""}`}
                  onClick={() => handleNotificationClick(notif)}
                  style={{ padding: "16px 32px" }}
                >
                  <div className="notif-item-icon" style={{ width: 42, height: 42, minWidth: 42 }}>
                    {getIcon(notif.type)}
                  </div>
                  <div className="notif-item-content">
                    <div className="notif-item-text" style={{ fontSize: "0.9rem", WebkitLineClamp: "none" }}>
                      <strong>{notif.actorName}</strong>{" "}{notif.message}
                    </div>
                    <div className="notif-item-time" style={{ fontSize: "0.75rem" }}>{formatTime(notif.createdAt)}</div>
                  </div>
                  {!notif.read && <div className="notif-unread-dot" style={{ marginTop: 12 }} />}
                </div>
              ))}
            </div>

            <div style={{ padding: "20px 32px", borderTop: "1px solid #f1f5f9", display: "flex", justifyContent: "flex-end" }}>
              <button 
                className="notif-mark-all-btn" 
                onClick={handleMarkAllRead}
                style={{ fontSize: "0.8rem", padding: "8px 16px", background: "var(--color-bg-subtle)" }}
              >
                Mark all as read
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
