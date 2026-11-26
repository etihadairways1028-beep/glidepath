/**
 * Cockpit tools: open the web pages that aircraft add-ons already serve on
 * the simmer's PC (Fenix EFB/MCDU, FSLabs EFB, GSX remote, FBW SimBridge).
 * The Bridge only checks which ports answer; the pages themselves belong to
 * the add-ons and run unchanged.
 *
 * Several can be open at once as tabs, and two side by side on a wide screen.
 */
import { useEffect, useRef, useState } from "react";
import { Icon, Notice, Section } from "../components/ui";
import { activeBridge } from "../data/bridge";
import { ADDON_KIND, addonHref, canEmbed, loadExtraPorts, refreshAddons, saveExtraPorts, useAddons, type Addon } from "../data/addons";
import { useApp } from "../data/store";
import { EfbApps } from "../components/EfbApps";

/** Kept for older imports. */
export function addonUrl(a: Addon): string { return addonHref(a); }

const TABS_KEY = "glidepath.cockpitTabs";
const loadTabs = (): { open: string[]; split: boolean } => { try { return { open: [], split: false, ...(JSON.parse(localStorage.getItem(TABS_KEY) ?? "{}") as object) }; } catch { return { open: [], split: false }; } };
const kindOf = (a: Addon) => ADDON_KIND[a.id] ?? { short: a.name, verb: "Open", tint: "linear-gradient(140deg,#8E8E93,#48484A)" };
const glyph = (a: Addon) => (a.id === "gsx" ? "GSX" : a.id === "simbridge" ? "FBW" : a.id === "fenix" ? "FNX" : a.id === "fslabs" ? "FSL" : String(a.port).slice(-3));

function Frame({ a, onClose, onFull, big }: { a: Addon; onClose: () => void; onFull: () => void; big: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <div className="ck-pane">
      <div className="ck-pane-h">
        <span className="ck-glyph sm" style={{ background: kindOf(a).tint }} aria-hidden>{glyph(a)}</span>
        <b>{kindOf(a).short}</b>
        <span className="muted ck-air">{a.aircraft}</span>
        <span className="ck-sp" />
        <button className="btn small" onClick={() => { setLoaded(false); setKey((k) => k + 1); }} title="Reload this page">Reload</button>
        <button className="btn small" onClick={onFull}>{big ? "Smaller" : "Full screen"}</button>
        <a className="btn small" href={addonHref(a)} target="_blank" rel="noreferrer">Own tab</a>
        <button className="btn small round" aria-label={`Close ${kindOf(a).short}`} onClick={onClose}>{Icon.close()}</button>
      </div>
      {canEmbed(a) ? (
        <div className="ck-view">
          {!loaded && <div className="ck-loading"><span className="ck-spin" aria-hidden />Opening {kindOf(a).short}…</div>}
          <iframe key={key} title={a.name} src={addonHref(a)} allow="fullscreen; clipboard-write" onLoad={() => setLoaded(true)} />
        </div>
      ) : (
        <div className="cockpit-frame-off">
          <p>This copy of Glidepath is on a secure (https) address and your Bridge's secure link isn't on, so {a.name} can't show inside it.</p>
          <a className="btn primary" href={addonHref(a)} target="_blank" rel="noreferrer">Open {kindOf(a).short}</a>
        </div>
      )}
    </div>
  );
}

