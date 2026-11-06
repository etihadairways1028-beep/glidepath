/* Accounts on the website: sign in or create an account, then download the
   Windows Bridge through a short-lived link. Only active when cloud.json has
   the account service's public details; otherwise the download stays direct. */
(async function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let conf = null;
  try {
    const r = await fetch("cloud.json", { cache: "no-cache" });
    if (r.ok) { const j = await r.json(); if (j.supabaseUrl && j.supabaseKey) conf = j; }
  } catch (_) { /* not configured */ }
  if (!conf) return;

  const loaded = await new Promise((res) => { const s = document.createElement("script"); s.src = "assets/supabase.js"; s.onload = () => res(true); s.onerror = () => res(false); document.head.appendChild(s); });
  if (!loaded || !window.supabase) return;
  const sb = window.supabase.createClient(conf.supabaseUrl.replace(/\/$/, ""), conf.supabaseKey, { auth: { storageKey: "gp-site-auth", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

  const dlg = $("signin"), btn = $("acct-btn"), form = $("si-form"), msg = $("si-msg"), go = $("si-go");
  let mode = "in";
  let user = (await sb.auth.getSession()).data.session?.user ?? null;

  const friendly = (m) =>
    /invalid login/i.test(m) ? "That email and password don't match an account." :
    /not confirmed/i.test(m) ? "Confirm your email first: we sent you a link when you signed up." :
    /already registered|already exists/i.test(m) ? "There's already an account with that email. Sign in instead." :
    /password/i.test(m) && /least/i.test(m) ? "Use a password of at least 8 characters." :
    /rate limit/i.test(m) ? "Too many tries. Wait a minute and try again." : m;

  function render() {
    btn.hidden = false;
    btn.textContent = user ? (user.user_metadata?.display_name || user.email.split("@")[0]) : "Sign in";
    $("si-title").textContent = user ? "You're signed in" : mode === "in" ? "Sign in to download" : "Create your account";
    form.hidden = !!user;
    dlg.querySelector(".seg").hidden = !!user;
    $("si-done").hidden = !user;
    if (user) $("si-who").textContent = "Signed in as " + user.email + ". The download link is made just for you and lasts ten minutes.";
    $("si-name-row").hidden = mode !== "up";
    go.textContent = mode === "in" ? "Sign in" : "Create account";
    $("si-pw").autocomplete = mode === "in" ? "current-password" : "new-password";
    dlg.querySelectorAll(".seg button").forEach((b) => { const on = b.dataset.mode === mode; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
  }
  const open = () => { msg.textContent = ""; render(); if (!dlg.open) dlg.showModal(); };

  dlg.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.mode; msg.textContent = ""; render(); }));
  btn.addEventListener("click", open);
  document.querySelectorAll("[data-download]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); open(); }, true));
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("si-email").value.trim(), password = $("si-pw").value;
    msg.className = "si-msg"; msg.textContent = ""; go.disabled = true; go.textContent = "One moment…";
    try {
      if (mode === "in") {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        user = data.user;
      } else {
        if (password.length < 8) throw new Error("Use a password of at least 8 characters.");
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { display_name: $("si-name").value.trim() || null }, emailRedirectTo: location.origin + location.pathname + "#signed-in" } });
        if (error) throw error;
        if (!data.session) { mode = "in"; render(); msg.className = "si-msg ok"; msg.textContent = "Nearly there. We've emailed " + email + " a link: tap it, then sign in here."; return; }
        user = data.user;
      }
      render();
    } catch (err) {
      msg.className = "si-msg err"; msg.textContent = friendly(String(err.message || err));
    } finally {
      go.disabled = false; if (!user) go.textContent = mode === "in" ? "Sign in" : "Create account";
    }
  });

  $("si-dl").addEventListener("click", async () => {
    const b = $("si-dl"); b.disabled = true; b.textContent = "Getting your link…";
    const { data, error } = await sb.functions.invoke("download", { body: {} });
    b.disabled = false; b.textContent = "Download for Windows";
    if (error || !data?.url) { $("si-who").textContent = "Couldn't get the download just now: " + friendly(error?.message || "no link returned") + " Try again in a minute."; return; }
    location.href = data.url;
  });
  $("si-out").addEventListener("click", async () => { await sb.auth.signOut(); user = null; mode = "in"; render(); });
  sb.auth.onAuthStateChange((_e, s) => { user = s?.user ?? null; render(); });

  render();
  if (location.hash === "#signed-in") { history.replaceState(null, "", location.pathname); open(); }
})();
