import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function PlaceholderApp() {
  return <main>Job-search</main>;
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element #root was not found");
}

createRoot(root).render(
  <StrictMode>
    <PlaceholderApp />
  </StrictMode>
);
