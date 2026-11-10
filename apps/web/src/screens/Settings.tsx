import { useState } from "react";
import { BaseMapPicker, TrafficSources } from "../components/MapLayers";
import { connectFromSettings } from "../App";
import { ConnPill, Kv, Notice, Section } from "../components/ui";
import { activeBridge, setActiveBridge } from "../data/bridge";
import { startDemo, stopDemo } from "../data/demo";
import { loadPlan } from "../data/external";
import { fmt, zulu } from "../data/derive";
import { settingsStore, store, useApp, useSettings } from "../data/store";

export function SettingsScreen() {
  const s = useSettings();
  const mode = useApp((st) => st.mode);
  const status = useApp((st) => st.status);
  const plan = useApp((st) => st.flight?.plan ?? null);
  const [url, setUrl] = useState(s.bridgeUrl || (location.protocol === "http:" && location.pathname.startsWith("/app") ? location.origin : "http://localhost:4810"));
  const [token, setToken] = useState(s.token);
  const [planMsg, setPlanMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const https = location.protocol === "https:";
  const nonLocal = https && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url);

  const connect = () => {
    stopDemo();
    settingsStore.set({ bridgeUrl: url.trim().replace(/\/+$/, ""), token: token.trim() });
    connectFromSettings();
  };
  const disconnect = () => { setActiveBridge(null); settingsStore.set({ token: "" }); store.reset("none"); };

  return (
    <div className="stack">
      <h1 className="title">Settings</h1>
      <nav className="more-links" aria-label="More screens">
        <a className="btn small" href="#/cockpit">Cockpit tools</a>
        <a className="btn small" href="#/weather">Weather</a>
        <a className="btn small" href="#/airports">Airports</a>
        <a className="btn small" href="#/account">Account</a>
        <a className="btn small" href="#/glance">Glance mode</a>
      </nav>
      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <div className="stack">
          <Section title="Bridge connection" right={<ConnPill />}>
            <div className="stack" style={{ gap: 12 }}>
              <div className="field"><label htmlFor="b-url">Bridge address</label><input id="b-url" className="input data" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.20:4810" /></div>
              <div className="field"><label htmlFor="b-tok">Pairing key</label><input id="b-tok" className="input data" value={token} onChange={(e) => setToken(e.target.value)} placeholder="From the Bridge page on your PC" autoComplete="off" /></div>
              {nonLocal && <Notice>Browsers block this secure page from reaching other computers on your network. On your iPad, open the link shown on the Bridge's page instead: it opens this same app directly from your PC.</Notice>}
              <div className="row wrap">
                <button className="btn primary" onClick={connect} disabled={!token.trim()}>Connect</button>
                {mode === "bridge" && <button className="btn" onClick={disconnect}>Disconnect</button>}
              </div>
              {status && mode === "bridge" && (
                <div>
                  <Kv k="Bridge" v={`${status.hostname}, version ${status.bridgeVersion}`} />
                  <Kv k="Simulator" v={status.simulator?.name ?? status.message ?? status.simState} />
                  <Kv k="Aircraft" v={status.aircraft?.title ?? "—"} />
                  <Kv k="Telemetry" v={`${fmt(status.framesPerSecond, 1)} frames/s`} />
                  <Kv k="Devices connected" v={String(status.clients)} />
                </div>
              )}
              <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>The easiest way: on your sim PC, open <span className="data">localhost:4810</span> and tap the link it shows. That fills these in for you.</p>
            </div>
          </Section>

          <Section title="SimBrief">
            <div className="stack" style={{ gap: 12 }}>
              <div className="field"><label htmlFor="sb">SimBrief username or Pilot ID</label><input id="sb" className="input" value={s.simbriefUser} onChange={(e) => settingsStore.set({ simbriefUser: e.target.value })} placeholder="Your Navigraph alias" /></div>
              <div className="row wrap">
                <button className="btn primary" disabled={!s.simbriefUser.trim() || mode !== "bridge" || busy} onClick={async () => {
                  setBusy(true); setPlanMsg(null);
                  try { const p = await loadPlan(s.simbriefUser); setPlanMsg(`Loaded ${p.origin.icao} → ${p.destination.icao}${p.callsign ? ` (${p.callsign})` : ""}. It's linked to your current flight.`); }
                  catch (e) { setPlanMsg((e as Error).message); }
                  setBusy(false);
                }}>{busy ? "Loading…" : "Load my latest plan"}</button>
              </div>
              {mode !== "bridge" && <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>Plans are fetched by your Bridge, so connect it first.</p>}
              {planMsg && <Notice info>{planMsg}</Notice>}
              {plan && (
                <div>
                  <Kv k="Route" v={`${plan.origin.icao} → ${plan.destination.icao}`} />
                  <Kv k="Callsign" v={plan.callsign ?? "—"} />
                  <Kv k="Cruise" v={plan.cruiseAltitudeFt ? `FL${Math.round(plan.cruiseAltitudeFt / 100)}` : "—"} />
                  <Kv k="Scheduled" v={`${zulu((plan.scheduledOut ?? 0) * 1000)} → ${zulu((plan.scheduledIn ?? 0) * 1000)}`} />
                  <Kv k="Runways" v={`${plan.origin.runway ?? "—"} / ${plan.destination.runway ?? "—"}`} />
                </div>
              )}
            </div>
          </Section>

          <Section title="Demo">
            <p className="muted" style={{ marginTop: 0 }}>Replays a synthetic Heathrow to Manchester flight through the real flight engine, so you can explore every screen without the simulator.</p>
            <div className="row wrap">
              <button className="btn" onClick={() => { setActiveBridge(null); startDemo(); location.hash = "#/home"; }}>Start demo flight</button>
              {mode === "demo" && (
                <div className="seg" role="group" aria-label="Demo speed">{[10, 30, 60, 120].map((v) => <button key={v} className={useApp.length >= 0 && store.get().demoSpeed === v ? "on" : ""} onClick={() => store.set({ demoSpeed: v })}>{v}×</button>)}</div>
              )}
            </div>
          </Section>
        </div>

        <div className="stack">
          <Section title="Map and networks">
            <p className="lp-h">Base map</p>
            <BaseMapPicker />
            <p className="lp-h" style={{ marginTop: 18 }}>Traffic on the map</p>
            <TrafficSources />
            <p className="faint" style={{ fontSize: 12.5, margin: "10px 0 0" }}>Your Bridge fetches each network once and shares it with every device, within each network's refresh limits. SayIntentions shows its public tracker: people flying with its AI ATC.</p>
          </Section>
          <Section title="Units">
            <div className="between"><span>Fuel</span><div className="seg">{(["kg", "lb"] as const).map((u) => <button key={u} className={s.fuelUnit === u ? "on" : ""} onClick={() => settingsStore.set({ fuelUnit: u })}>{u}</button>)}</div></div>
          </Section>
          <Section title="Glideslope messages">
            <label className="between" style={{ padding: "8px 0" }}><span>Messages at each stage of the flight<br /><span className="faint" style={{ fontSize: 12.5 }}>Taxi, take-off, cruise reached, top of descent, approach, touchdown</span></span><input className="switch" type="checkbox" checked={s.flightMessages} onChange={(e) => settingsStore.set({ flightMessages: e.target.checked })} /></label>
            <label className="between" style={{ padding: "8px 0" }}><span>Read them out loud</span><input className="switch" type="checkbox" checked={s.voiceCallouts} onChange={(e) => settingsStore.set({ voiceCallouts: e.target.checked })} /></label>
          </Section>
          <Section title="Appearance">
            <div className="between" style={{ padding: "6px 0" }}><span>Theme</span>
              <div className="seg">{([["system", "Automatic"], ["dark", "Dark"], ["light", "Light"]] as const).map(([k, l]) => <button key={k} className={(s.theme ?? "system") === k ? "on" : ""} onClick={() => settingsStore.set({ theme: k })}>{l}</button>)}</div>
            </div>
            <div className="between" style={{ padding: "6px 0" }}><span>Accent</span>
              <div className="seg">{([["glideslope", "Glideslope"], ["aurora", "Aurora"], ["ice", "Ice"]] as const).map(([k, l]) => <button key={k} className={s.accent === k ? "on" : ""} onClick={() => settingsStore.set({ accent: k })}>{l}</button>)}</div>
            </div>
            <label className="between" style={{ padding: "8px 0" }}><span>Reduce transparency</span><input className="switch" type="checkbox" checked={s.reduceTransparency} onChange={(e) => settingsStore.set({ reduceTransparency: e.target.checked })} /></label>
          </Section>
          <Section title="On your Home Screen">
            <ol style={{ margin: 0, paddingLeft: 18, color: "var(--mist)", lineHeight: 1.7 }}>
              <li>In Safari on your iPad or iPhone, go to glidepath.local:4810 and type the code shown on your PC.</li>
              <li>Tap Share, then <b style={{ color: "var(--ink)" }}>Add to Home Screen</b>. On Android, use Chrome's menu, then <b style={{ color: "var(--ink)" }}>Install app</b>.</li>
              <li>Open it from the icon. It launches full screen, straight to your flight.</li>
            </ol>
            <p className="faint" style={{ fontSize: 12.5, margin: "10px 0 0" }}>For an iPad on a stand, use <a href="#/glance">Glance mode</a>. Lock Screen and widget cards need the native iPad app, which is planned.</p>
          </Section>
          <Section title="About">
            <Kv k="Version" v="Glidepath 0.8.4 (early test build)" />
            <Kv k="Airports" v="OurAirports, public domain" />
            <Kv k="Map" v="OpenFreeMap / OpenStreetMap, Natural Earth" />
            <Kv k="Weather" v="aviationweather.gov, via your Bridge" />
            <Kv k="Networks" v="VATSIM, IVAO public feeds" />
            <Kv k="Stands" v="OpenStreetMap, via your Bridge" />
            <p className="faint" style={{ fontSize: 12, margin: "8px 0 0" }}>Not affiliated with Microsoft, VATSIM, IVAO, Navigraph or SimBrief. Not for real-world navigation.</p>
          </Section>
        </div>
      </div>
      {activeBridge() === null && mode === "none" && <p className="faint" style={{ fontSize: 12.5 }}>Not connected.</p>}
    </div>
  );
}
