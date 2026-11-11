/** Account: sign in (several accounts per device), monthly brief, saved PCs, flight sync. */
import { useEffect, useState, type ReactElement } from "react";
import { Icon, Notice, Section } from "../components/ui";
import { deleteAccount, forgotPassword, resetPassword, setEmailPrefs, forgetBridge, savedBridges, sendBriefPreview, setMonthlyEmail, signIn, signOut, signUp, switchAccount, useCloud, type SavedBridge } from "../data/cloud";

export function Account() {
  const c = useCloud();
  const [adding, setAdding] = useState(false);
  const active = c.accounts.find((a) => a.slot === c.active) ?? null;

  if (c.status === "loading") return <div className="stack"><h1 className="title">Account</h1><div className="skeleton" style={{ height: 160 }} /></div>;
  if (c.status === "off") {
    return (
      <div className="stack">
        <h1 className="title">Account</h1>
        <section className="glass pad">
          <div className="h2" style={{ margin: 0 }}>Accounts aren't switched on yet</div>
          <p className="muted" style={{ margin: "8px 0 0", maxWidth: "60ch" }}>Once they are, you'll sign in here to keep your logbook on every device, find your PC automatically, and get a monthly email about your flying. Until then, every flight is still saved on your PC by the Bridge.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="between wrap">
        <h1 className="title">Account</h1>
        {c.accounts.length > 0 && !adding && <button className="btn small" onClick={() => setAdding(true)}><span style={{ width: 16, height: 16 }}>{Icon.plus()}</span>Add account</button>}
      </div>

      {(c.accounts.length === 0 || adding) && <SignInCard onDone={() => setAdding(false)} canCancel={c.accounts.length > 0} />}

      {c.accounts.length > 0 && (
        <div className="grid cols-2">
          <Section title="Signed in on this device">
            <div className="acct-list">
              {c.accounts.map((a) => (
                <div key={a.slot} className={`acct${a.slot === c.active ? " on" : ""}`}>
                  <span className="av" aria-hidden="true">{(a.name ?? a.email).slice(0, 1).toUpperCase()}</span>
                  <span className="acct-t"><b>{a.name ?? a.email.split("@")[0]}</b><span>{a.email}</span></span>
                  {a.slot === c.active ? <span className="pill">In use</span> : <button className="btn small" onClick={() => switchAccount(a.slot)}>Switch</button>}
                  <button className="btn small ghost" onClick={() => void signOut(a.slot)} aria-label={`Sign out ${a.email}`}>Sign out</button>
                </div>
              ))}
            </div>
            <p className="faint" style={{ fontSize: 12.5, margin: "10px 0 0" }}>Flights sync to the account in use. {c.lastSync ? `Last synced ${new Date(c.lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.` : "Connect your Bridge to sync."}</p>
            {c.syncError && <Notice>{c.syncError}</Notice>}
          </Section>
          {active && <MonthlyBrief monthly={c.profile?.monthly_email ?? true} email={active.email} />}
          {active && <EmailSettings />}
          {active && <SavedPcs key={active.slot} />}
          {active && <DeleteAccount email={active.email} />}
        </div>
      )}
    </div>
  );
}

function DeleteAccount({ email }: { email: string }) {
  const [sure, setSure] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Section title="Delete account">
      <p className="muted" style={{ margin: 0 }}>Removes {email}, its synced flights and saved PCs from Glidepath's servers. Flights on your PC stay there.</p>
      {sure ? (
        <div className="row wrap" style={{ marginTop: 12 }}>
          <button className="btn small danger" onClick={async () => setErr(await deleteAccount())}>Yes, delete it for good</button>
          <button className="btn small" onClick={() => setSure(false)}>Keep my account</button>
        </div>
      ) : <button className="btn small" style={{ marginTop: 12 }} onClick={() => setSure(true)}>Delete account…</button>}
      {err && <Notice>{err}</Notice>}
    </Section>
  );
}

