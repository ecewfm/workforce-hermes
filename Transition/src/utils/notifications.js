// Notification utility for desktop notifications
import { itemWords } from "./workspaceTerms";
import { loadSettings } from "./settingsManager";

export const initNotifications = () => {
  if (!("Notification" in window)) {
    console.warn("This browser does not support notifications");
    return;
  }

  if (Notification.permission === "granted") return;

  if (Notification.permission !== "denied") {
    // Older Safari's requestPermission takes a callback and returns nothing.
    Notification.requestPermission()?.catch?.(() => {});
  } else {
    console.warn("Notification permission was denied");
  }
};

export const sendNotification = (title, options = {}) => {
  // Settings → "Push / Desktop Notifications" switched off: stay quiet.
  if (loadSettings().notificationsEnabled === false) return;

  if (!("Notification" in window)) {
    console.warn("Browser does not support the Notification API");
    return;
  }

  if (Notification.permission !== "granted") {
    console.warn(`Notification permission not granted (status: ${Notification.permission})`);
    return;
  }

  const defaultOptions = {
    icon: "/notification-icon.png",
    tag: "wf-hermes-notification",
    requireInteraction: true,  // Force notification to stay visible and require user interaction
    ...options,
  };

  try {
    new Notification(title, defaultOptions);
  } catch (err) {
    console.error("Failed to send notification:", err);
  }
};

export const notifyTaskUpdated = (taskTitle) => {
  sendNotification("Task Updated", {
    body: `"${taskTitle}" has been updated`,
    tag: "task-update",
  });
};

// Sidebar items are features/bugs (Workforce) or roadblocks (Operations,
// Executives). Callers pass the item's kind ("feature" | "bug" | "roadblock");
// without one the wording stays the original generic "Feature/Bug".
const itemTitle = (kind) => (kind ? itemWords(kind).title : "Feature/Bug");
const doneWord = (kind) => {
  const done = kind ? itemWords(kind).done : "COMPLETED"; // "COMPLETED" | "CLEARED"
  return done.charAt(0) + done.slice(1).toLowerCase();
};

export const notifyFeatureAdded = (taskTitle, featureName, kind) => {
  const roadblock = kind === "roadblock";
  sendNotification(`${itemTitle(kind)} ${roadblock ? "Flagged" : "Added"}`, {
    body: roadblock ? `"${featureName}" is blocking "${taskTitle}"` : `"${featureName}" added to "${taskTitle}"`,
    tag: `${kind || "feature"}-add`,
  });
};

export const notifyFeatureCompleted = (taskTitle, featureName, kind) => {
  const done = doneWord(kind);
  sendNotification(`${itemTitle(kind)} ${done}`, {
    body: `"${featureName}" ${kind === "roadblock" ? "on" : "in"} "${taskTitle}" is now ${done.toLowerCase()}`,
    tag: `${kind || "feature"}-complete`,
  });
};

export const notifyNoteAdded = (taskTitle, notePreview) => {
  try {
    const preview = notePreview?.substring(0, 50) || "Update";
    const body = `New note on "${taskTitle}": ${preview}${notePreview?.length > 50 ? "..." : ""}`;
    sendNotification("Note Added", {
      body,
      tag: "note-add",
    });
  } catch (err) {
    console.error("Error in notifyNoteAdded:", err);
  }
};

export const notifyMilestoneCompleted = (taskTitle, milestoneName) => {
  sendNotification("Milestone Completed", {
    body: `"${milestoneName}" in "${taskTitle}" is complete`,
    tag: "milestone-complete",
  });
};
