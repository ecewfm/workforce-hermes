import { useState, useEffect } from "react";
import Select from "./ui/Select";
import DatePicker from "./ui/DatePicker";

/**
 * A beautiful modal for collecting user input (Text/Links/Credentials).
 */
export default function InputModal({ isOpen, title, message, fields, onConfirm, onCancel }) {
  const [formData, setFormData] = useState({});

  useEffect(() => {
    if (isOpen) {
      const initial = {};
      fields.forEach(f => initial[f.name] = f.initialValue || "");
      setFormData(initial);
    }
  }, [isOpen, fields]);

  if (!isOpen) return null;

  const handleChange = (name, value) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleConfirm = () => {
    onConfirm(formData);
  };

  return (
    <div className="custom-modal-overlay" onClick={onCancel}>
      <div className="custom-modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
        <h2 className="custom-modal-title" style={{ marginBottom: 10 }}>{title}</h2>
        {message && <p className="custom-modal-message" style={{ marginBottom: 20 }}>{message}</p>}
        
        <div className="input-modal-fields" style={{ display: "flex", flexDirection: "column", gap: 15, marginBottom: 30 }}>
          {fields.map(field => (
            <div key={field.name} style={{ textAlign: "left" }}>
              <label style={{ fontSize: "0.7rem", fontWeight: 900, textTransform: "uppercase", color: "#64748b", marginBottom: 5, display: "block", marginLeft: 10 }}>
                {field.label}
              </label>
              {field.type === "date" ? (
                <DatePicker
                  className="input-modal-control"
                  value={formData[field.name] || ""}
                  onChange={(v) => handleChange(field.name, v)}
                  placeholder={field.placeholder || "Pick a date"}
                  allowClear
                  ariaLabel={field.label}
                />
              ) : field.type === "select" ? (
                <Select
                  className="input-modal-control"
                  value={formData[field.name] || ""}
                  onChange={(v) => handleChange(field.name, v)}
                  placeholder={field.placeholder}
                  options={field.options || []}
                  ariaLabel={field.label}
                />
              ) : (
                <input
                  type={field.type || "text"}
                  className="form-input"
                  style={{ width: "100%", padding: "12px 16px", borderRadius: 12 }}
                  placeholder={field.placeholder}
                  value={formData[field.name] || ""}
                  onChange={(e) => handleChange(field.name, e.target.value)}
                  autoFocus={fields[0].name === field.name}
                  onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
                />
              )}
            </div>
          ))}
        </div>

        <div className="custom-modal-actions">
          <button className="btn-modal-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button 
            className="btn-modal-confirm btn-primary" 
            onClick={handleConfirm}
          >
            Save Information
          </button>
        </div>
      </div>
    </div>
  );
}
