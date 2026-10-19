// Local persistence for Caddy chat sessions — per signed-in person, per browser.
// A session: { id, title, ts, messages:[{role,text,error?}], contents:[Gemini turns] }
//
// Each person's chats live under their own key ("wf_caddy_chats:<email>"), so
// someone else signing in on the same browser never sees them. The email is the
// one passed in, else the signed-in user's ("wf_email"), lowercased; with no
// signed-in user nothing is loaded or saved. The old shared key (everyone's
// chats in one list) is simply removed — there's no telling whose they were.

const PREFIX = "wf_caddy_chats:";
const LEGACY_KEY = "wf_caddy_chats";
const MAX = 30; // keep the most recent N chats

function ownerEmail(email) {
  let e = email;
  if (!e) {
    try { e = localStorage.getItem("wf_email"); } catch { e = ""; }
  }
  return String(e || "").trim().toLowerCase();
}

function keyFor(email) {
  const e = ownerEmail(email);
  return e ? PREFIX + e : null;
}

function dropLegacy() {
  try { localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
}

export function loadChats(email) {
  dropLegacy();
  const key = keyFor(email);
  if (!key) return [];
  try {
    const arr = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveChat(session, email) {
  const key = keyFor(email);
  if (!key || !session || !session.id || !(session.messages || []).length) return;
  const all = loadChats(email).filter((c) => c.id !== session.id);
  all.unshift(session);
  try {
    localStorage.setItem(key, JSON.stringify(all.slice(0, MAX)));
  } catch {
    /* storage full — ignore */
  }
}

export function deleteChat(id, email) {
  const key = keyFor(email);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(loadChats(email).filter((c) => c.id !== id)));
  } catch {
    /* ignore */
  }
}

/**
 * Forget a person's Caddy chats on this browser — call on logout.
 * Pass their email, or call it BEFORE "wf_email" is removed. If no email can be
 * found at all, it errs on the side of privacy and clears every Caddy chat
 * history stored in this browser.
 */
export function clearCaddyChats(email) {
  dropLegacy();
  try {
    const key = keyFor(email);
    if (key) {
      localStorage.removeItem(key);
      return;
    }
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

export function newSessionId() {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
