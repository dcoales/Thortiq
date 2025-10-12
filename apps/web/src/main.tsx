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

document.documentElement.style.height = "100%";
document.documentElement.style.overflow = "hidden";
document.body.style.height = "100%";
document.body.style.overflow = "hidden";
document.body.style.margin = "0";

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
