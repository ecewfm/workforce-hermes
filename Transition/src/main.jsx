import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import "./styles/controls.css";
import "./styles/motion-sweep.css";
import "./styles/feature-modal.css";
import "./styles/entry-review.css";

// Data now comes from Supabase via src/data (no provider needed — the client
// is a shared module; see src/data/supabase.js).
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
