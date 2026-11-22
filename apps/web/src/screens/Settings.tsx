import { useEffect, useState } from "react";
import { disablePush, enablePush, getPushPrefs, pushState, setPushPrefs, testPush, type PushPrefs, type PushState } from "../data/push";
import { APP_VERSION, showWhatsNew } from "../components/WhatsNew";
import { BaseMapPicker, TrafficSources } from "../components/MapLayers";
import { connectFromSettings } from "../App";
import { ConnPill, Icon, Kv, Notice, Section } from "../components/ui";
import { WallpaperPicker } from "../components/Wallpaper";
import { LookPicker } from "../components/Look";
import { EmailSettings } from "./Account";
import { DiscordStatus } from "../components/DiscordStatus";
import { useCloud } from "../data/cloud";
import { activeBridge, setActiveBridge } from "../data/bridge";
import { startDemo, stopDemo } from "../data/demo";
import { loadLatestPlan as loadPlan } from "../data/plan";
import { fmt, zulu } from "../data/derive";
import { settingsStore, store, useApp, useSettings } from "../data/store";

/** Running on the sim PC itself: show the iPad code here, so the Bridge page is never needed. */
function OnThisPc() {
  const [code, setCode] = useState<string | null>(null);
  const onPc = location.protocol === "http:" && location.pathname.startsWith("/app") && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  useEffect(() => {
    if (!onPc) return;
    let off = false;
    const get = () => fetch("/api/local-token", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((j: { code?: string } | null) => { if (!off && j?.code) setCode(j.code); }).catch(() => undefined);
    void get(); const t = window.setInterval(get, 30_000);
    return () => { off = true; clearInterval(t); };
  }, [onPc]);
  if (!onPc || !code) return null;
  return (
    <section className="glass pc-code">
      <div>
        <p className="lp-h" style={{ marginTop: 0 }}>Connect your iPad or phone</p>
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>On the same Wi-Fi, open <b className="data">glidepath-ad9.pages.dev/app</b>, tap <b>Connect to my PC</b> and type this code. Or sign in with the same Glidepath account on both.</p>
      </div>
      <b className="data pc-code-n" aria-label={`Pairing code ${code.split("").join(" ")}`}>{code.slice(0, 3)} {code.slice(3)}</b>
      <a className="btn small" href="/">Bridge details</a>
    </section>
  );
}

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
      <OnThisPc />
      <nav className="more-grid" aria-label="More screens">
        {([
          ["performance", "Performance", Icon.perf], ["approach", "Approach", Icon.approach], ["charts", "Charts", Icon.chart], ["copilot", "Copilot", Icon.headset], ["checklists", "Checklists", Icon.checklist],
          ["tools", "Pilot tools", Icon.calc], ["cockpit", "Cockpit tools", Icon.panel], ["weather", "Weather", Icon.cloud],
          ["airports", "Airports", Icon.tower], ["glance", "Glance mode", Icon.expand], ["career", "Career", Icon.career],
          ["challenge", "Landing challenge", Icon.trophy], ["account", "Account", Icon.person],
        ] as const).map(([id, label, I]) => (
          <a key={id} className="more-tile glass" href={`#/${id}`}><span className={`more-ic ic-${id}`}><I /></span><span>{label}</span><span className="more-chev" aria-hidden="true">›</span></a>
        ))}
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
                <button className="btn primary" disabled={!s.simbriefUser.trim() || mode === "demo" || busy} onClick={async () => {
                  setBusy(true); setPlanMsg(null);
                  try { const p = await loadPlan(s.simbriefUser); setPlanMsg(`Loaded ${p.origin.icao} → ${p.destination.icao}${p.callsign ? ` (${p.callsign})` : ""}.${mode === "bridge" ? " It's linked to your current flight." : " It's on your map and Flight screen."}`); }
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
          <Section title="Look">
            <LookPicker />
          </Section>
          <Section title="Background">
            <p className="faint" style={{ fontSize: 12.5, margin: "0 0 10px" }}>Used by the Liquid glass look. The other looks bring their own sky.</p>
            <WallpaperPicker />
          </Section>
          <Section title="Units">
            <div className="between"><span>Fuel</span><div className="seg">{(["kg", "lb"] as const).map((u) => <button key={u} className={s.fuelUnit === u ? "on" : ""} onClick={() => settingsStore.set({ fuelUnit: u })}>{u}</button>)}</div></div>
          </Section>
          <Section title="Lock screen notifications"><PushSetup /></Section>
          <Section title="Glideslope messages">
            <label className="between" style={{ padding: "8px 0" }}><span>Messages at each stage of the flight<br /><span className="faint" style={{ fontSize: 12.5 }}>Taxi, take-off, cruise reached, top of descent, approach, touchdown</span></span><input className="switch" type="checkbox" checked={s.flightMessages} onChange={(e) => settingsStore.set({ flightMessages: e.target.checked })} /></label>
            <label className="between" style={{ padding: "8px 0" }}><span>Lights messages and reminders<br /><span className="faint" style={{ fontSize: 12.5 }}>When lights are switched, beacon before engine start, landing lights at 10,000 ft. Some add-ons (like Fenix) run their own lights and may not report them.</span></span><input className="switch" type="checkbox" checked={s.lightMessages} onChange={(e) => settingsStore.set({ lightMessages: e.target.checked })} /></label>
            <label className="between" style={{ padding: "8px 0" }}><span>Stable-approach coach<br /><span className="faint" style={{ fontSize: 12.5 }}>At 1000 ft and 500 ft on the way down: stable or not, and why (sink rate, bank, gear, speed)</span></span><input className="switch" type="checkbox" checked={s.approachCoach} onChange={(e) => settingsStore.set({ approachCoach: e.target.checked })} /></label>
            <label className="between" style={{ padding: "8px 0" }}><span>Also as notifications<br /><span className="faint" style={{ fontSize: 12.5 }}>Top of descent, 10 minutes to landing, ATC online and your debrief, when Glidepath is in the background. On iPad and iPhone, add Glidepath to your Home Screen first.</span></span><input className="switch" type="checkbox" checked={s.systemNotifications} onChange={async (e) => {
              const on = e.target.checked;
              if (on && "Notification" in window && Notification.permission !== "granted") { const p = await Notification.requestPermission().catch(() => "denied"); if (p !== "granted") { alert("Notifications are blocked for Glidepath. Allow them in your browser or device settings, then try again."); return; } }
              settingsStore.set({ systemNotifications: on });
            }} disabled={!("Notification" in window)} /></label>
            <label className="between" style={{ padding: "8px 0" }}><span>ATC online alerts<br /><span className="faint" style={{ fontSize: 12.5 }}>When a controller comes online at your departure or destination, on the networks you show on the map.</span></span><input className="switch" type="checkbox" checked={s.atcAlerts} onChange={(e) => settingsStore.set({ atcAlerts: e.target.checked })} /></label>
            <label className="between" style={{ padding: "8px 0" }}><span>Read them out loud</span><input className="switch" type="checkbox" checked={s.voiceCallouts} onChange={(e) => settingsStore.set({ voiceCallouts: e.target.checked })} /></label>
          </Section>
          <Section title="Appearance">
            <div className="between" style={{ padding: "6px 0" }}><span>Theme</span>
              <div className="seg">{([["system", "Automatic"], ["dark", "Dark"], ["light", "Light"]] as const).map(([k, l]) => <button key={k} className={(s.theme ?? "system") === k ? "on" : ""} onClick={() => settingsStore.set({ theme: k })}>{l}</button>)}</div>
            </div>
            <div className="between" style={{ padding: "6px 0" }}><span>Accent</span>
              <div className="seg">{([["glideslope", "Glideslope"], ["aurora", "Aurora"], ["ice", "Ice"]] as const).map(([k, l]) => <button key={k} className={s.accent === k ? "on" : ""} onClick={() => settingsStore.set({ accent: k })}>{l}</button>)}</div>
            </div>
            <div style={{ padding: "8px 0" }}>
              <div className="between"><span>Liquid Glass</span><b className="data">{s.reduceTransparency ? "Off" : `${s.glassLevel ?? 95}%`}</b></div>
              <input className="lg-range" type="range" min={0} max={100} step={5} value={s.glassLevel ?? 95} disabled={s.reduceTransparency} aria-label="Liquid Glass strength" onChange={(e) => settingsStore.set({ glassLevel: Number(e.target.value) })} />
              <div className="between faint" style={{ fontSize: 12 }}><span>Frosted</span><span>Crystal clear</span></div>
            </div>
            <label className="between" style={{ padding: "8px 0" }}><span>Reduce transparency</span><input className="switch" type="checkbox" checked={s.reduceTransparency} onChange={(e) => settingsStore.set({ reduceTransparency: e.target.checked })} /></label>
          </Section>
          <EmailsInSettings />
          <DiscordStatus />
          <Section title="On your Home Screen">
            <ol style={{ margin: 0, paddingLeft: 18, color: "var(--mist)", lineHeight: 1.7 }}>
              <li>In Safari on your iPad or iPhone, go to <b style={{ color: "var(--ink)" }}>glidepath-ad9.pages.dev/app</b> and sign in with the same Glidepath account as the Bridge page on your PC. No account? On the same Wi-Fi, type the 6-digit code instead.</li>
              <li>Tap Share, then <b style={{ color: "var(--ink)" }}>Add to Home Screen</b>. On Android, use Chrome's menu, then <b style={{ color: "var(--ink)" }}>Install app</b>.</li>
              <li>Open it from the icon. It launches full screen, straight to your flight.</li>
            </ol>
            <p className="faint" style={{ fontSize: 12.5, margin: "10px 0 0" }}>Added from the website, the icon always opens, even when your PC is off, and connects again when the Bridge is running. An icon added from glidepath.local:4810 only opens while the Bridge is running.</p>
            <p className="faint" style={{ fontSize: 12.5, margin: "10px 0 0" }}>For an iPad on a stand, use <a href="#/glance">Glance mode</a>. Lock Screen and widget cards need the native iPad app, which is planned.</p>
          </Section>
          <Section title="About">
            <Kv k="Version" v={`Glidepath ${APP_VERSION}`} />
            <div className="row" style={{ gap: 8, flexWrap: "wrap", margin: "6px 0 10px" }}>
              <button className="btn" onClick={showWhatsNew}>What's new</button>
              <a className="btn" href="#/updates">Updates</a>
              <a className="btn" href="#/support">Support</a>
              <a className="btn" href="https://glidepath-ad9.pages.dev/privacy.html" target="_blank" rel="noopener">Privacy</a>
            </div>
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

/** The account emails, also here so they're easy to find. */
function EmailsInSettings() {
  const c = useCloud();
  if (c.status !== "ready") return null;
  if (!c.active) return (
    <Section title="Emails">
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>Sign in to get your flight debrief, top of descent and arrival heads-ups, and sign-in alerts by email.</p>
      <a className="btn small" style={{ marginTop: 12 }} href="#/account">Sign in</a>
    </Section>
  );
  return <EmailSettings />;
}

/** This device's lock screen notifications (Web Push through the account; sent by the Bridge). */
function PushSetup() {
  const cloud = useCloud();
  const signed = !!(cloud.active && cloud.accounts.some((a) => a.slot === cloud.active));
  const [st, setSt] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { void pushState().then(setSt); }, []);
  const on = st === "on";
  const toggle = async () => {
    setBusy(true); setMsg(null);
    if (on) { await disablePush(); setSt(await pushState()); }
    else { const err = await enablePush(); setSt(await pushState()); if (err) setMsg({ ok: false, text: err }); else { const t = await testPush(); setMsg(t ? { ok: false, text: t } : { ok: true, text: "Done. A test notification is on its way." }); } }
    setBusy(false);
  };
  return (
    <div className="push-setup">
      <label className="between" style={{ padding: "8px 0" }}>
        <span>On this {st === null ? "device" : /iPad|iPhone/.test(navigator.userAgent) ? (/iPad/.test(navigator.userAgent) ? "iPad" : "iPhone") : "device"}<br />
          <span className="faint" style={{ fontSize: 12.5 }}>Checklist reminders, top of descent, your landing and your flight review, even with Glidepath closed. Sent by the Bridge on your PC through your account.</span></span>
        <input className="switch" type="checkbox" checked={on} disabled={busy || !signed || st === "unsupported" || st === "needs-home-screen"} onChange={() => void toggle()} />
      </label>
      {!signed && <p className="faint push-note">Sign in (Account) on this device and on the Bridge page on your PC to get them.</p>}
      {signed && st === "needs-home-screen" && <p className="faint push-note">On iPhone and iPad, Apple allows these for apps on the Home Screen: in Safari, tap Share, then <b>Add to Home Screen</b>, open Glidepath from there and turn this on.</p>}
      {signed && st === "blocked" && <p className="faint push-note">Notifications are blocked for Glidepath. Allow them in your device or browser settings.</p>}
      {signed && st === "unsupported" && <p className="faint push-note">This browser can't show notifications from websites.</p>}
      {on && <div className="row" style={{ gap: 8, marginTop: 4 }}><button className="btn small" disabled={busy} onClick={async () => { setBusy(true); const t = await testPush(); setMsg(t ? { ok: false, text: t } : { ok: true, text: "Test sent. It should arrive in a few seconds." }); setBusy(false); }}>Send a test</button></div>}
      {msg && <p className={`push-note ${msg.ok ? "ok" : "warn"}`}>{msg.text}</p>}
      {signed && <PushKinds />}
    </div>
  );
}

const KINDS: Array<[keyof PushPrefs, string, string]> = [
  ["checklist", "Checklist reminders", "Before take-off when you taxi, approach and landing, and parking at the gate"],
  ["tod", "Top of descent", "When it's time to start down"],
  ["landed", "Landing", "Your touchdown rate, grade and runway"],
  ["review", "Flight review ready", "Your scores and one thing to work on"],
];
/** One switch per kind of notification; saved on the account, so every device follows. */
function PushKinds() {
  const [p, setP] = useState<PushPrefs | null>(null);
  useEffect(() => { void getPushPrefs().then(setP); }, []);
  if (!p) return null;
  return (
    <div className="push-kinds">
      <p className="lp-h" style={{ margin: "12px 0 4px" }}>Send me</p>
      {KINDS.map(([k, label, sub]) => (
        <label key={k} className="between" style={{ padding: "7px 0" }}>
          <span>{label}<br /><span className="faint" style={{ fontSize: 12.5 }}>{sub}</span></span>
          <input className="switch" type="checkbox" checked={p[k]} onChange={(e) => { const next = { ...p, [k]: e.target.checked }; setP(next); void setPushPrefs({ [k]: e.target.checked }).then((r) => r && setP(r)); }} />
        </label>
      ))}
      <p className="faint push-note">Emails (your debrief and in-flight emails) stay as they are; change those under Account.</p>
    </div>
  );
}
