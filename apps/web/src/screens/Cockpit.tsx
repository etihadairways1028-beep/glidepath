/**
 * Cockpit tools: open the web pages that aircraft add-ons already serve on
 * the simmer's PC (Fenix EFB/MCDU, FSLabs EFB, GSX remote, FBW SimBridge).
 * The Bridge only checks which ports answer; the pages themselves belong to
 * the add-ons and run unchanged.
 */
import { useEffect, useRef, useState } from "react";
import { Icon, Notice, Section } from "../components/ui";
import { activeBridge } from "../data/bridge";
import { ADDON_KIND, addonHref, canEmbed, loadExtraPorts, refreshAddons, saveExtraPorts, useAddons, type Addon } from "../data/addons";
import { useApp } from "../data/store";

/** Kept for older imports. */
export function addonUrl(a: Addon): string { return addonHref(a); }

export function CockpitScreen({ initial }: { initial?: string }) {
  const mode = useApp((s) => s.mode);
  const b = mode === "bridge" ? activeBridge() : null;
  const { list, error: err, busy } = useAddons();
  const [open, setOpen] = useState<string | null>(initial ?? null);
  useEffect(() => { if (initial) setOpen(initial); }, [initial]);
  const [extra, setExtra] = useState<number[]>(loadExtraPorts);
  const [portText, setPortText] = useState("");
  const [big, setBig] = useState(false);
  const frameRef = useRef<HTMLElement>(null);
  const refresh = () => void refreshAddons();

  const addPort = () => {
    const n = Number(portText);
    if (!Number.isInteger(n) || n < 1 || n > 65535) return;
    const next = [...new Set([...extra, n])].slice(0, 6);
    setExtra(next); saveExtraPorts(next); setPortText("");
  };
  const removePort = (n: number) => { const next = extra.filter((p) => p !== n); setExtra(next); saveExtraPorts(next); };

  const current = list?.find((a) => a.id === open && a.up) ?? null;
  const anySecure = !!list?.some((a) => a.secureUrl);
  const httpsPage = location.protocol === "https:";
  const goFull = () => { const el = frameRef.current as (HTMLElement & { webkitRequestFullscreen?: () => void }) | null; if (!el) return; if (el.requestFullscreen) void el.requestFullscreen().catch(() => setBig(true)); else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen(); else setBig(true); };

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
      {b?.isRelay && <Notice info>You're connected through your account, so this works on any network. Add-on screens (EFB, GSX) run on your PC itself, so they only open when this device is on the same Wi-Fi as the PC.</Notice>}

      {current && (
        <section ref={frameRef} className={`glass cockpit-frame${big ? " big" : ""}`}>
          <div className="cockpit-frame-h">
            <strong>{ADDON_KIND[current.id]?.short ?? current.name}</strong>
            <span className="muted">{current.aircraft}</span>
            <button className="btn small" onClick={() => (big ? setBig(false) : goFull())}>{big ? "Smaller" : "Full screen"}</button>
            <a className="btn small" href={addonHref(current)} target="_blank" rel="noreferrer">Own tab</a>
            <button className="btn small round" aria-label="Close" onClick={() => { setOpen(null); setBig(false); if (location.hash.startsWith("#/cockpit/")) history.replaceState(null, "", "#/cockpit"); }}>{Icon.close()}</button>
          </div>
          {canEmbed(current) ? (
            <iframe title={current.name} src={addonHref(current)} allow="fullscreen; clipboard-write" />
          ) : (
            <div className="cockpit-frame-off">
              <p>This copy of Glidepath is on a secure (https) address and your Bridge's secure link isn't on, so {current.name} can't show inside it.</p>
              <a className="btn primary" href={addonHref(current)} target="_blank" rel="noreferrer">Open {ADDON_KIND[current.id]?.short ?? current.name}</a>
            </div>
          )}
          <p className="muted small">If this stays blank, the add-on page didn't load here. Use "Own tab".</p>
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
                    {canEmbed(a) && <button className="btn primary small" onClick={() => setOpen(a.id)}>Show here</button>}
                    <a className={`btn small${canEmbed(a) ? "" : " primary"}`} href={addonHref(a)} target="_blank" rel="noreferrer">{canEmbed(a) ? "Own tab" : "Open"}</a>
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

      {b && httpsPage && list && !anySecure && <Notice info>To show add-on pages inside Glidepath on this secure address, update the Bridge on your PC to the latest version from the Glidepath website. Until then they open in their own tab.</Notice>}

      <Section title="PMDG 737 and 777">
        <p className="small">PMDG's EFB isn't served as a web page, so it can't be opened here. The CDU can be mirrored in a later version through PMDG's own SDK. To get ready, add this to <code>737_Options.ini</code> or <code>777_Options.ini</code> in the aircraft's work folder:</p>
        <pre className="code">{"[SDK]\nEnableDataBroadcast=1\nEnableCDUBroadcast.0=1\nEnableCDUBroadcast.1=1"}</pre>
        <p className="small muted">Glidepath doesn't press PMDG buttons yet. That needs the event numbers from the PMDG SDK file on your PC, and guessing them could press the wrong switch.</p>
      </Section>
    </div>
  );
}
