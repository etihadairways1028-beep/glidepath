/**
 * Cockpit tools: open the web pages that aircraft add-ons already serve on
 * the simmer's PC (Fenix EFB/MCDU, FSLabs EFB, GSX remote, FBW SimBridge).
 * The Bridge only checks which ports answer; the pages themselves belong to
 * the add-ons and run unchanged.
 */
import { useEffect, useState } from "react";
import { Icon, Notice, Section } from "../components/ui";
import { activeBridge } from "../data/bridge";
import { useApp } from "../data/store";

interface Addon { id: string; name: string; aircraft: string; port: number; up: boolean; localUrl: string; lanUrls: string[]; help: string }

const EXTRA_KEY = "glidepath.addonPorts";
const loadExtra = (): number[] => {
  try { return (JSON.parse(localStorage.getItem(EXTRA_KEY) ?? "[]") as number[]).filter((n) => Number.isInteger(n)); } catch { return []; }
};

/** The address of an add-on page as this device should open it. */
export function addonUrl(a: Addon, bridgeBase: string | null): string {
  if (!bridgeBase) return a.localUrl;
  let host = "localhost";
  try { host = new URL(bridgeBase).hostname; } catch { /* keep localhost */ }
  return a.localUrl.replace("localhost", host);
}

export function CockpitScreen() {
  const mode = useApp((s) => s.mode);
  const conn = useApp((s) => s.conn);
  const b = mode === "bridge" ? activeBridge() : null;
  const [list, setList] = useState<Addon[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [extra, setExtra] = useState<number[]>(loadExtra);
  const [portText, setPortText] = useState("");

  const refresh = async () => {
    if (!b) return;
    setBusy(true);
    try {
      const l = await b.get<Addon[]>(`/api/addons${extra.length ? `?extra=${extra.join(",")}` : ""}`);
      setList(l);
      setErr(null);
    } catch (e) {
      setErr(/404/.test(String(e)) ? "Your Bridge is older than this app. Download the latest Bridge to use cockpit tools." : "Couldn't ask the Bridge which add-ons are running.");
    } finally { setBusy(false); }
  };
  useEffect(() => { void refresh(); const t = setInterval(refresh, 15000); return () => clearInterval(t); }, [b, conn, extra.join(",")]);

  const addPort = () => {
    const n = Number(portText);
    if (!Number.isInteger(n) || n < 1 || n > 65535) return;
    const next = [...new Set([...extra, n])].slice(0, 6);
    setExtra(next);
    try { localStorage.setItem(EXTRA_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    setPortText("");
  };
  const removePort = (n: number) => {
    const next = extra.filter((p) => p !== n);
    setExtra(next);
    try { localStorage.setItem(EXTRA_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  // An https page (GitHub Pages) can't show http pages from your PC inside it.
  const canEmbed = location.protocol === "http:";
  const current = list?.find((a) => a.id === open && a.up) ?? null;
  const base = b?.baseUrl ?? null;

  return (
    <div className="stack cockpit">
      <div className="between wrap">
        <div>
          <h1 className="title">Cockpit tools</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>Your add-ons' EFBs, MCDUs and GSX, on this screen.</p>
        </div>
        {b && <button className="btn small" onClick={() => void refresh()} disabled={busy}>{busy ? "Checking…" : "Check again"}</button>}
      </div>

      {!b && <Notice info>Connect to the Glidepath Bridge on your PC first. Cockpit tools are web pages your add-ons run on that PC, and the Bridge checks which ones are on.</Notice>}
      {err && <Notice>{err}</Notice>}

      {current && (
        <section className="glass cockpit-frame">
          <div className="cockpit-frame-h">
            <strong>{current.name}</strong>
            <span className="muted">{current.aircraft}</span>
            <a className="btn small" href={addonUrl(current, base)} target="_blank" rel="noreferrer">Open in its own tab</a>
            <button className="btn small round" aria-label="Close" onClick={() => setOpen(null)}>{Icon.close()}</button>
          </div>
          <iframe title={current.name} src={addonUrl(current, base)} allow="fullscreen" />
          <p className="muted small">If this stays blank, the add-on doesn't allow being shown inside other pages. Use "Open in its own tab".</p>
        </section>
      )}

      {b && list && (
        <div className="addon-grid">
          {list.map((a) => (
            <article key={a.id} className={`glass addon${a.up ? " up" : ""}`}>
              <div className="addon-top">
                <span className={`dot ${a.up ? "on" : ""}`} aria-hidden />
                <div><h3>{a.name}</h3><p className="muted">{a.aircraft}</p></div>
              </div>
              {a.up ? (
                <>
                  <p className="small">Running on your PC, port {a.port}.</p>
                  <div className="addon-act">
                    {canEmbed && <button className="btn primary small" onClick={() => setOpen(a.id)}>Show here</button>}
                    <a className={`btn small${canEmbed ? "" : " primary"}`} href={addonUrl(a, base)} target="_blank" rel="noreferrer">Open</a>
                    {a.id.startsWith("custom-") && <button className="btn small" onClick={() => removePort(a.port)}>Remove</button>}
                  </div>
                </>
              ) : (
                <>
                  <p className="small muted">Not found on port {a.port}. {a.help}</p>
                  {a.id.startsWith("custom-") && <div className="addon-act"><button className="btn small" onClick={() => removePort(a.port)}>Remove</button></div>}
                </>
              )}
            </article>
          ))}
        </div>
      )}

      {b && (
        <Section title="Another add-on">
          <p className="small muted">If an add-on shows a web page on your PC that isn't listed, type its port number.</p>
          <div className="addon-add">
            <input inputMode="numeric" placeholder="Port, e.g. 8086" value={portText} onChange={(e) => setPortText(e.target.value.replace(/\D/g, "").slice(0, 5))} onKeyDown={(e) => e.key === "Enter" && addPort()} />
            <button className="btn primary small" onClick={addPort} disabled={!portText}>Add</button>
          </div>
        </Section>
      )}

      {b && !canEmbed && <Notice info>This copy of the app is on a secure (https) address, so it can only open the add-on pages in a new tab. Open the app from your Bridge's link to show them inside Glidepath.</Notice>}

      <Section title="PMDG 737 and 777">
        <p className="small">PMDG's EFB isn't served as a web page, so it can't be opened here. The CDU can be mirrored in a later version through PMDG's own SDK. To get ready, add this to <code>737_Options.ini</code> or <code>777_Options.ini</code> in the aircraft's work folder:</p>
        <pre className="code">{"[SDK]\nEnableDataBroadcast=1\nEnableCDUBroadcast.0=1\nEnableCDUBroadcast.1=1"}</pre>
        <p className="small muted">Glidepath doesn't press PMDG buttons yet. That needs the event numbers from the PMDG SDK file on your PC, and guessing them could press the wrong switch.</p>
      </Section>
    </div>
  );
}
