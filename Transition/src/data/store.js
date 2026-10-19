// Query cache + live updates — what Convex's reactive queries used to do.
//
// Each query result is cached by (function name + args). Components subscribe;
// when a table that query reads changes — via Supabase Realtime, or right after
// one of our own mutations — the query refetches and every subscriber
// re-renders. If the realtime connection drops, active queries fall back to
// polling until it's back.
import { supabase } from "./supabase";

const entries = new Map(); // key → { def, args, data, loaded, listeners:Set, timer, inflight, seq }
const REFETCH_DEBOUNCE_MS = 120;
const FALLBACK_POLL_MS = 30_000;

export const keyOf = (def, args) => `${def.name}:${JSON.stringify(args ?? {})}`;

function emit(entry) {
  entry.listeners.forEach((l) => l());
}

async function load(entry) {
  const seq = ++entry.seq;
  // Signed out (e.g. the login screen): nothing to fetch yet — every function
  // needs a session. Signing in refetches everything (see auth.js).
  const { data: auth } = await supabase.auth.getSession();
  if (!auth.session) return;
  try {
    const data = await entry.def.run(entry.args ?? {});
    if (seq !== entry.seq) return; // a newer fetch started — drop this one
    entry.data = data;
    entry.loaded = true;
    emit(entry);
  } catch (err) {
    if (seq !== entry.seq) return;
    console.warn(`[data] ${entry.def.name} failed:`, err?.message || err);
    if (!entry.loaded) { entry.data = undefined; }
    emit(entry);
  }
}

function scheduleRefetch(entry) {
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => load(entry), REFETCH_DEBOUNCE_MS);
}

export function subscribe(def, args, listener) {
  const key = keyOf(def, args);
  let entry = entries.get(key);
  if (!entry) {
    entry = { def, args, data: undefined, loaded: false, listeners: new Set(), timer: null, seq: 0 };
    entries.set(key, entry);
    load(entry);
  } else if (entry.listeners.size === 0) {
    scheduleRefetch(entry); // was idle — show the cached value, then refresh it
  }
  entry.listeners.add(listener);
  ensureRealtime();
  return () => {
    entry.listeners.delete(listener);
  };
}

export function peek(key) {
  return entries.get(key)?.data;
}

/** Refetch every active query that reads any of these tables. */
export function invalidateTables(tables) {
  if (!tables?.length) return;
  for (const entry of entries.values()) {
    if (entry.listeners.size && entry.def.reads?.some((t) => tables.includes(t))) scheduleRefetch(entry);
    else if (entry.def.reads?.some((t) => tables.includes(t))) entry.loaded = false; // refetch when next used
  }
}

/** Throw everything away (sign-in / sign-out: what you're allowed to see changed). */
export function invalidateAll() {
  for (const entry of entries.values()) {
    if (entry.listeners.size) scheduleRefetch(entry);
    else entries.delete(keyOf(entry.def, entry.args));
  }
}

/** Run a mutation, then refresh whatever it touched (realtime would too — this is just faster). */
export async function runMutation(def, args) {
  try {
    return await def.run(args ?? {});
  } finally {
    invalidateTables(def.writes || []);
  }
}

/** Optimistic updates: the same localStore shape Convex handed to withOptimisticUpdate. */
export function applyOptimistic(update, args) {
  const localStore = {
    getQuery: (def, qArgs) => entries.get(keyOf(def, qArgs))?.data,
    setQuery: (def, qArgs, value) => {
      const entry = entries.get(keyOf(def, qArgs));
      if (!entry) return;
      entry.data = value;
      emit(entry);
    },
  };
  try {
    update(localStore, args);
  } catch (err) {
    console.warn("[data] optimistic update failed:", err);
  }
}

// ── Realtime ────────────────────────────────────────────────────────────────
const LIVE_TABLES = [
  "tasks", "task_milestones", "task_notes", "note_replies", "note_reactions", "task_features",
  "feature_images", "notebook_ideas", "announcements", "announcement_views", "handbooks",
  "workspace_settings", "notifications", "staff",
];
let channel = null;
let live = false;
let pollTimer = null;

function ensureRealtime() {
  if (channel) return;
  channel = supabase.channel("hermes-db");
  for (const table of LIVE_TABLES) {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, () => invalidateTables([table]));
  }
  channel.subscribe((status) => {
    live = status === "SUBSCRIBED";
    if (live) invalidateAll(); // catch up on anything missed while disconnected
  });
  pollTimer = setInterval(() => {
    if (live) return;
    for (const entry of entries.values()) if (entry.listeners.size) scheduleRefetch(entry);
  }, FALLBACK_POLL_MS);
}

/** Re-join realtime with the current session (after sign-in/out). */
export function resetRealtime() {
  if (channel) supabase.removeChannel(channel);
  channel = null;
  live = false;
  clearInterval(pollTimer);
  if ([...entries.values()].some((e) => e.listeners.size)) ensureRealtime();
}
