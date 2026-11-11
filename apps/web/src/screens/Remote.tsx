/**
 * Remote: control the simulator from any device (autopilot, lights, aircraft,
 * engines, camera views), plus the live camera and engine readouts.
 *
 * Every button sends a standard MSFS control through the Bridge. The Bridge
 * then checks the simulator's own data: a button only shows "done" when the
 * sim reports the change. Study-level add-ons (PMDG, Fenix, FSLabs) run their
 * own systems and may ignore some of these, which the app says plainly.
 */
import { useState } from "react";
import type { TelemetryFrame } from "@glidepath/protocol";
import { activeBridge } from "../data/bridge";
import { useApp } from "../data/store";
import { useLive } from "../data/derive";
import { Notice } from "../components/ui";
import { CameraViewer, LocalPreview, canShare, useCameraHost } from "../components/LiveCamera";

type Result = { state: string; detail: string | null };

function useSend() {
  const [busy, setBusy] = useState<string | null>(null);
  const [last, setLast] = useState<{ key: string; r: Result } | null>(null);
  const send = async (key: string, cap: string, value: number | boolean | null, confirmText?: string) => {
    const b = activeBridge();
    if (!b) { setLast({ key, r: { state: "rejected", detail: "Connect to your PC first." } }); return; }
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(key);
    const r = await b.command(cap, value, !!confirmText);
    setBusy(null);
    setLast({ key, r });
    window.setTimeout(() => setLast((l) => (l?.key === key ? null : l)), 6000);
  };
  return { busy, last, send };
}

const word = (r: Result) => r.state === "confirmed" ? (r.detail === "Already set." ? "Already set" : "Done") : r.state === "timeout" ? "Sent, but the aircraft didn't react" : r.state === "disarmed" ? "Needs confirming" : r.state === "unsupported" ? "Not available" : "Couldn't do that";

function Toggle({ label, on, k, cap, s, confirm }: { label: string; on: boolean | null; k: string; cap: string; s: ReturnType<typeof useSend>; confirm?: (next: boolean) => string | undefined }) {
  return (
    <button className={`rc-tog${on ? " on" : ""}${s.busy === k ? " busy" : ""}`} onClick={() => s.send(k, cap, !on, confirm?.(!on))} aria-pressed={!!on}>
      <span className="rc-led" />{label}
    </button>
  );
}

function Target({ label, value, unit, k, cap, step, big, min, max, s, fmt }: { label: string; value: number | null; unit: string; k: string; cap: string; step: number; big: number; min: number; max: number; s: ReturnType<typeof useSend>; fmt?: (v: number) => string }) {
  const [edit, setEdit] = useState<string | null>(null);
  const v = value ?? null;
  const set = (n: number) => s.send(k, cap, Math.max(min, Math.min(max, n)));
  const show = v === null ? "—" : fmt ? fmt(v) : Math.round(v).toLocaleString("en-US");
  return (
    <div className={`rc-target${s.busy === k ? " busy" : ""}`}>
      <span className="rc-k">{label}</span>
      {edit !== null ? (
        <form onSubmit={(e) => { e.preventDefault(); const n = Number(edit); if (Number.isFinite(n)) set(n); setEdit(null); }}>
          <input autoFocus inputMode="numeric" value={edit} onChange={(e) => setEdit(e.target.value)} onBlur={() => setEdit(null)} className="rc-edit" />
        </form>
      ) : <button className="rc-v data" onClick={() => setEdit(v === null ? "" : String(Math.round(v)))} title="Tap to type a value">{show}<small>{unit}</small></button>}
      <div className="rc-steps">
        <button onClick={() => v !== null && set(v - big)} aria-label={`${label} down a lot`}>«</button>
        <button onClick={() => v !== null && set(v - step)} aria-label={`${label} down`}>−</button>
        <button onClick={() => v !== null && set(v + step)} aria-label={`${label} up`}>+</button>
        <button onClick={() => v !== null && set(v + big)} aria-label={`${label} up a lot`}>»</button>
      </div>
    </div>
  );
}

