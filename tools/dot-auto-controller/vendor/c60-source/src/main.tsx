import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserAdminApp } from "./admin/BrowserAdminApp";
import { App } from "./app/App";
import { createHttpAppDataProvider } from "./app/appDataProvider";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element #root was not found");
}

createRoot(root).render(
  <StrictMode>
    {window.location.pathname.startsWith("/admin") ? (
      <BrowserAdminApp />
    ) : (
      <App dataProvider={createHttpAppDataProvider()} />
    )}
  </StrictMode>
);
