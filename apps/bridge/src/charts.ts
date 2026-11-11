/**
 * Airport charts from the FAA's digital Terminal Procedures Publication
 * (d-TPP): free, public, official charts for every US airport with
 * instrument procedures (airport diagrams, SIDs, STARs, approaches, minimums).
 *
 * The FAA publishes a new set every 28 days with an XML index of every chart.
 * The Bridge downloads that index once per cycle (about 15 MB), keeps a small
 * per-airport index on disk, and hands the app a list of chart PDFs, which the
 * app opens straight from the FAA.
 *
 * Outside the US there is no free worldwide chart API we may use: Navigraph's
 * charts API is only licensed to software running inside the simulator, and
 * ChartFox needs your own sign-in. The app links to both instead.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type ChartKind = "airport" | "departure" | "arrival" | "approach" | "minimums" | "other";
export interface Chart { name: string; kind: ChartKind; code: string; url: string }
export interface AirportCharts { icao: string; source: "FAA d-TPP"; cycle: string; effective: string | null; charts: Chart[] }

const DAY = 86_400_000;
/** Cycle 2606 took effect on 11 June 2026; cycles are 28 days and numbered from 01 each calendar year. */
const ANCHOR = Date.UTC(2026, 5, 11);

/** The d-TPP cycle in force at a time, e.g. "2611". */
export function dtppCycle(now = Date.now()): string {
  const steps = Math.floor((now - ANCHOR) / (28 * DAY));
  const eff = ANCHOR + steps * 28 * DAY;
  const year = new Date(eff).getUTCFullYear();
  // Count the cycles that took effect earlier in the same year.
  let n = 1;
  for (let t = eff - 28 * DAY; new Date(t).getUTCFullYear() === year; t -= 28 * DAY) n++;
  return `${String(year).slice(2)}${String(n).padStart(2, "0")}`;
}

const KIND: Record<string, ChartKind> = { APD: "airport", DP: "departure", ODP: "departure", DAU: "departure", STAR: "arrival", STR: "arrival", IAP: "approach", MIN: "minimums", LAH: "other", HOT: "other" };
const ORDER: ChartKind[] = ["airport", "departure", "arrival", "approach", "minimums", "other"];

const tag = (block: string, name: string): string => {
  const m = block.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return m ? m[1]!.trim() : "";
};
const unescape = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** Parse the d-TPP metafile into ICAO (and FAA ident) → charts. */
export function parseDtpp(xml: string, cycle: string): Map<string, Chart[]> {
  const out = new Map<string, Chart[]>();
  const apt = /<airport_name\b([^>]*)>([\s\S]*?)<\/airport_name>/g;
  let m: RegExpExecArray | null;
  while ((m = apt.exec(xml))) {
    const attrs = m[1]!;
    const icao = (attrs.match(/icao_ident="([^"]*)"/)?.[1] ?? "").trim().toUpperCase();
    const ident = (attrs.match(/apt_ident="([^"]*)"/)?.[1] ?? "").trim().toUpperCase();
    const charts: Chart[] = [];
    for (const r of m[2]!.split(/<record>/).slice(1)) {
      const code = tag(r, "chart_code").toUpperCase();
      const pdf = tag(r, "pdf_name");
      const action = tag(r, "useraction").toUpperCase();
      if (!pdf || action === "D") continue; // deleted this cycle
      charts.push({ name: unescape(tag(r, "chart_name")), code, kind: KIND[code] ?? "other", url: `https://aeronav.faa.gov/d-tpp/${cycle}/${pdf}` });
    }
    if (!charts.length) continue;
    charts.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.name.localeCompare(b.name, "en", { numeric: true }));
    if (icao) out.set(icao, charts);
    if (ident && !out.has(ident)) out.set(ident, charts);
  }
  return out;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export class ChartService {
  private index: { cycle: string; map: Map<string, Chart[]>; effective: string | null } | null = null;
  private loading: Promise<void> | null = null;

  constructor(private readonly dir: string, private readonly fetchImpl: Fetch = fetch, private readonly log?: { info(m: string): void; warn(m: string): void }) {}

  async forAirport(code: string): Promise<AirportCharts | null> {
    const c = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,4}$/.test(c)) return null;
    await this.ensure();
    const list = this.index!.map.get(c) ?? (c.length === 4 && c.startsWith("K") ? this.index!.map.get(c.slice(1)) : undefined);
    if (!list) return null;
    return { icao: c, source: "FAA d-TPP", cycle: this.index!.cycle, effective: this.index!.effective, charts: list };
  }

  private async ensure(): Promise<void> {
    const cycle = dtppCycle();
    if (this.index?.cycle === cycle) return;
    if (!this.loading) this.loading = this.load(cycle).finally(() => { this.loading = null; });
    await this.loading;
  }

  private async load(cycle: string): Promise<void> {
    const file = join(this.dir, `dtpp-${cycle}.json`);
    try {
      const saved = JSON.parse(await readFile(file, "utf8")) as { effective: string | null; entries: Array<[string, Chart[]]> };
      this.index = { cycle, effective: saved.effective, map: new Map(saved.entries) };
      return;
    } catch { /* not cached yet */ }
    this.log?.info(`Downloading the FAA chart index for cycle ${cycle} (about 15 MB, once every 28 days)…`);
    let xml = "";
    let lastErr = "";
    for (const name of ["d-tpp_Metafile.xml", "d-TPP_Metafile.xml"]) {
      const res = await this.fetchImpl(`https://aeronav.faa.gov/d-tpp/${cycle}/xml_data/${name}`, { signal: AbortSignal.timeout(120_000) }).catch((e: Error) => { lastErr = e.message; return null; });
      if (res?.ok) { xml = await res.text(); break; }
      if (res) lastErr = `HTTP ${res.status}`;
    }
    if (!xml) throw new Error(`Couldn't download the FAA chart index (${lastErr}).`);
    const map = parseDtpp(xml, cycle);
    const effective = xml.match(/from_edate="([^"]*)"/)?.[1]?.trim() ?? null;
    this.index = { cycle, effective, map };
    await mkdir(this.dir, { recursive: true }).catch(() => undefined);
    await writeFile(file, JSON.stringify({ effective, entries: [...map.entries()] })).catch(() => undefined);
    this.log?.info(`FAA charts ready: ${map.size.toLocaleString("en-US")} airports.`);
  }
}
