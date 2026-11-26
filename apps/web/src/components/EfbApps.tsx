/**
 * The EFB home screen: every tool as an app icon, like a pilot's tablet.
 * Glidepath's own tools open their screens; SimBrief opens in here; Navigraph
 * opens its own site (it needs your Navigraph subscription); the add-on pages
 * the Bridge finds on your PC (Fenix, FSLabs, GSX, flyPad) are listed below.
 */
import { useState, type ReactNode } from "react";
import { autoSimbrief, loadLatestPlan, setAutoSimbrief, useSavedPlan } from "../data/plan";
import { settingsStore, useSettings } from "../data/store";

type App = { id: string; name: string; c1: string; c2: string; icon: ReactNode; href?: string; ext?: string; onOpen?: () => void; note?: string };
const svg = (d: string) => <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;

function Tile({ a }: { a: App }) {
  const inner = (
    <>
      <span className="efb-ic" style={{ background: `linear-gradient(160deg, ${a.c1}, ${a.c2})` }}>{a.icon}</span>
      <span className="efb-name">{a.name}</span>
      {a.note && <span className="efb-note">{a.note}</span>}
    </>
  );
  if (a.onOpen) return <button type="button" className="efb-app" onClick={a.onOpen}>{inner}</button>;
  if (a.ext) return <a className="efb-app" href={a.ext} target="_blank" rel="noreferrer">{inner}</a>;
  return <a className="efb-app" href={a.href}>{inner}</a>;
}

function SimbriefApp({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const plan = useSavedPlan();
  const [user, setUser] = useState(s.simbriefUser ?? "");
  const [auto, setAuto] = useState(autoSimbrief());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = async () => {
    setBusy(true); setMsg(null);
    try { settingsStore.set({ simbriefUser: user.trim() }); const p = await loadLatestPlan(user); setMsg(`Loaded ${p.origin.icao} to ${p.destination.icao}.`); }
    catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <section className="glass pad efb-panel" aria-label="SimBrief">
      <div className="between"><h2 className="h2" style={{ margin: 0 }}>SimBrief</h2><button className="btn small" onClick={onClose}>Close</button></div>
      <label className="efb-field">Your SimBrief username or Pilot ID
        <input value={user} onChange={(e) => setUser(e.target.value)} onBlur={() => settingsStore.set({ simbriefUser: user.trim() })} placeholder="e.g. 123456" autoCapitalize="off" autoCorrect="off" />
      </label>
      <div className="row wrap" style={{ gap: 8 }}>
        <a className="btn primary" href="https://dispatch.simbrief.com/options/custom" target="_blank" rel="noreferrer">Plan a new flight on SimBrief</a>
        <button className="btn" onClick={() => void load()} disabled={busy || !user.trim()}>{busy ? "Loading…" : "Load my latest flight"}</button>
      </div>
      <label className="efb-toggle"><input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); setAutoSimbrief(e.target.checked); }} />
        <span>Load new flights by themselves. When you press Generate on SimBrief, the flight appears in Glidepath within a minute (only while you're on the ground).</span></label>
      {msg && <p className="small" role="status">{msg}</p>}
      {plan && (
        <div className="efb-ofp">
          <span className="k">Loaded now</span>
          <b>{plan.origin.icao} → {plan.destination.icao}</b>
          <span className="muted small">{[plan.callsign, plan.aircraftIcao, plan.cruiseAltitudeFt ? `FL${Math.round(plan.cruiseAltitudeFt / 100)}` : null].filter(Boolean).join(" · ")}</span>
        </div>
      )}
    </section>
  );
}

export function EfbApps({ onPmdg }: { onPmdg: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const plan: App[] = [
    { id: "simbrief", name: "SimBrief", c1: "#3BA0FF", c2: "#1450B8", icon: svg("M4 20 20 4M9 4h11v11"), onOpen: () => setOpen(open === "simbrief" ? null : "simbrief") },
    { id: "navigraph", name: "Navigraph", c1: "#2D3748", c2: "#0B1220", icon: svg("M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15"), ext: "https://charts.navigraph.com/", note: "Opens their site" },
    { id: "charts", name: "Charts", c1: "#7DA7FF", c2: "#3D5AFE", icon: svg("M6 3h9l4 4v14H6zM9 12h7M9 16h7"), href: "#/charts" },
    { id: "perf", name: "Performance", c1: "#FF9F6B", c2: "#E8590C", icon: svg("M4 19h16M6 15l4-4 3 3 5-6"), href: "#/performance" },
    { id: "check", name: "Checklists", c1: "#34E0A1", c2: "#0FA77A", icon: svg("M9 11l3 3 8-8M4 6h2M4 12h2M4 18h2"), href: "#/checklists" },
    { id: "wx", name: "Weather", c1: "#7FD3FF", c2: "#2B8BDB", icon: svg("M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 2A3 3 0 0 0 7 18z"), href: "#/weather" },
    { id: "tools", name: "Pilot tools", c1: "#FFD45E", c2: "#E8A400", icon: svg("M4 4h16v16H4zM8 8h8M8 12h8M8 16h4"), href: "#/tools" },
    { id: "appr", name: "Landing helper", c1: "#FF8AB4", c2: "#D6336C", icon: svg("M3 18 21 9M3 18h18"), href: "#/approach" },
    { id: "remote", name: "Remote", c1: "#8E9AAF", c2: "#4A5568", icon: svg("M7 3h10v18H7zM11 7h2"), href: "#/remote" },
    { id: "pmdg", name: "PMDG CDU", c1: "#5B6478", c2: "#2D3340", icon: svg("M5 4h14v16H5zM8 8h8M8 12h3M13 12h3M8 16h3M13 16h3"), onOpen: onPmdg, note: "Set-up" },
  ];
  return (
    <div className="efb">
      <div className="efb-grid" role="list">{plan.map((a) => <div role="listitem" key={a.id}><Tile a={a} /></div>)}</div>
      {open === "simbrief" && <SimbriefApp onClose={() => setOpen(null)} />}
    </div>
  );
}
