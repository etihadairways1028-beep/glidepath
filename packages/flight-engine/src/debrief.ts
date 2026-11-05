/**
 * The end-of-flight debrief: what went well and what to work on, written the
 * way a training captain would say it. Built only from the recorded flight
 * (takeoff report, landing report, handling stats, plan). Sections with no
 * data are left out rather than guessed.
 */
import type { FlightSummary, LandingReport, ReviewNote } from "@glidepath/protocol";
import { LANDING_PROFILES } from "./landing.js";
import { takeoffBandsFor, touchdownWords } from "./review.js";

export type Rating = "good" | "ok" | "improve";

export interface DebriefSection {
  id: "takeoff" | "climb" | "approach" | "landing" | "ground";
  title: string;
  rating: Rating;
  headline: string;
  notes: ReviewNote[];
  facts: { k: string; v: string }[];
}

export interface Debrief {
  headline: string;
  summary: string;
  rating: Rating;
  sections: DebriefSection[];
  wentWell: string[];
  toImprove: string[];
}

const n0 = (n: number) => Math.round(n).toLocaleString("en-US");
const fl = (ft: number) => (ft >= 18_000 ? `FL${String(Math.round(ft / 100)).padStart(3, "0")}` : `${n0(Math.round(ft / 100) * 100)} ft`);
const mmss = (s: number) => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, "0")} s`);
const worst = (notes: ReviewNote[]): Rating => (notes.some((n) => n.level === "improve") ? "improve" : notes.some((n) => n.level === "ok") ? "ok" : "good");

export function buildDebrief(f: FlightSummary): Debrief {
  const sections: DebriefSection[] = [];
  const profileId = f.takeoff?.profileId ?? f.landings.at(-1)?.profileId ?? "generic";
  const bands = takeoffBandsFor(profileId);
  const st = f.stats ?? null;

  // Takeoff
  const to = f.takeoff ?? null;
  if (to) {
    const facts: DebriefSection["facts"] = [];
    if (to.rotationRateDegS !== null) facts.push({ k: "Rotation", v: `${to.rotationRateDegS}°/s${to.rotateIasKt !== null ? ` from ${to.rotateIasKt} kt` : ""}` });
    if (to.liftoffIasKt !== null || to.liftoffPitchDeg !== null) facts.push({ k: "Lift-off", v: [to.liftoffIasKt !== null ? `${to.liftoffIasKt} kt` : null, to.liftoffPitchDeg !== null ? `${to.liftoffPitchDeg}° nose up` : null].filter(Boolean).join(", ") });
    if (to.maxPitchDeg !== null) facts.push({ k: "Climb pitch", v: `${to.maxPitchDeg}° max${to.avgClimbPitchDeg !== null ? `, ${to.avgClimbPitchDeg}° average` : ""}` });
    if (to.initialClimbFpm !== null) facts.push({ k: "Initial climb", v: `${n0(to.initialClimbFpm)} fpm` });
    if (to.groundRollFt !== null) facts.push({ k: "Ground roll", v: `${n0(to.groundRollFt)} ft` });
    if (to.gearUpS !== null) facts.push({ k: "Gear up", v: `${Math.round(to.gearUpS)} s after lift-off` });
    facts.push({ k: "Runway", v: f.departureRunway ? `${f.departureIcao ?? ""} ${f.departureRunway}`.trim() : "not identified" });
    sections.push({ id: "takeoff", title: "Takeoff", rating: worst(to.notes), headline: to.verdict, notes: to.notes, facts });
  }

  // Climb, cruise and handling
  if (st) {
    const notes: ReviewNote[] = [];
    const facts: DebriefSection["facts"] = [];
    if (st.climbAvgFpm !== null) facts.push({ k: "Average climb", v: `${n0(st.climbAvgFpm)} fpm` });
    if (f.maxAltitudeFt !== null) facts.push({ k: "Cruise", v: fl(f.maxAltitudeFt) + (f.plan?.cruiseAltitudeFt ? `, planned ${fl(f.plan.cruiseAltitudeFt)}` : "") });
    if (st.maxIasBelow10kKt !== null) facts.push({ k: "Fastest below 10,000 ft", v: `${st.maxIasBelow10kKt} kt` });
    if (st.maxBankDeg !== null) facts.push({ k: "Steepest bank", v: `${st.maxBankDeg}°` });
    if (st.maxG !== null) facts.push({ k: "Load", v: st.minG !== null && st.maxG - st.minG < 0.15 ? `steady, ${st.maxG.toFixed(1)} g` : `${st.minG ?? "?"} to ${st.maxG} g` });

    if (st.overspeedBelow10kS > 15) notes.push({ level: "improve", text: `${mmss(st.overspeedBelow10kS)} above 250 kt below 10,000 ft, up to ${st.maxIasBelow10kKt} kt. 250 kt is the limit down there in most airspace.` });
    else if (st.overspeedBelow10kS > 3) notes.push({ level: "ok", text: `Brushed past 250 kt below 10,000 ft for a few seconds (${st.maxIasBelow10kKt} kt). Watch the speed as you climb and descend through FL100.` });
    else if (st.maxIasBelow10kKt !== null && profileId !== "light-aircraft") notes.push({ level: "good", text: "Kept to 250 kt below 10,000 ft." });

    const [comfy, steep] = bands.bank;
    if (st.maxBankDeg !== null) {
      if (st.maxBankDeg > steep) notes.push({ level: "improve", text: `Banked up to ${st.maxBankDeg}° at one point. ${profileId === "light-aircraft" ? "Keep normal turns nearer 30°." : "Airliners stay within 25–30°; passengers notice anything more."}` });
      else if (st.maxBankDeg > comfy) notes.push({ level: "ok", text: `A ${st.maxBankDeg}° bank at one point, a little steep. ${comfy}° is a comfortable limit.` });
      else notes.push({ level: "good", text: `Gentle turns, never past ${st.maxBankDeg}° of bank.` });
    }
    if (st.maxG !== null && st.maxG > 1.8) notes.push({ level: "improve", text: `Pulled ${st.maxG} g in the air. Keep manoeuvres smooth; airliners rarely see more than 1.3 g.` });
    else if (st.maxG !== null && st.maxG > 1.5) notes.push({ level: "ok", text: `${st.maxG} g at one point in the air. A bit abrupt on the controls.` });
    if (notes.length || facts.length) {
      const r = worst(notes);
      sections.push({ id: "climb", title: "Climb and cruise", rating: r, headline: r === "good" ? "Smooth and within limits" : r === "ok" ? "Mostly tidy" : "Some handling to tighten up", notes, facts });
    }
  }

  // Descent and approach
  if (st && (st.gate1000 || st.descentAvgFpm !== null)) {
    const notes: ReviewNote[] = [];
    const facts: DebriefSection["facts"] = [];
    if (st.descentAvgFpm !== null) facts.push({ k: "Average descent", v: `${n0(st.descentAvgFpm)} fpm` });
    if (st.maxDescentFpm !== null) facts.push({ k: "Steepest descent", v: `${n0(st.maxDescentFpm)} fpm` });
    for (const g of [st.gate1000, st.gate500]) {
      if (!g) continue;
      facts.push({ k: `At ${n0(g.heightFt)} ft`, v: [g.iasKt !== null ? `${g.iasKt} kt` : null, g.vsFpm !== null ? (Math.abs(g.vsFpm) < 100 ? "level" : `${n0(Math.abs(g.vsFpm))} fpm ${g.vsFpm < 0 ? "down" : "up"}`) : null, g.gearDown === null ? null : g.gearDown ? "gear down" : "gear up"].filter(Boolean).join(", ") });
    }
    const g = st.gate1000;
    if (g) {
      const why: string[] = [];
      if (g.gearDown === false) why.push("gear still up");
      if (g.vsFpm !== null && g.vsFpm < -1100) why.push(`sinking at ${n0(-g.vsFpm)} fpm`);
      if (g.bankDeg !== null && Math.abs(g.bankDeg) > 15) why.push(`banked ${Math.abs(g.bankDeg)}°`);
      if (why.length) notes.push({ level: "improve", text: `Not stable at 1,000 ft: ${why.join(", ")}. Most airlines would call a go-around there.` });
      else notes.push({ level: "good", text: `Stable at 1,000 ft${g.iasKt !== null ? `: ${g.iasKt} kt` : ""}${g.vsFpm !== null ? `, ${n0(-g.vsFpm)} fpm down` : ""}${g.gearDown ? ", gear down" : ""}.` });
    }
    if (st.gate500 && st.gate500.gearDown === false) notes.push({ level: "improve", text: "Gear was still up at 500 ft. That's a go-around, every time." });
    if (st.iasSpreadBelow1000Kt !== null) {
      if (st.iasSpreadBelow1000Kt > 25) notes.push({ level: "improve", text: `Speed wandered by ${st.iasSpreadBelow1000Kt} kt below 1,000 ft. Get configured earlier and hold your approach speed within +10/−5.` });
      else if (st.iasSpreadBelow1000Kt > 15) notes.push({ level: "ok", text: `Speed moved around by ${st.iasSpreadBelow1000Kt} kt on short final. Try to settle it earlier.` });
      else notes.push({ level: "good", text: st.iasSpreadBelow1000Kt <= 5 ? "Speed rock steady on final." : `Speed held within ${st.iasSpreadBelow1000Kt} kt on final.` });
    }
    if (st.maxSinkBelow1000Fpm !== null && st.maxSinkBelow1000Fpm > 1200) notes.push({ level: "improve", text: `Sink rate reached ${n0(st.maxSinkBelow1000Fpm)} fpm below 1,000 ft. On a 3° path you need about 700–800 fpm.` });
    if (st.maxBankBelow500Deg !== null && st.maxBankBelow500Deg > 10) notes.push({ level: st.maxBankBelow500Deg > 15 ? "improve" : "ok", text: `${st.maxBankBelow500Deg}° of bank below 500 ft. Line up earlier so the last part is wings level.` });
    if (st.goArounds > 0) notes.push({ level: "ok", text: `${st.goArounds === 1 ? "One go-around" : `${st.goArounds} go-arounds`}. No shame in that; it's the right call when an approach isn't working.` });
    const r = worst(notes);
    sections.push({ id: "approach", title: "Descent and approach", rating: r, headline: r === "good" ? "Stable approach" : r === "ok" ? "A workable approach" : "Approach needs work", notes, facts });
  }

  // Landing
  const l = f.landings.at(-1) ?? null;
  if (l) sections.push(landingSection(l, f));

  // Taxi, fuel and time
  {
    const notes: ReviewNote[] = [];
    const facts: DebriefSection["facts"] = [];
    if (st?.maxTaxiKt != null) {
      facts.push({ k: "Fastest taxi", v: `${st.maxTaxiKt} kt` });
      if (st.fastTaxiS > 20) notes.push({ level: st.maxTaxiKt > 40 ? "improve" : "ok", text: `Taxied at up to ${st.maxTaxiKt} kt. Keep it around 20–30 kt on straights and 10 kt in turns.` });
      else notes.push({ level: "good", text: `Sensible taxi speeds, ${st.maxTaxiKt} kt at most.` });
    }
    if (f.fuelStartKg !== null && f.fuelEndKg !== null) facts.push({ k: "Fuel used", v: `${n0(f.fuelStartKg - f.fuelEndKg)} kg` });
    const planLand = f.plan?.fuelLandingKg ?? null;
    if (planLand !== null && f.fuelEndKg !== null) {
      const d = f.fuelEndKg - planLand;
      const pct = Math.abs(d) / planLand;
      facts.push({ k: "Fuel left", v: `${n0(f.fuelEndKg)} kg, planned ${n0(planLand)}` });
      if (d < 0 && pct > 0.1) notes.push({ level: "ok", text: `Arrived with ${n0(-d)} kg less fuel than planned. Check the cruise level and speed against the plan next time.` });
      else notes.push({ level: "good", text: `Fuel came out close to plan (${d >= 0 ? `${n0(d)} kg over` : `${n0(-d)} kg under`}).` });
    }
    const sIn = f.plan?.scheduledIn ?? null;
    if (sIn && f.onBlockAt) {
      const mins = Math.round((f.onBlockAt - sIn * 1000) / 60000);
      facts.push({ k: "On blocks", v: mins === 0 ? "on schedule" : `${Math.abs(mins)} min ${mins > 0 ? "late" : "early"}` });
      if (mins > 15) notes.push({ level: "ok", text: `${mins} minutes late on blocks.` });
      else notes.push({ level: "good", text: mins < -2 ? `On blocks ${-mins} minutes early.` : "On time at the gate." });
    }
    if (f.wheelsUpAt && f.wheelsDownAt) facts.push({ k: "Air time", v: mmss((f.wheelsDownAt - f.wheelsUpAt) / 1000).replace(/ \d+ s$/, "") });
    if (notes.length || facts.length) {
      const r = worst(notes);
      sections.push({ id: "ground", title: "Taxi, fuel and time", rating: r, headline: r === "good" ? "No issues" : "Minor points", notes, facts });
    }
  }

  const all = sections.flatMap((s) => s.notes);
  const improve = all.filter((n) => n.level === "improve");
  const ok = all.filter((n) => n.level === "ok");
  const rating: Rating = improve.length ? "improve" : ok.length ? "ok" : "good";
  const headline =
    improve.length === 0 && ok.length <= 1 ? "Good flight. Tidy from start to finish." :
    improve.length === 0 ? "A good flight, with a couple of small things to polish." :
    improve.length === 1 ? "Solid flight. One thing to work on." :
    improve.length <= 3 ? "You got it there. A few things to tighten up." :
    "A rough one. Let's go through it.";

  const parts: string[] = [];
  if (to) parts.push(`${takeoffAdjective(to.grade)} takeoff`);
  if (l && l.touchdownVsFpm !== null) parts.push(`${touchdownWords(l.touchdownVsFpm, l.profileId).word.toLowerCase()} landing at ${Math.abs(l.touchdownVsFpm)} fpm${f.arrivalRunway ? ` on ${f.arrivalRunway}` : ""}`);
  const summary = parts.length ? cap(parts.map(article).join(" and ")) + "." : "Not enough data was recorded for a full debrief.";

  return {
    headline,
    summary,
    rating,
    sections,
    wentWell: all.filter((n) => n.level === "good").map((n) => n.text).slice(0, 4),
    toImprove: [...improve, ...ok].map((n) => n.text).slice(0, 5),
  };
}

function landingSection(l: LandingReport, f: FlightSummary): DebriefSection {
  const p = LANDING_PROFILES[l.profileId] ?? LANDING_PROFILES.generic!;
  const notes: ReviewNote[] = [];
  const facts: DebriefSection["facts"] = [];
  let headline = l.verdict;
  if (l.touchdownVsFpm !== null) {
    const w = touchdownWords(l.touchdownVsFpm, l.profileId);
    notes.push({ level: w.level, text: w.text });
    headline = `${w.word}, ${Math.abs(l.touchdownVsFpm)} fpm`;
    facts.push({ k: "Sink rate", v: `${Math.abs(l.touchdownVsFpm)} fpm${l.touchdownVsSource === "derived" ? " (estimated)" : ""}` });
  }
  if (l.peakG !== null) {
    facts.push({ k: "Peak load", v: `${l.peakG} g` });
    if (l.peakG >= p.gHard) notes.push({ level: "improve", text: `${l.peakG} g on touchdown. That's a hard hit for the gear.` });
  }
  if (l.bounces > 0) notes.push({ level: "improve", text: `Bounced ${l.bounces === 1 ? "once" : `${l.bounces} times`}. Hold the flare attitude after first contact rather than pushing the nose down.` });
  if (l.pitchDeg !== null) {
    facts.push({ k: "Pitch at touchdown", v: `${l.pitchDeg}°` });
    if (l.pitchDeg >= p.tailStrikePitchDeg) notes.push({ level: "improve", text: `Touched down at ${l.pitchDeg}° nose up, close to a tail strike. Fly it onto the runway instead of holding it off.` });
    else if (l.pitchDeg < 0) notes.push({ level: "improve", text: `Landed nose-first at ${l.pitchDeg}°. Mains first, every time; flare a little more.` });
  }
  if (l.bankDeg !== null && Math.abs(l.bankDeg) > p.maxBankDeg) notes.push({ level: "ok", text: `${Math.abs(l.bankDeg)}° of bank at touchdown. Wings level, or just enough into wind.` });
  if (l.runway) {
    const along = l.runway.distanceFromThresholdFt;
    const off = Math.abs(l.runway.centrelineOffsetFt);
    facts.push({ k: "Touchdown point", v: `${n0(along)} ft down ${l.runway.ident}, ${n0(off)} ft ${l.runway.centrelineOffsetFt >= 0 ? "right" : "left"} of centre` });
    const [zLo, zHi] = p.touchdownZoneFt;
    if (along > zHi + 1000) notes.push({ level: "improve", text: `Landed long, ${n0(along)} ft past the threshold. Aim for the touchdown zone markings, ${n0(zLo)}–${n0(zHi)} ft in.` });
    else if (along > zHi) notes.push({ level: "ok", text: `A little long at ${n0(along)} ft. Don't let it float in the flare.` });
    else if (along < zLo * 0.5) notes.push({ level: "improve", text: `Touched down short, only ${n0(along)} ft past the threshold. Keep the aiming point steady until the flare.` });
    else notes.push({ level: "good", text: `In the touchdown zone, ${n0(along)} ft in.` });
    if (off > 30) notes.push({ level: "improve", text: `${n0(off)} ft off the centreline. Pick it up earlier on final and keep it with the rudder in the flare.` });
    else if (off > 15) notes.push({ level: "ok", text: `${n0(off)} ft off the centreline.` });
    else notes.push({ level: "good", text: `On the centreline (${n0(off)} ft off).` });
  }
  if (l.crosswindKt !== null && Math.abs(l.crosswindKt) >= 5) facts.push({ k: "Crosswind", v: `${Math.round(Math.abs(l.crosswindKt))} kt` });
  if (l.iasKt !== null) facts.push({ k: "Speed at touchdown", v: `${Math.round(l.iasKt)} kt` });
  if (!f.arrivalRunway && !l.runway) facts.push({ k: "Runway", v: "not identified" });
  return { id: "landing", title: "Landing", rating: worst(notes), headline, notes, facts };
}

function takeoffAdjective(grade: string): string {
  return grade === "A+" || grade === "A" ? "smooth" : grade === "B" ? "decent" : grade === "C" ? "untidy" : "rough";
}
const article = (s: string) => (/^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
