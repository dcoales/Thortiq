import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

/**
 * Bootstraps the client-side React tree using the upcoming shared providers.
 */
const container = document.getElementById("root");

if (!container) {
  throw new Error("Unable to locate root container for Thortiq web app");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
