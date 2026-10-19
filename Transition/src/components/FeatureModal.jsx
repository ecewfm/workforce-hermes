import { useState, useEffect } from "react";
import { useMutation, useQuery } from "../data/react";
import { api, uploadFeatureImage } from "../data/api";
import { notifyFeatureAdded, notifyFeatureCompleted } from "../utils/notifications";

export default function FeatureModal({ mode, feature, taskId, onClose, canEdit, userName, type, taskTitle, showModal }) {
  const [name, setName] = useState(feature?.name || "");
  const [description, setDescription] = useState(feature?.description || "");
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
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

  useEffect(() => {
    return () => previews.forEach(p => URL.revokeObjectURL(p));
  }, [previews]);

  function handleFileChange(e) {
    const selectedFiles = Array.from(e.target.files);
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
        notifyFeatureAdded(taskTitle || "Task", name);
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
        message: `Failed to save feature: ${err.message || err.toString()}`,
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
      notifyFeatureCompleted(taskTitle || "Task", feature.name);
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

  return (
    <>
      <div className="modal-overlay" style={{ zIndex: 3000 }} onClick={onClose}>
        <div className="modal-content" style={{ maxWidth: 600, padding: 30 }} onClick={(e) => e.stopPropagation()}>
          <button className="modal-close" onClick={onClose}>×</button>

          <h2 style={{ margin: "0 0 20px 0", fontSize: "1.4rem", fontWeight: 900 }}>
            {mode === "add" ? `Add New ${type === "bug" ? "Bug" : "Feature"}` : mode === "edit" ? `Edit ${type === "bug" ? "Bug" : "Feature"}` : `${type === "bug" ? "Bug" : "Feature"} Details`}
          </h2>

          {(mode === "add" || mode === "edit") && (
            <div>
              <div className="form-group">
                <label className="form-label">{type === "bug" ? "Bug Name" : "Feature Name"}</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder={type === "bug" ? "e.g. Broken login button" : "e.g. Advanced Analytics"}
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea
                  className="form-input"
                  placeholder={`Describe the ${type === "bug" ? "bug" : "feature"}...`}
                  style={{ height: 100, resize: "vertical" }}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Reference Images (Max 3 total)</label>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileChange}
                  disabled={files.length + existingActiveCount >= 3}
                  style={{ display: "block", marginBottom: 10, fontSize: "0.8rem" }}
                />
                <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                  {/* Existing images (edit mode) */}
                  {mode === "edit" && imageUrls && imageUrls.map((url, idx) =>
                    !removedExistingIndexes.has(idx) && (
                      <div key={`existing-${idx}`} style={{ position: "relative", width: 100, height: 100, borderRadius: 8, overflow: "hidden", border: "1px solid #e2e8f0" }}>
                        <img src={url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        <button
                          onClick={() => removeExistingImage(idx)}
                          style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.5)", color: "white", border: "none", borderRadius: "50%", width: 20, height: 20, cursor: "pointer", fontSize: "0.6rem" }}
                        >×</button>
                      </div>
                    )
                  )}
                  {/* New file previews */}
                  {previews.map((src, idx) => (
                    <div key={`new-${idx}`} style={{ position: "relative", width: 100, height: 100, borderRadius: 8, overflow: "hidden", border: "1px solid #e2e8f0" }}>
                      <img src={src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      <button
                        onClick={() => removeFile(idx)}
                        style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.5)", color: "white", border: "none", borderRadius: "50%", width: 20, height: 20, cursor: "pointer", fontSize: "0.6rem" }}
                      >×</button>
                    </div>
                  ))}
                </div>
              </div>

              <button
                className="btn-primary"
                onClick={handleAddOrUpdateSubmit}
                disabled={isSubmitting}
                style={{ marginTop: 20, background: type === "bug" ? "#ef4444" : undefined }}
              >
                {isSubmitting ? "SAVING..." : mode === "edit" ? "SAVE CHANGES" : `ADD ${type === "bug" ? "BUG" : "FEATURE"}`}
              </button>
            </div>
          )}

          {mode === "view" && feature && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <div>
                  <h3 style={{ margin: "0 0 5px 0", fontSize: "1.2rem", color: "var(--color-text-primary)", fontWeight: 800 }}>{feature.name}</h3>
                  <span className={`feature-badge ${feature.status}`} style={{ fontSize: "0.65rem", padding: "4px 8px" }}>
                    {feature.status === "completed" ? "COMPLETED" : "PENDING"}
                  </span>
                </div>
                {canEdit && feature.status !== "completed" && (
                  <button
                    className="btn-primary"
                    style={{ width: "auto", padding: "8px 16px", fontSize: "0.7rem", background: "#10b981" }}
                    onClick={handleMarkComplete}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? "UPDATING..." : "MARK COMPLETED"}
                  </button>
                )}
              </div>

              <div style={{ background: "var(--color-bg-subtle)", padding: 20, borderRadius: 12, border: "1px solid var(--glass-border)", marginBottom: 20 }}>
                <h4 style={{ margin: "0 0 10px 0", fontSize: "0.75rem", textTransform: "uppercase", color: "var(--color-text-secondary)", fontWeight: 800 }}>Description</h4>
                <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--color-text-primary)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{feature.description}</p>
              </div>

              <div style={{ marginBottom: 20 }}>
                <span style={{ fontSize: "0.7rem", fontWeight: 800, color: "var(--color-accent)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{type === "bug" ? "Reported By" : "Suggested By"}</span>
                <div style={{ fontSize: "0.9rem", color: "var(--color-text-primary)", fontWeight: 700, marginTop: "4px" }}>{feature.suggestedBy || "System"}</div>
              </div>

              {initialStorageIds.length > 0 && (
                <div>
                  <h4 style={{ margin: "0 0 10px 0", fontSize: "0.75rem", textTransform: "uppercase", color: "#64748b", fontWeight: 800 }}>Reference Images</h4>
                  {imageUrls === undefined ? (
                    <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}>Loading images...</div>
                  ) : (
                    <div style={{ display: "flex", gap: 15 }}>
                      {imageUrls.map((url, idx) => (
                        <div
                          key={idx}
                          onClick={() => openZoom(url)}
                          style={{ width: 120, height: 120, borderRadius: 10, overflow: "hidden", border: "1px solid #e2e8f0", cursor: "pointer", transition: "0.2s" }}
                        >
                          <img src={url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {zoomedImage && (
        <div
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
