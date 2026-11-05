/**
 * Top-of-descent prediction.
 *
 * This is an ESTIMATE, not simulator data, and every result says so. The
 * model is the standard airline rule of thumb, applied explicitly:
 *
 *   descent distance = (altitude to lose / 1000) × (nm per 1000 ft for the path angle)
 *                    + wind correction (tailwind lengthens, headwind shortens)
 *                    + deceleration allowance (to slow down for each speed constraint)
 *
 * A 3.0° path is 3.14 nm per 1000 ft. Wind correction: the ground distance
 * covered during descent scales with groundspeed / airspeed, so the descent
 * distance is multiplied by GS/TAS (using the mean wind expected in descent).
 */

export interface DescentConstraint {
  /** Distance along the route from the aircraft to the constraint point (nm). */
  distanceNm: number;
  /** Altitude to be at or below at that point (ft MSL). */
  altitudeFt: number;
  label?: string;
}

export interface TodInput {
  currentAltitudeFt: number;
  groundSpeedKt: number;
  /** True airspeed, used for wind correction. Optional. */
  trueAirspeedKt?: number | null;
  /** Expected mean headwind (+) / tailwind (−) during the descent, kt. Optional. */
  descentHeadwindKt?: number | null;
  /** The target the descent must meet: by default the arrival airport at its elevation + 1500 ft. */
  target: DescentConstraint;
  /** Flight path angle, degrees. Default 3.0. */
  pathAngleDeg?: number;
  /** Extra distance to slow down (nm), e.g. ~5 nm to decelerate to 250 kt at FL100. Default 5 for jets. */
  decelerationNm?: number;
}

export interface TodResult {
  kind: "estimate";
  /** Distance from the aircraft to the computed top of descent (nm). Negative = already past it. */
  distanceToTodNm: number;
  /** Minutes until reaching ToD at current groundspeed. Null when past ToD or GS is ~0. */
  minutesToTod: number | null;
  /** Total horizontal distance the descent needs (nm). */
  descentDistanceNm: number;
  /** Vertical speed for the planned path at current GS (fpm, negative). */
  plannedVsFpm: number;
  /** Vertical speed needed from *now* to meet the constraint (fpm, negative), if descending now. */
  requiredVsNowFpm: number | null;
  /** True when ToD is behind the aircraft: a steeper descent than planned is needed. */
  pastTod: boolean;
  altitudeToLoseFt: number;
  pathAngleDeg: number;
  assumptions: string[];
}

const FT_PER_NM = 6076.12;

export function nmPer1000Ft(pathAngleDeg: number): number {
  return 1000 / (Math.tan((pathAngleDeg * Math.PI) / 180) * FT_PER_NM);
}

/** Vertical speed (fpm) that holds a path angle at a groundspeed. ≈ GS × 5.3 for 3°. */
export function vsForPath(groundSpeedKt: number, pathAngleDeg: number): number {
  return -Math.tan((pathAngleDeg * Math.PI) / 180) * groundSpeedKt * (FT_PER_NM / 60);
}

export function computeTopOfDescent(input: TodInput): TodResult {
  const angle = input.pathAngleDeg ?? 3.0;
  const decel = input.decelerationNm ?? 5;
  const assumptions = [`${angle.toFixed(1)}° descent path`, `${decel} nm deceleration allowance`];
  const toLose = Math.max(0, input.currentAltitudeFt - input.target.altitudeFt);

  let distance = (toLose / 1000) * nmPer1000Ft(angle);
  const tas = input.trueAirspeedKt ?? null;
  const hw = input.descentHeadwindKt ?? null;
  if (tas && tas > 50 && hw !== null) {
    // Mean descent TAS is lower than cruise TAS; 0.85 is a conventional approximation.
    const meanTas = tas * 0.85;
    const factor = Math.max(0.6, Math.min(1.4, (meanTas - hw) / meanTas));
    distance *= factor;
    assumptions.push(`wind correction ×${factor.toFixed(2)} (${hw >= 0 ? "headwind" : "tailwind"} ${Math.abs(Math.round(hw))} kt)`);
  } else {
    assumptions.push("no wind correction (no wind data)");
  }
  if (toLose > 0) distance += decel;

  const distanceToTod = input.target.distanceNm - distance;
  const gs = input.groundSpeedKt;
  const minutes = distanceToTod > 0 && gs > 30 ? (distanceToTod / gs) * 60 : null;
  const plannedVs = vsForPath(Math.max(gs, 0), angle);

  let requiredNow: number | null = null;
  const usable = input.target.distanceNm - (toLose > 0 ? decel : 0);
  if (toLose > 0 && gs > 30 && usable > 0) {
    requiredNow = -(toLose / ((usable / gs) * 60));
  }

  return {
    kind: "estimate",
    distanceToTodNm: round1(distanceToTod),
    minutesToTod: minutes === null ? null : round1(minutes),
    descentDistanceNm: round1(distance),
    plannedVsFpm: Math.round(plannedVs),
    requiredVsNowFpm: requiredNow === null ? null : Math.round(requiredNow),
    pastTod: distanceToTod < 0,
    altitudeToLoseFt: Math.round(toLose),
    pathAngleDeg: angle,
    assumptions,
  };
}

/**
 * Picks the most restrictive of several constraints: the one whose
 * computed top of descent comes first (smallest distanceToTod).
 */
export function computeWithConstraints(base: Omit<TodInput, "target">, constraints: DescentConstraint[]): { result: TodResult; governing: DescentConstraint } | null {
  let best: { result: TodResult; governing: DescentConstraint } | null = null;
  for (const c of constraints) {
    if (c.altitudeFt >= base.currentAltitudeFt) continue;
    const result = computeTopOfDescent({ ...base, target: c });
    if (!best || result.distanceToTodNm < best.result.distanceToTodNm) best = { result, governing: c };
  }
  return best;
}

const round1 = (v: number) => Math.round(v * 10) / 10;
