import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "../data/react";
import { api, uploadFeatureImage } from "../data/api";
import { notifyFeatureAdded, notifyFeatureCompleted } from "../utils/notifications";
import { itemWords } from "../utils/workspaceTerms";

// What a good one looks like — shown beside the form.
const TIPS = {
  feature: [
    "Say what it should do and who it helps.",
    "One idea per feature — it's easier to build and track.",
    "A sketch or screenshot of what you mean helps a lot.",
  ],
  bug: [
    "What did you do, what happened, and what did you expect?",
    "Name the screen or page where it happened.",
    "Add a screenshot of the error if you have one.",
  ],
  roadblock: [
    "What exactly is blocked right now?",
    "Who can unblock it — and what do they need to do?",
    "Attach the email, ticket or screenshot if it helps.",
  ],
};

function KindIcon({ kind }) {
  if (kind === "bug") {
    return (
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="8" y="6" width="8" height="14" rx="4" /><path d="M19 7l-3 2M5 7l3 2M19 19l-3-2M5 19l3-2M20 13h-4M4 13h4M10 4l1 2M14 4l-1 2" />
      </svg>
    );
  }
  if (kind === "roadblock") {
    return (
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    );
  }
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" />
    </svg>
  );
}

export default function FeatureModal({ mode, feature, taskId, onClose, canEdit, userName, type, taskTitle, showModal }) {
  // Feature, bug or roadblock — every label below comes from its words.
  const W = itemWords(type);
  const isBug = type === "bug";
  const isRoadblock = type === "roadblock";
  const [name, setName] = useState(feature?.name || "");
  const [description, setDescription] = useState(feature?.description || "");
  const [files, setFiles] = useState([]);
  const fileInputRef = useRef(null);
  const [previews, setPreviews] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [removedExistingIndexes, setRemovedExistingIndexes] = useState(new Set());

  const [zoomedImage, setZoomedImage] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const addTaskFeature = useMutation(api.tasks.addTaskFeature);
  const updateTaskFeature = useMutation(api.tasks.updateTaskFeature);
  const updateFeatureStatus = useMutation(api.tasks.updateFeatureStatus);

  const initialStorageIds = feature?.imageStorageIds || [];
  const imageUrls = useQuery(
    api.tasks.getFeatureImageUrls,
    initialStorageIds.length > 0 ? { storageIds: initialStorageIds } : "skip"
  );

  // Free the preview URLs when the modal closes (removeFile frees single ones).
  const previewsRef = useRef(previews);
  previewsRef.current = previews;
  useEffect(() => () => previewsRef.current.forEach((p) => URL.revokeObjectURL(p)), []);

  // Esc closes the zoomed image, then the modal (not while a dialog is on top).
  const zoomRef = useRef(null);
  zoomRef.current = zoomedImage;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || document.querySelector(".custom-modal-overlay")) return;
      e.stopPropagation();
      if (zoomRef.current) setZoomedImage(null);
      else onClose();
    };
    // Capture phase: runs before anything below can swallow the key.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  function addFiles(list) {
    const selectedFiles = Array.from(list || []).filter((file) => file.type.startsWith("image/"));
    if (!selectedFiles.length) return;
    const existingCount = initialStorageIds.length - removedExistingIndexes.size;
    if (selectedFiles.length + files.length + existingCount > 3) {
      showModal({
        title: "Too Many Files",
        message: "You can only attach up to 3 images total.",
        type: "alert"
      });
      return;
    }
    setFiles(prev => [...prev, ...selectedFiles]);
    const newPreviews = selectedFiles.map(file => URL.createObjectURL(file));
    setPreviews(prev => [...prev, ...newPreviews]);
  }

  function removeExistingImage(index) {
    setRemovedExistingIndexes(prev => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  }

  function removeFile(index) {
    setFiles(prev => prev.filter((_, i) => i !== index));
    setPreviews(prev => {
      URL.revokeObjectURL(prev[index]);
      return prev.filter((_, i) => i !== index);
    });
  }

  async function handleAddOrUpdateSubmit() {
    if (!name.trim() || !description.trim()) {
      showModal({
        title: "Incomplete Details",
        message: "Please provide a name and description.",
        type: "alert"
      });
      return;
    }
    setIsSubmitting(true);
    try {
      const finalStorageIds = initialStorageIds.filter((_, idx) => !removedExistingIndexes.has(idx));
      for (const file of files) {
        // Straight into the private Supabase Storage bucket; returns its path.
        finalStorageIds.push(await uploadFeatureImage(file));
      }

      if (mode === "add") {
        const estDate = new Date().toLocaleString("en-US", {
          timeZone: "America/New_York",
          year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
        });
        await addTaskFeature({
          taskId,
          feature: {
            id: crypto.randomUUID(),
            name,
            description,
            status: "pending",
            suggestedBy: userName || "Anonymous",
            imageStorageIds: finalStorageIds,
            type: type || "feature",
            createdAt: estDate,
          },
          actorEmail: (localStorage.getItem("wf_email") || "").toLowerCase(),
          actorName: userName || "Anonymous",
        });
        notifyFeatureAdded(taskTitle || "Task", name, type || "feature");
      } else if (mode === "edit") {
        await updateTaskFeature({
          taskId,
          featureId: feature.id,
          updates: { name, description, imageStorageIds: finalStorageIds },
        });
      }
      onClose();
    } catch (err) {
      console.error("Feature submit error:", err);
      showModal({
        title: "Save Failed",
        message: `Failed to save the ${W.one}: ${err.message || err.toString()}`,
        type: "alert"
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleMarkComplete() {
    setIsSubmitting(true);
    try {
      await updateFeatureStatus({
        taskId,
        featureId: feature.id,
        status: "completed",
        writer: userName,
      });
      notifyFeatureCompleted(taskTitle || "Task", feature.name, feature.type || type);
      onClose();
    } catch (err) {
      console.error(err);
      showModal({
        title: "Update Failed",
        message: "Failed to update status.",
        type: "alert"
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  function openZoom(url) {
    setZoomedImage(url);
    setZoomLevel(1);
    setPosition({ x: 0, y: 0 });
  }

  function handleMouseDown(e) {
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    e.preventDefault();
  }

  function handleMouseMove(e) {
    if (!isDragging) return;
    setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  }

  function handleMouseUp() {
    setIsDragging(false);
  }

  function handleWheel(e) {
    if (e.deltaY < 0) setZoomLevel(prev => Math.min(prev + 0.1, 1.5));
    else setZoomLevel(prev => Math.max(prev - 0.1, 0.5));
  }

  const existingActiveCount = initialStorageIds.length - removedExistingIndexes.size;
  const imageCount = files.length + existingActiveCount;
  const kind = isBug ? "bug" : isRoadblock ? "roadblock" : "feature";
  const editing = mode === "add" || mode === "edit";
  const done = feature?.status === "completed";
  const eyebrow = mode === "add" ? `New ${W.one}` : mode === "edit" ? `Editing ${W.one}` : `${W.title} · ${done ? W.done.toLowerCase() : W.open.toLowerCase()}`;
  const heading = mode === "add" ? W.add : mode === "edit" ? (name.trim() || W.title) : feature?.name;
  // Slots for the image grid: what's attached (existing + new), then empty ones up to 3.
  const slots = [
    ...(mode === "edit" && imageUrls ? imageUrls.map((url, idx) => (removedExistingIndexes.has(idx) ? null : { key: `e${idx}`, src: url, remove: () => removeExistingImage(idx) })).filter(Boolean) : []),
    ...previews.map((src, idx) => ({ key: `n${src}`, src, remove: () => removeFile(idx), fresh: true })),
  ];
  const empty = Math.max(0, 3 - imageCount);

  return (
    <>
      <div className="modal-overlay fm-overlay" style={{ zIndex: 3000 }} onClick={onClose}>
        <div
          className={`fm-shell fm-${kind} fm-mode-${mode}`}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={typeof heading === "string" ? heading : W.title}
        >
          {/* ── Left: what this is, for which project, and tips / details ── */}
          <aside className="fm-hero">
            <div className="fm-hero-orb" aria-hidden="true" />
            <div className="fm-hero-icon" aria-hidden="true"><KindIcon kind={kind} /></div>
            <div className="fm-hero-eyebrow">{eyebrow}</div>
            <h2 className="fm-hero-title">{heading}</h2>
            {taskTitle && (
              <div className="fm-hero-project">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
                </svg>
                <span>{taskTitle}</span>
              </div>
            )}
            {mode === "view" && feature ? (
              <dl className="fm-meta">
                <div>
                  <dt>Status</dt>
                  <dd><span className={`fm-status ${done ? "done" : "open"}`}>{done ? W.done : W.open}</span></dd>
                </div>
                <div><dt>{W.by}</dt><dd>{feature.suggestedBy || "System"}</dd></div>
                {feature.createdAt && <div><dt>Added</dt><dd>{feature.createdAt}</dd></div>}
                {initialStorageIds.length > 0 && <div><dt>Images</dt><dd>{initialStorageIds.length}</dd></div>}
              </dl>
            ) : (
              <ul className="fm-tips">
                {TIPS[kind].map((t) => <li key={t}>{t}</li>)}
              </ul>
            )}
          </aside>

          {/* ── Right: the form, or the details ── */}
          <section className="fm-main">
            <button className="fm-close" onClick={onClose} aria-label="Close">×</button>

            {editing && (
              <>
                <label className="fm-label" htmlFor="fm-name">{W.nameLabel}</label>
                <input
                  id="fm-name"
                  type="text"
                  className="fm-title-input"
                  placeholder={W.placeholder}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />

                <label className="fm-label" htmlFor="fm-desc">
                  Description
                  <span className="fm-count">{description.trim() ? `${description.trim().split(/\s+/).length} words` : ""}</span>
                </label>
                <textarea
                  id="fm-desc"
                  className="fm-desc-input"
                  placeholder={W.describe}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />

                <div className="fm-label">
                  Reference images
                  <span className="fm-count">{imageCount}/3 · optional</span>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
                  style={{ display: "none" }}
                />
                <div
                  className={`fm-images ${dragOver ? "over" : ""}`}
                  onDragOver={(e) => { if (imageCount < 3) { e.preventDefault(); setDragOver(true); } }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
                >
                  {slots.map((sl) => (
                    <div key={sl.key} className={`fm-slot filled ${sl.fresh ? "fresh" : ""}`}>
                      <img src={sl.src} alt="" onClick={() => openZoom(sl.src)} />
                      <button type="button" className="fm-slot-remove" onClick={sl.remove} aria-label="Remove image">×</button>
                    </div>
                  ))}
                  {Array.from({ length: empty }, (_, i) => (
                    <button key={`empty${i}`} type="button" className="fm-slot empty" onClick={() => fileInputRef.current?.click()}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                        <rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
                      </svg>
                      <span>{i === 0 ? (dragOver ? "Drop it here" : "Add or drop an image") : "Empty"}</span>
                    </button>
                  ))}
                </div>

                <footer className="fm-footer">
                  <button type="button" className="fm-btn ghost" onClick={onClose}>Cancel</button>
                  <button type="button" className="fm-btn primary" onClick={handleAddOrUpdateSubmit} disabled={isSubmitting}>
                    {isSubmitting && <span className="fm-spinner" aria-hidden="true" />}
                    {isSubmitting ? "Saving…" : mode === "edit" ? "Save changes" : W.add}
                  </button>
                </footer>
              </>
            )}

            {mode === "view" && feature && (
              <>
                <div className="fm-label">Description</div>
                <p className="fm-view-desc">{feature.description || "No description."}</p>

                {initialStorageIds.length > 0 && (
                  <>
                    <div className="fm-label">Reference images</div>
                    {imageUrls === undefined ? (
                      <div className="fm-images view">
                        {initialStorageIds.map((id) => <div key={id} className="fm-slot loading" />)}
                      </div>
                    ) : (
                      <div className="fm-images view">
                        {imageUrls.map((url, idx) => (
                          <button key={idx} type="button" className="fm-slot filled" onClick={() => openZoom(url)} aria-label={`Open image ${idx + 1}`}>
                            <img src={url} alt="" />
                            <span className="fm-slot-zoom">Click to zoom</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}

                <footer className="fm-footer">
                  <button type="button" className="fm-btn ghost" onClick={onClose}>Close</button>
                  {canEdit && !done && (
                    <button type="button" className="fm-btn primary success" onClick={handleMarkComplete} disabled={isSubmitting}>
                      {isSubmitting && <span className="fm-spinner" aria-hidden="true" />}
                      {isSubmitting ? "Updating…" : isRoadblock ? "Mark cleared" : "Mark completed"}
                    </button>
                  )}
                </footer>
              </>
            )}
          </section>
        </div>
      </div>

      {zoomedImage && (
        <div
          className="fm-zoom"
          style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(0,0,0,0.85)", zIndex: 4000, display: "flex", alignItems: "center", justifyContent: "center", cursor: isDragging ? "grabbing" : "zoom-out" }}
          onClick={() => setZoomedImage(null)}
          onWheel={handleWheel}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div style={{ position: "absolute", top: 20, left: 20, color: "white", fontSize: "0.8rem", background: "rgba(0,0,0,0.5)", padding: "5px 10px", borderRadius: 8 }}>
            Scroll to zoom ({Math.round(zoomLevel * 100)}%)
          </div>
          <button
            style={{ position: "absolute", top: 20, right: 20, background: "rgba(255,255,255,0.2)", color: "white", border: "none", width: 40, height: 40, borderRadius: "50%", cursor: "pointer", fontSize: "1.2rem", display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={(e) => { e.stopPropagation(); setZoomedImage(null); }}
          >×</button>
          <img
            src={zoomedImage}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={handleMouseDown}
            style={{
              maxWidth: "90%",
              maxHeight: "90%",
              transform: `translate(${position.x}px, ${position.y}px) scale(${zoomLevel})`,
              transition: isDragging ? "none" : "transform 0.1s ease-out",
              cursor: isDragging ? "grabbing" : "grab",
              boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
              borderRadius: 8,
              userSelect: "none",
              pointerEvents: "auto",
            }}
          />
        </div>
      )}
    </>
  );
}
