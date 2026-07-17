import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { documentMetadataController } from "./document-metadata";
import { classifyRoute, resolveCanonicalLocation } from "./routing";
import "./styles.css";

const requestedLocation =
  window.location.pathname + window.location.search + window.location.hash;
const canonicalLocation = resolveCanonicalLocation(requestedLocation);
if (canonicalLocation !== requestedLocation) {
  window.history.replaceState(null, "", canonicalLocation);
}
documentMetadataController.begin(classifyRoute(window.location.pathname));

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
