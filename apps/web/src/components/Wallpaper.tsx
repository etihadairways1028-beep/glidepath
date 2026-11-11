/**
 * Background: a built-in colour wallpaper, plain, or your own photo.
 * The photo is shrunk on this device and kept only here (never uploaded).
 */
import { useEffect, useRef, useState } from "react";
import { settingsStore, useSettings } from "../data/store";

export const WALLPAPERS = [
  { id: "aurora", label: "Aurora", swatch: "radial-gradient(60% 60% at 25% 30%, #2F5BFF, transparent 70%), radial-gradient(60% 60% at 80% 30%, #8A3FFC, transparent 70%), radial-gradient(60% 60% at 60% 85%, #00BFA6, transparent 70%), #060818" },
  { id: "sunset", label: "Sunset", swatch: "radial-gradient(60% 60% at 25% 30%, #FF7A45, transparent 70%), radial-gradient(60% 60% at 80% 30%, #FF3D7F, transparent 70%), radial-gradient(60% 60% at 60% 85%, #FFC24B, transparent 70%), #1A0B1E" },
  { id: "ocean", label: "Ocean", swatch: "radial-gradient(60% 60% at 25% 30%, #0A84FF, transparent 70%), radial-gradient(60% 60% at 80% 30%, #00C7BE, transparent 70%), radial-gradient(60% 60% at 60% 85%, #3355FF, transparent 70%), #04121F" },
  { id: "dusk", label: "Dusk", swatch: "radial-gradient(60% 60% at 25% 30%, #6B4CFF, transparent 70%), radial-gradient(60% 60% at 80% 30%, #FF6FB5, transparent 70%), radial-gradient(60% 60% at 60% 85%, #2B1C7A, transparent 70%), #0B0820" },
  { id: "forest", label: "Forest", swatch: "radial-gradient(60% 60% at 25% 30%, #1FB86A, transparent 70%), radial-gradient(60% 60% at 80% 30%, #0E8C7F, transparent 70%), radial-gradient(60% 60% at 60% 85%, #9BD14B, transparent 70%), #04140E" },
  { id: "plain", label: "Plain", swatch: "linear-gradient(180deg, #1C1C1E, #000)" },
] as const;
export type WallpaperId = (typeof WALLPAPERS)[number]["id"] | "photo";
const PHOTO_KEY = "glidepath.wallpaperPhoto";

/** Puts the chosen background on the page. Call once, near the top of the app. */
export function useWallpaper() {
  const s = useSettings();
  useEffect(() => {
    const root = document.documentElement;
    const id = s.wallpaper ?? "aurora";
    let photo: string | null = null;
    if (id === "photo") { try { photo = localStorage.getItem(PHOTO_KEY); } catch { /* blocked */ } }
    root.dataset.wall = id === "photo" && !photo ? "aurora" : id;
    if (photo) root.style.setProperty("--wall-photo", `url("${photo}")`); else root.style.removeProperty("--wall-photo");
  }, [s.wallpaper]);
}

/** Shrink a picture to at most 1920 px on its long side, as a JPEG. */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("That file isn't a picture we can open.")); i.src = url; });
    const k = Math.min(1, 1920 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82);
  } finally { URL.revokeObjectURL(url); }
}

export function WallpaperPicker() {
  const s = useSettings();
  const cur = (s.wallpaper ?? "aurora") as WallpaperId;
  const file = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(() => { try { return localStorage.getItem(PHOTO_KEY); } catch { return null; } });
  const set = (wallpaper: WallpaperId) => settingsStore.set({ wallpaper });
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    try {
      const data = await shrink(f);
      localStorage.setItem(PHOTO_KEY, data);
      setPhoto(data);
      set("photo");
      // Force the page to pick up a new photo even if "photo" was already chosen.
      document.documentElement.style.setProperty("--wall-photo", `url("${data}")`);
      document.documentElement.dataset.wall = "photo";
    } catch (e) { setErr(e instanceof Error && /quota/i.test(e.message) ? "That picture is too big to keep on this device. Try a smaller one." : e instanceof Error ? e.message : "Couldn't use that picture."); }
  };
  return (
    <div className="wall-picker">
      <div className="wall-grid">
        {WALLPAPERS.map((w) => (
          <button key={w.id} className={`wall-sw${cur === w.id ? " on" : ""}`} onClick={() => set(w.id)} aria-pressed={cur === w.id}>
            <span style={{ background: w.swatch }} />{w.label}
          </button>
        ))}
        <button className={`wall-sw${cur === "photo" ? " on" : ""}`} onClick={() => (photo ? set("photo") : file.current?.click())} aria-pressed={cur === "photo"}>
          <span style={photo ? { backgroundImage: `url("${photo}")`, backgroundSize: "cover", backgroundPosition: "center" } : { background: "repeating-linear-gradient(45deg, rgba(127,127,127,.25) 0 6px, transparent 6px 12px)" }}>{photo ? null : <b>+</b>}</span>Your photo
        </button>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button className="btn small" onClick={() => file.current?.click()}>{photo ? "Choose a different photo" : "Choose a photo"}</button>
        {photo && <button className="btn small" onClick={() => { try { localStorage.removeItem(PHOTO_KEY); } catch { /* ignore */ } setPhoto(null); if (cur === "photo") set("aurora"); }}>Remove photo</button>}
      </div>
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
      {err && <p className="faint" style={{ color: "var(--a-red)", margin: "8px 0 0" }}>{err}</p>}
      <p className="faint" style={{ fontSize: 12.5, margin: "8px 0 0" }}>Your photo stays on this device only.</p>
    </div>
  );
}
