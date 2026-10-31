import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHttpAppDataProvider } from "./app/appDataProvider";

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root was not found");

// Keep the existing admin styling isolated from the selected public redesign.
async function mount() {
  if (window.location.pathname.startsWith("/admin")) {
    const { BrowserAdminApp } = await import("./admin/BrowserAdminApp");
    await import("./admin/legacyBase.css");
    createRoot(root!).render(<StrictMode><BrowserAdminApp /></StrictMode>);
  } else {
    const { App } = await import("./app/App");
    createRoot(root!).render(<StrictMode><App dataProvider={createHttpAppDataProvider()} /></StrictMode>);
  }
}
void mount();
