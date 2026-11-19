/**
 * Network traffic, weather and SimBrief, all fetched through the Bridge
 * (see apps/bridge/src/external.ts for why). Without a Bridge these return
 * a clear "needs Bridge" error, never placeholder data.
 */
import { useEffect, useState } from "react";
import type { FlightPlan } from "@glidepath/protocol";
import { activeBridge } from "./bridge";

export interface NetworkPilot { callsign: string; lat: number; lon: number; altFt: number; gsKt: number; hdg: number; type: string | null; dep: string | null; arr: string | null; network: Network; squawk?: string | null }
export type Network = "vatsim" | "ivao" | "sayintentions" | "sim";
export const NETWORK_LABEL: Record<Network, string> = { vatsim: "VATSIM", ivao: "IVAO", sayintentions: "SayIntentions", sim: "Sim AI traffic" };
export interface NetworkController { callsign: string; frequency: string | null; facility: string; atis: string[]; network: Network }
export interface NetworkSnapshot { network: Network; updatedAt: string; pilots: NetworkPilot[]; controllers: NetworkController[] }
export interface Metar { icao: string; raw: string; observed: string | null; windDir: number | "VRB" | null; windKt: number | null; gustKt: number | null; visibility: string | null; tempC: number | null; dewC: number | null; qnhHpa: number | null; category: string | null; clouds: Array<{ cover: string; baseFt: number | null }> }
export interface Taf { icao: string; raw: string; issued: string | null }

import { parseMetars, parseTafs } from "@glidepath/protocol";
import { publicGet } from "./cloud";

export class NeedsBridge extends Error {
  constructor() {
    super("Connect your Bridge to load live data. It fetches this for every device on your Wi-Fi.");
  }
}

function bridge() {
  const b = activeBridge();
  if (!b) throw new NeedsBridge();
  return b;
}

export const getNetwork = (n: Network) => bridge().get<NetworkSnapshot>(`/api/ext/${n}`);
export interface Stand { ref: string; kind: "gate" | "stand"; lat: number; lon: number; distanceM: number }
export const getStands = (lat: number, lon: number) => bridge().get<Stand[]>(`/api/ext/stands?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`);
/** Live METAR/TAF: through the Bridge when connected, otherwise through the Glidepath service, so it works on any device. */
export async function getMetar(ids: string[]): Promise<Metar[]> {
  const b = activeBridge();
  if (b) { try { return await b.get<Metar[]>(`/api/ext/metar?ids=${ids.join(",")}`); } catch { /* fall through */ } }
  return parseMetars(await publicGet<unknown>(`/wx/metar?ids=${ids.join(",")}`));
}
export async function getTaf(ids: string[]): Promise<Taf[]> {
  const b = activeBridge();
  if (b) { try { return await b.get<Taf[]>(`/api/ext/taf?ids=${ids.join(",")}`); } catch { /* fall through */ } }
  return parseTafs(await publicGet<unknown>(`/wx/taf?ids=${ids.join(",")}`));
}
export const loadPlan = (user: string) => bridge().post<FlightPlan>("/api/plan", { user });

/** Poll something while a component is mounted. */
export function usePoll<T>(fn: (() => Promise<T>) | null, everyMs: number, deps: unknown[] = []): { data: T | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: !!fn });
  useEffect(() => {
    if (!fn) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let alive = true;
    let timer: number;
    const run = async () => {
      try {
        const data = await fn();
        if (alive) setState({ data, error: null, loading: false });
      } catch (e) {
        if (alive) setState((s) => ({ data: s.data, error: (e as Error).message, loading: false }));
      }
      if (alive) timer = window.setTimeout(run, everyMs);
    };
    void run();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
