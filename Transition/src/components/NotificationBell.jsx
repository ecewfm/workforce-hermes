import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation } from "../data/react";
import { api } from "../data/api";
import { sendNotification, initNotifications } from "../utils/notifications";
import { useWorkspace } from "../utils/workspaceContext";
import { morphOriginFrom } from "../utils/modalOrigin";
import "../styles/notifications-motion.css";

// ── Motion ───────────────────────────────────────────────────────────────────
// Every move here is a Web Animation on transform/opacity, which the browser
// plays on the compositor — a live update re-rendering the list mid-flight
// can't make it stutter. Springs are real damped springs, sampled into
// keyframes and played with linear timing. Reduced motion → nothing moves.
// (CSS half — hover/press, flash, shimmer, loops: styles/notifications-motion.css)

const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

function play(el, keyframes, options) {
  if (!el || typeof el.animate !== "function" || reducedMotion()) return null;
  try { return el.animate(keyframes, options); } catch { return null; }
}

// A damped spring (unit mass) released from 0, overshooting and settling on 1,
// sampled for keyframes. `impulse` instead kicks it at rest and lets it ring
// back to 0 (peak normalised to 1) — a bump.
function spring(stiffness, damping, { impulse = false, steps = 30 } = {}) {
  const w0 = Math.sqrt(stiffness);
  const zeta = Math.min(damping / (2 * w0), 0.95);
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  const decay = zeta * w0;
  const secs = 4 / decay; // the wobble is down to a few % by then...
  // ...and the last 40% eases what's left to zero, so the final frame never snaps.
  const tail = (u) => (u < 0.6 ? 1 : 0.5 * (1 + Math.cos((Math.PI * (u - 0.6)) / 0.4)));
  const off = impulse
    ? (t) => Math.exp(-decay * t) * Math.sin(wd * t)
    : (t) => Math.exp(-decay * t) * (Math.cos(wd * t) + (decay / wd) * Math.sin(wd * t));
  let values = Array.from({ length: steps + 1 }, (_, i) => {
    const u = i / steps;
    const v = off(u * secs) * tail(u);
    return impulse ? v : 1 - v;
  });
  if (impulse) {
    const peak = Math.max(...values);
    values = values.map((v) => v / peak);
  }
  return { values, duration: Math.round(secs * 1000) };
}
const frames = (s, frame) => s.values.map(frame);

const PANEL = spring(420, 30); // dropdown: ~270ms, a 2% overshoot
const MODAL = spring(260, 27); // "see all": ~300ms, barely-there overshoot
const POP = spring(600, 20); // badge / unread dot appearing: lively
const BUMP = spring(700, 22, { impulse: true }); // badge when the count changes
const PRESS = spring(520, 22); // bell icon released after a click

const CASCADE_CAP = 14; // rows past this just appear (below the fold anyway)
const STAGGER = 26; // ms between rows
const DOT_OUT = [
  { transform: "scale(1)", opacity: 1 },
  { transform: "scale(1.7)", opacity: 1, offset: 0.3 },
  { transform: "scale(0)", opacity: 0 },
];
const BADGE_OUT = [
  { transform: "scale(1)", opacity: 1 },
  { transform: "scale(1.25)", opacity: 1, offset: 0.3 },
  { transform: "scale(0)", opacity: 0 },
];

// transform-origin (in el's own box) on `anchor`'s centre — el scales out of
// it and back into it.
function originAt(anchor, el) {
  if (!anchor || !el) return "50% 0";
  const a = anchor.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return `${a.left + a.width / 2 - r.left}px ${a.top + a.height / 2 - r.top}px`;
}