export function CockpitScreen({ initial }: { initial?: string }) {
  const mode = useApp((s) => s.mode);
  const b = mode === "bridge" ? activeBridge() : null;
  const { list, error: err, busy } = useAddons();
  const saved = loadTabs();
  const [open, setOpen] = useState<string[]>(initial ? [...new Set([initial, ...saved.open])] : saved.open);
  const [active, setActive] = useState<string | null>(initial ?? saved.open[0] ?? null);
  const [split, setSplit] = useState(saved.split);
  const [extra, setExtra] = useState<number[]>(loadExtraPorts);
  const [portText, setPortText] = useState("");
  const [big, setBig] = useState(false);
  const [pmdg, setPmdg] = useState(false);
  const frameRef = useRef<HTMLElement>(null);
  useEffect(() => { if (initial) { setOpen((o) => [...new Set([initial, ...o])]); setActive(initial); } }, [initial]);
  useEffect(() => { try { localStorage.setItem(TABS_KEY, JSON.stringify({ open, split })); } catch { /* fine */ } }, [open, split]);

  const addPort = () => {
    const n = Number(portText);
    if (!Number.isInteger(n) || n < 1 || n > 65535) return;
    const next = [...new Set([...extra, n])].slice(0, 6);
    setExtra(next); saveExtraPorts(next); setPortText("");
  };
  const removePort = (n: number) => { const next = extra.filter((p) => p !== n); setExtra(next); saveExtraPorts(next); };

  const up = (list ?? []).filter((a) => a.up);
  const tabs = open.map((id) => up.find((a) => a.id === id)).filter((a): a is Addon => !!a);
  const cur = tabs.find((a) => a.id === active) ?? tabs[0] ?? null;
  const second = split ? tabs.find((a) => a.id !== cur?.id) ?? null : null;
  const show = (id: string) => { setOpen((o) => (o.includes(id) ? o : [...o, id])); setActive(id); requestAnimationFrame(() => frameRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })); };
  const close = (id: string) => { setOpen((o) => o.filter((x) => x !== id)); if (active === id) setActive(null); if (location.hash.startsWith("#/cockpit/")) history.replaceState(null, "", "#/cockpit"); };
  const anySecure = !!list?.some((a) => a.secureUrl);
  const httpsPage = location.protocol === "https:";
  const goFull = () => {
    if (big) { setBig(false); return; }
    const el = frameRef.current as (HTMLElement & { webkitRequestFullscreen?: () => void }) | null; if (!el) return;
    if (el.requestFullscreen) void el.requestFullscreen().catch(() => setBig(true)); else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen(); else setBig(true);
  };

  return (
    <div className="stack cockpit">
      <div className="between wrap">
        <div>
          <h1 className="title">EFB</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>Your flight bag: plan on SimBrief, charts, performance, and your add-ons' EFBs, MCDUs and GSX, all as apps.</p>
        </div>
        {b && <button className="btn small" onClick={() => void refreshAddons()} disabled={busy}>{busy ? "Checking…" : "Check again"}</button>}
      </div>

      <EfbApps onPmdg={() => { setPmdg(true); requestAnimationFrame(() => document.getElementById("efb-pmdg")?.scrollIntoView({ behavior: "smooth", block: "start" })); }} />
      <h2 className="h2 efb-sub">Your add-ons</h2>
      {!b && <Notice info>Connect to the Glidepath Bridge on your PC first. Cockpit tools are web pages your add-ons run on that PC, and the Bridge checks which ones are on.</Notice>}
      {err && <Notice>{err}</Notice>}
      {b?.isRelay && <Notice info>You're connected through your account, so this works on any network. Add-on screens (EFB, GSX) run on your PC itself, so they only open when this device is on the same Wi-Fi as the PC.</Notice>}

      {b && list && (
        <div className="ck-launch" role="list">
          {list.map((a) => (
            <div key={a.id} role="listitem" className={`glass ck-app${a.up ? " up" : ""}${open.includes(a.id) && a.up ? " open" : ""}`}>
              <button className="ck-app-main" onClick={() => (a.up ? (canEmbed(a) ? show(a.id) : window.open(addonHref(a), "_blank", "noreferrer")) : undefined)} disabled={!a.up} aria-label={a.up ? `${kindOf(a).verb}: ${a.name}` : `${a.name} isn't running`}>
                <span className="ck-glyph" style={{ background: a.up ? kindOf(a).tint : undefined }} aria-hidden>{glyph(a)}</span>
                <span className="ck-app-t"><b>{kindOf(a).short}</b><small>{a.aircraft}</small></span>
                <span className={`ck-state${a.up ? " on" : ""}`}>{a.up ? (open.includes(a.id) ? "Open" : "Ready") : "Off"}</span>
              </button>
              {!a.up && <p className="ck-help">Not found on port {a.port}. {a.help}</p>}
              {a.up && <div className="ck-app-act">
                <a className="btn small ghost" href={addonHref(a)} target="_blank" rel="noreferrer">Own tab</a>
                {a.id.startsWith("custom-") && <button className="btn small ghost" onClick={() => removePort(a.port)}>Remove</button>}
              </div>}
              {!a.up && a.id.startsWith("custom-") && <div className="ck-app-act"><button className="btn small ghost" onClick={() => removePort(a.port)}>Remove</button></div>}
            </div>
          ))}
        </div>
      )}
      {b && list && up.length === 0 && <p className="muted ck-none">No add-on pages found on your PC yet. Start the aircraft in the sim (the Fenix and FBW pages only run while the aircraft is loaded), then press Check again.</p>}

      {cur && (
        <section ref={frameRef} className={`glass ck-stage${big ? " big" : ""}`}>
          <div className="ck-tabs" role="tablist" aria-label="Open tools">
            {tabs.map((a) => (
              <button key={a.id} role="tab" aria-selected={a.id === cur.id} className={`ck-tab${a.id === cur.id ? " on" : ""}${second?.id === a.id ? " side" : ""}`} onClick={() => setActive(a.id)}>
                <span className="ck-glyph xs" style={{ background: kindOf(a).tint }} aria-hidden>{glyph(a)}</span>{kindOf(a).short}
              </button>
            ))}
            <span className="ck-sp" />
            {tabs.length > 1 && <button className={`btn small ck-split${split ? " on" : ""}`} aria-pressed={split} onClick={() => setSplit(!split)} title="Show two tools side by side">Side by side</button>}
          </div>
          <div className={`ck-panes${second ? " two" : ""}`}>
            <Frame a={cur} onClose={() => close(cur.id)} onFull={goFull} big={big} />
            {second && <Frame a={second} onClose={() => close(second.id)} onFull={goFull} big={big} />}
          </div>
          <p className="muted small" style={{ margin: 0 }}>If a page stays blank, it didn't load here: use "Own tab".</p>
        </section>
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

      {pmdg && <div id="efb-pmdg"><Section title="PMDG 737 and 777">
        <p className="small">PMDG's EFB isn't served as a web page, so it can't be opened here. The CDU can be mirrored in a later version through PMDG's own SDK. To get ready, add this to <code>737_Options.ini</code> or <code>777_Options.ini</code> in the aircraft's work folder:</p>
        <pre className="code">{"[SDK]\nEnableDataBroadcast=1\nEnableCDUBroadcast.0=1\nEnableCDUBroadcast.1=1"}</pre>
        <p className="small muted">Glidepath doesn't press PMDG buttons yet. That needs the event numbers from the PMDG SDK file on your PC, and guessing them could press the wrong switch.</p>
      </Section></div>}
    </div>
  );
}