function SignInCard({ onDone, canCancel }: { onDone: () => void; canCancel: boolean }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setMsg(null);
    if (mode === "in") {
      const err = await signIn(email, pw);
      setBusy(false);
      if (err) setMsg({ kind: "err", text: err }); else onDone();
    } else {
      if (pw.length < 8) { setBusy(false); setMsg({ kind: "err", text: "Use a password of at least 8 characters." }); return; }
      const r = await signUp(name, email, pw);
      setBusy(false);
      if (r.error) setMsg({ kind: "err", text: r.error });
      else if (r.confirm) { setMsg({ kind: "ok", text: `Nearly there. We've emailed ${email.trim()} a link: tap it, then sign in here.` }); setMode("in"); }
      else onDone();
    }
  };

  return (
    <section className="glass strong signin">
      <div className="signin-copy">
        <h2 className="onboard-h">{mode === "in" ? "Sign in to Glidepath" : "Create your account"}</h2>
        <p className="muted" style={{ margin: "10px 0 0" }}>Your logbook on every device, your PC found on its own, and a monthly email about your flying. You can sign in to as many accounts as you like.</p>
      </div>
      <form className="signin-form" onSubmit={(e) => void submit(e)}>
        <div className="seg" role="tablist" aria-label="Sign in or create account">
          <button type="button" role="tab" aria-selected={mode === "in"} className={mode === "in" ? "on" : ""} onClick={() => { setMode("in"); setMsg(null); }}>Sign in</button>
          <button type="button" role="tab" aria-selected={mode === "up"} className={mode === "up" ? "on" : ""} onClick={() => { setMode("up"); setMsg(null); }}>Create account</button>
        </div>
        {mode === "up" && <label className="field"><span>Your name</span><input className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="So the monthly email can say hi" /></label>}
        <label className="field"><span>Email</span><input className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field"><span>Password</span><input className="input" type="password" required minLength={mode === "up" ? 8 : undefined} autoComplete={mode === "in" ? "current-password" : "new-password"} value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        {msg && <p className={msg.kind === "err" ? "form-err" : "form-ok"} role="status">{msg.text}</p>}
        <div className="row wrap">
          <button className="btn primary" type="submit" disabled={busy}>{busy ? "One moment…" : mode === "in" ? "Sign in" : "Create account"}</button>
          {mode === "in" && <a className="btn ghost" href="#/forgot">Forgot password?</a>}
          {canCancel && <button className="btn" type="button" onClick={onDone}>Cancel</button>}
        </div>
      </form>
    </section>
  );
}

function MonthlyBrief({ monthly, email }: { monthly: boolean; email: string }) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Section title="Monthly brief">
      <label className="between" style={{ padding: "4px 0" }}>
        <span>Email me on the 1st of each month</span>
        <input className="switch" type="checkbox" checked={monthly} onChange={(e) => { void setMonthlyEmail(e.target.checked).then((err) => setNote(err)); }} />
      </label>
      <p className="muted" style={{ fontSize: 14, margin: "8px 0 0" }}>A short summary sent to {email}: hours flown, your landings, your best flight, and one thing to work on.</p>
      <div className="row wrap" style={{ marginTop: 12 }}>
        <button className="btn" disabled={busy} onClick={() => { setBusy(true); void sendBriefPreview().then((m) => { setNote(m); setBusy(false); }); }}>{busy ? "Sending…" : "Email me this month so far"}</button>
      </div>
      {note && <p className="faint" style={{ fontSize: 13, margin: "10px 0 0" }}>{note}</p>}
    </Section>
  );
}

