import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChartService, dtppCycle, parseDtpp } from "../src/charts.js";

const XML = `<?xml version="1.0"?><digital_tpp cycle="2611" from_edate="0901Z  10/29/26" to_edate="0900Z  11/26/26">
<state_code ID="NY"><city_name ID="NEW YORK" volume="NE-2">
<airport_name ID="JOHN F KENNEDY INTL" military="N" apt_ident="JFK" icao_ident="KJFK" alnum="610">
<record><chartseq>10100</chartseq><chart_code>MIN</chart_code><chart_name>TAKEOFF MINIMUMS</chart_name><useraction></useraction><pdf_name>NE2TO.PDF</pdf_name></record>
<record><chartseq>10200</chartseq><chart_code>IAP</chart_code><chart_name>ILS OR LOC RWY 04L</chart_name><useraction></useraction><pdf_name>00610IL4L.PDF</pdf_name></record>
<record><chartseq>10300</chartseq><chart_code>APD</chart_code><chart_name>AIRPORT DIAGRAM</chart_name><useraction></useraction><pdf_name>00610AD.PDF</pdf_name></record>
<record><chartseq>10400</chartseq><chart_code>STR</chart_code><chart_name>ROBER TWO (RNAV)</chart_name><useraction></useraction><pdf_name>00610ROBER.PDF</pdf_name></record>
<record><chartseq>10500</chartseq><chart_code>DP</chart_code><chart_name>KENNEDY FIVE</chart_name><useraction>D</useraction><pdf_name>00610KENNEDY.PDF</pdf_name></record>
</airport_name></city_name></state_code></digital_tpp>`;

describe("FAA charts", () => {
  it("works out the 28-day cycle number", () => {
    expect(dtppCycle(Date.UTC(2026, 5, 11, 12))).toBe("2606");
    expect(dtppCycle(Date.UTC(2026, 7, 6, 12))).toBe("2608");
    expect(dtppCycle(Date.UTC(2026, 10, 11))).toBe("2611");
    expect(dtppCycle(Date.UTC(2026, 0, 22, 12))).toBe("2601");
    expect(dtppCycle(Date.UTC(2027, 0, 25))).toBe("2701");
  });
  it("parses charts per airport, sorted, skipping deleted ones", () => {
    const m = parseDtpp(XML, "2611");
    const c = m.get("KJFK")!;
    expect(c.map((x) => x.kind)).toEqual(["airport", "arrival", "approach", "minimums"]);
    expect(c[0]!.url).toBe("https://aeronav.faa.gov/d-tpp/2611/00610AD.PDF");
    expect(m.get("JFK")).toBe(c);
  });
  it("downloads the index once and answers by ICAO", async () => {
    let calls = 0;
    const svc = new ChartService(mkdtempSync(join(tmpdir(), "gpc-")), async (url) => { calls++; return new Response(XML.replace('cycle="2611"', `cycle="${dtppCycle()}"`), { status: url.includes("d-tpp_Metafile") ? 200 : 404 }); });
    const a = await svc.forAirport("kjfk");
    expect(a?.charts.length).toBe(4);
    expect(a?.effective).toContain("10/29/26");
    expect(await svc.forAirport("EGLL")).toBeNull();
    expect(calls).toBe(1);
  });
});
