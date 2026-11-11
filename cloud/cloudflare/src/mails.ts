/** The Glidepath emails, in one look: a card with a coloured header, a button and a short footer. */
const APP = "https://glidepath-ad9.pages.dev/app/";
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function card(o: { kicker: string; title: string; lead?: string; rows?: Array<[string, string]>; button?: { label: string; url: string }; foot?: string; color?: string }) {
  const rows = (o.rows ?? []).map(([k, v]) => `<tr><td style="padding:9px 0;color:#667085;border-top:1px solid #eef0f4">${esc(k)}</td><td style="padding:9px 0;text-align:right;font-weight:600;border-top:1px solid #eef0f4">${esc(v)}</td></tr>`).join("");
  const html = `<div style="background:#f2f3f7;padding:24px 12px;font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#0b1527">
<div style="max-width:520px;margin:auto;background:#fff;border-radius:20px;overflow:hidden">
<div style="background:${o.color ?? "#0A84FF"};color:#fff;padding:22px 24px"><div style="font-size:12px;letter-spacing:.12em;font-weight:700;opacity:.85">${esc(o.kicker)}</div><div style="font-size:24px;font-weight:800;margin-top:6px">${esc(o.title)}</div></div>
<div style="padding:20px 24px">${o.lead ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${esc(o.lead)}</p>` : ""}
${rows ? `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>` : ""}
${o.button ? `<p style="margin:18px 0 4px"><a href="${esc(o.button.url)}" style="display:inline-block;background:#0A84FF;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">${esc(o.button.label)}</a></p>` : ""}
</div></div>
<p style="max-width:520px;margin:12px auto 0;color:#8a90a0;font-size:12px;text-align:center">${esc(o.foot ?? "You can turn these emails off in Glidepath under Account.")}</p></div>`;
  const text = [o.title, o.lead ?? "", ...(o.rows ?? []).map(([k, v]) => `${k}: ${v}`), o.button ? `${o.button.label}: ${o.button.url}` : "", "", o.foot ?? "You can turn these emails off in Glidepath under Account."].filter((x) => x !== undefined).join("\n");
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
  if (fpm !== null) rows.push(["Touchdown", `${fpm} fpm${l.grade ? `, grade ${l.grade}` : ""}`]);
  if (l?.runway?.ident) rows.push(["Runway", String(l.runway.ident)]);
  return {
    subject: `Your debrief: ${dep} → ${arr}${l?.grade ? ` (${l.grade})` : ""}`,
    ...card({ kicker: "FLIGHT DEBRIEF", title: `${dep} → ${arr}`, lead: l?.verdict ? String(l.verdict) : "Your flight is saved to your logbook. Here's how it went.", rows, button: { label: "Open the full debrief", url: `${APP}#/logbook/${encodeURIComponent(f.id)}` }, color: "#1E9E5A" }),
  };
}

export function inflightMail(kind: string, title: string, body: string) {
  return { subject: `Glidepath: ${title}`, ...card({ kicker: kind === "tod" ? "TOP OF DESCENT" : kind === "arrival" ? "ARRIVAL" : "YOUR FLIGHT", title, lead: body, button: { label: "Open Glidepath", url: APP }, color: kind === "tod" ? "#E08A00" : "#0A84FF" }) };
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
