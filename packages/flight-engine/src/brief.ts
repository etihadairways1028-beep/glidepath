/**
 * The monthly email: a short, human summary of how a pilot did last month.
 * Pure function so it can be tested here and bundled into the email job.
 * Returns null when there were no completed flights that month (no email).
 */
import type { FlightSummary } from "@glidepath/protocol";
import { careerStats, flightsInMonth, hoursText, WORD_ORDER } from "./career.js";
import { buildDebrief } from "./debrief.js";
import { touchdownWords } from "./review.js";

export interface MonthlyBrief { subject: string; html: string; text: string; flights: number }

const WORK_ON: Record<string, (n: number, of: number) => string> = {
  landing: (n, of) => `${n} of your ${of} landings were firmer than they should be. Start the flare a touch earlier and keep a little power on until the mains are down.`,
  approach: (n, of) => `${n} of ${of} approaches weren't fully stable by 1,000 ft. Get the gear and flaps out earlier so the last mile is just about speed and the centreline.`,
  takeoff: (n, of) => `${n} of ${of} takeoffs needed tidying up: aim for a steady rotation of about 3° a second and follow the flight director in the climb.`,
  climb: (n, of) => `On ${n} of ${of} flights the handling was a bit busy: watch 250 kt below 10,000 ft and keep turns under 30° of bank.`,
  ground: (n, of) => `Taxi speed crept up on ${n} of ${of} flights. 20 to 30 kt on straights, 10 in the turns.`,
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const n0 = (n: number) => Math.round(n).toLocaleString("en-US");

export function composeMonthlyBrief(all: FlightSummary[], year: number, month: number, opts: { name?: string | null; appUrl?: string } = {}): MonthlyBrief | null {
  const flights = flightsInMonth(all, year, month).filter((f) => f.status === "completed");
  if (flights.length === 0) return null;
  const s = careerStats(flights, { now: Date.UTC(year, month - 1, 15), months: 1 });
  const prevY = month === 1 ? year - 1 : year;
  const prevM = month === 1 ? 12 : month - 1;
  const prev = careerStats(flightsInMonth(all, prevY, prevM), { months: 1 });
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  const appUrl = opts.appUrl ?? "";

  // What to work on: the debrief section that most often came out "improve".
  const counts: Record<string, number> = {};
  let goodFlights = 0;
  for (const f of flights) {
    const d = buildDebrief({ ...f, takeoff: f.takeoff ?? null, stats: f.stats ?? null });
    if (d.rating === "good") goodFlights++;
    for (const sec of d.sections) if (sec.rating === "improve") counts[sec.id] = (counts[sec.id] ?? 0) + 1;
  }
  const worst = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const workOn = worst && WORK_ON[worst[0]] ? WORK_ON[worst[0]]!(worst[1], flights.length) : null;

  const hello = opts.name ? `Hi ${opts.name.split(/\s+/)[0]},` : "Hi,";
  const trend = prev.flights === 0 ? "" : s.blockMs > prev.blockMs ? ` That's ${hoursText(s.blockMs - prev.blockMs)} more than ${monthOf(prevY, prevM)}.` : s.blockMs < prev.blockMs ? ` A quieter month than ${monthOf(prevY, prevM)}.` : "";
  const opener = `You flew ${flights.length === 1 ? "one flight" : `${flights.length} flights`} in ${monthName}, ${hoursText(s.blockMs)} block to block over ${n0(s.distanceNm)} nm.${trend}`;
  const landingLine = s.avgFpm === null ? null : `Your landings averaged ${n0(s.avgFpm)} fpm, which is ${touchdownWords(s.avgFpm).word.toLowerCase()}.${s.bestLanding?.fpm != null ? ` The best was ${n0(s.bestLanding.fpm)} fpm${s.bestLanding.at ? ` into ${s.bestLanding.at}` : ""}, graded ${s.bestLanding.grade}.` : ""}`;
  const praise = goodFlights === flights.length ? "Every flight came out clean in the debrief. Nice work." : goodFlights > 0 ? `${goodFlights} of ${flights.length} flights came out clean in the debrief.` : null;
  const subject = `Your ${monthName} in the air: ${hoursText(s.blockMs)}, ${flights.length} ${flights.length === 1 ? "flight" : "flights"}`;

  const words = WORD_ORDER.filter((w) => s.words[w]).map((w) => `${w} ${s.words[w]}`).join(", ");
  const rows: Array<[string, string]> = [
    ["Hours flown", hoursText(s.blockMs)],
    ["Flights", String(flights.length)],
    ["Distance", `${n0(s.distanceNm)} nm`],
    ...(s.avgFpm !== null ? [["Average landing", `${n0(s.avgFpm)} fpm`] as [string, string]] : []),
    ...(s.longest ? [["Longest flight", `${hoursText(s.longest.blockMs)}, ${s.longest.from ?? "?"} to ${s.longest.to ?? "?"}`] as [string, string]] : []),
    ...(s.topAircraft[0] ? [["Most flown", `${s.topAircraft[0].type}, ${hoursText(s.topAircraft[0].blockMs)}`] as [string, string]] : []),
    ...(words ? [["Landings by feel", words] as [string, string]] : []),
  ];

  const text = [
    hello, "", opener, ...(landingLine ? ["", landingLine] : []), ...(praise ? ["", praise] : []),
    ...(workOn ? ["", `Something to work on: ${workOn}`] : []), "",
    ...rows.map(([k, v]) => `${k}: ${v}`), "",
    appUrl ? `Your logbook: ${appUrl}#/logbook` : "", "", "Blue skies,", "Glidepath",
    "", "You get this because monthly briefs are on in your Glidepath account. Turn them off in the app under Account.",
  ].join("\n");

  const p = (t: string, extra = "") => `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#1c2434;${extra}">${esc(t)}</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#eef2f8;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden">
<tr><td style="background:linear-gradient(135deg,#2F6BFF,#7A3CFF);background-color:#2F6BFF;padding:28px 28px 24px;color:#fff">
<div style="font-size:13px;font-weight:600;opacity:.85;letter-spacing:.04em;text-transform:uppercase">Glidepath · ${esc(monthName)} ${year}</div>
<div style="font-size:40px;font-weight:800;letter-spacing:-0.03em;margin-top:10px">${esc(hoursText(s.blockMs))}</div>
<div style="font-size:15px;opacity:.9;margin-top:2px">${flights.length} ${flights.length === 1 ? "flight" : "flights"}, ${esc(n0(s.distanceNm))} nm</div>
</td></tr>
<tr><td style="padding:26px 28px 8px">
${p(hello)}${p(opener)}${landingLine ? p(landingLine) : ""}${praise ? p(praise) : ""}
${workOn ? `<div style="margin:0 0 18px;padding:14px 16px;border-radius:14px;background:#fff6e8;border:1px solid #ffe0b0"><div style="font-size:12px;font-weight:700;color:#b26a00;text-transform:uppercase;letter-spacing:.04em">Something to work on</div><div style="font-size:15px;line-height:1.5;color:#3a2a10;margin-top:4px">${esc(workOn)}</div></div>` : ""}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:4px 0 18px">
${rows.map(([k, v]) => `<tr><td style="padding:10px 0;border-top:1px solid #e8edf5;font-size:14px;color:#5b6578">${esc(k)}</td><td align="right" style="padding:10px 0;border-top:1px solid #e8edf5;font-size:14px;font-weight:600;color:#1c2434">${esc(v)}</td></tr>`).join("")}
</table>
${appUrl ? `<a href="${esc(appUrl)}#/logbook" style="display:inline-block;background:#0A6CFF;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:999px">Open your logbook</a>` : ""}
<p style="margin:24px 0 0;font-size:15px;color:#1c2434">Blue skies,<br>Glidepath</p>
</td></tr>
<tr><td style="padding:18px 28px 24px;font-size:12px;line-height:1.5;color:#8a93a5">You get this because monthly briefs are on in your Glidepath account. Turn them off in the app under Account. Glidepath is an independent project, not affiliated with Microsoft or any airline.</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, html, text, flights: flights.length };
}

function monthOf(y: number, m: number): string {
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
}
