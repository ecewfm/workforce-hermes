import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useWorkspace } from "../utils/workspaceContext";

export default function Notebook({ userRole, userName, showModal }) {
  const workspace = useWorkspace();
  const ideas = useQuery(api.notebook.getIdeas, { workspace });
  const addIdea = useMutation(api.notebook.addIdea);
  const deleteIdeaMut = useMutation(api.notebook.deleteIdea);
  const takeIdeaMut = useMutation(api.notebook.takeIdea);

  async function handleSubmit(e) {
    e.preventDefault();
    const estDate = new Date().toLocaleDateString("en-US", {
      timeZone: "America/New_York",
    });
    await addIdea({
      workspace,
      name: document.getElementById("idea-title").value,
      description: document.getElementById("idea-desc").value,
      pros: document.getElementById("idea-pros").value,
      cons: document.getElementById("idea-cons").value,
      details: document.getElementById("idea-details").value,
      date: estDate,
    });
    showModal({
      title: "Success",
      message: "Concept Saved to Notebook",
      type: "success"
    });
    e.target.reset();
  }

  function handleDelete(id) {
    showModal({
      title: "Delete Idea",
      message: "Are you sure you want to delete this idea?",
      type: "confirm",
      onConfirm: () => deleteIdeaMut({ ideaId: id })
    });
  }

  function handleTake(id) {
    showModal({
      title: "Take Idea",
      message: "Take this idea? It will be removed from the notebook and added to your projects (assigned to you).",
      type: "confirm",
      onConfirm: async () => {
        try {
          await takeIdeaMut({ ideaId: id, takerName: userName, workspace });
          showModal({
            title: "Added to Projects",
            message: "This idea is now a project assigned to you. Find it in the Dashboard (To Do).",
            type: "success"
          });
        } catch (err) {
          showModal({ title: "Error", message: err.message || "Could not take this idea.", type: "alert" });
        }
      }
    });
  }

  return (
    <div id="notebook-view" className="view-section">
      <div className="container">
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <h1 style={{ fontWeight: 900, margin: 0, fontSize: "2rem", color: "var(--color-text-primary)" }}>Project Ideas & Concepts</h1>
          <div style={{ height: 3, width: "100%", background: "var(--color-accent)", marginTop: 10 }}></div>
        </div>

        <div className="notebook-grid">
          {/* Ideas Feed */}
          <div className="section-card">
            <h2 style={{ fontWeight: 900, marginTop: 0, textTransform: "uppercase", marginBottom: 30 }}>Ideas Feed</h2>
            {(Array.isArray(ideas) ? ideas : []).map((i) => {
              let takerBadge;
              let actions = [];

              if (i.taker) {
                takerBadge = (
                  <span style={{ background: "var(--color-accent)", color: "white", padding: "2px 8px", borderRadius: 12, fontSize: "0.7rem", fontWeight: 800 }}>
                    Taken by: {i.taker}
                  </span>
                );
              } else {
                takerBadge = (
                  <span style={{ background: "var(--color-text-secondary)", color: "white", padding: "2px 8px", borderRadius: 12, fontSize: "0.7rem", fontWeight: 800 }}>
                    Open for takers
                  </span>
                );
                if (userRole === "Programmer") {
                  actions.push(
                    <button key="take" className="btn-primary" style={{ marginRight: 10, padding: "6px 12px", width: "auto", fontSize: "0.75rem" }} onClick={() => handleTake(i._id)}>
                      Take Idea
                    </button>
                  );
                }
              }

              if (userRole === "Admin") {
                actions.push(
                  <button key="del" className="btn-secondary" style={{ background: "var(--color-logout)", padding: "6px 12px", fontSize: "0.75rem" }} onClick={() => handleDelete(i._id)}>
                    Delete
                  </button>
                );
              }

              return (
                <div key={i._id} className="idea-card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <h3>{i.name}</h3>
                      {takerBadge}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: 600 }}>{i.date}</div>
                  </div>
                  <p>{i.description}</p>

                  {i.details && (
                    <div style={{ margin: "10px 0", padding: 12, background: "var(--color-bg-primary)", borderRadius: 8, fontSize: "0.85rem", color: "var(--color-text-primary)", borderLeft: "4px solid var(--color-accent)", lineHeight: 1.5 }}>
                      <strong>Details:</strong><br />{i.details}
                    </div>
                  )}

                  <div className="pros-cons-grid">
                    <div className="pros-box">
                      <div className="pc-label">Pros</div>
                      <div className="pc-content">
                        {(i.pros || "").split("\n").map((line, idx) => line ? <div key={idx}>✓ {line}</div> : null)}
                      </div>
                    </div>
                    <div className="cons-box">
                      <div className="pc-label">Cons</div>
                      <div className="pc-content">
                        {(i.cons || "").split("\n").map((line, idx) => line ? <div key={idx}>✗ {line}</div> : null)}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 15 }}>
                    {actions}
                  </div>
                </div>
              );
            })}
            {(Array.isArray(ideas) ? ideas : []).length === 0 && (
              <p style={{ color: "#94a3b8", fontStyle: "italic", textAlign: "center" }}>No ideas yet. Add one!</p>
            )}
          </div>

          {/* Idea Form (Admin only) */}
          {userRole === "Admin" && (
            <div className="section-card">
              <h2 style={{ fontWeight: 900, marginTop: 0, textTransform: "uppercase", marginBottom: 30, textAlign: "center" }}>Add New Idea</h2>
              <div style={{ height: 2, background: "var(--color-accent)", marginBottom: 25 }}></div>
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label className="form-label">Project Name *</label>
                  <input type="text" id="idea-title" className="form-input" placeholder="Enter a temporary project name..." required />
                </div>
                <div className="form-group">
                  <label className="form-label">What does it do? *</label>
                  <textarea id="idea-desc" className="form-input" style={{ height: 100 }} placeholder="Briefly describe what this project would accomplish..." required></textarea>
                </div>
                <div className="form-group">
                  <label className="form-label">Pros</label>
                  <textarea id="idea-pros" className="form-input" style={{ height: 100 }} placeholder="List potential benefits..."></textarea>
                </div>
                <div className="form-group">
                  <label className="form-label">Cons</label>
                  <textarea id="idea-cons" className="form-input" style={{ height: 100 }} placeholder="List potential drawbacks..."></textarea>
                </div>
                <div className="form-group">
                  <label className="form-label">Further Details</label>
                  <textarea id="idea-details" className="form-input" style={{ height: 100 }} placeholder="Additional thoughts..."></textarea>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" className="btn-secondary" style={{ flex: 1 }} onClick={() => document.getElementById("idea-title")?.closest("form")?.reset()}>
                    Clear
                  </button>
                  <button type="submit" className="btn-primary" style={{ flex: 2, background: "var(--color-accent)" }}>Save Idea</button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