function Gauge({ pct, label }: { pct: number | null; label: string }) {
  const p = Math.max(0, Math.min(110, pct ?? 0));
  const sweep = 270 * (p / 110);
  const pt = (deg: number, r = 34) => { const rad = ((deg - 90) * Math.PI) / 180; return `${40 + r * Math.cos(rad)} ${40 + r * Math.sin(rad)}`; };
  const arc = (from: number, to: number) => `M ${pt(from)} A 34 34 0 ${to - from > 180 ? 1 : 0} 1 ${pt(to)}`;
  return (
    <svg viewBox="0 0 80 80" className="rc-gauge" aria-label={`${label} ${pct === null ? "unknown" : pct.toFixed(1) + "%"}`}>
      <path d={arc(225, 494.9)} className="track" />
      {pct !== null && sweep > 0.5 && <path d={arc(225, 225 + sweep)} className={`val${p > 100 ? " hot" : ""}`} />}
      <text x="40" y="43" textAnchor="middle" className="num">{pct === null ? "—" : pct.toFixed(1)}</text>
      <text x="40" y="55" textAnchor="middle" className="lab">{label}</text>
    </svg>
  );
}

function Engines({ f, s }: { f: TelemetryFrame | null; s: ReturnType<typeof useSend> }) {
  const eng = f?.engines ?? [];
  return (
    <section className="glass rc-card rc-engines">
      <div className="between"><h2 className="h2">Engines</h2><span className="faint" style={{ fontSize: 12.5 }}>{eng.length ? `${eng.length}-engine` : "No data yet"}</span></div>
      <div className="rc-eng-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(4, eng.length))}, 1fr)` }}>
        {eng.map((e, i) => (
          <div key={i} className="rc-eng">
            <span className={`rc-eng-name${e.running ? " run" : ""}`}><i />ENG {i + 1}</span>
            <Gauge pct={e.n1Pct} label="N1" />
            <div className="rc-eng-nums">
              <span><b className="data">{e.n2Pct === null ? "—" : `${e.n2Pct.toFixed(1)}%`}</b>N2</span>
              <span><b className="data">{e.egtC === null ? "—" : `${Math.round(e.egtC)}°C`}</b>EGT</span>
              <span><b className="data">{e.fuelFlowKgH === null ? "—" : Math.round(e.fuelFlowKgH).toLocaleString("en-US")}</b>FF kg/h</span>
            </div>
          </div>
        ))}
      </div>
      <div className="rc-row">
        <button className="btn" onClick={() => s.send("eng-start", "engines.start", null, "Start the engines with the simulator's auto-start?")}>{s.busy === "eng-start" ? "Starting…" : "Auto-start"}</button>
        <button className="btn" onClick={() => s.send("eng-stop", "engines.shutdown", null, "Shut down all engines? Only on the ground, stopped.")}>{s.busy === "eng-stop" ? "Shutting down…" : "Shut down"}</button>
      </div>
      <p className="rc-note">Auto-start and shutdown are the simulator's own (Ctrl+E). Study-level aircraft need their real start procedure.</p>
    </section>
  );
}

