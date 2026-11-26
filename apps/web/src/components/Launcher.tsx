/** More: every other screen in one tap, in a sheet over the page you're on. */
import { useEffect } from "react";
import { Icon } from "./ui";

export const MORE_SCREENS = [
  ["performance", "Performance", Icon.perf], ["approach", "Landing helper", Icon.approach], ["charts", "Charts", Icon.chart], ["copilot", "Copilot", Icon.headset], ["checklists", "Checklists", Icon.checklist],
  ["tools", "Pilot tools", Icon.calc], ["cockpit", "EFB", Icon.panel], ["weather", "Weather", Icon.cloud],
  ["airports", "Airports", Icon.tower], ["glance", "Glance mode", Icon.expand], ["career", "Career", Icon.career],
  ["challenge", "Landing challenge", Icon.trophy], ["account", "Account", Icon.person], ["settings", "Settings", Icon.more],
] as const;

export function Launcher({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="launch-wrap" onClick={onClose}>
      <nav className="launch glass strong" aria-label="All screens" onClick={(e) => e.stopPropagation()}>
        <div className="launch-grid">
          {MORE_SCREENS.map(([id, label, I]) => (
            <a key={id} className="launch-app" href={`#/${id}`} onClick={onClose}>
              <span className={`more-ic ic-${id}`}><I /></span><span>{label}</span>
            </a>
          ))}
        </div>
      </nav>
    </div>
  );
}
