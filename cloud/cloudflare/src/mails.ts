/** The Glidepath emails, in one look: a card with a coloured header, a button and a short footer. */
const APP = "https://glidepath-ad9.pages.dev/app/";
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const SITE = "https://glidepath-ad9.pages.dev";
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * The Glidepath email look: a dark aurora background with clear "glass" panels and bright
 * edges, like the app. Built from tables and inline styles so Gmail, Apple Mail and Outlook
 * all show it; where a mail app drops the background image, the dark colour stays.
 */
export function card(o: { kicker: string; title: string; lead?: string; rows?: Array<[string, string]>; button?: { label: string; url: string }; foot?: string; color?: string; big?: { value: string; unit?: string; label: string; badge?: string } }) {
  const accent = o.color ?? "#0A84FF";
  const glass = "background-color:rgba(255,255,255,0.09);border:1px solid rgba(255,255,255,0.28);border-top-color:rgba(255,255,255,0.6);border-left-color:rgba(255,255,255,0.45);";
  const tiles = (o.rows ?? []).map(([k, v]) => `<td width="50%" valign="top" style="padding:6px;"><div style="${glass}border-radius:18px;padding:14px 16px;"><div style="font:600 11px/1.2 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:#AEB8D6;">${esc(k)}</div><div style="font:700 17px/1.35 ${FONT};color:#FFFFFF;padding-top:4px;">${esc(v)}</div></div></td>`);
  const tileRows: string[] = [];
  for (let i = 0; i < tiles.length; i += 2) tileRows.push(`<tr>${tiles[i]}${tiles[i + 1] ?? '<td width="50%"></td>'}</tr>`);
  const big = o.big ? `<tr><td colspan="2" style="padding:6px 6px 6px;"><div style="${glass}border-radius:22px;padding:18px 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td valign="middle"><div style="font:600 11px/1.2 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:#AEB8D6;">${esc(o.big.label)}</div><div style="font:800 46px/1.05 ${FONT};color:#FFFFFF;padding-top:6px;">${esc(o.big.value)}<span style="font:600 18px ${FONT};color:#C9D2EC;"> ${esc(o.big.unit ?? "")}</span></div></td>${o.big.badge ? `<td align="right" valign="middle" width="84"><div style="width:72px;height:72px;line-height:72px;border-radius:36px;background-color:${accent};color:#06122E;text-align:center;font:900 30px/72px ${FONT};border:2px solid rgba(255,255,255,0.8);">${esc(o.big.badge)}</div></td>` : ""}</tr></table></div></td></tr>` : "";
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light"></head>
<body style="margin:0;padding:0;background-color:#070B1F;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#070B1F" background="${SITE}/assets/email/aurora.jpg" style="background-color:#070B1F;background-image:url('${SITE}/assets/email/aurora.jpg');background-size:cover;background-position:center top;">
<tr><td align="center" style="padding:28px 12px 36px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td style="padding:0 6px 18px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td valign="middle"><img src="${SITE}/assets/email/icon.png" width="36" height="36" alt="" style="display:block;border-radius:9px;border:0;"></td><td valign="middle" style="padding-left:10px;font:700 18px ${FONT};color:#FFFFFF;">Glidepath</td></tr></table></td></tr>
<tr><td style="padding:0 6px;"><div style="${glass}border-radius:28px;padding:24px 22px 22px;">
<div><span style="display:inline-block;padding:5px 11px;border-radius:999px;background-color:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.35);font:800 11px/1 ${FONT};letter-spacing:.1em;text-transform:uppercase;color:${accent === "#0A84FF" ? "#64D2FF" : accent};">${esc(o.kicker)}</span></div>
<div style="font:800 30px/1.12 ${FONT};color:#FFFFFF;padding-top:14px;letter-spacing:-.5px;">${esc(o.title)}</div>
${o.lead ? `<div style="font:400 16px/1.55 ${FONT};color:#D3DAEE;padding-top:10px;">${esc(o.lead)}</div>` : ""}
</div></td></tr>
${big || tileRows.length ? `<tr><td style="padding:8px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${big}${tileRows.join("")}</table></td></tr>` : ""}
${o.button ? `<tr><td align="center" style="padding:22px 6px 4px;"><a href="${esc(o.button.url)}" style="display:inline-block;padding:15px 30px;border-radius:999px;background-color:#0A84FF;background-image:linear-gradient(135deg,#0A84FF,#5E5CE6);border:1px solid rgba(255,255,255,0.55);color:#FFFFFF;text-decoration:none;font:700 16px/1 ${FONT};">${esc(o.button.label)}</a></td></tr>` : ""}
<tr><td align="center" style="padding:24px 18px 0;font:400 12.5px/1.6 ${FONT};color:#9AA5C4;">${esc(o.foot ?? "You can turn these emails off in Glidepath under Account.")}<br><a href="${SITE}" style="color:#9AA5C4;">glidepath-ad9.pages.dev</a> · Free for Microsoft Flight Simulator</td></tr>
</table></td></tr></table></body></html>`;
  const text = [o.title, o.lead ?? "", o.big ? `${o.big.label}: ${o.big.value} ${o.big.unit ?? ""}${o.big.badge ? ` (${o.big.badge})` : ""}` : "", ...(o.rows ?? []).map(([k, v]) => `${k}: ${v}`), o.button ? `${o.button.label}: ${o.button.url}` : "", "", o.foot ?? "You can turn these emails off in Glidepath under Account."].filter((x) => x !== "").join("\n");
  return { html, text };
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
  return {
    subject: `Your debrief: ${dep} → ${arr}${l?.grade ? ` (${l.grade})` : ""}`,
    ...card({ kicker: "FLIGHT DEBRIEF", title: `${dep} → ${arr}`, lead: l?.verdict ? String(l.verdict) : "Your flight is saved to your logbook. Here's how it went.", rows,
      big: fpm !== null ? { label: "Touchdown", value: String(fpm), unit: "fpm", badge: l.grade ? String(l.grade) : undefined } : undefined, button: { label: "Open the full debrief", url: `${APP}#/logbook/${encodeURIComponent(f.id)}` }, color: "#30D158" }),
  };
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
