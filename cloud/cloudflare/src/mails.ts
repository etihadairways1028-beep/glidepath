/** The Glidepath emails, in one look: a card with a coloured header, a button and a short footer. */
const APP = "https://glidepath-ad9.pages.dev/app/";
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const SITE = "https://glidepath-ad9.pages.dev";
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const MONO = "'SF Mono',ui-monospace,Menlo,Consolas,'Courier New',monospace";
const BG = "#0C0F15", PANEL = "#151A24", EDGE = "#262D3B", INK = "#FFFFFF", SOFT = "#A9B3C9", FAINT = "#6E7891";

/** Logo bar at the top of every email, with a small airline-style label on the right. */
function header(label: string) {
  return `<tr><td style="padding:0 4px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td valign="middle"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td valign="middle"><img src="${SITE}/assets/email/icon.png" width="32" height="32" alt="" style="display:block;border-radius:8px;border:0;"></td><td valign="middle" style="padding-left:10px;font:800 15px ${FONT};letter-spacing:.14em;color:${INK};">GLIDEPATH</td></tr></table></td>
<td align="right" valign="middle" style="font:700 11px ${FONT};letter-spacing:.16em;color:${FAINT};">${esc(label)}</td></tr></table></td></tr>`;
}
function footer(foot?: string) {
  return `<tr><td align="center" style="padding:26px 18px 0;font:400 12px/1.65 ${FONT};color:${FAINT};">${esc(foot ?? "You can turn these emails off in Glidepath under Account.")}<br><a href="${SITE}" style="color:${FAINT};">glidepath-ad9.pages.dev</a> · Free for Microsoft Flight Simulator</td></tr>`;
}
function shell(inner: string) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head>
<body style="margin:0;padding:0;background-color:${BG};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${BG}" style="background-color:${BG};"><tr><td align="center" style="padding:30px 12px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">${inner}</table></td></tr></table></body></html>`;
}
function button(b?: { label: string; url: string }) {
  return b ? `<tr><td align="center" style="padding:24px 6px 2px;"><a href="${esc(b.url)}" style="display:inline-block;padding:15px 32px;border-radius:999px;background-color:#0A84FF;color:#FFFFFF;text-decoration:none;font:700 15px/1 ${FONT};">${esc(b.label)}</a></td></tr>` : "";
}

/**
 * Everyday messages look like an ACARS printout: the short text message airline crews
 * receive in the cockpit. Monospace, a header line, then the message.
 */
export function card(o: { kicker: string; title: string; lead?: string; rows?: Array<[string, string]>; button?: { label: string; url: string }; foot?: string; color?: string; big?: { value: string; unit?: string; label: string; badge?: string } }) {
  const accent = o.color ?? "#64D2FF";
  const now = new Date();
  const stamp = `${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}Z`;
  const rows = (o.rows ?? []).map(([k, v]) => `<tr><td style="padding:5px 0;font:600 12px ${MONO};letter-spacing:.06em;color:${FAINT};width:38%;" valign="top">${esc(k.toUpperCase())}</td><td style="padding:5px 0;font:600 14px ${MONO};color:${INK};">${esc(v)}</td></tr>`).join("");
  const big = o.big ? `<div style="padding-top:16px;font:700 12px ${MONO};letter-spacing:.06em;color:${FAINT};">${esc(o.big.label.toUpperCase())}</div><div style="font:800 40px/1.1 ${FONT};color:${INK};padding-top:2px;">${esc(o.big.value)}<span style="font:600 16px ${FONT};color:${SOFT};"> ${esc(o.big.unit ?? "")}</span>${o.big.badge ? ` <span style="font:800 16px ${FONT};color:${accent};">${esc(o.big.badge)}</span>` : ""}</div>` : "";
  const inner = `${header(o.kicker)}
