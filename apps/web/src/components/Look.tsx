import { useState } from "react";

export type LookId = "glass" | "cockpit" | "sunset" | "neon";
const KEY = "glidepath.look";

export const LOOKS: { id: LookId; label: string; note: string; swatch: string }[] = [
  { id: "glass", label: "Liquid glass", note: "Uses your background", swatch: "linear-gradient(160deg,#1E3A8A,#0A84FF 55%,#5E5CE6)" },
  { id: "cockpit", label: "Cockpit", note: "Avionics readouts", swatch: "linear-gradient(160deg,#0B0E12 40%,#1A1F26),radial-gradient(circle at 30% 60%,#3CFF6B 0 6%,transparent 7%),radial-gradient(circle at 70% 40%,#FFB340 0 6%,transparent 7%)" },
  { id: "sunset", label: "Sunset", note: "Warm and bright", swatch: "linear-gradient(170deg,#2A1B5C,#7A2E7E 38%,#E0566B 68%,#FFA34D)" },
  { id: "neon", label: "Neon night", note: "Glowing edges", swatch: "linear-gradient(120deg,#00E5FF,#090418 45%,#090418 55%,#FF2BD6)" },
];

function valid(v: string | null): LookId {
  return LOOKS.some((l) => l.id === v) ? (v as LookId) : "glass";
}

export function currentLook(): LookId {
  try { return valid(localStorage.getItem(KEY)); } catch { return "glass"; }
}

export function applyLook(id: LookId = currentLook()): void {
  const root = document.documentElement;
  if (id === "glass") delete root.dataset.look; else root.dataset.look = id;
  window.dispatchEvent(new Event("glidepath-look"));
}

export function LookPicker() {
  const [cur, setCur] = useState<LookId>(currentLook);
  const set = (id: LookId) => {
    try { localStorage.setItem(KEY, id); } catch { /* still applies for this visit */ }
    setCur(id);
    applyLook(id);
  };
  return (
    <div className="wall-grid look-grid">
      {LOOKS.map((l) => (
        <button key={l.id} className={`wall-sw${cur === l.id ? " on" : ""}`} onClick={() => set(l.id)} aria-pressed={cur === l.id} title={l.note}>
          <span style={{ background: l.swatch }} />
          {l.label}
          <small className="faint" style={{ fontWeight: 500, fontSize: 11.5 }}>{l.note}</small>
        </button>
      ))}
    </div>
  );
}
