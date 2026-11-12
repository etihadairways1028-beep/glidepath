/** Settings → Discord status: show what you're flying on your Discord profile (runs on the PC's Bridge). */
import { useEffect, useState } from "react";
import { activeBridge } from "../data/bridge";
import { useApp } from "../data/store";
import { Section } from "./ui";

interface St { enabled: boolean; clientId: string; state: "off" | "needs-id" | "connecting" | "no-discord" | "on"; message: string; user: string | null }

export function DiscordStatus() {
  const mode = useApp((s) => s.mode);
  const conn = useApp((s) => s.conn);
  const [st, setSt] = useState<St | null>(null);
  const [id, setId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const b = activeBridge();
    if (!b || mode !== "bridge") { setSt(null); return; }
    let alive = true;
    const load = () => b.get<St>("/api/discord").then((s) => { if (alive) { setSt(s); setId((v) => v || s.clientId); } }, (e) => { if (alive) setErr(/404|Not found/i.test(String(e?.message)) ? "Update the Bridge on your PC to use this." : String(e?.message ?? e)); });
    void load();
    const t = setInterval(load, 8000);
    return () => { alive = false; clearInterval(t); };
  }, [mode, conn]);

  const save = async (patch: Partial<St>) => {
    const b = activeBridge(); if (!b) return;
    setBusy(true); setErr(null);
    try { setSt(await b.post<St>("/api/discord", patch)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  return (
    <Section title="Discord status">
      <p className="muted" style={{ margin: "0 0 10px", fontSize: 14 }}>Show what you're flying on your Discord profile, like "EGLL → EGCC · A320, Cruising at FL360". Uses the Discord app on your sim PC.</p>
      {mode !== "bridge" ? (
        <p className="faint" style={{ margin: 0, fontSize: 13 }}>Connect to your Bridge to set this up.</p>
      ) : !st ? (
        err ? <p className="form-err" style={{ margin: 0 }}>{err}</p> : <div className="skeleton" style={{ height: 40 }} />
      ) : (
        <>
          <label className="between" style={{ padding: "6px 0" }}>
            <span>Show my flight on Discord</span>
            <input className="switch" type="checkbox" checked={st.enabled} disabled={busy} onChange={(e) => void save({ enabled: e.target.checked })} />
          </label>
          <label className="field" style={{ marginTop: 6 }}>
            <span>Discord Application ID</span>
            <div className="row" style={{ gap: 8 }}>
              <input className="input data" inputMode="numeric" placeholder="1234567890123456789" value={id} onChange={(e) => setId(e.target.value.replace(/\D/g, ""))} />
              <button className="btn" disabled={busy || id === st.clientId} onClick={() => void save({ clientId: id, enabled: true })}>Save</button>
            </div>
          </label>
          <p className={st.state === "on" ? "form-ok" : "faint"} style={{ margin: "8px 0 0", fontSize: 13 }}>{st.state === "on" ? "● " : ""}{st.message}</p>
          {err && <p className="form-err" style={{ margin: "6px 0 0" }}>{err}</p>}
          <button className="btn ghost small" style={{ marginTop: 8 }} onClick={() => setOpen((v) => !v)}>{open ? "Hide" : "How do I get an Application ID?"}</button>
          {open && (
            <ol style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--mist)", lineHeight: 1.7, fontSize: 14 }}>
              <li>On your PC, go to <b>discord.com/developers/applications</b> and sign in with Discord.</li>
              <li>Click <b>New Application</b>, name it <b>Glidepath</b> (that's the name your friends see), and create it.</li>
              <li>Copy the <b>Application ID</b> from the General Information page and paste it above. It's a public number, not a password.</li>
              <li>Optional: under <b>Rich Presence → Art Assets</b>, upload the Glidepath logo with the name <b>glidepath</b> to show it next to your status.</li>
            </ol>
          )}
        </>
      )}
    </Section>
  );
}
