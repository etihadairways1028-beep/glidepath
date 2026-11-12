/** Home: when an add-on EFB, MCDU or GSX is running on the PC, it's the first thing you see. */
import { ADDON_KIND, useAddons } from "../data/addons";
import { useApp } from "../data/store";

export function CockpitReady() {
  const mode = useApp((s) => s.mode);
  const { list } = useAddons();
  if (mode !== "bridge" || !list) return null;
  const up = list.filter((a) => a.up);
  if (!up.length) return null;
  const efb = up.find((a) => a.id === "fenix" || a.id === "fslabs" || a.id === "simbridge");
  return (
    <section className="glass strong cockpit-ready" aria-label="Cockpit tools ready">
      <div className="cr-head">
        <span className="cr-live"><i />On your PC now</span>
        <h2>{efb ? `${ADDON_KIND[efb.id]?.short ?? efb.name} is ready` : "GSX is ready"}</h2>
        <p className="muted">{efb ? "Use your aircraft's own tablet right here: performance, loadsheet, ground services and charts." : "Call the jetway, catering, fuel and pushback from here."}</p>
      </div>
      <div className="cr-tiles">
        {up.map((a) => {
          const k = ADDON_KIND[a.id];
          return (
            <a key={a.id} className="cr-tile" href={`#/cockpit/${a.id}`}>
              <span className="cr-ic" style={{ background: k?.tint ?? "linear-gradient(140deg,#8E9AAF,#5A6578)" }} aria-hidden="true">
                {a.id === "gsx" ? <svg viewBox="0 0 24 24"><path d="M3 17h13l3-5h2M5 17v-4h8v4M7 13V9h4" /><circle cx="7" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
                  : <svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2.5" /><path d="M9 7h6M9 11h6M9 15h3" /></svg>}
              </span>
              <span className="cr-t"><b>{k?.short ?? a.name}</b><small>{k?.verb ?? "Open"}</small></span>
              <span className="cr-go" aria-hidden="true">›</span>
            </a>
          );
        })}
      </div>
    </section>
  );
}
