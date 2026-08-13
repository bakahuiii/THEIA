import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { PersonalizationProvider } from "./hooks/usePersonalization";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersonalizationProvider>
      <App />
    </PersonalizationProvider>
  </StrictMode>,
);
