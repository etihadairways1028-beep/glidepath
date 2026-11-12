/** "Follow my flight": a link friends open to watch your plane on a map, live. */
import { useEffect, useState } from "react";
import { useCloud } from "../data/cloud";
import { liveLink, startSharing, stopSharing, useLive } from "../data/live";

const ago = (t: number | null) => { if (!t) return "waiting for your sim"; const s = Math.round((Date.now() - t) / 1000); return s < 5 ? "just now" : s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`; };

export function ShareLive({ compact }: { compact?: boolean }) {
  const c = useCloud();
  const live = useLive();
  const [copied, setCopied] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { if (!live.on) return; const t = setInterval(() => tick((n) => n + 1), 5000); return () => clearInterval(t); }, [live.on]);
  const link = liveLink();

  const share = async () => {
    if (!link) return;
    const text = "Follow my flight live on Glidepath";
    try {
      if (navigator.share) { await navigator.share({ title: "Follow my flight", text, url: link }); return; }
    } catch { /* cancelled */ }
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };

  return (
    <section className={`glass share-live${compact ? " compact" : ""}`} aria-label="Follow my flight">
      <div className="between" style={{ gap: 12 }}>
        <div>
          <h2 className="h2" style={{ margin: 0 }}>{live.on ? <><span className="live-dot" />Sharing your flight</> : "Follow my flight"}</h2>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            {live.on ? `Anyone with the link can watch your plane on a map. Last update ${ago(live.sentAt)}.` : "Send friends a link to watch your plane move on a map, live. No app or account needed for them."}
          </p>
        </div>
      </div>
      {!c.active ? (
        <a className="btn" href="#/account">Sign in to share (free)</a>
      ) : live.on && link ? (
        <>
          <div className="share-link data" title={link}>{link.replace("https://", "")}</div>
          <div className="row wrap">
            <button className="btn primary" onClick={share}>{copied ? "Copied" : "Share link"}</button>
            <a className="btn" href={link} target="_blank" rel="noreferrer">Open</a>
            <button className="btn" onClick={() => void stopSharing()}>Stop sharing</button>
          </div>
        </>
      ) : (
        <button className="btn primary" disabled={live.busy} onClick={async () => { const u = await startSharing(c.profile?.display_name ?? null); if (u && navigator.clipboard) navigator.clipboard.writeText(u).catch(() => undefined); }}>
          {live.busy ? "Starting…" : "Start a live link"}
        </button>
      )}
      {live.error && <p className="form-err" style={{ margin: 0 }}>{live.error}</p>}
      {live.on && <p className="faint" style={{ fontSize: 12, margin: 0 }}>Only your position, speed, altitude and route are shared. It stops by itself 3 minutes after you land and park.</p>}
    </section>
  );
}
