/** Base map picker and traffic sources, shared by the map's layers button and Settings. */
import { MAP_STYLES, settingsStore, useSettings, type MapStyle } from "../data/store";
import { NETWORK_LABEL, type Network } from "../data/external";
import { NET_COLOR } from "./MapView";

const SWATCH: Record<MapStyle, string> = {
  satellite: "linear-gradient(135deg, #2f4a2a 0%, #5d6b3c 35%, #2a4f6b 60%, #183650 100%)",
  map: "linear-gradient(135deg, #0e1424 0 50%, #e7ecf3 50% 100%)",
  dark: "linear-gradient(135deg, #0b0f17, #1c2230 60%, #2a3142)",
  fiord: "linear-gradient(135deg, #1f3a52, #2d5070 55%, #45698a)",
  light: "linear-gradient(135deg, #f4f6f9, #e1e6ee 60%, #cfd8e3)",
  liberty: "linear-gradient(135deg, #f2efe9, #cde6c0 40%, #f7d68f 70%, #a9cbe8)",
  bright: "linear-gradient(135deg, #f8f4f0, #d8e8c8 45%, #fcd6a4 75%, #b5d0e8)",
};

export function BaseMapPicker() {
  const s = useSettings();
  const current = s.mapStyle ?? "satellite";
  return (
    <div className="basemaps" role="radiogroup" aria-label="Base map">
      {MAP_STYLES.map((m) => (
        <button key={m.id} role="radio" aria-checked={current === m.id} className={`basemap${current === m.id ? " on" : ""}`} onClick={() => settingsStore.set({ mapStyle: m.id })} title={m.hint}>
          <span className="sw" style={{ background: SWATCH[m.id] }} aria-hidden="true" />
          <span className="nm">{m.label}</span>
        </button>
      ))}
    </div>
  );
}

const KEYS: Record<Network, "showVatsim" | "showIvao" | "showSayIntentions"> = { vatsim: "showVatsim", ivao: "showIvao", sayintentions: "showSayIntentions" };
const NOTE: Record<Network, string> = { vatsim: "Human ATC and pilots", ivao: "Human ATC and pilots", sayintentions: "Pilots flying with AI ATC" };

export function TrafficSources({ counts, errors }: { counts?: Partial<Record<Network, number>>; errors?: Partial<Record<Network, string | null>> }) {
  const s = useSettings();
  return (
    <div className="sources-list">
      {(Object.keys(KEYS) as Network[]).map((n) => {
        const on = !!s[KEYS[n]];
        const c = counts?.[n];
        const err = errors?.[n];
        return (
          <label key={n} className="src-row">
            <span className="dotc" style={{ background: NET_COLOR[n] }} aria-hidden="true" />
            <span className="src-txt">
              <b>{NETWORK_LABEL[n]}</b>
              <span>{on && err ? `Couldn't load: ${err}` : on && c !== undefined ? `${c.toLocaleString()} aircraft` : NOTE[n]}</span>
            </span>
            <input className="switch" type="checkbox" checked={on} onChange={(e) => settingsStore.set({ [KEYS[n]]: e.target.checked } as never)} />
          </label>
        );
      })}
    </div>
  );
}
