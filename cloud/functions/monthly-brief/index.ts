// Built from cloud/src/monthly-brief.ts by cloud/build.sh. Paste this whole file into the Supabase editor.

// ../packages/flight-engine/src/geo.ts
var D2R = Math.PI / 180;
var R2D = 180 / Math.PI;

// ../packages/flight-engine/src/landing.ts
var LANDING_PROFILES = {
  "narrowbody-jet": {
    id: "narrowbody-jet",
    label: "Narrow-body jet (A320 family, 737, E-Jets)",
    idealVsFpm: [60, 180],
    firmVsFpm: 360,
    hardVsFpm: 600,
    gFirm: 1.3,
    gHard: 1.7,
    maxBankDeg: 7,
    tailStrikePitchDeg: 10,
    touchdownZoneFt: [800, 2e3]
  },
  "widebody-jet": {
    id: "widebody-jet",
    label: "Wide-body jet (777, 787, A330, A350, 747)",
    idealVsFpm: [80, 220],
    firmVsFpm: 400,
    hardVsFpm: 600,
    gFirm: 1.3,
    gHard: 1.7,
    maxBankDeg: 6,
    tailStrikePitchDeg: 9,
    touchdownZoneFt: [1e3, 2500]
  },
  "turboprop": {
    id: "turboprop",
    label: "Regional turboprop (ATR, Dash 8)",
    idealVsFpm: [60, 220],
    firmVsFpm: 400,
    hardVsFpm: 650,
    gFirm: 1.35,
    gHard: 1.8,
    maxBankDeg: 8,
    tailStrikePitchDeg: 8,
    touchdownZoneFt: [500, 1800]
  },
  "light-aircraft": {
    id: "light-aircraft",
    label: "Light aircraft (C172, SR22, DA40, PA-28)",
    idealVsFpm: [40, 250],
    firmVsFpm: 450,
    hardVsFpm: 700,
    gFirm: 1.4,
    gHard: 2,
    maxBankDeg: 10,
    tailStrikePitchDeg: 13,
    touchdownZoneFt: [200, 1200]
  },
  generic: {
    id: "generic",
    label: "Generic aircraft",
    idealVsFpm: [60, 220],
    firmVsFpm: 400,
    hardVsFpm: 650,
    gFirm: 1.35,
    gHard: 1.8,
    maxBankDeg: 8,
    tailStrikePitchDeg: 10,
    touchdownZoneFt: [500, 2e3]
  }
};

// ../packages/flight-engine/src/review.ts
var TAKEOFF_BANDS = {
  "narrowbody-jet": { rotate: [2, 3.5], climbPitch: [12, 18], excessivePitch: 21, tailDeg: 11.5, bank: [30, 35], retractableGear: true },
  "widebody-jet": { rotate: [1.5, 3], climbPitch: [11, 17], excessivePitch: 20, tailDeg: 10, bank: [30, 35], retractableGear: true },
  turboprop: { rotate: [2, 4], climbPitch: [8, 14], excessivePitch: 17, tailDeg: 9, bank: [30, 35], retractableGear: true },
  "light-aircraft": { rotate: [1, 5], climbPitch: [5, 12], excessivePitch: 15, tailDeg: 14, bank: [45, 60], retractableGear: false },
  generic: { rotate: [1.5, 4], climbPitch: [8, 18], excessivePitch: 21, tailDeg: 11, bank: [30, 35], retractableGear: true }
};
function takeoffBandsFor(profileId) {
  return TAKEOFF_BANDS[profileId] ?? TAKEOFF_BANDS.generic;
}
function touchdownWords(fpm, profileId = "generic") {
  const v = Math.round(Math.abs(fpm));
  const flare = profileId === "light-aircraft" ? "around 10\u201315 ft" : profileId === "widebody-jet" ? "around 30\u201340 ft" : "around 20\u201330 ft";
  if (v < 60) return { word: "Very soft", level: "good", text: `${v} fpm, barely felt. Almost too soft: on a wet or short runway you want it on firmly, so make sure you didn't float.` };
  if (v < 150) return { word: "Smooth", level: "good", text: `Smooth touchdown at ${v} fpm. Exactly what you want.` };
  if (v < 240) return { word: "Normal", level: "good", text: `A normal, positive touchdown at ${v} fpm. That's what line pilots aim for.` };
  if (v < 360) return { word: "Firm", level: "ok", text: `Firm at ${v} fpm. You'd feel it in the cabin, but it's well inside limits.` };
  if (v < 600) return { word: "Heavy", level: "improve", text: `Heavy at ${v} fpm. Start the flare a touch earlier, ${flare}, and keep the power on until it's settled.` };
  return { word: "Hard", level: "improve", text: `Hard landing at ${v} fpm. Beyond about 600 fpm (10 ft/s) most airliners need a hard-landing inspection.` };
}