<tr><td style="padding:0 4px;"><div style="background-color:${PANEL};border:1px solid ${EDGE};border-radius:18px;overflow:hidden;">
<div style="padding:12px 20px;border-bottom:1px dashed ${EDGE};font:700 11.5px ${MONO};letter-spacing:.12em;color:${accent};">ACARS · GLIDEPATH · ${stamp}</div>
<div style="padding:20px 20px 22px;">
<div style="font:800 26px/1.2 ${FONT};color:${INK};letter-spacing:-.3px;">${esc(o.title)}</div>
${o.lead ? `<div style="font:400 15.5px/1.6 ${FONT};color:${SOFT};padding-top:10px;">${esc(o.lead)}</div>` : ""}
${big}
${rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border-top:1px dashed ${EDGE};padding-top:8px;">${rows}</table>` : ""}
</div></div></td></tr>
${button(o.button)}${footer(o.foot)}`;
  const text = [o.title, o.lead ?? "", o.big ? `${o.big.label}: ${o.big.value} ${o.big.unit ?? ""}${o.big.badge ? ` (${o.big.badge})` : ""}` : "", ...(o.rows ?? []).map(([k, v]) => `${k}: ${v}`), o.button ? `${o.button.label}: ${o.button.url}` : "", "", o.foot ?? "You can turn these emails off in Glidepath under Account."].filter((x) => x !== "").join("\n");
  return { html: shell(inner), text };
}

/** The debrief as a boarding pass: route, a tear line, and a stub with the landing grade. */
function boardingPass(o: { dep: string; arr: string; depName: string; arrName: string; callsign: string; date: string; grade?: string; fpm?: string; verdict: string; fields: Array<[string, string]>; button: { label: string; url: string } }) {
  const cells = o.fields.map(([k, v]) => `<td width="25%" valign="top" style="padding:10px 4px 0 0;"><div style="font:700 10.5px ${FONT};letter-spacing:.12em;color:${FAINT};">${esc(k.toUpperCase())}</div><div style="font:700 15px ${MONO};color:${INK};padding-top:3px;">${esc(v)}</div></td>`);
  const fieldRows: string[] = [];
  for (let i = 0; i < cells.length; i += 4) fieldRows.push(`<tr>${cells.slice(i, i + 4).join("")}${'<td width="25%"></td>'.repeat(Math.max(0, 4 - cells.slice(i, i + 4).length))}</tr>`);
  const gradeColor = !o.grade ? SOFT : /^A/.test(o.grade) ? "#30D158" : /^B/.test(o.grade) ? "#64D2FF" : /^C/.test(o.grade) ? "#FFB340" : "#FF6B5E";
  const inner = `${header("FLIGHT DEBRIEF")}
<tr><td style="padding:0 4px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${PANEL};border:1px solid ${EDGE};border-radius:20px;">
<tr><td style="padding:22px 22px 6px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td valign="top" style="font:700 11px ${FONT};letter-spacing:.14em;color:#64D2FF;">${esc(o.callsign)}</td>
    <td align="right" valign="top" style="font:700 11px ${FONT};letter-spacing:.14em;color:${FAINT};">${esc(o.date)}</td>
  </tr></table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;"><tr>
    <td valign="top" width="40%"><div style="font:800 44px/1 ${FONT};letter-spacing:-1px;color:${INK};">${esc(o.dep)}</div><div style="font:500 13px/1.4 ${FONT};color:${SOFT};padding-top:6px;">${esc(o.depName)}</div></td>
    <td align="center" valign="top" width="20%" style="padding-top:12px;font:400 22px ${FONT};color:#64D2FF;">&#9992;&#xFE0E;</td>
    <td align="right" valign="top" width="40%"><div style="font:800 44px/1 ${FONT};letter-spacing:-1px;color:${INK};">${esc(o.arr)}</div><div style="font:500 13px/1.4 ${FONT};color:${SOFT};padding-top:6px;">${esc(o.arrName)}</div></td>
  </tr></table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">${fieldRows.join("")}</table>
</td></tr>
<tr><td style="padding:18px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  <td width="14" style="font-size:0;line-height:0;"><div style="width:14px;height:28px;border-radius:0 14px 14px 0;background-color:${BG};border:1px solid ${EDGE};border-left:0;"></div></td>
  <td style="border-top:2px dashed ${EDGE};font-size:0;line-height:0;">&nbsp;</td>
  <td width="14" style="font-size:0;line-height:0;"><div style="width:14px;height:28px;border-radius:14px 0 0 14px;background-color:${BG};border:1px solid ${EDGE};border-right:0;"></div></td>
</tr></table></td></tr>
<tr><td style="padding:12px 22px 22px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  <td valign="middle"><div style="font:700 10.5px ${FONT};letter-spacing:.12em;color:${FAINT};">TOUCHDOWN</div><div style="font:800 34px/1.1 ${FONT};color:${INK};padding-top:3px;">${esc(o.fpm ?? "—")}<span style="font:600 14px ${FONT};color:${SOFT};"> fpm</span></div><div style="font:400 14px/1.5 ${FONT};color:${SOFT};padding-top:6px;">${esc(o.verdict)}</div></td>
  ${o.grade ? `<td align="right" valign="middle" width="92"><div style="width:76px;height:76px;border-radius:38px;border:4px solid ${gradeColor};text-align:center;font:900 28px/76px ${FONT};color:${gradeColor};">${esc(o.grade)}</div></td>` : ""}
</tr></table></td></tr>
</table></td></tr>
${button(o.button)}${footer()}`;
  return shell(inner);
}

const dur = (ms: number | null | undefined) => { if (!ms || ms < 0) return "—"; const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m} min`; };
const span = (a?: number | null, b?: number | null) => (a && b ? b - a : null);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debriefMail(f: any) {
  const dep = f.departureIcao ?? "—", arr = f.arrivalIcao ?? "—";
  const l = Array.isArray(f.landings) ? f.landings[0] : null;
  const fpm = l && Number.isFinite(l.touchdownVsFpm) ? Math.round(Math.abs(l.touchdownVsFpm)) : null;
  const fuel = f.fuelStartKg != null && f.fuelEndKg != null && f.fuelStartKg > f.fuelEndKg ? `${Math.round(f.fuelStartKg - f.fuelEndKg).toLocaleString("en-US")} kg` : "—";
  const rows: Array<[string, string]> = [
    ["Route", `${dep} → ${arr}`],
    ["Aircraft", f.aircraft?.title ?? f.aircraft?.icaoType ?? "—"],
    ["Block time", dur(span(f.offBlockAt, f.onBlockAt))],
    ["Air time", dur(span(f.wheelsUpAt, f.wheelsDownAt))],
    ["Distance", f.distanceNm ? `${Math.round(f.distanceNm).toLocaleString("en-US")} nm` : "—"],
    ["Fuel used", fuel],
  ];
  if (l?.runway?.ident) rows.push(["Runway", String(l.runway.ident)]);
  if (l && Number.isFinite(l.peakG)) rows.push(["Peak G", `${Number(l.peakG).toFixed(2)} G`]);
  const when = f.offBlockAt ?? f.startedAt;
  const date = when ? new Date(when).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).toUpperCase() : "";
  const fields: Array<[string, string]> = rows.filter(([k]) => k !== "Route");
  const verdict = l?.verdict ? String(l.verdict) : "Your flight is saved to your logbook.";
  const url = `${APP}#/review/${encodeURIComponent(f.id)}`;
  const html = boardingPass({ dep, arr, depName: f.departureName ?? "", arrName: f.arrivalName ?? "", callsign: (f.callsign ?? f.plan?.callsign ?? "GLIDEPATH").toString().toUpperCase(), date, grade: l?.grade ? String(l.grade) : undefined, fpm: fpm !== null ? String(fpm) : undefined, verdict, fields, button: { label: "See your full flight review", url } });
  const text = [`${dep} → ${arr}`, verdict, fpm !== null ? `Touchdown: ${fpm} fpm${l?.grade ? ` (${l.grade})` : ""}` : "", ...fields.map(([k, v]) => `${k}: ${v}`), `Your full review: ${url}`, "", "You can turn these emails off in Glidepath under Account."].filter(Boolean).join("\n");
  return { subject: `Your debrief: ${dep} → ${arr}${l?.grade ? ` (${l.grade})` : ""}`, html, text };
}

