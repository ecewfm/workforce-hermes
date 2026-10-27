import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useConvex } from "../data/react";
import { api, uploadSopFile, sopFileUrl, removeSopFile } from "../data/api";
import { useWorkspace } from "../utils/workspaceContext";
import {
  SOP_ACCEPT, readSopFile, digestSop, titleFromFileName, sopFileKind, countWords,
} from "../utils/sopKnowledge";
import "../styles/knowledge.css";

const fmtDay = (ms) => (ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const KIND_LABEL = { docx: "DOCX", pdf: "PDF", txt: "TXT", md: "MD", typed: "TYPED" };

function KindBadge({ doc }) {
  const k = doc.source === "typed" ? "typed" : sopFileKind(doc.fileName || doc.fileType || "") || doc.fileType;
  return <span className={`kb-kind kb-kind--${k}`}>{KIND_LABEL[k] || String(k || "FILE").toUpperCase()}</span>;
}

/**
 * Settings → Account Knowledge (Operations). Each client account's SOPs and
 * notes; the AI reads them when it plans a project for that account. Anyone
 * on an account can add and edit; Admins (or whoever added it) can delete.
 */
export default function AccountKnowledge({ showModal, userName }) {
  const workspace = useWorkspace();
  const convex = useConvex();
  const overview = useQuery(api.knowledge.getOverview, { workspace });
  const accounts = useMemo(() => (Array.isArray(overview) ? overview : []), [overview]);
  const [accountId, setAccountId] = useState("");
  useEffect(() => {
    if (!accounts.length) { if (accountId) setAccountId(""); return; }
    if (!accounts.some((a) => a.accountId === accountId)) setAccountId(accounts[0].accountId);
  }, [accounts, accountId]);
  const data = useQuery(api.knowledge.getAccount, accountId ? { accountId } : "skip");
  const account = accounts.find((a) => a.accountId === accountId);

  // ── Notes ──
  const saveNotesMut = useMutation(api.knowledge.saveNotes);
  const [notes, setNotes] = useState("");
  const [notesFor, setNotesFor] = useState(null); // which account `notes` was loaded from
  const [savingNotes, setSavingNotes] = useState(false);
  const notesDirty = notesFor === accountId && data && notes !== (data.notes || "");
  useEffect(() => {
    // Load the account's notes — but never clobber what someone is typing.
    if (!data || data.accountId !== accountId) return;
    if (notesFor !== accountId || !notesDirty) { setNotes(data.notes || ""); setNotesFor(accountId); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.notes, data?.accountId, accountId]);

  async function saveNotes() {
    if (!notesDirty || savingNotes) return;
    setSavingNotes(true);
    try {
      await saveNotesMut({ accountId, notes });
    } catch (err) {
      showModal({ title: "Couldn't save the notes", message: err.message || "Please try again.", type: "alert" });
    } finally {
      setSavingNotes(false);
    }
  }

  function switchAccount(id) {
    if (id === accountId) return;
    if (notesDirty) {
      showModal({
        title: "Leave without saving?",
        message: `Your changes to ${account?.name || "this account"}'s notes aren't saved yet.`,
        type: "confirm",
        onConfirm: () => { setNotesFor(null); setAccountId(id); },
      });
      return;
    }
    setNotesFor(null);
    setAccountId(id);
  }

  // ── Documents ──
  const addDocMut = useMutation(api.knowledge.addDoc);
  const setDigestMut = useMutation(api.knowledge.setDigest);
  const docs = data?.accountId === accountId ? data.docs || [] : [];
  const [uploads, setUploads] = useState([]); // [{ key, name, stage, error }]
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);
  const [sheet, setSheet] = useState(null); // { docId } | { create: true }

  const setUpload = (key, patch) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length || !accountId) return;
    const target = accountId;
    for (const file of files) {
      const key = crypto.randomUUID();
      setUploads((u) => [...u, { key, name: file.name, stage: sopFileKind(file.name) === "pdf" ? "The AI is reading the PDF…" : "Reading the file…" }]);
      let path = null;
      try {
        const text = await readSopFile(file);
        setUpload(key, { stage: "Uploading…" });
        path = await uploadSopFile(target, file);
        setUpload(key, { stage: "Saving…" });
        await addDocMut({
          accountId: target, title: titleFromFileName(file.name), source: "upload", content: text,
          fileName: file.name, fileType: sopFileKind(file.name), fileSize: file.size, storagePath: path,
        });
        setUploads((u) => u.filter((x) => x.key !== key));
      } catch (err) {
        if (path) removeSopFile(path);
        setUpload(key, { stage: "", error: err.message || "Couldn't add this file." });
      }
    }
  }

  // The AI reads every document that's waiting (new uploads, edited text).
  const reading = useRef(new Set());
  const [readingIds, setReadingIds] = useState([]);
  const readDoc = useCallback(async (docId) => {
    if (reading.current.has(docId)) return;
    reading.current.add(docId);
    setReadingIds([...reading.current]);
    try {
      const doc = await convex.query(api.knowledge.getDoc, { docId });
      if (!doc) return;
      const digest = await digestSop({ title: doc.title, text: doc.content, accountName: account?.name || "this account" });
      await setDigestMut({ docId, digest, status: "ready" });
    } catch (err) {
      await setDigestMut({ docId, status: "failed", error: err.message || "The AI couldn't read it." }).catch(() => {});
    } finally {
      reading.current.delete(docId);
      setReadingIds([...reading.current]);
    }
  }, [convex, account?.name, setDigestMut]);
  useEffect(() => {
    for (const d of docs) if (d.digestStatus === "pending" && !reading.current.has(d._id)) readDoc(d._id);
  }, [docs, readDoc]);

  const totalWords = docs.reduce((s, d) => s + (d.words || 0), 0) + countWords(data?.notes || "");
  const lastUpdate = [data?.notesUpdatedAt, ...docs.map((d) => d.updatedAt)].filter(Boolean).sort((a, b) => b - a)[0];

  if (overview === undefined) {
    return <div className="kb-loading"><span className="kb-spinner" /> Loading accounts…</div>;
  }
  if (!accounts.length) {
    return (
      <div className="settings-card kb-empty-accounts">
        No client accounts you can see yet. Admin+ and Managers add accounts under Client Accounts, then put people on them in Staff Management.
      </div>
    );
  }

  return (
    <div className="kb">
      {/* ── Which account ── */}
      <div className="kb-accounts" role="tablist" aria-label="Client account">
        {accounts.map((a) => (
          <button
            key={a.accountId}
            type="button"
            role="tab"
            aria-selected={a.accountId === accountId}
            className={`kb-account ${a.accountId === accountId ? "on" : ""}`}
            onClick={() => switchAccount(a.accountId)}
          >
            <span className="kb-account-name">{a.name}</span>
            <span className="kb-account-meta">{a.docs ? plural(Number(a.docs), "SOP") : a.hasNotes ? "Notes only" : "Empty"}</span>
          </button>
        ))}
      </div>

      {/* ── What the AI knows ── */}
      <div className={`kb-status ${totalWords ? "has" : ""}`}>
        <span className="kb-status-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z" /><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" /></svg>
        </span>
        <div>
          {totalWords ? (
            <>
              <strong>The AI reads {docs.length ? plural(docs.length, "SOP") : "no SOPs"}{countWords(data?.notes || "") ? " and the notes below" : ""}</strong> ({plural(totalWords, "word")}) whenever someone plans a project for {account?.name}.
              {lastUpdate ? <span className="kb-status-sub"> Last updated {fmtDay(lastUpdate)}.</span> : null}
            </>
          ) : (
            <>
              <strong>Nothing here yet for {account?.name}.</strong> Add its SOPs and a few notes, and the AI will plan this account's projects around how it actually works.
            </>
          )}
        </div>
      </div>

      {/* ── Notes (typed) ── */}
      <div className="settings-card kb-card">
        <div className="kb-card-head">
          <div>
            <div className="kb-card-title">Notes for the AI</div>
            <div className="kb-card-hint">Anything worth knowing when planning for {account?.name}: who signs off, client rules, tools, SLAs, blackout dates, how the team likes things done.</div>
          </div>
        </div>
        <textarea
          className="kb-notes"
          value={notesFor === accountId ? notes : ""}
          onChange={(e) => { setNotes(e.target.value); setNotesFor(accountId); }}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "Enter")) { e.preventDefault(); saveNotes(); } }}
          placeholder={`e.g.\n• Every client-facing change needs sign-off from the client's Ops Manager (allow 5 business days).\n• Go-lives never on weekends or the last 3 days of the month.\n• Coaching forms live in the "${account?.name || "Account"} QA" sheet.`}
          rows={8}
          disabled={!data}
          aria-label={`Notes for the AI about ${account?.name || "this account"}`}
        />
        <div className="kb-notes-foot">
          <span className="kb-muted">
            {plural(countWords(notesFor === accountId ? notes : ""), "word")}
            {data?.notesUpdatedBy ? ` · saved by ${data.notesUpdatedBy}, ${fmtDay(data.notesUpdatedAt)}` : ""}
          </span>
          {notesDirty && <span className="kb-unsaved">Unsaved changes</span>}
          <button type="button" className="settings-btn-primary kb-save" onClick={saveNotes} disabled={!notesDirty || savingNotes}>
            {savingNotes ? "Saving…" : notesDirty ? "Save notes" : "Saved"}
          </button>
        </div>
      </div>

      {/* ── SOP documents ── */}
      <div
        className={`settings-card kb-card kb-docs ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); setDragging(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
        onDrop={(e) => { e.preventDefault(); setDragging(false); uploadFiles(e.dataTransfer.files); }}
      >
        <div className="kb-card-head">
          <div>
            <div className="kb-card-title">SOP documents</div>
            <div className="kb-card-hint">Upload Word (.docx), PDF or text files, or write one here. The AI reads each one and keeps what matters for planning.</div>
          </div>
          <div className="kb-card-actions">
            <button type="button" className="settings-btn-outline" onClick={() => setSheet({ create: true })}>Write one</button>
            <button type="button" className="settings-btn-primary" onClick={() => fileRef.current?.click()}>Upload SOPs</button>
            <input ref={fileRef} type="file" accept={SOP_ACCEPT} multiple hidden onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }} />
          </div>
        </div>

        {(docs.length > 0 || uploads.length > 0) ? (
          <ul className="kb-doc-list">
            {uploads.map((u) => (
              <li key={u.key} className={`kb-doc kb-doc--pending ${u.error ? "failed" : ""}`}>
                <span className="kb-kind kb-kind--pending">{u.error ? "!" : <span className="kb-spinner" />}</span>
                <div className="kb-doc-main">
                  <span className="kb-doc-title">{u.name}</span>
                  <span className={`kb-doc-meta ${u.error ? "err" : ""}`}>{u.error || u.stage}</span>
                </div>
                {u.error && <button type="button" className="kb-x" aria-label="Dismiss" onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}>×</button>}
              </li>
            ))}
            {docs.map((d, i) => {
              const busy = readingIds.includes(d._id) || d.digestStatus === "pending";
              return (
                <li key={d._id} className="kb-doc" style={{ "--i": Math.min(i, 10) }}>
                  <button type="button" className="kb-doc-open" onClick={() => setSheet({ docId: d._id })}>
                    <KindBadge doc={d} />
                    <span className="kb-doc-main">
                      <span className="kb-doc-title">{d.title}</span>
                      <span className="kb-doc-meta">{plural(d.words || 0, "word")} · {d.source === "typed" ? "written" : "added"} by {d.createdBy || "someone"} · {fmtDay(d.createdAt)}</span>
                    </span>
                    <span className={`kb-ai ${busy ? "busy" : d.digestStatus}`}>
                      {busy ? <><span className="kb-spinner" />AI is reading</> : d.digestStatus === "ready" ? "AI read it" : "AI couldn't read it"}
                    </span>
                  </button>
                  {!busy && d.digestStatus === "failed" && (
                    <button type="button" className="kb-retry" onClick={() => readDoc(d._id)}>Try again</button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <button type="button" className="kb-drop" onClick={() => fileRef.current?.click()}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><polyline points="9 15 12 12 15 15" /></svg>
            <span><strong>Drop {account?.name}'s SOPs here</strong>, or click to choose files</span>
            <span className="kb-muted">Word (.docx), PDF up to 3 MB, or .txt / .md</span>
          </button>
        )}
        {dragging && <div className="kb-drop-veil">Drop to add to {account?.name}</div>}
      </div>

      {sheet && (
        <DocSheet
          key={sheet.docId || "new"}
          docId={sheet.docId}
          create={!!sheet.create}
          accountId={accountId}
          accountName={account?.name}
          canDeleteAll={!!data?.canDelete}
          userName={userName}
          showModal={showModal}
          reading={sheet.docId ? readingIds.includes(sheet.docId) : false}
          onReadAgain={(id) => readDoc(id)}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

// ── One SOP: what the AI took from it, and the text it reads ───────────────
function DocSheet({ docId, create, accountId, accountName, canDeleteAll, userName, showModal, reading, onReadAgain, onClose }) {
  const doc = useQuery(api.knowledge.getDoc, docId ? { docId } : "skip");
  const addDocMut = useMutation(api.knowledge.addDoc);
  const updateDocMut = useMutation(api.knowledge.updateDoc);
  const deleteDocMut = useMutation(api.knowledge.deleteDoc);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [loadedFor, setLoadedFor] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (doc && loadedFor !== doc._id) { setTitle(doc.title || ""); setText(doc.content || ""); setLoadedFor(doc._id); }
  }, [doc, loadedFor]);
  const dirty = create ? !!(title.trim() || text.trim()) : !!doc && (title !== (doc.title || "") || text !== (doc.content || ""));
  const canDelete = !create && doc && (canDeleteAll || doc.createdBy === userName);
  const digest = doc?.digest;
  const busy = reading || doc?.digestStatus === "pending";

  const requestClose = useCallback(() => {
    if (!dirty) { onClose(); return; }
    showModal({ title: "Close without saving?", message: "Your changes to this SOP will be lost.", type: "confirm", onConfirm: onClose });
  }, [dirty, onClose, showModal]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || document.querySelector(".custom-modal-overlay")) return;
      e.stopPropagation();
      requestClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [requestClose]);

  async function save() {
    if (!title.trim()) { showModal({ title: "Give it a title", message: "A short name for this SOP, e.g. \"QA Calibration\".", type: "alert" }); return; }
    if (!text.trim()) { showModal({ title: "Nothing to read", message: "Write the SOP's steps and rules in the text box first.", type: "alert" }); return; }
    setSaving(true);
    try {
      if (create) {
        await addDocMut({ accountId, title: title.trim(), source: "typed", content: text });
      } else {
        await updateDocMut({ docId, title: title.trim(), content: text !== doc.content ? text : undefined });
        setLoadedFor(null);
      }
      onClose();
    } catch (err) {
      showModal({ title: "Couldn't save it", message: err.message || "Please try again.", type: "alert" });
    } finally {
      setSaving(false);
    }
  }

  function remove() {
    showModal({
      title: "Delete this SOP?",
      message: `"${doc.title}" will be removed from ${accountName}'s knowledge${doc.storagePath ? ", along with the original file" : ""}. The AI stops using it right away.`,
      type: "confirm",
      onConfirm: async () => {
        try { await deleteDocMut({ docId }); onClose(); } catch (err) { showModal({ title: "Couldn't delete it", message: err.message, type: "alert" }); }
      },
    });
  }

  async function download() {
    try { window.open(await sopFileUrl(doc.storagePath, doc.fileName), "_blank", "noopener"); } catch (err) { showModal({ title: "Couldn't open the file", message: err.message, type: "alert" }); }
  }

  const section = (label, items) => (items?.length ? (
    <div className="kb-dg-block"><div className="kb-dg-label">{label}</div><ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
  ) : null);

  return createPortal(
    <div className="kb-sheet-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
      <div className="kb-sheet" role="dialog" aria-modal="true" aria-label={title || "SOP"}>
        <div className="kb-sheet-head">
          {doc ? <KindBadge doc={doc} /> : <span className="kb-kind kb-kind--typed">NEW</span>}
          <input className="kb-sheet-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="SOP title, e.g. QA Calibration" aria-label="SOP title" autoFocus={create} maxLength={200} />
          <button type="button" className="kb-sheet-close" onClick={requestClose} aria-label="Close">×</button>
        </div>
        <div className="kb-sheet-meta">
          {create ? `A new SOP for ${accountName}. Write the steps and rules as you'd explain them to a new team lead.`
            : doc ? `${accountName} · ${plural(countWords(text), "word")} · ${doc.source === "typed" ? "written" : `uploaded from ${doc.fileName || "a file"}`} by ${doc.createdBy || "someone"}, ${fmtDay(doc.createdAt)}${doc.updatedBy && doc.updatedAt !== doc.createdAt ? ` · edited by ${doc.updatedBy}, ${fmtDay(doc.updatedAt)}` : ""}`
              : "Loading…"}
        </div>

        <div className={`kb-sheet-body ${create ? "create" : ""}`}>
          {!create && (
            <section className="kb-digest" aria-label="What the AI took from it">
              <div className="kb-pane-label">What the AI took from it</div>
              {busy ? (
                <div className="kb-dg-busy"><span className="kb-spinner" /> The AI is reading this SOP…</div>
              ) : doc?.digestStatus === "failed" ? (
                <div className="kb-dg-failed">The AI couldn't read it{doc.digestError ? `: ${doc.digestError}` : "."} <button type="button" onClick={() => onReadAgain(docId)}>Try again</button></div>
              ) : digest ? (
                <>
                  {digest.summary && <p className="kb-dg-summary">{digest.summary}</p>}
                  {digest.appliesTo?.length > 0 && <div className="kb-dg-chips">{digest.appliesTo.map((a, i) => <span key={i}>{a}</span>)}</div>}
                  {digest.steps?.length > 0 && (
                    <div className="kb-dg-block">
                      <div className="kb-dg-label">Procedure</div>
                      <ol>{digest.steps.map((s, i) => <li key={i}>{s.step}{(s.owner || s.timing) && <span className="kb-muted"> {[s.owner, s.timing].filter(Boolean).join(" · ")}</span>}</li>)}</ol>
                    </div>
                  )}
                  {section("Sign-offs", digest.approvals)}
                  {section("Timelines & SLAs", digest.timelines)}
                  {section("Tools", digest.tools)}
                  {section("Roles", digest.roles)}
                  {section("Rules", digest.rules)}
                  {section("Watch-outs", digest.risks)}
                </>
              ) : <div className="kb-muted">Not read yet.</div>}
            </section>
          )}
          <section className="kb-text" aria-label="The text the AI reads">
            <div className="kb-pane-label">{create ? "The SOP" : "The text the AI reads"}<span className="kb-muted">{plural(countWords(text), "word")}</span></div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "Enter")) { e.preventDefault(); if (dirty) save(); } }}
              placeholder={"e.g.\n1. The TL reviews 5 calls per agent each week in the QA form.\n2. Scores under 85% get a coaching session within 48 hours.\n3. The client's QA lead signs off on scorecard changes."}
              aria-label="SOP text"
              disabled={!create && !doc}
            />
            {!create && <div className="kb-text-hint">Fix anything the file reading got wrong. Saving new text makes the AI read it again.</div>}
          </section>
        </div>

        <footer className="kb-sheet-foot">
          {canDelete && <button type="button" className="kb-btn danger" onClick={remove}>Delete</button>}
          {!create && doc?.storagePath && <button type="button" className="kb-btn ghost" onClick={download}>Download original</button>}
          {!create && doc && !busy && <button type="button" className="kb-btn ghost" onClick={() => onReadAgain(docId)}>Read it again</button>}
          <span className="kb-spacer" />
          <button type="button" className="kb-btn ghost" onClick={requestClose}>{dirty ? "Cancel" : "Close"}</button>
          <button type="button" className="kb-btn primary" onClick={save} disabled={!dirty || saving}>
            {saving ? "Saving…" : create ? "Add SOP" : "Save changes"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
