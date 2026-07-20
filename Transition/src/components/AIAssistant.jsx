import { useState, useRef, useEffect } from "react";
import { runAssistant } from "../utils/geminiClient";
import { useAiActions } from "../utils/aiTools";
import { loadChats, saveChat, deleteChat, newSessionId } from "../utils/caddyChats";

// Friendly stand-ins shown instead of raw API errors (rate limits, outages, …).
const COFFEE_LINES = [
  "I'm a little tired right now and need a coffee ☕ — give me a minute and try again.",
  "Phew, my brain's running on empty ☕. Let me grab a coffee and try that again shortly.",
  "I'm worn out at the moment ☕ — mind trying that again in a bit?",
  "Running low on steam ☕ — let me recharge and take another shot in a moment.",
];

// Caddy's dramatic inner monologue while it works — shown instead of a plain
// "Thinking…". Picked by what it's doing.
const SASS = {
  analyzing: [
    "omg what is this even asking 😵",
    "wait… let me read that again 🤨",
    "hold on, decoding the request…",
    "ok ok don't panic, I got this (I think)",
    "the audacity of this question 😮‍💨",
  ],
  thinking: [
    "why can't this person even do this anyway 🙄",
    "thinking reeeally hard rn 🧠",
    "cooking something up, gimme a sec 🍳",
    "hmm hmm hmm… let me think",
    "consulting my inner genius…",
    "let me guess, this is a trick question…",
    "Joriz told you to do this did he? 😤",
    'ugh, to much brainpower required for this, I need a coffee ☕',
  ],
  working: [
    "why is this person telling ME to do this 😤",
    "can't they just do this themselves? so basic, tsk",
    "fine, FINE, I'll do it ✋",
    "the things I do around here… 🙄",
    "on it (reluctantly) 💪",
    "ugh, okay, one sec… ✨",
  ],
};
function sassLine(phase) {
  const pool = SASS[phase] || SASS.thinking;
  return pool[Math.floor(Math.random() * pool.length)];
}

function timeAgo(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d ago` : new Date(ts).toLocaleDateString();
}

export default function AIAssistant({ open, onClose, userName, userEmail, actualRole }) {
  const { tools, executeTool, systemInstruction } = useAiActions({ userName, userEmail, actualRole });
  const [messages, setMessages] = useState([]); // { role: "user"|"assistant", text, error? }
  const [input, setInput] = useState("");
  const [status, setStatus] = useState(null); // { phase, label }
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState(newSessionId);
  const [showHistory, setShowHistory] = useState(false);
  const [chats, setChats] = useState([]);
  const historyRef = useRef([]); // Gemini `contents` across turns
  const coffeeIdx = useRef(0);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, status]);

  // Auto-persist the current session whenever it gains messages.
  useEffect(() => {
    if (messages.length === 0) return;
    const title = (messages.find((m) => m.role === "user")?.text || "New chat").slice(0, 48);
    saveChat({ id: sessionId, title, ts: Date.now(), messages, contents: historyRef.current });
  }, [messages, sessionId]);

  function newChat() {
    setMessages([]);
    historyRef.current = [];
    setSessionId(newSessionId());
    setShowHistory(false);
    setInput("");
  }

  function openHistory() {
    setChats(loadChats());
    setShowHistory((v) => !v);
  }

  function loadChat(c) {
    setMessages(c.messages || []);
    historyRef.current = c.contents || [];
    setSessionId(c.id);
    setShowHistory(false);
  }

  function removeChat(e, id) {
    e.stopPropagation();
    deleteChat(id);
    setChats(loadChats());
  }

  async function send(text) {
    const msg = (text ?? input).trim();
    if (!msg || busy) return;
    setInput("");
    setShowHistory(false);
    setMessages((m) => [...m, { role: "user", text: msg }]);
    setBusy(true);
    setStatus({ phase: "analyzing", label: sassLine("analyzing") });
    try {
      const { text: reply, contents } = await runAssistant({
        history: historyRef.current,
        userText: msg,
        tools,
        systemInstruction,
        executeTool,
        onStatus: (phase) => setStatus({ phase, label: sassLine(phase) }),
      });
      historyRef.current = contents;
      setMessages((m) => [...m, { role: "assistant", text: reply }]);
    } catch (err) {
      // Keep the real reason in the console; show the user a gentle stand-in.
      console.warn("[Caddy] error:", err);
      const raw = err?.message || "";
      // Config/deploy problems get a clear, actionable message; genuine
      // rate-limits / transient errors get the playful "coffee" line.
      const isSetupIssue = /api key|not configured|not deployed|\/api\/gemini|endpoint|404/i.test(raw);
      const friendly = isSetupIssue
        ? `⚠️ ${raw}`
        : COFFEE_LINES[coffeeIdx.current++ % COFFEE_LINES.length];
      setMessages((m) => [...m, { role: "assistant", text: friendly, error: true }]);
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  if (!open) return null;

  return (
    <div className="ai-overlay" onClick={onClose}>
      <div className="ai-panel" onClick={(e) => e.stopPropagation()}>
        <div className="ai-header">
          <div className="ai-header-left">
            <span className="ai-orb" aria-hidden="true" />
            <div>
              <div className="ai-title">Caduceus</div>
              <div className="ai-subtitle">Your Workforce Hermes assistant</div>
            </div>
          </div>
          <div className="ai-header-actions">
            <button className="ai-iconbtn" onClick={newChat} title="New chat">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </button>
            <button className={`ai-iconbtn ${showHistory ? "active" : ""}`} onClick={openHistory} title="Chat history">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>
            </button>
            <button className="ai-iconbtn ai-close" onClick={onClose} title="Close">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>

        {showHistory ? (
          <div className="ai-messages ai-history">
            <p className="ai-history-title">Recent chats</p>
            {chats.length === 0 && <p className="ai-empty-sub" style={{ textAlign: "center" }}>No saved chats yet.</p>}
            {chats.map((c) => (
              <button key={c.id} className={`ai-history-item ${c.id === sessionId ? "active" : ""}`} onClick={() => loadChat(c)}>
                <span className="ai-history-item-title">{c.title || "Untitled chat"}</span>
                <span className="ai-history-item-time">{timeAgo(c.ts)}</span>
                <span className="ai-history-del" title="Delete" onClick={(e) => removeChat(e, c.id)}>×</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="ai-messages" ref={scrollRef}>
            {messages.length === 0 && !busy && (
              <div className="ai-empty">
                <p className="ai-empty-title">Hi, I'm Caddy 👋</p>
                <p className="ai-empty-sub">Ask about a project's updates, log a new task, jot an idea, or file a bug — just say it in plain language.</p>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`ai-msg ai-msg-${m.role} ${m.error ? "ai-msg-error" : ""}`}>
                {m.text}
              </div>
            ))}

            {busy && status && (
              <div className="ai-status">
                <span className="ai-status-dots" aria-hidden="true"><i /><i /><i /></span>
                <span className="ai-status-label">{status.label}</span>
              </div>
            )}
          </div>
        )}

        <div className="ai-input-row">
          <textarea
            className="ai-input"
            rows={1}
            placeholder="Message Caddy…"
            value={input}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button className="ai-send" onClick={() => send()} disabled={busy || !input.trim()} title="Send">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