export function inflightMail(kind: string, title: string, body: string) {
  return { subject: `Glidepath: ${title}`, ...card({ kicker: kind === "tod" ? "TOP OF DESCENT" : kind === "arrival" ? "ARRIVAL" : "YOUR FLIGHT", title, lead: body, button: { label: "Open Glidepath", url: APP }, color: kind === "tod" ? "#FFB340" : "#0A84FF" }) };
}

export function resetMail(link: string) {
  return { subject: "Reset your Glidepath password", ...card({ kicker: "ACCOUNT", title: "Reset your password", lead: "Someone asked to reset the password for your Glidepath account. If it was you, tap the button. The link works for 1 hour.", button: { label: "Choose a new password", url: link }, foot: "If you didn't ask for this, ignore this email. Your password stays the same." }) };
}

export function signinMail(device: string, when: string) {
  return { subject: "New sign-in to Glidepath", ...card({ kicker: "ACCOUNT", title: "New sign-in", lead: `Your Glidepath account was just signed in on ${device}.`, rows: [["When", when], ["Device", device]], button: { label: "Not you? Reset your password", url: `${APP}#/forgot` }, foot: "If this was you, there's nothing to do. Turn these alerts off in Glidepath under Account." }) };
}

/** A readable device name from a browser's user agent. */
export function deviceName(ua: string): string {
  const os = /iPad/.test(ua) ? "an iPad" : /iPhone/.test(ua) ? "an iPhone" : /Android/.test(ua) ? "an Android device" : /Windows/.test(ua) ? "a Windows PC" : /Macintosh/.test(ua) ? "a Mac (or iPad)" : /Linux/.test(ua) ? "a Linux computer" : "a device";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "a browser";
  return `${os} (${br})`;
}

export function welcomeMail(name: string | null) {
  const hi = name ? `Hi ${name.slice(0, 40)}, your account is ready.` : "Your account is ready.";
  return { subject: "Welcome to Glidepath", ...card({ kicker: "WELCOME", title: "Welcome aboard.", lead: `${hi} Your logbook now follows you to every device you sign in on.`, rows: [["Step 1", "Install the Bridge on your sim PC"], ["Step 2", "Type the 6-digit code on your iPad"], ["Step 3", "Fly. Your debrief waits at the gate"], ["Cost", "Free. All of it."]], button: { label: "Open Glidepath", url: `${SITE}/app/` }, foot: "One short email on the 1st of each month about your flying. Turn it off any time in the app under Account." }) };
}