function SavedPcs() {
  const [list, setList] = useState<SavedBridge[] | null>(null);
  useEffect(() => { void savedBridges().then(setList); }, []);
  return (
    <Section title="Your PCs">
      {list === null ? <div className="skeleton" style={{ height: 60 }} /> : list.length === 0 ? (
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>Connect to your PC once (type the code from the Bridge window) while signed in, and it's saved here. After that, any device signed in to this account finds it on your Wi-Fi.</p>
      ) : (
        <div className="cg-rows" style={{ marginTop: 0 }}>
          {list.map((b) => (
            <div key={b.bridge_id}>
              <span><b style={{ color: "var(--ink)" }}>{b.name ?? "Bridge"}</b><br /><small className="data">{b.addresses.join(", ") || "no address yet"}, port {b.port}</small></span>
              <span className="row" style={{ gap: 6 }}>
                {b.addresses[0] && <a className="btn small" href={`http://${b.addresses[0]}:${b.port}/app/#token=${encodeURIComponent(b.token)}`}>Open</a>}
                <button className="btn small ghost" onClick={() => void forgetBridge(b.bridge_id).then(() => savedBridges().then(setList))}>Forget</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/** On Home before connecting: the account's PCs, one tap to open the app on your Wi-Fi. */
export function YourPcs() {
  const c = useCloud();
  const [list, setList] = useState<SavedBridge[]>([]);
  useEffect(() => { if (c.status === "ready" && c.active) void savedBridges().then(setList); else setList([]); }, [c.status, c.active]);
  if (!list.length) return null;
  return (
    <section className="glass pad">
      <div className="h2" style={{ margin: 0 }}>Your PCs</div>
      <p className="muted" style={{ margin: "6px 0 12px", fontSize: 14 }}>Start the Bridge on your PC, then open it here. On iPad, add that page to your Home Screen once.</p>
      <div className="cg-rows" style={{ marginTop: 0 }}>
        {list.map((b) => (
          <div key={b.bridge_id}>
            <span><b style={{ color: "var(--ink)" }}>{b.name ?? "Bridge"}</b><br /><small className="data">{b.addresses[0] ?? "address unknown"}</small></span>
            {b.addresses[0] && <a className="btn small primary" href={`http://${b.addresses[0]}:${b.port}/app/#token=${encodeURIComponent(b.token)}`}>Open</a>}
          </div>
        ))}
      </div>
    </section>
  );
}

const WELCOME_KEY = "glidepath.welcomed";
/** Skipped inside the website's live preview and for "try the app" demo links. */
export const hasBeenWelcomed = (): boolean => {
  if (window.self !== window.top || /[?&]demo=1/.test(location.search)) return true;
  try { return localStorage.getItem(WELCOME_KEY) === "1"; } catch { return true; }
};

/** First open on a device: sign in or create an account, or carry on without one. */
export function Welcome({ onDone }: { onDone: () => void }) {
  const c = useCloud();
  const finish = () => { try { localStorage.setItem(WELCOME_KEY, "1"); } catch { /* ignore */ } onDone(); };
  useEffect(() => { if (c.accounts.length > 0) finish(); }, [c.accounts.length]);
  const feats: Array<[string, string, string, () => ReactElement]> = [
    ["ic-map", "Your flight, live", "Map, timings and network traffic on your iPad, phone or laptop.", Icon.map],
    ["ic-remote", "Fly from the sofa", "Autopilot, lights, engines and a live camera from the sim PC.", Icon.remote],
    ["ic-flight", "Messages that matter", "Top of descent in 10 minutes, ATC online, and your debrief.", Icon.flight],
    ["ic-logbook", "Every flight kept", "Logbook, replays, badges and landing grades. Free, all of it.", Icon.book],
  ];
  return (
    <div className="welcome v1">
      <div className="welcome-grid">
        <div className="welcome-hero">
          <img className="welcome-logo" src="icons/icon-192.png" alt="" width={84} height={84} />
          <h1 className="welcome-title">Your flight.<br />Off the desk.</h1>
          <p className="muted welcome-sub">The free companion for Microsoft Flight Simulator 2020 and 2024.</p>
          <ul className="welcome-feats">
            {feats.map(([ic, t, d, I]) => (
              <li key={t} className="glass"><span className={`nav-ic ${ic}`} aria-hidden="true"><I /></span><span><b>{t}</b><span>{d}</span></span></li>
            ))}
          </ul>
        </div>
        <div className="welcome-card">
          {c.status === "loading" && <div className="skeleton" style={{ height: 300, borderRadius: 28 }} />}
          {c.status === "off" && (
            <section className="glass pad">
              <div className="h2" style={{ margin: 0 }}>Sign-in isn't available here</div>
              <p className="muted" style={{ margin: "8px 0 0" }}>You can use everything without an account: your flights are saved on your PC by the Bridge. Sign in later from Account.</p>
            </section>
          )}
          {c.status !== "loading" && c.status !== "off" && <SignInCard onDone={finish} canCancel={false} />}
          <button className="btn welcome-skip" onClick={finish}>{c.status === "off" ? "Get started" : "Continue without an account"}</button>
          <p className="faint welcome-fine">No ads, no subscription. Live flight data stays on your own network.</p>
        </div>
      </div>
    </div>
  );
}

export function EmailSettings() {
  const c = useCloud();
  const p = c.profile?.email_prefs ?? { debrief: true, inflight: true, signin: true };
  const [note, setNote] = useState<string | null>(null);
  const rows: Array<[keyof typeof p, string, string]> = [
    ["debrief", "Flight debrief", "After each flight: route, block and air time, fuel, and your landing grade, with a link to the full debrief."],
    ["inflight", "Top of descent and arrival", "An email 10 minutes before top of descent and 10 minutes before landing, handy when you step away from the sim."],
    ["signin", "New sign-in alerts", "Tells you when your account signs in on a new device."],
  ];
  return (
    <Section title="Emails">
      {rows.map(([k, t, d]) => (
        <label key={k} className="between" style={{ padding: "8px 0", gap: 14, alignItems: "flex-start" }}>
          <span><b style={{ color: "var(--ink)" }}>{t}</b><br /><small className="muted">{d}</small></span>
          <input className="switch" type="checkbox" checked={p[k]} onChange={(e) => { void setEmailPrefs({ [k]: e.target.checked }).then(setNote); }} />
        </label>
      ))}
      <p className="faint" style={{ fontSize: 12.5, margin: "8px 0 0" }}>Emails come from Glidepath's Gmail. If one doesn't show up, check Spam and mark it "Not spam" once.</p>
      {note && <Notice>{note}</Notice>}
    </Section>
  );
}

/** "Forgot password?": emails a reset link. */
export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="stack">
      <h1 className="title">Forgot password</h1>
      <section className="glass strong signin">
        <div className="signin-copy">
          <h2 className="onboard-h">Reset your password</h2>
          <p className="muted" style={{ margin: "10px 0 0" }}>Type the email you signed up with. We'll send a link to choose a new password. It works for 1 hour.</p>
        </div>
        <form className="signin-form" onSubmit={(e) => { e.preventDefault(); if (busy) return; setBusy(true); void forgotPassword(email).then((r) => { setMsg(r); setBusy(false); }); }}>
          <label className="field"><span>Email</span><input className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          {msg && <p className={msg.ok ? "form-ok" : "form-err"} role="status">{msg.text}</p>}
          <div className="row wrap">
            <button className="btn primary" type="submit" disabled={busy}>{busy ? "Sending…" : "Email me a reset link"}</button>
            <a className="btn" href="#/account">Back to sign in</a>
          </div>
        </form>
      </section>
    </div>
  );
}

/** Opened from the reset email: choose a new password. */
export function ResetPassword({ token }: { token?: string }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const valid = !!token && /^[a-f0-9]{64}$/.test(token);
  return (
    <div className="stack">
      <h1 className="title">New password</h1>
      <section className="glass strong signin">
        <div className="signin-copy">
          <h2 className="onboard-h">{done ? "Password changed" : "Choose a new password"}</h2>
          <p className="muted" style={{ margin: "10px 0 0" }}>{done ? "You're signed in on this device. Other devices were signed out, so sign in there with the new password." : "At least 8 characters. Every other device will be signed out."}</p>
        </div>
        {done ? (
          <div className="signin-form"><div className="row wrap"><a className="btn primary" href="#/home">Open Glidepath</a><a className="btn" href="#/account">Account</a></div></div>
        ) : !valid ? (
          <div className="signin-form"><p className="form-err">That reset link isn't complete. Open it straight from the email, or ask for a new one.</p><div className="row wrap"><a className="btn primary" href="#/forgot">Send a new link</a></div></div>
        ) : (
          <form className="signin-form" onSubmit={(e) => {
            e.preventDefault(); if (busy) return;
            if (pw.length < 8) { setErr("Use a password of at least 8 characters."); return; }
            if (pw !== pw2) { setErr("The two passwords don't match."); return; }
            setBusy(true); setErr(null);
            void resetPassword(token!, pw).then((e2) => { setBusy(false); if (e2) setErr(e2); else { setDone(true); history.replaceState(null, "", "#/account"); } });
          }}>
            <label className="field"><span>New password</span><input className="input" type="password" required minLength={8} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
            <label className="field"><span>Type it again</span><input className="input" type="password" required minLength={8} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
            {err && <p className="form-err" role="status">{err}</p>}
            <div className="row wrap"><button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save new password"}</button></div>
            {err && /expired|used|valid/.test(err) && <a className="btn ghost" href="#/forgot">Send a new link</a>}
          </form>
        )}
      </section>
    </div>
  );
}