// ../packages/flight-engine/src/career.ts
var WORD_ORDER = ["Very soft", "Smooth", "Normal", "Firm", "Heavy", "Hard"];
var blockOf = (f) => f.onBlockAt && f.offBlockAt ? Math.max(0, f.onBlockAt - f.offBlockAt) : 0;
var airOf = (f) => f.wheelsDownAt && f.wheelsUpAt ? Math.max(0, f.wheelsDownAt - f.wheelsUpAt) : 0;
var monthKey = (t) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
function careerStats(all, opts = {}) {
  const now = opts.now ?? Date.now();
  const nMonths = opts.months ?? 12;
  const done = all.filter((f) => f.status === "completed");
  const landings = done.flatMap((f) => f.landings.map((l) => ({ f, l })));
  const fpms = landings.map(({ l }) => l.touchdownVsFpm).filter((v) => v !== null && Number.isFinite(v)).map((v) => Math.abs(v));
  const words = {};
  for (const v of fpms) {
    const w = touchdownWords(v).word;
    words[w] = (words[w] ?? 0) + 1;
  }
  const rot = done.map((f) => f.takeoff?.rotationRateDegS ?? null).filter((v) => v !== null);
  const visits = /* @__PURE__ */ new Map();
  for (const f of done) for (const a of [f.departureIcao, f.arrivalIcao]) if (a) visits.set(a, (visits.get(a) ?? 0) + 1);
  const types = /* @__PURE__ */ new Map();
  for (const f of done) {
    const t = f.aircraft?.icaoType ?? f.plan?.aircraftIcao ?? f.aircraft?.title ?? null;
    if (!t) continue;
    const e = types.get(t) ?? { flights: 0, blockMs: 0 };
    e.flights++;
    e.blockMs += blockOf(f);
    types.set(t, e);
  }
  const longestF = [...done].sort((a, b) => blockOf(b) - blockOf(a))[0];
  const furthestF = [...done].sort((a, b) => b.distanceNm - a.distanceNm)[0];
  const best = [...landings].sort((a, b) => b.l.score - a.l.score || Math.abs(a.l.touchdownVsFpm ?? 1e9) - Math.abs(b.l.touchdownVsFpm ?? 1e9))[0];
  const byMonth = [];
  const d0 = new Date(now);
  for (let i = nMonths - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - i, 1));
    const key = monthKey(d.getTime());
    byMonth.push({ key, label: d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }), flights: 0, blockMs: 0 });
  }
  const idx = new Map(byMonth.map((m, i) => [m.key, i]));
  for (const f of done) {
    const i = idx.get(monthKey(f.offBlockAt ?? f.startedAt));
    if (i !== void 0) {
      byMonth[i].flights++;
      byMonth[i].blockMs += blockOf(f);
    }
  }
  const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const avgFpm = avg(fpms);
  const avgScore = avg(landings.map(({ l }) => l.score));
  const avgRot = avg(rot);
  return {
    flights: done.length,
    blockMs: done.reduce((s, f) => s + blockOf(f), 0),
    airMs: done.reduce((s, f) => s + airOf(f), 0),
    distanceNm: Math.round(done.reduce((s, f) => s + f.distanceNm, 0)),
    fuelBurnedKg: Math.round(done.reduce((s, f) => s + (f.fuelStartKg !== null && f.fuelEndKg !== null ? Math.max(0, f.fuelStartKg - f.fuelEndKg) : 0), 0)),
    landings: landings.length,
    avgFpm: avgFpm === null ? null : Math.round(avgFpm),
    softestFpm: fpms.length ? Math.round(Math.min(...fpms)) : null,
    firmestFpm: fpms.length ? Math.round(Math.max(...fpms)) : null,
    avgScore: avgScore === null ? null : Math.round(avgScore),
    words,
    avgRotationDegS: avgRot === null ? null : Math.round(avgRot * 10) / 10,
    airports: visits.size,
    aircraftTypes: types.size,
    topAirports: [...visits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([icao, v]) => ({ icao, visits: v })),
    topAircraft: [...types.entries()].sort((a, b) => b[1].blockMs - a[1].blockMs || b[1].flights - a[1].flights).slice(0, 5).map(([type, e]) => ({ type, ...e })),
    longest: longestF && blockOf(longestF) > 0 ? { id: longestF.id, blockMs: blockOf(longestF), from: longestF.departureIcao, to: longestF.arrivalIcao } : null,
    furthest: furthestF ? { id: furthestF.id, nm: Math.round(furthestF.distanceNm), from: furthestF.departureIcao, to: furthestF.arrivalIcao } : null,
    bestLanding: best ? { id: best.f.id, fpm: best.l.touchdownVsFpm === null ? null : Math.round(Math.abs(best.l.touchdownVsFpm)), score: best.l.score, grade: best.l.grade, at: best.f.arrivalIcao } : null,
    byMonth
  };
}
function flightsInMonth(all, year, month) {
  const start = Date.UTC(year, month - 1, 1);
  const end = Date.UTC(year, month, 1);
  return all.filter((f) => {
    const t = f.offBlockAt ?? f.startedAt;
    return t >= start && t < end;
  });
}
function hoursText(ms) {
  const m = Math.round(ms / 6e4);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

// ../packages/flight-engine/src/debrief.ts
var n0 = (n) => Math.round(n).toLocaleString("en-US");
var fl = (ft) => ft >= 18e3 ? `FL${String(Math.round(ft / 100)).padStart(3, "0")}` : `${n0(Math.round(ft / 100) * 100)} ft`;
var mmss = (s) => s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, "0")} s`;
var worst = (notes) => notes.some((n) => n.level === "improve") ? "improve" : notes.some((n) => n.level === "ok") ? "ok" : "good";
function buildDebrief(f) {
  const sections = [];
  const profileId = f.takeoff?.profileId ?? f.landings.at(-1)?.profileId ?? "generic";
  const bands = takeoffBandsFor(profileId);
  const st = f.stats ?? null;
  const to = f.takeoff ?? null;
  if (to) {
    const facts = [];
    if (to.rotationRateDegS !== null) facts.push({ k: "Rotation", v: `${to.rotationRateDegS}\xB0/s${to.rotateIasKt !== null ? ` from ${to.rotateIasKt} kt` : ""}` });
    if (to.liftoffIasKt !== null || to.liftoffPitchDeg !== null) facts.push({ k: "Lift-off", v: [to.liftoffIasKt !== null ? `${to.liftoffIasKt} kt` : null, to.liftoffPitchDeg !== null ? `${to.liftoffPitchDeg}\xB0 nose up` : null].filter(Boolean).join(", ") });
    if (to.maxPitchDeg !== null) facts.push({ k: "Climb pitch", v: `${to.maxPitchDeg}\xB0 max${to.avgClimbPitchDeg !== null ? `, ${to.avgClimbPitchDeg}\xB0 average` : ""}` });
    if (to.initialClimbFpm !== null) facts.push({ k: "Initial climb", v: `${n0(to.initialClimbFpm)} fpm` });
    if (to.groundRollFt !== null) facts.push({ k: "Ground roll", v: `${n0(to.groundRollFt)} ft` });
    if (to.gearUpS !== null) facts.push({ k: "Gear up", v: `${Math.round(to.gearUpS)} s after lift-off` });
    facts.push({ k: "Runway", v: f.departureRunway ? `${f.departureIcao ?? ""} ${f.departureRunway}`.trim() : "not identified" });
    sections.push({ id: "takeoff", title: "Takeoff", rating: worst(to.notes), headline: to.verdict, notes: to.notes, facts });
  }
  if (st) {
    const notes = [];
    const facts = [];
    if (st.climbAvgFpm !== null) facts.push({ k: "Average climb", v: `${n0(st.climbAvgFpm)} fpm` });
    if (f.maxAltitudeFt !== null) facts.push({ k: "Cruise", v: fl(f.maxAltitudeFt) + (f.plan?.cruiseAltitudeFt ? `, planned ${fl(f.plan.cruiseAltitudeFt)}` : "") });
    if (st.maxIasBelow10kKt !== null) facts.push({ k: "Fastest below 10,000 ft", v: `${st.maxIasBelow10kKt} kt` });
    if (st.maxBankDeg !== null) facts.push({ k: "Steepest bank", v: `${st.maxBankDeg}\xB0` });
    if (st.maxG !== null) facts.push({ k: "Load", v: st.minG !== null && st.maxG - st.minG < 0.15 ? `steady, ${st.maxG.toFixed(1)} g` : `${st.minG ?? "?"} to ${st.maxG} g` });
    if (st.overspeedBelow10kS > 15) notes.push({ level: "improve", text: `${mmss(st.overspeedBelow10kS)} above 250 kt below 10,000 ft, up to ${st.maxIasBelow10kKt} kt. 250 kt is the limit down there in most airspace.` });
    else if (st.overspeedBelow10kS > 3) notes.push({ level: "ok", text: `Brushed past 250 kt below 10,000 ft for a few seconds (${st.maxIasBelow10kKt} kt). Watch the speed as you climb and descend through FL100.` });
    else if (st.maxIasBelow10kKt !== null && profileId !== "light-aircraft") notes.push({ level: "good", text: "Kept to 250 kt below 10,000 ft." });
    const [comfy, steep] = bands.bank;
    if (st.maxBankDeg !== null) {
      if (st.maxBankDeg > steep) notes.push({ level: "improve", text: `Banked up to ${st.maxBankDeg}\xB0 at one point. ${profileId === "light-aircraft" ? "Keep normal turns nearer 30\xB0." : "Airliners stay within 25\u201330\xB0; passengers notice anything more."}` });
      else if (st.maxBankDeg > comfy) notes.push({ level: "ok", text: `A ${st.maxBankDeg}\xB0 bank at one point, a little steep. ${comfy}\xB0 is a comfortable limit.` });
      else notes.push({ level: "good", text: `Gentle turns, never past ${st.maxBankDeg}\xB0 of bank.` });
    }
    if (st.maxG !== null && st.maxG > 1.8) notes.push({ level: "improve", text: `Pulled ${st.maxG} g in the air. Keep manoeuvres smooth; airliners rarely see more than 1.3 g.` });
    else if (st.maxG !== null && st.maxG > 1.5) notes.push({ level: "ok", text: `${st.maxG} g at one point in the air. A bit abrupt on the controls.` });
    if (notes.length || facts.length) {
      const r = worst(notes);
      sections.push({ id: "climb", title: "Climb and cruise", rating: r, headline: r === "good" ? "Smooth and within limits" : r === "ok" ? "Mostly tidy" : "Some handling to tighten up", notes, facts });
    }
  }
  if (st && (st.gate1000 || st.descentAvgFpm !== null)) {
    const notes = [];
    const facts = [];
    if (st.descentAvgFpm !== null) facts.push({ k: "Average descent", v: `${n0(st.descentAvgFpm)} fpm` });
    if (st.maxDescentFpm !== null) facts.push({ k: "Steepest descent", v: `${n0(st.maxDescentFpm)} fpm` });
    for (const g2 of [st.gate1000, st.gate500]) {
      if (!g2) continue;
      facts.push({ k: `At ${n0(g2.heightFt)} ft`, v: [g2.iasKt !== null ? `${g2.iasKt} kt` : null, g2.vsFpm !== null ? Math.abs(g2.vsFpm) < 100 ? "level" : `${n0(Math.abs(g2.vsFpm))} fpm ${g2.vsFpm < 0 ? "down" : "up"}` : null, g2.gearDown === null ? null : g2.gearDown ? "gear down" : "gear up"].filter(Boolean).join(", ") });
    }
    const g = st.gate1000;
    if (g) {
      const why = [];
      if (g.gearDown === false) why.push("gear still up");
      if (g.vsFpm !== null && g.vsFpm < -1100) why.push(`sinking at ${n0(-g.vsFpm)} fpm`);
      if (g.bankDeg !== null && Math.abs(g.bankDeg) > 15) why.push(`banked ${Math.abs(g.bankDeg)}\xB0`);
      if (why.length) notes.push({ level: "improve", text: `Not stable at 1,000 ft: ${why.join(", ")}. Most airlines would call a go-around there.` });
      else notes.push({ level: "good", text: `Stable at 1,000 ft${g.iasKt !== null ? `: ${g.iasKt} kt` : ""}${g.vsFpm !== null ? `, ${n0(-g.vsFpm)} fpm down` : ""}${g.gearDown ? ", gear down" : ""}.` });
    }
    if (st.gate500 && st.gate500.gearDown === false) notes.push({ level: "improve", text: "Gear was still up at 500 ft. That's a go-around, every time." });
    if (st.iasSpreadBelow1000Kt !== null) {
      if (st.iasSpreadBelow1000Kt > 25) notes.push({ level: "improve", text: `Speed wandered by ${st.iasSpreadBelow1000Kt} kt below 1,000 ft. Get configured earlier and hold your approach speed within +10/\u22125.` });
      else if (st.iasSpreadBelow1000Kt > 15) notes.push({ level: "ok", text: `Speed moved around by ${st.iasSpreadBelow1000Kt} kt on short final. Try to settle it earlier.` });
      else notes.push({ level: "good", text: st.iasSpreadBelow1000Kt <= 5 ? "Speed rock steady on final." : `Speed held within ${st.iasSpreadBelow1000Kt} kt on final.` });
    }
    if (st.maxSinkBelow1000Fpm !== null && st.maxSinkBelow1000Fpm > 1200) notes.push({ level: "improve", text: `Sink rate reached ${n0(st.maxSinkBelow1000Fpm)} fpm below 1,000 ft. On a 3\xB0 path you need about 700\u2013800 fpm.` });
    if (st.maxBankBelow500Deg !== null && st.maxBankBelow500Deg > 10) notes.push({ level: st.maxBankBelow500Deg > 15 ? "improve" : "ok", text: `${st.maxBankBelow500Deg}\xB0 of bank below 500 ft. Line up earlier so the last part is wings level.` });
    if (st.goArounds > 0) notes.push({ level: "ok", text: `${st.goArounds === 1 ? "One go-around" : `${st.goArounds} go-arounds`}. No shame in that; it's the right call when an approach isn't working.` });
    const r = worst(notes);
    sections.push({ id: "approach", title: "Descent and approach", rating: r, headline: r === "good" ? "Stable approach" : r === "ok" ? "A workable approach" : "Approach needs work", notes, facts });
  }
  const l = f.landings.at(-1) ?? null;
  if (l) sections.push(landingSection(l, f));
  {
    const notes = [];
    const facts = [];
    if (st?.maxTaxiKt != null) {
      facts.push({ k: "Fastest taxi", v: `${st.maxTaxiKt} kt` });
      if (st.fastTaxiS > 20) notes.push({ level: st.maxTaxiKt > 40 ? "improve" : "ok", text: `Taxied at up to ${st.maxTaxiKt} kt. Keep it around 20\u201330 kt on straights and 10 kt in turns.` });
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
      const mins = Math.round((f.onBlockAt - sIn * 1e3) / 6e4);
      facts.push({ k: "On blocks", v: mins === 0 ? "on schedule" : `${Math.abs(mins)} min ${mins > 0 ? "late" : "early"}` });
      if (mins > 15) notes.push({ level: "ok", text: `${mins} minutes late on blocks.` });
      else notes.push({ level: "good", text: mins < -2 ? `On blocks ${-mins} minutes early.` : "On time at the gate." });
    }
    if (f.wheelsUpAt && f.wheelsDownAt) facts.push({ k: "Air time", v: mmss((f.wheelsDownAt - f.wheelsUpAt) / 1e3).replace(/ \d+ s$/, "") });
    if (notes.length || facts.length) {
      const r = worst(notes);
      sections.push({ id: "ground", title: "Taxi, fuel and time", rating: r, headline: r === "good" ? "No issues" : "Minor points", notes, facts });
    }
  }
  const all = sections.flatMap((s) => s.notes);
  const improve = all.filter((n) => n.level === "improve");
  const ok = all.filter((n) => n.level === "ok");
  const rating = improve.length ? "improve" : ok.length ? "ok" : "good";
  const headline = improve.length === 0 && ok.length <= 1 ? "Good flight. Tidy from start to finish." : improve.length === 0 ? "A good flight, with a couple of small things to polish." : improve.length === 1 ? "Solid flight. One thing to work on." : improve.length <= 3 ? "You got it there. A few things to tighten up." : "A rough one. Let's go through it.";
  const parts = [];
  if (to) parts.push(`${takeoffAdjective(to.grade)} takeoff`);
  if (l && l.touchdownVsFpm !== null) parts.push(`${touchdownWords(l.touchdownVsFpm, l.profileId).word.toLowerCase()} landing at ${Math.abs(l.touchdownVsFpm)} fpm${f.arrivalRunway ? ` on ${f.arrivalRunway}` : ""}`);
  const summary = parts.length ? cap(parts.map(article).join(" and ")) + "." : "Not enough data was recorded for a full debrief.";
  return {
    headline,
    summary,
    rating,
    sections,
    wentWell: all.filter((n) => n.level === "good").map((n) => n.text).slice(0, 4),
    toImprove: [...improve, ...ok].map((n) => n.text).slice(0, 5)
  };
}
function landingSection(l, f) {
  const p = LANDING_PROFILES[l.profileId] ?? LANDING_PROFILES.generic;
  const notes = [];
  const facts = [];
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
    facts.push({ k: "Pitch at touchdown", v: `${l.pitchDeg}\xB0` });
    if (l.pitchDeg >= p.tailStrikePitchDeg) notes.push({ level: "improve", text: `Touched down at ${l.pitchDeg}\xB0 nose up, close to a tail strike. Fly it onto the runway instead of holding it off.` });
    else if (l.pitchDeg < 0) notes.push({ level: "improve", text: `Landed nose-first at ${l.pitchDeg}\xB0. Mains first, every time; flare a little more.` });
  }
  if (l.bankDeg !== null && Math.abs(l.bankDeg) > p.maxBankDeg) notes.push({ level: "ok", text: `${Math.abs(l.bankDeg)}\xB0 of bank at touchdown. Wings level, or just enough into wind.` });
  if (l.runway) {
    const along = l.runway.distanceFromThresholdFt;
    const off = Math.abs(l.runway.centrelineOffsetFt);
    facts.push({ k: "Touchdown point", v: `${n0(along)} ft down ${l.runway.ident}, ${n0(off)} ft ${l.runway.centrelineOffsetFt >= 0 ? "right" : "left"} of centre` });
    const [zLo, zHi] = p.touchdownZoneFt;
    if (along > zHi + 1e3) notes.push({ level: "improve", text: `Landed long, ${n0(along)} ft past the threshold. Aim for the touchdown zone markings, ${n0(zLo)}\u2013${n0(zHi)} ft in.` });
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
function takeoffAdjective(grade) {
  return grade === "A+" || grade === "A" ? "smooth" : grade === "B" ? "decent" : grade === "C" ? "untidy" : "rough";
}
var article = (s) => /^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`;
var cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ../packages/flight-engine/src/brief.ts
var WORK_ON = {
  landing: (n, of) => `${n} of your ${of} landings were firmer than they should be. Start the flare a touch earlier and keep a little power on until the mains are down.`,
  approach: (n, of) => `${n} of ${of} approaches weren't fully stable by 1,000 ft. Get the gear and flaps out earlier so the last mile is just about speed and the centreline.`,
  takeoff: (n, of) => `${n} of ${of} takeoffs needed tidying up: aim for a steady rotation of about 3\xB0 a second and follow the flight director in the climb.`,
  climb: (n, of) => `On ${n} of ${of} flights the handling was a bit busy: watch 250 kt below 10,000 ft and keep turns under 30\xB0 of bank.`,
  ground: (n, of) => `Taxi speed crept up on ${n} of ${of} flights. 20 to 30 kt on straights, 10 in the turns.`
};
var esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
var n02 = (n) => Math.round(n).toLocaleString("en-US");
function composeMonthlyBrief(all, year, month, opts = {}) {
  const flights = flightsInMonth(all, year, month).filter((f) => f.status === "completed");
  if (flights.length === 0) return null;
  const s = careerStats(flights, { now: Date.UTC(year, month - 1, 15), months: 1 });
  const prevY = month === 1 ? year - 1 : year;
  const prevM = month === 1 ? 12 : month - 1;
  const prev = careerStats(flightsInMonth(all, prevY, prevM), { months: 1 });
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  const appUrl = opts.appUrl ?? "";
  const counts = {};
  let goodFlights = 0;
  for (const f of flights) {
    const d = buildDebrief({ ...f, takeoff: f.takeoff ?? null, stats: f.stats ?? null });
    if (d.rating === "good") goodFlights++;
    for (const sec of d.sections) if (sec.rating === "improve") counts[sec.id] = (counts[sec.id] ?? 0) + 1;
  }
  const worst2 = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const workOn = worst2 && WORK_ON[worst2[0]] ? WORK_ON[worst2[0]](worst2[1], flights.length) : null;
  const hello = opts.name ? `Hi ${opts.name.split(/\s+/)[0]},` : "Hi,";
  const trend = prev.flights === 0 ? "" : s.blockMs > prev.blockMs ? ` That's ${hoursText(s.blockMs - prev.blockMs)} more than ${monthOf(prevY, prevM)}.` : s.blockMs < prev.blockMs ? ` A quieter month than ${monthOf(prevY, prevM)}.` : "";
  const opener = `You flew ${flights.length === 1 ? "one flight" : `${flights.length} flights`} in ${monthName}, ${hoursText(s.blockMs)} block to block over ${n02(s.distanceNm)} nm.${trend}`;
  const landingLine = s.avgFpm === null ? null : `Your landings averaged ${n02(s.avgFpm)} fpm, which is ${touchdownWords(s.avgFpm).word.toLowerCase()}.${s.bestLanding?.fpm != null ? ` The best was ${n02(s.bestLanding.fpm)} fpm${s.bestLanding.at ? ` into ${s.bestLanding.at}` : ""}, graded ${s.bestLanding.grade}.` : ""}`;
  const praise = goodFlights === flights.length ? "Every flight came out clean in the debrief. Nice work." : goodFlights > 0 ? `${goodFlights} of ${flights.length} flights came out clean in the debrief.` : null;
  const subject = `Your ${monthName} in the air: ${hoursText(s.blockMs)}, ${flights.length} ${flights.length === 1 ? "flight" : "flights"}`;
  const words = WORD_ORDER.filter((w) => s.words[w]).map((w) => `${w} ${s.words[w]}`).join(", ");
  const rows = [
    ["Hours flown", hoursText(s.blockMs)],
    ["Flights", String(flights.length)],
    ["Distance", `${n02(s.distanceNm)} nm`],
    ...s.avgFpm !== null ? [["Average landing", `${n02(s.avgFpm)} fpm`]] : [],
    ...s.longest ? [["Longest flight", `${hoursText(s.longest.blockMs)}, ${s.longest.from ?? "?"} to ${s.longest.to ?? "?"}`]] : [],
    ...s.topAircraft[0] ? [["Most flown", `${s.topAircraft[0].type}, ${hoursText(s.topAircraft[0].blockMs)}`]] : [],
    ...words ? [["Landings by feel", words]] : []
  ];
  const text = [
    hello,
    "",
    opener,
    ...landingLine ? ["", landingLine] : [],
    ...praise ? ["", praise] : [],
    ...workOn ? ["", `Something to work on: ${workOn}`] : [],
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    appUrl ? `Your logbook: ${appUrl}#/logbook` : "",
    "",
    "Blue skies,",
    "Glidepath",
    "",
    "You get this because monthly briefs are on in your Glidepath account. Turn them off in the app under Account."
  ].join("\n");
  const p = (t, extra = "") => `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#1c2434;${extra}">${esc(t)}</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#eef2f8;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden">
<tr><td style="background:linear-gradient(135deg,#2F6BFF,#7A3CFF);background-color:#2F6BFF;padding:28px 28px 24px;color:#fff">
<div style="font-size:13px;font-weight:600;opacity:.85;letter-spacing:.04em;text-transform:uppercase">Glidepath \xB7 ${esc(monthName)} ${year}</div>
<div style="font-size:40px;font-weight:800;letter-spacing:-0.03em;margin-top:10px">${esc(hoursText(s.blockMs))}</div>
<div style="font-size:15px;opacity:.9;margin-top:2px">${flights.length} ${flights.length === 1 ? "flight" : "flights"}, ${esc(n02(s.distanceNm))} nm</div>
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
function monthOf(y, m) {
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
}

// src/shared.ts
import { createClient } from "npm:@supabase/supabase-js@2";
var env = (k) => Deno.env.get(k) ?? "";
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
var reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
function admin() {
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("GLIDEPATH_SERVICE_KEY");
  if (!key) throw new Error("Missing service key. Add a GLIDEPATH_SERVICE_KEY secret with your project's secret key.");
  return createClient(env("SUPABASE_URL"), key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function userFrom(req, db) {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data?.user?.email) return null;
  return { id: data.user.id, email: data.user.email };
}

// src/monthly-brief.ts
async function sendEmail(to, name, subject, html, text) {
  const r = await fetch(env("BREVO_API_URL") || "https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env("BREVO_API_KEY"), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ sender: { name: "Glidepath", email: env("BREVO_SENDER_EMAIL") }, to: [{ email: to, ...name ? { name } : {} }], subject, htmlContent: html, textContent: text })
  });
  return r.ok ? null : `Brevo ${r.status}: ${(await r.text()).slice(0, 200)}`;
}
async function flightsFor(db, userId, from, to) {
  const { data, error } = await db.from("flights").select("summary").eq("user_id", userId).gte("off_block_at", from.toISOString()).lt("off_block_at", to.toISOString()).limit(2e3);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.summary);
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!env("BREVO_API_KEY") || !env("BREVO_SENDER_EMAIL")) return reply(500, { error: "Email isn't set up: add the BREVO_API_KEY and BREVO_SENDER_EMAIL secrets." });
  const db = admin();
  const appUrl = env("APP_URL") || "https://etihadairways1028-beep.github.io/glidepath/app/";
  const cron = env("CRON_SECRET");
  const isCron = !!cron && req.headers.get("x-cron-secret") === cron;
  const now = /* @__PURE__ */ new Date();
  let year, month, people;
  if (isCron) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    year = d.getUTCFullYear();
    month = d.getUTCMonth() + 1;
    const { data, error } = await db.from("profiles").select("id, email, display_name").eq("monthly_email", true).limit(1e4);
    if (error) return reply(500, { error: error.message });
    people = data ?? [];
  } else {
    const me = await userFrom(req, db);
    if (!me) return reply(401, { error: "Sign in first." });
    year = now.getUTCFullYear();
    month = now.getUTCMonth() + 1;
    const hour = now.toISOString().slice(0, 13);
    const { error: dup } = await db.from("email_log").insert({ user_id: me.id, kind: "preview", period: hour });
    if (dup) return reply(429, { error: "You've had a preview in the last hour. Try again later." });
    const { data } = await db.from("profiles").select("id, email, display_name").eq("id", me.id).maybeSingle();
    people = [data ?? { id: me.id, email: me.email, display_name: null }];
  }
  const period = `${year}-${String(month).padStart(2, "0")}`;
  const from = new Date(Date.UTC(year, month - 2, 1));
  const to = new Date(Date.UTC(year, month, 1));
  const result = { period, sent: 0, skipped: 0, failed: [] };
  for (const p of people) {
    try {
      if (isCron) {
        const { data: done } = await db.from("email_log").select("user_id").eq("user_id", p.id).eq("kind", "monthly").eq("period", period).maybeSingle();
        if (done) {
          result.skipped++;
          continue;
        }
      }
      const brief = composeMonthlyBrief(await flightsFor(db, p.id, from, to), year, month, { name: p.display_name, appUrl });
      if (!brief) {
        result.skipped++;
        if (!isCron) return reply(200, { sent: false, reason: "No completed flights this month yet, so there's nothing to send." });
        continue;
      }
      const err = await sendEmail(p.email, p.display_name, isCron ? brief.subject : `Preview: ${brief.subject}`, brief.html, brief.text);
      if (err) {
        result.failed.push(err);
        continue;
      }
      if (isCron) await db.from("email_log").insert({ user_id: p.id, kind: "monthly", period });
      result.sent++;
    } catch (e) {
      result.failed.push(String(e.message ?? e));
    }
  }
  return reply(result.failed.length && !result.sent ? 502 : 200, isCron ? result : { sent: result.sent > 0, error: result.failed[0] ?? null });
});
