/* Accounts on the website: sign in or create an account, then download the
   Windows Bridge. Only active when cloud.json names the account service
   (see cloud/cloudflare); otherwise the download stays direct. */
(async function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let api = null;
  try {
    const r = await fetch("cloud.json", { cache: "no-cache" });
    if (r.ok) { const j = await r.json(); if (j.api && /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(j.api)) api = j.api.replace(/\/$/, ""); }
  } catch (_) { /* not configured */ }
  if (!api) return;

  const KEY = "gp-site-session";
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) { return null; } },
    set(v) { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch (_) { /* blocked */ } },
  };
  // On Cloudflare Pages the site forwards /acct to the service (some networks block *.workers.dev).
  let bases = /\.pages\.dev$/.test(location.hostname) ? [location.origin + "/acct", api] : [api];
  async function call(path, method, body, token) {
    let r = null;
    for (const base of bases) {
      try {
        r = await fetch(base + path, { method: method || "GET", headers: Object.assign({}, body ? { "Content-Type": "application/json" } : {}, token ? { Authorization: "Bearer " + token } : {}), body: body ? JSON.stringify(body) : undefined });
        if (r.status === 404 && base !== api) { r = null; continue; }
        if (bases[0] !== base) bases = [base].concat(bases.filter((b) => b !== base));
        break;
      } catch (_) { r = null; }
    }
    if (!r) throw new Error("Couldn't reach the account service. Check your internet connection, then try again.");
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "The account service said " + r.status + ".");
    return j;
  }

  const dlg = $("signin"), btn = $("acct-btn"), form = $("si-form"), msg = $("si-msg"), go = $("si-go");
  let mode = "in";
  let session = store.get();
  if (session) { try { session.user = await call("/me", "GET", null, session.token); store.set(session); } catch (_) { session = null; store.set(null); } }

  function render() {
    const user = session && session.user;
    btn.hidden = false;
    const ms = $("menu-signin");
    if (ms) { ms.hidden = false; ms.textContent = user ? "Your account (" + (user.display_name || user.email.split("@")[0]) + ")" : "Sign in or create an account"; }
    btn.textContent = user ? (user.display_name || user.email.split("@")[0]) : "Sign in";
    $("si-title").textContent = user ? "You're signed in" : mode === "in" ? "Sign in to download" : "Create your free account";
    form.hidden = !!user;
    dlg.querySelector(".seg").hidden = !!user;
    $("si-done").hidden = !user;
    if (user) $("si-who").textContent = "Signed in as " + user.email + ". Your flights sync to this account in the app.";
    $("si-name-row").hidden = mode !== "up";
    go.textContent = mode === "in" ? "Sign in" : "Create account";
    $("si-pw").autocomplete = mode === "in" ? "current-password" : "new-password";
    dlg.querySelectorAll(".seg button").forEach((b) => { const on = b.dataset.mode === mode; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
  }
  const open = () => { msg.textContent = ""; render(); if (!dlg.open) dlg.showModal(); };

  dlg.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.mode; msg.textContent = ""; render(); }));
  btn.addEventListener("click", open);
  const ms = $("menu-signin");
  if (ms) ms.addEventListener("click", () => { const sheet = $("menu-sheet"), mb = $("menu-btn"); if (sheet) sheet.hidden = true; if (mb) { mb.classList.remove("on"); mb.setAttribute("aria-expanded", "false"); } open(); });
  document.querySelectorAll("[data-download]").forEach((a) => a.addEventListener("click", (e) => { if (session) return; e.preventDefault(); e.stopPropagation(); open(); }, true));
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("si-email").value.trim(), password = $("si-pw").value;
    msg.className = "si-msg"; msg.textContent = ""; go.disabled = true; go.textContent = "One moment…";
    try {
      if (mode === "up" && password.length < 8) throw new Error("Use a password of at least 8 characters.");
      const r = mode === "in"
        ? await call("/auth/login", "POST", { email, password })
        : await call("/auth/signup", "POST", { email, password, name: $("si-name").value.trim() });
      session = { token: r.token, user: r.user };
      store.set(session);
      render(); fp.hidden = true;
    } catch (err) {
      msg.className = "si-msg err"; msg.textContent = String(err.message || err);
    } finally {
      go.disabled = false; if (!session) go.textContent = mode === "in" ? "Sign in" : "Create account";
    }
  });

  // "Forgot password?": emails a link that opens the app's reset screen.
  const fp = document.createElement("button");
  fp.type = "button"; fp.className = "btn ghost si-forgot"; fp.textContent = "Forgot password?";
  go.insertAdjacentElement("afterend", fp);
  const syncFp = () => { fp.hidden = mode !== "in" || !!(session && session.user); };
  dlg.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", syncFp));
  fp.addEventListener("click", async () => {
    const email = $("si-email").value.trim();
    if (!email) { msg.className = "si-msg err"; msg.textContent = "Type your email above first, then tap Forgot password."; $("si-email").focus(); return; }
    fp.disabled = true; fp.textContent = "Sending…";
    try {
      const r = await call("/auth/forgot", "POST", { email });
      msg.className = "si-msg"; msg.textContent = r.message || "If there's an account with that email, a reset link is on its way.";
    } catch (err) { msg.className = "si-msg err"; msg.textContent = String(err.message || err); }
    finally { fp.disabled = false; fp.textContent = "Forgot password?"; }
  });
  syncFp();

  $("si-dl").addEventListener("click", async () => {
    const b = $("si-dl"); b.disabled = true; b.textContent = "Getting your download…";
    try {
      const r = await call("/download", "GET", null, session && session.token);
      location.href = r.url;
    } catch (err) {
      $("si-who").textContent = "Couldn't get the download just now: " + err.message + " Try again in a minute.";
    } finally { b.disabled = false; b.textContent = "Download for Windows"; }
  });
  $("si-out").addEventListener("click", async () => {
    try { if (session) await call("/auth/logout", "POST", {}, session.token); } catch (_) { /* already gone */ }
    session = null; store.set(null); mode = "in"; render(); fp.hidden = false;
  });

  render();
  if (location.hash === "#signed-in") { history.replaceState(null, "", location.pathname); open(); }
})();
