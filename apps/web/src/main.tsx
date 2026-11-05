import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./extra.css";
import "./liquid.css";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);

// Offline app shell, only where browsers allow service workers (the hosted https site).
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => undefined);
}