// Rows that haven't been seen yet deal in, one after another (first
// CASCADE_CAP only). Unread ones pop their dot and catch the light once.
function cascadeIn(list, seen, lead) {
  let k = 0;
  for (const row of list.children) {
    if (seen.has(row)) continue;
    seen.add(row);
    if (k >= CASCADE_CAP || !row.matches(".notif-item, .notif-show-more-btn")) continue;
    const delay = lead + k++ * STAGGER;
    play(row, [{ opacity: 0, transform: "translate3d(-14px, -4px, 0)" }, { opacity: 1, transform: "none" }],
      { duration: 380, delay, easing: "cubic-bezier(0.2, 0.9, 0.3, 1.12)", fill: "backwards" });
    play(row.querySelector(".notif-item-icon"), [{ opacity: 0, transform: "scale(0.55) rotate(-16deg)" }, { opacity: 1, transform: "none" }],
      { duration: 460, delay: delay + 40, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)", fill: "backwards" });
    if (row.classList.contains("notif-unread") && !reducedMotion()) {
      play(row.querySelector(".notif-unread-dot"), frames(POP, (p) => ({ transform: `scale(${p})` })),
        { duration: POP.duration, delay: delay + 150, easing: "linear", fill: "backwards" });
      row.style.setProperty("--notif-delay", `${delay + 220}ms`);
      row.dataset.shimmer = ""; // data-* (not a class): React's className updates leave it alone
    }
  }
}

// The clicked row says "got it": a wash sweeps across it, the icon flinches
// and the unread dot pops away. Returns how long to let that land (ms).
function acknowledge(row, wasUnread) {
  if (!row || reducedMotion()) return 0;
  row.style.setProperty("--notif-ack-delay", "0ms");
  row.dataset.ack = "";
  setTimeout(() => { delete row.dataset.ack; }, 560);
  play(row.querySelector(".notif-item-icon"), [
    { transform: "none" },
    { transform: "scale(0.82) rotate(-8deg)", offset: 0.3 },
    { transform: "scale(1.12) rotate(4deg)", offset: 0.65 },
    { transform: "none" },
  ], { duration: 380, easing: "ease-out" });
  if (wasUnread) {
    play(row.querySelector(".notif-unread-dot"), DOT_OUT, { duration: 240, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" });
  }
  return wasUnread ? 200 : 130;
}

// "Mark all read": the unread dots pop away top to bottom, each row flashing
// as its dot goes. Returns how long the sweep takes (ms).
function sweepRead(scope) {
  if (!scope || reducedMotion()) return 0;
  const rows = [...scope.querySelectorAll(".notif-item.notif-unread")].slice(0, CASCADE_CAP);
  rows.forEach((row, i) => {
    const delay = i * 34;
    play(row.querySelector(".notif-unread-dot"), DOT_OUT, { duration: 260, delay, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" });
    row.style.setProperty("--notif-ack-delay", `${delay}ms`);
    row.dataset.ack = "";
    setTimeout(() => { delete row.dataset.ack; }, 560 + delay);
  });
  return rows.length ? 260 + (rows.length - 1) * 34 : 0;
}

// Roadblock notices come in two flavours; the server's message says which
// ('flagged a roadblock "X" on "Y"' / 'cleared the roadblock "X" on "Y"').
const isCleared = (message = "") =>
  /^\s*cleared\b/i.test(message) || (!/^\s*flagged\b/i.test(message) && /\bcleared\b/i.test(message));

function bannerTitle(n) {
  switch (n.type) {
    case "mention": return "New Mention";
    case "reaction": return "New Reaction";
    case "manager_overdue": return "⏰ Project Overdue";
    case "manager_stale": return "💤 Project Inactive";
    case "manager_bug": return "🐞 New Bug Reported";
    case "manager_feature": return "✨ Feature Update";
    case "manager_roadblock": return isCleared(n.message) ? "✅ Roadblock Cleared" : "🚧 Roadblock Flagged";
    default: return "Project Update";
  }
}

/**
 * NotificationBell — sits beside the Settings gear in the header.
 *
 * Data (Supabase, live):
 * - Unread count + latest: always subscribed (tiny payloads, keep the badge live)
 * - Full list: subscribed only while the dropdown is open
 * - markRead / markAllRead: database functions (your own notifications only)
 */
export default function NotificationBell({ userEmail, onOpenTask }) {
  const workspace = useWorkspace();
  const [isOpen, setIsOpen] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false); // dropdown playing its exit (still mounted)
  const [showAllModal, setShowAllModal] = useState(false);
  const [modalClosing, setModalClosing] = useState(false);
  const [notifications, setNotifications] = useState(null);
  const panelRef = useRef(null);
  const bellBtnRef = useRef(null);
  const bellIconRef = useRef(null);
  const clapperRef = useRef(null);
  const badgeRef = useRef(null);
  const badgeNumRef = useRef(null);
  const menuRef = useRef(null);
  const modalOverlayRef = useRef(null);
  const modalBoxRef = useRef(null);
  const modalListRef = useRef(null);
  const menuAnims = useRef([]);
  const modalAnims = useRef([]);
  const openedAt = useRef(0);
  const seenRows = useRef(null);
  if (!seenRows.current) seenRows.current = new WeakSet();
  const navPending = useRef(false);
  // Latest open flags, for handlers that run after a short delay.
  const live = useRef({});
  live.current = { isOpen, showAllModal };

  // Unread count and latest notification (for desktop banners) — scoped to the
  // active workspace so the badge/banners only reflect this workspace.
  const unreadCount = useQuery(api.notifications.getUnreadCount, { email: userEmail || "", workspace });
  const latestNotif = useQuery(api.notifications.getLatestNotification, { email: userEmail || "", workspace });
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);

  const lastSeenNotifId = useRef(null);

  // Initialize browser notifications on mount
  useEffect(() => {
    initNotifications();
  }, []);

  // Trigger desktop banner when a NEW unread notification arrives
  useEffect(() => {
    if (latestNotif && !latestNotif.read && latestNotif._id !== lastSeenNotifId.current) {
      lastSeenNotifId.current = latestNotif._id;
      sendNotification(bannerTitle(latestNotif), {
        body: `${latestNotif.actorName} ${latestNotif.message}`,
        tag: latestNotif._id, // Unique tag per notification
      });
    }
  }, [latestNotif]);

  // Full list: a live query, only while the dropdown / "see all" is open.
  // Always the signed-in user's own notifications (enforced server-side).
  const listOpen = isOpen || showAllModal;
  const liveList = useQuery(api.notifications.getNotifications, listOpen && userEmail ? { email: userEmail, workspace } : "skip");
  useEffect(() => {
    if (liveList !== undefined) setNotifications(liveList);
  }, [liveList]);
  const isLoadingList = listOpen && liveList === undefined;

  // Open/close. Closing keeps the surface mounted while it animates away.
  const closeMenu = () => {
    if (!live.current.isOpen) return;
    setIsOpen(false);
    setMenuClosing(!reducedMotion());
  };
  const openMenu = () => {
    setMenuClosing(false);
    setIsOpen(true);
  };
  const closeModal = () => {
    if (!live.current.showAllModal) return;
    setShowAllModal(false);
    setModalClosing(!reducedMotion());
  };
  const openModal = () => {
    closeMenu();
    setModalClosing(false);
    setShowAllModal(true);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        closeMenu();
      }
    };
    if (isOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ── Bell + badge ──────────────────────────────────────────────────────────
  const ringBell = () => {
    play(bellIconRef.current, [
      { transform: "rotate(0deg)" },
      { transform: "rotate(18deg)", offset: 0.1 },
      { transform: "rotate(-15deg)", offset: 0.26 },
      { transform: "rotate(11deg)", offset: 0.42 },
      { transform: "rotate(-7deg)", offset: 0.58 },
      { transform: "rotate(3deg)", offset: 0.76 },
      { transform: "rotate(0deg)" },
    ], { duration: 820, easing: "cubic-bezier(0.25, 0.6, 0.4, 1)" });
    play(clapperRef.current, [
      { transform: "translateX(0)" },
      { transform: "translateX(-2.5px)", offset: 0.16 },
      { transform: "translateX(2.2px)", offset: 0.32 },
      { transform: "translateX(-1.6px)", offset: 0.48 },
      { transform: "translateX(0.8px)", offset: 0.66 },
      { transform: "translateX(0)" },
    ], { duration: 820, easing: "ease-out" });
  };

  const handleBellClick = () => {
    // A soft squash on the icon; the button's own :active sink comes from CSS.
    play(bellIconRef.current, frames(PRESS, (p) => ({ transform: `scale(${0.78 + 0.22 * p}) rotate(${-12 * (1 - p)}deg)` })),
      { duration: PRESS.duration, easing: "linear" });
    if (isOpen) closeMenu();
    else openMenu();
  };

  // What the badge shows. It trails the live count only while animating out.
  const count = unreadCount || 0;
  const countKnown = unreadCount !== undefined && unreadCount !== null;
  const [badgeCount, setBadgeCount] = useState(0);
  const prevCount = useRef(null);
  const countWorkspace = useRef(workspace);
  const badgeFx = useRef(null); // "in" | "up" | "down" — for the next badge render
  const badgeExit = useRef(null);

  useLayoutEffect(() => {
    if (!countKnown) return;
    if (countWorkspace.current !== workspace) { // another workspace's count: not "new"
      countWorkspace.current = workspace;
      prevCount.current = null;
    }
    const prev = prevCount.current;
    prevCount.current = count;
    if (prev === count) return;
    if (prev !== null && count > prev) ringBell(); // something new just arrived
    if (count > 0) {
      badgeExit.current?.cancel();
      badgeExit.current = null;
      badgeFx.current = !badgeRef.current ? "in" : count > (prev ?? 0) ? "up" : "down";
      setBadgeCount(count);
      return;
    }
    // Down to zero: the badge pops away, then unmounts.
    const out = play(badgeRef.current, BADGE_OUT, { duration: 260, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" });
    if (!out) { setBadgeCount(0); return; }
    badgeExit.current = out;
    out.finished.then(() => {
      if (badgeExit.current !== out) return;
      badgeExit.current = null;
      setBadgeCount(0);
    }, () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, countKnown, workspace]);

  useLayoutEffect(() => {
    const fx = badgeFx.current;
    badgeFx.current = null;
    if (!fx || !badgeRef.current) return;
    if (fx === "in") {
      play(badgeRef.current, frames(POP, (p) => ({ transform: `scale(${0.2 + 0.8 * p})` })), { duration: POP.duration, easing: "linear" });
      play(badgeRef.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: "ease-out" });
      return;
    }
    // A new number rolls in (from below when it went up) while the badge bumps.
    play(badgeRef.current, frames(BUMP, (b) => ({ transform: `scale(${1 + 0.3 * b})` })), { duration: BUMP.duration, easing: "linear" });
    play(badgeNumRef.current, [
      { transform: `translateY(${fx === "up" ? 80 : -80}%)`, opacity: 0 },
      { transform: "none", opacity: 1 },
    ], { duration: 320, easing: "cubic-bezier(0.2, 0.9, 0.3, 1.25)" });
  }, [badgeCount]);

  // ── Dropdown: grows out of the bell, shrinks back into it ─────────────────
  useLayoutEffect(() => {
    const el = menuRef.current;
    menuAnims.current.forEach((a) => a.cancel());
    menuAnims.current = [];
    if (!el) return;
    if (isOpen) {
      openedAt.current = performance.now();
      el.style.transformOrigin = originAt(bellBtnRef.current, el);
      menuAnims.current = [
        play(el, frames(PANEL, (p) => ({ transform: `scale(${0.55 + 0.45 * p}, ${0.35 + 0.65 * p})` })), { duration: PANEL.duration, easing: "linear" }),
        play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "cubic-bezier(0.2, 0, 0, 1)" }),
        play(el.querySelector(".notif-dropdown-header"), [{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }],
          { duration: 280, delay: 60, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)", fill: "backwards" }),
      ].filter(Boolean);
    } else if (menuClosing) {
      const out = play(el, [{ transform: "none", opacity: 1 }, { transform: "scale(0.6, 0.4)", opacity: 0 }],
        { duration: 170, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
      if (!out) { setMenuClosing(false); return; }
      menuAnims.current = [out];
      out.finished.then(() => setMenuClosing(false), () => {});
    }
  }, [isOpen, menuClosing]);

  // ── "See all" modal: flies out of the bell, falls back toward it ──────────
  useLayoutEffect(() => {
    const overlay = modalOverlayRef.current;
    const box = modalBoxRef.current;
    modalAnims.current.forEach((a) => a.cancel());
    modalAnims.current = [];
    if (!overlay || !box) return;
    if (showAllModal) {
      openedAt.current = performance.now();
      box.style.transformOrigin = originAt(bellBtnRef.current, box);
      modalAnims.current = [
        play(overlay, [{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: "ease-out" }),
        play(box, frames(MODAL, (p) => ({ transform: `scale(${0.3 + 0.7 * p})` })), { duration: MODAL.duration, easing: "linear" }),
        play(box, [{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }),
        play(box.querySelector(".notif-modal-header"), [{ opacity: 0, transform: "translateY(-8px)" }, { opacity: 1, transform: "none" }],
          { duration: 300, delay: 90, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)", fill: "backwards" }),
      ].filter(Boolean);
    } else if (modalClosing) {
      const out = play(box, [{ transform: "none", opacity: 1 }, { transform: "scale(0.7)", opacity: 0 }],
        { duration: 200, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
      const fade = play(overlay, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: "ease-in", fill: "forwards" });
      if (!out) { setModalClosing(false); return; }
      modalAnims.current = [out, fade].filter(Boolean);
      Promise.all(modalAnims.current.map((a) => a.finished)).then(() => setModalClosing(false), () => {});
    }
  }, [showAllModal, modalClosing]);

  // Rows deal in as they mount — on open, when the list finishes loading, and
  // when a new notification arrives while you're looking.
  useLayoutEffect(() => {
    if (!isOpen && !showAllModal) return;
    const lead = Math.max(0, 80 - (performance.now() - openedAt.current));
    const lists = [isOpen && menuRef.current?.querySelector(".notif-dropdown-list"), showAllModal && modalListRef.current];
    for (const list of lists) if (list) cascadeIn(list, seenRows.current, lead);
  });

  const getIcon = (type, message) => {
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
      case "manager_roadblock":
        return isCleared(message) ? (
          // Cleared: a check in a circle
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" /><polyline points="8 12.5 11 15.5 16 9.5" />
          </svg>
        ) : (
          // Flagged: a striped road barrier
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="6" width="20" height="7" rx="1.5" /><path d="M7 6l-4 7M13 6l-4 7M19 6l-4 7M5 13v7M19 13v7" />
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

  const handleNotificationClick = (notif, e) => {
    if (navPending.current) return; // already acknowledging a click
    const row = e?.currentTarget;
    // Where the task modal grows from — measured now, while the row is on
    // screen (and again after the acknowledgement, if it's still there).
    const clickedFrom = morphOriginFrom(row);
    const wasUnread = !notif.read;
    if (wasUnread) {
      Promise.resolve(markRead({ notificationId: notif._id }))
        .catch((err) => console.error("Couldn't mark the notification read:", err));
    }
    const settle = () => {
      navPending.current = false;
      // Optimistically update local state
      if (wasUnread) setNotifications((prev) => prev?.map((n) => (n._id === notif._id ? { ...n, read: true } : n)));
      if (notif.taskId && onOpenTask) {
        const origin = (row?.isConnected && morphOriginFrom(row)) || clickedFrom;
        // The rect only: the row sits in a closing popover, not on the board —
        // no card copy, no camera push toward the header.
        onOpenTask(notif.taskId, origin ? { ...origin, node: null } : null);
        closeMenu();
        closeModal();
      }
    };
    const wait = acknowledge(row, wasUnread);
    if (wait) {
      navPending.current = true;
      setTimeout(settle, wait);
    } else {
      settle();
    }
  };

  const handleMarkAllRead = (e) => {
    Promise.resolve(markAllRead({ email: userEmail, workspace }))
      .catch((err) => console.error("Couldn't mark all notifications read:", err));
    // Optimistically update local state — once the dots have swept away.
    const settle = () => setNotifications((prev) => prev?.map((n) => ({ ...n, read: true })));
    const wait = sweepRead(e?.currentTarget?.closest(".notif-motion"));
    if (wait) setTimeout(settle, wait);
    else settle();
  };

  const displayedNotifs = notifications?.slice(0, 7) || [];
  const hasMore = (notifications?.length || 0) > 7;
  const badgeLabel = badgeCount > 99 ? "99+" : badgeCount;

  return (
    <div className="notif-bell-wrapper" ref={panelRef}>
      <button
        ref={bellBtnRef}
        className="btn-settings-header notif-bell-btn"
        onClick={handleBellClick}
        title="Notifications"
        aria-label={count > 0 ? `Notifications (${count} unread)` : "Notifications"}
        aria-expanded={isOpen}
        style={{ padding: "8px", borderRadius: "50%", marginLeft: "0px", position: "relative" }}
      >
        <svg ref={bellIconRef} className="notif-bell-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path ref={clapperRef} className="notif-bell-clapper" d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {badgeCount > 0 && (
          <span className="notif-badge-count" ref={badgeRef}>
            <span key={badgeLabel} ref={badgeNumRef} className="notif-badge-num">{badgeLabel}</span>
          </span>
        )}
      </button>

      {(isOpen || menuClosing) && (
        <div ref={menuRef} className={`notif-dropdown notif-motion${isOpen ? "" : " is-closing"}`}>
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
                <span key={unreadCount} className="notif-new-pill" style={{
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
              <div className="notif-skeleton" aria-label="Loading notifications">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="notif-skel-row" style={{ "--i": i }}>
                    <span className="notif-skel-icon" />
                    <span className="notif-skel-lines"><span /><span /></span>
                  </div>
                ))}
              </div>
            ) : (!notifications || notifications.length === 0) ? (
              <div className="notif-empty">
                <div className="notif-empty-art" aria-hidden="true">
                  <span className="notif-empty-shadow" />
                  <svg className="notif-empty-bell" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                  <span className="notif-empty-spark s1" />
                  <span className="notif-empty-spark s2" />
                  <span className="notif-empty-spark s3" />
                </div>
                <span>All caught up!</span>
                <span style={{ fontSize: "0.7rem", opacity: 0.5 }}>No notifications yet</span>
              </div>
            ) : (
              <>
                {displayedNotifs.map((notif) => (
                  <div
                    key={notif._id}
                    className={`notif-item ${!notif.read ? "notif-unread" : ""}`}
                    onClick={(e) => handleNotificationClick(notif, e)}
                  >
                    <div className="notif-item-icon">
                      {getIcon(notif.type, notif.message)}
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
                  <button className="notif-show-more-btn" onClick={openModal}>
                    Show More
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Full Screen Modal — portalled to <body>: the header's frosted skins
          (backdrop-filter) would otherwise trap this fixed overlay inside it. */}
      {(showAllModal || modalClosing) && createPortal(
        <div
          ref={modalOverlayRef}
          className={`notif-modal-overlay notif-motion${showAllModal ? "" : " is-closing"}`}
          onClick={closeModal}
        >
          <div ref={modalBoxRef} className="notif-modal-content" onClick={(e) => e.stopPropagation()}>
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
                onClick={closeModal}
                style={{ position: "static", transform: "none", width: 40, height: 40, fontSize: "1.5rem" }}
              >
                ×
              </button>
            </div>

            <div className="notif-modal-list" ref={modalListRef}>
              {notifications?.map((notif) => (
                <div
                  key={notif._id}
                  className={`notif-item ${!notif.read ? "notif-unread" : ""}`}
                  onClick={(e) => handleNotificationClick(notif, e)}
                  style={{ padding: "16px 32px" }}
                >
                  <div className="notif-item-icon" style={{ width: 42, height: 42, minWidth: 42 }}>
                    {getIcon(notif.type, notif.message)}
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
        </div>,
        document.body
      )}
    </div>
  );
}
