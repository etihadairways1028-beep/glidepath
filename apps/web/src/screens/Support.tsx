/** Support Centre: quick answers for the common problems, and a direct message to Glidepath Support. */
import { useState } from "react";
import { sendSupport, useCloud } from "../data/cloud";
import { useApp } from "../data/store";
import { APP_VERSION } from "../components/WhatsNew";

const TOPICS: Array<{ id: string; icon: string; title: string; sub: string; steps: string[] }> = [
  { id: "connect", icon: "📱", title: "My iPad or phone won't connect", sub: "Pairing, codes and Connect anywhere", steps: [
    "Easiest: sign in to the same free Glidepath account on the Bridge page on your PC and here. They connect by themselves on any network, every time the Bridge opens.",
    "With a code: your device and PC must be on the same Wi-Fi. The 6-digit code on the Bridge page stays the same every time it starts, and once paired this device reconnects by itself.",
    "If Windows asked about the firewall when you installed, choose Allow on private networks.",
    "Public or work Wi-Fi often blocks devices from seeing each other: sign in to use Connect anywhere instead." ] },
  { id: "sim", icon: "🖥️", title: "The Bridge doesn't see the sim", sub: "MSFS 2020 and 2024", steps: [
    "Start Microsoft Flight Simulator and load into a flight; the main menu doesn't send data.",
    "Keep the Bridge running while you fly. Nothing goes in the Community folder.",
    "Still nothing? Run Test MSFS connection from the Start menu (Glidepath folder) and send us the result." ] },
  { id: "install", icon: "⬇️", title: "Installing or updating", sub: "Windows warnings, updates", steps: [
    "“Windows protected your PC”: choose More info, then Run anyway. It appears for new apps that aren't code-signed yet.",
    "Updates: the Bridge page shows Update when a new version is out. Windows asks once, then the Bridge restarts by itself." ] },
  { id: "notifications", icon: "🔔", title: "Notifications", sub: "Lock screen alerts and reminders", steps: [
    "Settings › Lock screen notifications: turn them on, then pick checklist reminders, top of descent, landing and review.",
    "iPhone and iPad: add Glidepath to the Home Screen first (Safari › Share › Add to Home Screen) and open it from there.",
    "The Bridge on your PC must be signed in to the same account." ] },
  { id: "account", icon: "👤", title: "Account and sign-in", sub: "Passwords, email, deleting", steps: [
    "Forgot your password? Use Forgot password on the sign-in screen.",
    "No emails? Check spam, and the address on your account.",
    "To delete your account and everything with it: Account › Delete account." ] },
  { id: "bug", icon: "🛠️", title: "Something isn't working", sub: "Tell us what happened", steps: [
    "Say what you expected, what happened instead, and where (screen, sim, aircraft).",
    "For the Bridge, the newest log helps: Start menu › Glidepath › Bridge logs." ] },
  { id: "idea", icon: "💡", title: "An idea for Glidepath", sub: "What should we build next?", steps: ["Tell us what would make your flights better, and why. Every idea is read."] },
];

export function Support() {
  const cloud = useCloud();
  const status = useApp((s) => s.status);
  const mode = useApp((s) => s.mode);
  const me = cloud.accounts.find((a) => a.slot === cloud.active);
  const [open, setOpen] = useState<string | null>(null);
  const [topic, setTopic] = useState("connect");
  const [email, setEmail] = useState(me?.email ?? "");
  const [message, setMessage] = useState("");
  const [diag, setDiag] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ref, setRef] = useState<string | null>(null);
  const t = TOPICS.find((x) => x.id === open);
  const send = async () => {
    setErr(null);
    const mail = (me?.email ?? email).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) { setErr("Add the email address you'd like the answer sent to."); return; }
    if (message.trim().length < 10) { setErr("Tell us a little more, so we can help."); return; }
    const meta: Record<string, string> = { page: "app", app: APP_VERSION };
    if (diag) Object.assign(meta, { device: navigator.userAgent.slice(0, 180), screen: `${screen.width}x${screen.height}`, connection: mode, bridge: status?.bridgeVersion ?? "none", sim: status?.simulator?.name ?? "none" });
    setBusy(true);
    try { setRef(await sendSupport({ topic, email: mail, message: message.trim(), meta })); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="stack support">
      <div><h1 className="title">Support</h1><p className="muted" style={{ margin: "4px 0 0" }}>Pick what's going on for the quick fix, or write to us: a person answers by email.</p></div>
      <div className="sup-topics">
        {TOPICS.map((x) => (
          <button key={x.id} className={`sup-topic glass${open === x.id ? " on" : ""}`} aria-expanded={open === x.id} onClick={() => { setOpen(open === x.id ? null : x.id); setTopic(x.id); }}>
            <span className="ic" aria-hidden="true">{x.icon}</span><b>{x.title}</b><span>{x.sub}</span>
          </button>
        ))}
      </div>
      {t && (
        <div className="glass sup-answer">
          <h2 className="h2" style={{ margin: "0 0 8px" }}>{t.title}</h2>
          <ol>{t.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          <button className="btn small" onClick={() => document.getElementById("sup-form")?.scrollIntoView({ behavior: "smooth" })}>Still stuck? Write to us</button>
        </div>
      )}
      <section className="glass sup-form" id="sup-form" aria-label="Write to Glidepath Support">
        {ref ? (
          <div className="sup-done"><b>Sent. Your reference is {ref}.</b><p className="muted">A copy is on its way to your inbox, and we'll answer there.</p><button className="btn small" onClick={() => { setRef(null); setMessage(""); }}>Write another</button></div>
        ) : (<>
          <h2 className="h2" style={{ margin: 0 }}>Write to Glidepath Support</h2>
          <p className="muted" style={{ margin: "4px 0 12px" }}>You'll get a reference straight away and our answer by email.</p>
          {!me && <label className="sup-f">Your email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" /></label>}
          {me && <p className="faint" style={{ margin: "0 0 10px", fontSize: 13 }}>We'll answer at {me.email}.</p>}
          <label className="sup-f">About<select value={topic} onChange={(e) => setTopic(e.target.value)}>{TOPICS.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}<option value="other">Something else</option></select></label>
          <label className="sup-f">Message<textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What happened, and what were you doing at the time?" rows={6} /></label>
          <label className="between" style={{ padding: "6px 0" }}><span>Include app, Bridge and device details<br /><span className="faint" style={{ fontSize: 12.5 }}>Helps us fix things faster</span></span><input className="switch" type="checkbox" checked={diag} onChange={(e) => setDiag(e.target.checked)} /></label>
          {err && <p className="err-text">{err}</p>}
          <button className={`btn primary${busy ? " busy" : ""}`} disabled={busy} onClick={() => void send()}>Send to Support</button>
        </>)}
      </section>
    </div>
  );
}