export function RemoteScreen() {
  const mode = useApp((st) => st.mode);
  const L = useLive();
  const f = L.frame;
  const b = mode === "bridge" ? activeBridge() : null;
  const s = useSend();
  const host = useCameraHost(b);
  const [view, setView] = useState<number | null>(null);
  const ap = f?.autopilot;
  const li = f?.lights;

  return (
    <>
      <div className="page-head">
        <div><h1 className="title">Remote</h1><p className="muted" style={{ margin: "4px 0 0" }}>Fly from the sofa: autopilot, lights, engines and the camera, on any device.</p></div>
        {s.last && <span className={`rc-toast ${s.last.r.state}`} role="status">{word(s.last.r)}{s.last.r.detail && s.last.r.detail !== "Already set." ? `. ${s.last.r.detail}` : ""}</span>}
      </div>
      {mode === "demo" && <Notice info>This is the demo flight, so buttons don't reach a simulator. Connect your PC to fly for real.</Notice>}
      {mode === "none" && <Notice info>Connect to your PC to use the remote. <a href="#/">Connect</a></Notice>}

      <div className="rc-grid">
        <section className="glass strong rc-card rc-camera">
          <div className="between">
            <h2 className="h2">Camera</h2>
            <div className="seg" role="group" aria-label="Camera view">
              {([[2, "Cockpit"], [3, "Outside"], [4, "Drone"]] as const).map(([v, l]) => (
                <button key={v} className={view === v ? "on" : ""} onClick={() => { setView(v); void s.send(`cam${v}`, "camera", v); }}>{l}</button>
              ))}
            </div>
          </div>
          {host.stream ? <LocalPreview stream={host.stream} /> : <CameraViewer b={b} />}
          {canShare() && (
            <div className="rc-row">
              {host.stream
                ? <><span className="rc-sharing"><i />Sharing to {host.viewers} {host.viewers === 1 ? "device" : "devices"}</span><button className="btn" onClick={host.stop}>Stop sharing</button></>
                : <button className="btn primary" disabled={!b} onClick={() => void host.start().catch(() => undefined)}>Share my sim screen</button>}
            </div>
          )}
          <p className="rc-note">The picture goes straight from your PC to your devices on your Wi-Fi. The view buttons switch the simulator's own camera.</p>
        </section>

        <section className="glass rc-card rc-ap">
          <div className="between"><h2 className="h2">Autopilot</h2><span className={`rc-chip${ap?.master ? " on" : ""}`}>{ap?.master ? "AP engaged" : "AP off"}</span></div>
          <div className="rc-targets">
            <Target label="SPD" value={ap?.selectedSpeedKt ?? null} unit="kt" k="spd" cap="ap.speed" step={1} big={10} min={60} max={400} s={s} />
            <Target label="HDG" value={ap?.selectedHeadingDeg ?? null} unit="°" k="hdg" cap="ap.heading" step={1} big={10} min={0} max={359} s={s} fmt={(v) => String(Math.round(v) % 360).padStart(3, "0")} />
            <Target label="ALT" value={ap?.selectedAltitudeFt ?? null} unit="ft" k="alt" cap="ap.altitude" step={100} big={1000} min={0} max={50000} s={s} />
            <Target label="V/S" value={ap?.selectedVsFpm ?? null} unit="fpm" k="vs" cap="ap.vs" step={100} big={500} min={-6000} max={6000} s={s} />
          </div>
          <div className="rc-toggles">
            <Toggle label="AP" on={ap?.master ?? null} k="ap" cap="ap.master" s={s} />
            <Toggle label="FD" on={ap?.flightDirector ?? null} k="fd" cap="ap.fd" s={s} />
            <Toggle label="A/THR" on={ap?.autothrottle ?? null} k="athr" cap="ap.athr" s={s} />
            <Toggle label="HDG" on={ap?.headingHold ?? null} k="hdgh" cap="ap.hdgHold" s={s} />
            <Toggle label="NAV" on={ap?.navHold ?? null} k="nav" cap="ap.navHold" s={s} />
            <Toggle label="APPR" on={ap?.approachHold ?? null} k="appr" cap="ap.aprHold" s={s} />
          </div>
        </section>

        <section className="glass rc-card">
          <h2 className="h2">Lights</h2>
          <div className="rc-toggles">
            <Toggle label="Beacon" on={li?.beacon ?? null} k="lb" cap="lights.beacon" s={s} />
            <Toggle label="Strobes" on={li?.strobe ?? null} k="ls" cap="lights.strobe" s={s} />
            <Toggle label="Landing" on={li?.landing ?? null} k="ll" cap="lights.landing" s={s} />
            <Toggle label="Taxi" on={li?.taxi ?? null} k="lt" cap="lights.taxi" s={s} />
            <Toggle label="Nav" on={li?.nav ?? null} k="ln" cap="lights.nav" s={s} />
            <Toggle label="Logo" on={li?.logo ?? null} k="lo" cap="lights.logo" s={s} />
            <Toggle label="Wing" on={li?.wing ?? null} k="lw" cap="lights.wing" s={s} />
          </div>
        </section>

        <section className="glass rc-card">
          <h2 className="h2">Aircraft</h2>
          <div className="rc-toggles">
            <Toggle label="Parking brake" on={f?.controls.parkingBrake ?? null} k="pb" cap="brake.parking" s={s} />
            <Toggle label="Gear down" on={f?.controls.gearDown ?? null} k="gear" cap="gear" s={s} confirm={(next) => next ? "Put the gear down?" : "Raise the gear?"} />
            <Toggle label="Pause" on={f?.sim.paused ?? null} k="pause" cap="sim.pause" s={s} />
          </div>
          <div className="rc-row">
            <span className="rc-k" style={{ marginRight: "auto" }}>Flaps {f?.controls.flapsIndex ?? "—"}</span>
            <button className="btn" onClick={() => s.send("fu", "flaps.up", null)}>Flaps up</button>
            <button className="btn" onClick={() => s.send("fd", "flaps.down", null)}>Flaps down</button>
          </div>
        </section>

        <Engines f={f} s={s} />
      </div>
      <p className="rc-note" style={{ marginTop: 14 }}>Uses the simulator's standard controls. Default aircraft respond to all of them; PMDG, Fenix and FSLabs run their own systems and may ignore some. Each button tells you whether the sim actually changed.</p>
    </>
  );
}
