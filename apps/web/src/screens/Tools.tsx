/**
 * Pilot tools: quick calculators that work offline. Every result is plain
 * arithmetic, shown with its formula, so you can check it.
 */
import { useEffect, useState } from "react";
import { useLive } from "../data/derive";

const n = (s: string) => { const v = Number(String(s).replace(",", ".")); return Number.isFinite(v) ? v : null; };
const r0 = (v: number) => Math.round(v).toLocaleString("en-US");
const r1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-US");
const r2 = (v: number) => (Math.round(v * 100) / 100).toLocaleString("en-US");

function Field({ label, value, set, unit, w = 90 }: { label: string; value: string; set: (s: string) => void; unit?: string; w?: number }) {
  return (
    <label className="tl-field"><span>{label}</span>
      <span className="tl-in"><input inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} style={{ width: w }} />{unit && <em>{unit}</em>}</span>
    </label>
  );
}

function Clocks() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const d = new Date(now);
  const z = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`;
  return (
    <section className="glass tl-card tl-clock">
      <h2 className="h2">Clocks</h2>
      <div className="tl-clocks">
        <div><span className="k">UTC (Zulu)</span><span className="v data">{z}Z</span></div>
        <div><span className="k">Your time</span><span className="v data">{d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></div>
      </div>
      <p className="tl-foot">{d.toUTCString().slice(0, 16)}</p>
    </section>
  );
}

function Crosswind() {
  const L = useLive();
  const [rwy, setRwy] = useState("27");
  const [dir, setDir] = useState(L.frame?.environment?.windDirDeg != null ? String(Math.round(L.frame.environment.windDirDeg)) : "300");
  const [kt, setKt] = useState(L.frame?.environment?.windKt != null ? String(Math.round(L.frame.environment.windKt)) : "18");
  const hdg = n(rwy) !== null ? (n(rwy)! >= 1 && n(rwy)! <= 36 ? n(rwy)! * 10 : n(rwy)!) : null;
  const wd = n(dir), ws = n(kt);
  let out = null;
  if (hdg !== null && wd !== null && ws !== null) {
    const a = ((wd - hdg) * Math.PI) / 180;
    const head = ws * Math.cos(a), cross = ws * Math.sin(a);
    out = (<>
      <div className="tl-res"><span className="k">{head >= 0 ? "Headwind" : "Tailwind"}</span><span className={`v data${head < -10 ? " bad" : ""}`}>{r0(Math.abs(head))} kt</span></div>
      <div className="tl-res"><span className="k">Crosswind</span><span className={`v data${Math.abs(cross) > 30 ? " bad" : ""}`}>{r0(Math.abs(cross))} kt {cross > 0.5 ? "from the right" : cross < -0.5 ? "from the left" : ""}</span></div>
    </>);
  }
  return (
    <section className="glass tl-card">
      <h2 className="h2">Crosswind</h2>
      <div className="tl-row"><Field label="Runway" value={rwy} set={setRwy} unit="(27 or 270)" w={60} /><Field label="Wind from" value={dir} set={setDir} unit="°" w={60} /><Field label="Speed" value={kt} set={setKt} unit="kt" w={60} /></div>
      <div className="tl-out">{out ?? <span className="faint">Enter a runway and wind.</span>}</div>
      <p className="tl-foot">Wind angle off the runway: head = speed × cos, cross = speed × sin.{L.frame?.environment?.windKt != null ? " Wind filled in from your sim." : ""}</p>
    </section>
  );
}

function Descent() {
  const L = useLive();
  const [from, setFrom] = useState(L.frame?.position.altMslFt != null && !L.frame.position.onGround ? String(Math.round(L.frame.position.altMslFt / 100) * 100) : "36000");
  const [to, setTo] = useState("3000");
  const [gs, setGs] = useState(L.frame?.speed.gsKt != null && L.frame.speed.gsKt > 100 ? String(Math.round(L.frame.speed.gsKt)) : "420");
  const a = n(from), b = n(to), g = n(gs);
  const lose = a !== null && b !== null ? a - b : null;
  return (
    <section className="glass tl-card">
      <h2 className="h2">Descent planner</h2>
      <div className="tl-row"><Field label="From" value={from} set={setFrom} unit="ft" /><Field label="To" value={to} set={setTo} unit="ft" /><Field label="Groundspeed" value={gs} set={setGs} unit="kt" w={70} /></div>
      <div className="tl-out">
        {lose !== null && lose > 0 && g ? (<>
          <div className="tl-res"><span className="k">Start down</span><span className="v data">{r0((lose / 1000) * 3)} nm before</span></div>
          <div className="tl-res"><span className="k">Rate for 3°</span><span className="v data">{r0(g * 5.3)} fpm</span></div>
          <div className="tl-res"><span className="k">Time</span><span className="v data">{r1(lose / (g * 5.3))} min</span></div>
        </>) : <span className="faint">Enter heights and groundspeed.</span>}
      </div>
      <p className="tl-foot">3 nm per 1,000 ft to lose; vertical speed for a 3° path ≈ groundspeed × 5.3.</p>
    </section>
  );
}

function Convert() {
  const [v, setV] = useState("1013");
  const x = n(v);
  const rows: Array<[string, string]> = x === null ? [] : [
    [`${r0(x)} hPa`, `${r2(x / 33.8639)} inHg`],
    [`${r2(x)} inHg`, `${r0(x * 33.8639)} hPa`],
    [`${r0(x)} kg`, `${r0(x * 2.20462)} lb`],
    [`${r0(x)} lb`, `${r0(x / 2.20462)} kg`],
    [`${r0(x)} ft`, `${r0(x * 0.3048)} m`],
    [`${r0(x)} m`, `${r0(x / 0.3048)} ft`],
    [`${r1(x)} °C`, `${r1(x * 9 / 5 + 32)} °F`],
    [`${r0(x)} nm`, `${r0(x * 1.852)} km`],
    [`${r0(x)} kt`, `${r0(x * 1.852)} km/h`],
    [`${r0(x)} L Jet A`, `${r0(x * 0.8)} kg (at 0.8 kg/L)`],
  ];
  return (
    <section className="glass tl-card">
      <h2 className="h2">Converter</h2>
      <Field label="Value" value={v} set={setV} w={120} />
      <div className="tl-conv">{rows.map(([a, b]) => <div key={a}><span>{a}</span><span className="data">{b}</span></div>)}</div>
    </section>
  );
}

function Glidepath() {
  const [gs, setGs] = useState("140");
  const [deg, setDeg] = useState("3");
  const [dist, setDist] = useState("10");
  const g = n(gs), d = n(deg), nm = n(dist);
  const fpm = g !== null && d !== null ? g * 101.27 * Math.tan((d * Math.PI) / 180) : null;
  const height = nm !== null && d !== null ? nm * 6076.12 * Math.tan((d * Math.PI) / 180) : null;
  return (
    <section className="glass tl-card">
      <h2 className="h2">Approach path</h2>
      <div className="tl-row"><Field label="Groundspeed" value={gs} set={setGs} unit="kt" w={60} /><Field label="Angle" value={deg} set={setDeg} unit="°" w={50} /><Field label="From touchdown" value={dist} set={setDist} unit="nm" w={50} /></div>
      <div className="tl-out">
        {fpm !== null && <div className="tl-res"><span className="k">Descent rate</span><span className="v data">{r0(fpm)} fpm</span></div>}
        {height !== null && <div className="tl-res"><span className="k">Height above touchdown</span><span className="v data">{r0(height)} ft</span></div>}
      </div>
      <p className="tl-foot">Exact trigonometry, not the rule of thumb. On a 3° path you should be about 318 ft up per nm.</p>
    </section>
  );
}

function Fuel() {
  const [burn, setBurn] = useState("2500");
  const [hrs, setHrs] = useState("2.5");
  const [res, setRes] = useState("45");
  const b = n(burn), h = n(hrs), m = n(res);
  const trip = b !== null && h !== null ? b * h : null;
  const reserve = b !== null && m !== null ? (b * m) / 60 : null;
  return (
    <section className="glass tl-card">
      <h2 className="h2">Quick fuel</h2>
      <div className="tl-row"><Field label="Burn per hour" value={burn} set={setBurn} unit="kg/h" w={70} /><Field label="Flight time" value={hrs} set={setHrs} unit="h" w={50} /><Field label="Reserve" value={res} set={setRes} unit="min" w={50} /></div>
      <div className="tl-out">
        {trip !== null && reserve !== null && <>
          <div className="tl-res"><span className="k">Trip</span><span className="v data">{r0(trip)} kg</span></div>
          <div className="tl-res"><span className="k">Reserve</span><span className="v data">{r0(reserve)} kg</span></div>
          <div className="tl-res"><span className="k">Total (add taxi)</span><span className="v data">{r0(trip + reserve)} kg</span></div>
        </>}
      </div>
      <p className="tl-foot">A rough check, not a flight plan. SimBrief does the real thing.</p>
    </section>
  );
}

export function ToolsScreen() {
  return (
    <>
      <div className="page-head"><div><h1 className="title">Pilot tools</h1><p className="muted" style={{ margin: "4px 0 0" }}>Quick calculators. They work offline, and each one shows its formula.</p></div></div>
      <div className="tl-grid">
        <Clocks /><Crosswind /><Descent /><Glidepath /><Fuel /><Convert />
      </div>
    </>
  );
}
