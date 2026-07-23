// Fun-FX preferences: the camera-follow, the robotic nav arms, and the
// robotic cursor are each user-toggleable (Settings → Motion & fun).
// Stored in localStorage; components subscribe to the "wf-fx-prefs" event
// for live changes; the cursor is driven purely by an <html> class so CSS
// flips it instantly with no JS listeners.

const KEY = "wf_fx_prefs";
const DEFAULTS = { cameraFollow: true, roboArms: true, roboCursor: true };

export function getFxPrefs() {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) || "{}") || {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setFxPref(key, value) {
  const prefs = { ...getFxPrefs(), [key]: !!value };
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
  applyFxClasses(prefs);
  window.dispatchEvent(new CustomEvent("wf-fx-prefs", { detail: prefs }));
  return prefs;
}

// The robo cursor lives entirely in CSS behind html.fx-robo-cursor.
export function applyFxClasses(prefs = getFxPrefs()) {
  document.documentElement.classList.toggle("fx-robo-cursor", !!prefs.roboCursor);
}
