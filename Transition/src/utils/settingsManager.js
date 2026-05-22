/**
 * Settings Manager — Persist, load, and apply user settings.
 *
 * Settings are stored in localStorage under the key "wf_hermes_settings".
 * On load, settings are read and applied to the DOM (CSS custom properties
 * and data-theme attribute on <html>).
 */

const STORAGE_KEY = "wf_hermes_settings";

// ── Accent color palettes ──
// Each accent defines the full set of derived colors.
const ACCENT_PALETTES = {
  "#10b981": {
    accent: "#10b981",
    accentHover: "#059669",
    accentLighter: "#34d399",
    bgSubtle: "#f0fdf4",
    navBg: "#064e3b",
    colTodo: "#065f46",
    colPending: "#10b981",
    colDev: "#059669",
    colTest: "#34d399",
    colDone: "#064e3b",
    colImplemented: "#047857",
    colScrap: "#94a3b8",
  },
  "#6366f1": {
    accent: "#6366f1",
    accentHover: "#4f46e5",
    accentLighter: "#818cf8",
    bgSubtle: "#eef2ff",
    navBg: "#312e81",
    colTodo: "#3730a3",
    colPending: "#6366f1",
    colDev: "#4f46e5",
    colTest: "#818cf8",
    colDone: "#312e81",
    colImplemented: "#1e1b4b",
    colScrap: "#64748b",
  },
  "#f43f5e": {
    accent: "#f43f5e",
    accentHover: "#e11d48",
    accentLighter: "#fb7185",
    bgSubtle: "#fff1f2",
    navBg: "#881337",
    colTodo: "#9f1239",
    colPending: "#f43f5e",
    colDev: "#e11d48",
    colTest: "#fb7185",
    colDone: "#881337",
    colImplemented: "#4c0519",
    colScrap: "#64748b",
  },
  "#f59e0b": {
    accent: "#f59e0b",
    accentHover: "#d97706",
    accentLighter: "#fbbf24",
    bgSubtle: "#fffbeb",
    navBg: "#78350f",
    colTodo: "#92400e",
    colPending: "#f59e0b",
    colDev: "#d97706",
    colTest: "#fbbf24",
    colDone: "#78350f",
    colImplemented: "#451a03",
    colScrap: "#64748b",
  },
  "#06b6d4": {
    accent: "#06b6d4",
    accentHover: "#0891b2",
    accentLighter: "#22d3ee",
    bgSubtle: "#ecfeff",
    navBg: "#164e63",
    colTodo: "#155e75",
    colPending: "#06b6d4",
    colDev: "#0891b2",
    colTest: "#22d3ee",
    colDone: "#164e63",
    colImplemented: "#083344",
    colScrap: "#64748b",
  },
};

// ── Font scale multipliers ──
const FONT_SCALES = {
  Standard: 1,
  Large: 1.08,
  "Extra Large": 1.16,
};

// ── Defaults ──
export const DEFAULT_SETTINGS = {
  theme: "light",
  accentColor: "#10b981",
  fontSize: "Standard",
  defaultView: "Dashboard",
  openOnStartup: false,
  startMinimized: false,
  notificationsEnabled: true,
  notifyErrors: true,
  notifyUpdates: true,
  avatarUrl: null,
  bio: "",
};

/**
 * Load settings from localStorage. Returns merged defaults + stored values.
 */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {
    // Corrupted data — fall through to defaults
  }
  return { ...DEFAULT_SETTINGS };
}

/**
 * Save settings to localStorage.
 */
export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage full — fail silently
  }
}

/**
 * Resolve the effective theme ("light" | "dark") from the stored value,
 * taking "system" into account.
 */
function resolveTheme(theme) {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return theme;
}

/**
 * Apply settings to the DOM. Call this on app load and after saving.
 */
export function applySettings(settings) {
  if (!settings) settings = loadSettings();
  const root = document.documentElement;

  // ── Theme ──
  const effectiveTheme = resolveTheme(settings.theme);
  root.setAttribute("data-theme", effectiveTheme);

  // ── Accent color ──
  const palette = ACCENT_PALETTES[settings.accentColor] || ACCENT_PALETTES["#10b981"];
  root.style.setProperty("--color-accent", palette.accent);
  root.style.setProperty("--color-accent-hover", palette.accentHover);
  root.style.setProperty("--color-accent-lighter", palette.accentLighter);
  root.style.setProperty("--color-nav-bg", palette.navBg);
  root.style.setProperty("--col-todo", palette.colTodo);
  root.style.setProperty("--col-pending", palette.colPending);
  root.style.setProperty("--col-dev", palette.colDev);
  root.style.setProperty("--col-test", palette.colTest);
  root.style.setProperty("--col-done", palette.colDone);
  root.style.setProperty("--col-implemented", palette.colImplemented);
  root.style.setProperty("--col-scrap", palette.colScrap);

  // In dark mode, bgSubtle should be dark regardless of the palette's light bgSubtle
  const effectiveBgSubtle = (effectiveTheme === "dark") ? "#1e293b" : palette.bgSubtle;
  root.style.setProperty("--color-bg-subtle", effectiveBgSubtle);

  // ── Font scale ──
  const scale = FONT_SCALES[settings.fontSize] || 1;
  root.style.setProperty("--font-scale", scale);
}

/**
 * Listen for system theme changes (for "system" setting).
 * Returns a cleanup function.
 */
export function watchSystemTheme(currentThemeSetting) {
  if (currentThemeSetting !== "system") return () => {};

  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => applySettings(loadSettings());
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}
