import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { PreviewApp } from "./PreviewApp";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Unable to locate preview root container");
}

createRoot(container).render(
  <StrictMode>
    <PreviewApp />
  </StrictMode>
);
