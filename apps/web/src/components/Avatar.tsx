/** Profile picture: a photo you upload or a ready-made aviation avatar.
 *  Kept on this device only (localStorage), one per signed-in account, plus
 *  one for when you're not signed in. Nothing is uploaded anywhere. */
import { useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import { Icon } from "./ui";
import { useCloud } from "../data/cloud";

type Pfp = { kind: "photo"; data: string } | { kind: "preset"; id: string };
const KEY = "gp.pfp";
const EVT = "gp-pfp";

function readAll(): Record<string, Pfp> {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, Pfp>; } catch { return {}; }
}
let cache = readAll();
const subscribe = (f: () => void) => {
  const h = () => { cache = readAll(); f(); };
  addEventListener(EVT, h); addEventListener("storage", h);
  return () => { removeEventListener(EVT, h); removeEventListener("storage", h); };
};
const snapshot = () => cache;
function save(slot: string, p: Pfp | null): string | null {
  const all = readAll();
  if (p) all[slot] = p; else delete all[slot];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { return "There isn't room to save that picture on this device. Try a smaller one."; }
  dispatchEvent(new Event(EVT));
  return null;
}

/* Ready-made avatars: a glyph on a soft gradient. */
const g = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
export const PRESETS: { id: string; label: string; c: [string, string]; glyph: () => ReactElement }[] = [
  { id: "jet", label: "Jet", c: ["#5E9BFF", "#3046D8"], glyph: Icon.flight },
  { id: "tower", label: "Tower", c: ["#34C3A0", "#127A73"], glyph: Icon.tower },
  { id: "headset", label: "Headset", c: ["#B07CFF", "#6338D8"], glyph: Icon.headset },
  { id: "wings", label: "Pilot wings", c: ["#F4B740", "#C7791A"], glyph: () => <svg viewBox="0 0 24 24" {...g}><circle cx="12" cy="12" r="2.6" /><path d="M9.4 12H2.5c1.5 2 3.6 3 6.2 3M14.6 12h6.9c-1.5 2-3.6 3-6.2 3M3.6 10h5.8M14.6 10h5.8" /></svg> },
  { id: "cloud", label: "Cloud", c: ["#5CC8FF", "#2A86D8"], glyph: Icon.cloud },
  { id: "approach", label: "Approach", c: ["#FF8A65", "#D8463A"], glyph: Icon.approach },
  { id: "globe", label: "Globe", c: ["#6CD38A", "#2E8F52"], glyph: () => <svg viewBox="0 0 24 24" {...g}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5S14.6 18.1 12 20.5M12 3.5C9.4 5.9 8.2 8.7 8.2 12s1.2 6.1 3.8 8.5" /></svg> },
  { id: "compass", label: "Compass", c: ["#8A93A6", "#4A5266"], glyph: () => <svg viewBox="0 0 24 24" {...g}><circle cx="12" cy="12" r="8.5" /><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8z" /></svg> },
];

function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return "";
  const first = parts[0] ?? "", last = parts.length > 1 ? parts[parts.length - 1] ?? "" : "";
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}

/** Which key the picture is stored under: the active account, or "local" when signed out. */
export function usePfpSlot(): { slot: string; name: string | null } {
  const c = useCloud();
  const a = c.accounts.find((x) => x.slot === c.active) ?? null;
  return { slot: a?.slot ?? "local", name: a ? (a.name ?? a.email.split("@")[0] ?? null) : null };
}

export function Avatar({ size = 40, slot, name }: { size?: number; slot?: string; name?: string | null }): ReactElement {
  const all = useSyncExternalStore(subscribe, snapshot, snapshot);
  const me = usePfpSlot();
  const key = slot ?? me.slot;
  const who = name !== undefined ? name : me.name;
  const p = all[key];
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (p?.kind === "photo") return <span className="pfp" style={style} aria-hidden="true"><img src={p.data} alt="" draggable={false} /></span>;
  const preset = p?.kind === "preset" ? PRESETS.find((x) => x.id === p.id) : undefined;
  if (preset) {
    return <span className="pfp" style={{ ...style, background: `linear-gradient(160deg, ${preset.c[0]}, ${preset.c[1]})` }} aria-hidden="true"><span className="pfp-g">{preset.glyph()}</span></span>;
  }
  const ini = initials(who);
  return (
    <span className="pfp" style={{ ...style, background: "linear-gradient(160deg, #6FA8FF, #3B55E0 60%, #6B3FE0)" }} aria-hidden="true">
      {ini ? <b>{ini}</b> : <span className="pfp-g">{Icon.flight()}</span>}
    </span>
  );
}

/** Square-crop an image file to 192px and return it as a small JPEG data URL. */
function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const S = 192, c = document.createElement("canvas");
      c.width = c.height = S;
      const ctx = c.getContext("2d");
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error("no canvas")); return; }
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, S, S);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
    img.src = url;
  });
}

/** The picker shown in Account. */
export function PfpPicker(): ReactElement {
  const me = usePfpSlot();
  const all = useSyncExternalStore(subscribe, snapshot, snapshot);
  const cur = all[me.slot];
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);

  const onFile = async (f: File | undefined) => {
    setErr(null);
    if (!f) return;
    if (!f.type.startsWith("image/")) { setErr("That file isn't a picture. Choose a JPG, PNG or HEIC photo."); return; }
    try { setErr(save(me.slot, { kind: "photo", data: await shrink(f) })); }
    catch { setErr("Glidepath couldn't open that picture. Try a JPG or PNG."); }
  };

  return (
    <section className="glass pad pfp-pick" aria-label="Profile picture">
      <div className="pfp-pick-top">
        <Avatar size={72} />
        <div>
          <div className="h2" style={{ margin: 0 }}>Profile picture</div>
          <p className="muted" style={{ margin: "4px 0 0" }}>Shown at the top of the app{me.name ? ` for ${me.name}` : ""}. It stays on this device.</p>
        </div>
      </div>
      <div className="pfp-grid" role="radiogroup" aria-label="Ready-made pictures">
        {PRESETS.map((p) => {
          const on = cur?.kind === "preset" && cur.id === p.id;
          return (
            <button key={p.id} type="button" role="radio" aria-checked={on} aria-label={p.label} className={`pfp-opt${on ? " on" : ""}`}
              onClick={() => setErr(save(me.slot, { kind: "preset", id: p.id }))}>
              <span className="pfp" style={{ width: 48, height: 48, background: `linear-gradient(160deg, ${p.c[0]}, ${p.c[1]})` }}><span className="pfp-g">{p.glyph()}</span></span>
            </button>
          );
        })}
      </div>
      <div className="row wrap" style={{ gap: 10, marginTop: 14 }}>
        <button className="btn small primary" type="button" onClick={() => input.current?.click()}>Upload a photo</button>
        {cur && <button className="btn small" type="button" onClick={() => setErr(save(me.slot, null))}>Use my initials</button>}
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {err && <p className="pfp-err" role="alert" style={{ margin: "10px 0 0" }}>{err}</p>}
    </section>
  );
}
