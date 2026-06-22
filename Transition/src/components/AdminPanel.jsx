import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ASSIGNABLE_ROLES } from "../utils/roles";

export default function AdminPanel({ staff, showModal, onViewProfile }) {
  const addStaffMut = useMutation(api.staff.addStaff);
  const updateStaffRole = useMutation(api.staff.updateStaffRole);
  const deleteStaffMut = useMutation(api.staff.deleteStaff);

  const activeStaff = (staff || []).filter(s => s.role !== "Pending");
  const pendingRequests = (staff || []).filter(s => s.role === "Pending");

  async function handleSubmit(e) {
    e.preventDefault();
    await addStaffMut({
      name: document.getElementById("staff-name").value,
      email: document.getElementById("staff-email").value,
      role: document.getElementById("staff-role").value,
    });
    showModal({
      title: "Success",
      message: "Staff Member Registered Successfully",
      type: "success"
    });
    e.target.reset();
  }

  return (
    <div id="admin-view" className="view-section">
      <div className="container">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 50 }}>
          <div className="section-card" style={{ padding: "40px", borderRadius: "var(--radius-lg)" }}>
            <h2 style={{ fontWeight: 900, marginTop: 0, textTransform: "uppercase" }}>Add New Staff</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input type="text" id="staff-name" className="form-input" required />
              </div>
              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input type="email" id="staff-email" className="form-input" required />
              </div>
              <div className="form-group">
                <label className="form-label">Role</label>
                <input type="text" id="staff-role" className="form-input" defaultValue="Programmer" required />
              </div>
              <button type="submit" className="btn-primary">Register Staff Member</button>
            </form>
          </div>
          <div className="section-card" style={{ padding: "40px", borderRadius: "var(--radius-lg)" }}>
            <h2 style={{ fontWeight: 900, marginTop: 0, textTransform: "uppercase", marginBottom: 20 }}>Staff Management</h2>
            
            <div style={{ marginBottom: 40 }}>
              <h3 style={{ color: "var(--color-accent)", borderBottom: "2px solid var(--color-accent)", paddingBottom: 15, marginBottom: 25, fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "1px" }}>Pending Access Requests</h3>
              {pendingRequests.length > 0 ? (
                <table className="table" style={{ background: "var(--color-bg-subtle)", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}></th>
                      <th>Name</th>
                      <th>Email</th>
                      <th style={{ textAlign: "right" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingRequests.map((s) => (
                      <tr key={s.email}>
                        <td>
                          <div className="staff-avatar-small" style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--color-bg-subtle)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", border: "1px solid var(--glass-border)" }}>
                            {s.avatarUrl ? <img src={s.avatarUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>}
                          </div>
                        </td>
                        <td><strong>{s.name}</strong></td>
                        <td style={{ color: "#64748b" }}>{s.email}</td>
                        <td>
                          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                            <button
                              className="btn-primary"
                              style={{ padding: "6px 12px", fontSize: "0.75rem", width: "auto" }}
                              onClick={async () => {
                                try {
                                  await updateStaffRole({ staffEmail: s.email, newRole: "Programmer" });
                                  showModal({
                                    title: "Success",
                                    message: `Approved ${s.name} as Programmer`,
                                    type: "success"
                                  });
                                } catch (err) {
                                  showModal({
                                    title: "Error",
                                    message: `Approval failed: ${err.message}`,
                                    type: "error"
                                  });
                                }
                              }}
                            >
                              Approve
                            </button>
                            <button
                              className="btn-secondary"
                              style={{ padding: "6px 12px", fontSize: "0.75rem", background: "var(--color-logout)", color: "white" }}
                              onClick={async () => {
                                try {
                                  await deleteStaffMut({ email: s.email });
                                  showModal({
                                    title: "Request Rejected",
                                    message: `Successfully rejected access for ${s.name}`,
                                    type: "success"
                                  });
                                } catch (err) {
                                  showModal({
                                    title: "Error",
                                    message: `Rejection failed: ${err.message}`,
                                    type: "error"
                                  });
                                }
                              }}
                            >
                              Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ textAlign: "center", color: "var(--color-text-secondary)", fontStyle: "italic", padding: 40, background: "var(--color-bg-subtle)", borderRadius: "var(--radius-md)", border: "1px solid var(--glass-border)" }}>
                  No pending access requests at the moment.
                </div>
              )}
            </div>

            <h3 style={{ borderBottom: "2px solid var(--color-bg-primary)", paddingBottom: 10, marginBottom: 15, fontSize: "1rem", color: "var(--color-text-primary)", textTransform: "uppercase" }}>Active Staff</h3>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}></th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Email</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {activeStaff.map((s) => (
                  <tr key={s.email}>
                    <td>
                      <div 
                        className="staff-avatar-small clickable" 
                        onClick={() => onViewProfile(s)}
                        style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--color-bg-subtle)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", cursor: "pointer", border: "1px solid var(--glass-border)" }}
                      >
                        {s.avatarUrl ? <img src={s.avatarUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>}
                      </div>
                    </td>
                    <td>
                      <strong 
                        className="clickable-name" 
                        onClick={() => onViewProfile(s)}
                        style={{ cursor: "pointer", color: "var(--color-text-primary)" }}
                      >
                        {s.name}
                      </strong>
                    </td>
                    <td>
                      <select
                        className="role-switcher"
                        value={s.role}
                        onChange={async (e) => {
                          const newRole = e.target.value;
                          await updateStaffRole({ staffEmail: s.email, newRole });
                          showModal({
                            title: "Role Updated",
                            message: `${s.name}'s role has been changed to ${newRole}.`,
                            type: "success"
                          });
                        }}
                      >
                        {ASSIGNABLE_ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
                      </select>
                    </td>
                    <td style={{ color: "#64748b" }}>{s.email}</td>
                    <td>
                      <button
                        className="btn-secondary"
                        style={{ padding: "4px 8px", fontSize: "0.75rem", background: "var(--color-logout)", color: "white" }}
                        onClick={() => {
                          showModal({
                            title: "Revoke Access",
                            message: `Are you sure you want to completely remove access for ${s.name}? They will no longer be able to log in.`,
                            type: "confirm",
                            onConfirm: async () => {
                              try {
                                await deleteStaffMut({ email: s.email });
                                showModal({
                                  title: "Access Revoked",
                                  message: `Successfully removed access for ${s.name}`,
                                  type: "success"
                                });
                              } catch (err) {
                                showModal({
                                  title: "Error",
                                  message: `Removal failed: ${err.message}`,
                                  type: "error"
                                });
                              }
                            }
                          });
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
