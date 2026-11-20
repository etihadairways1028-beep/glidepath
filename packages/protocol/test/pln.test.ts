import { describe, expect, it } from "vitest";
import { FlightPlan, parsePln, parseWorldPosition } from "../src/index";

const PLN = `<?xml version="1.0" encoding="UTF-8"?>
<SimBase.Document Type="AceXML" version="1,0"><Descr>AceXML Document</Descr>
<FlightPlan.FlightPlan>
<Title>EGLL to EGCC</Title><FPType>IFR</FPType><RouteType>HighAlt</RouteType><CruisingAlt>24000</CruisingAlt>
<DepartureID>EGLL</DepartureID><DepartureLLA>N51° 28' 39.00",W0° 27' 41.00",+000083.00</DepartureLLA>
<DestinationID>EGCC</DestinationID><DestinationLLA>N53° 21' 13.00",W2° 16' 30.00",+000257.00</DestinationLLA>
<DepartureName>Heathrow</DepartureName><DestinationName>Manchester</DestinationName>
<ATCWaypoint id="EGLL"><ATCWaypointType>Airport</ATCWaypointType><WorldPosition>N51° 28' 39.00",W0° 27' 41.00",+000083.00</WorldPosition><RunwayNumberFP>27</RunwayNumberFP><ICAO><ICAOIdent>EGLL</ICAOIdent></ICAO></ATCWaypoint>
<ATCWaypoint id="BPK"><ATCWaypointType>VOR</ATCWaypointType><WorldPosition>N51° 44' 59.00",W0° 6' 24.00",+012000.00</WorldPosition><DepartureFP>BPK7G</DepartureFP><ICAO><ICAOIdent>BPK</ICAOIdent></ICAO></ATCWaypoint>
<ATCWaypoint id="DTY"><ATCWaypointType>VOR</ATCWaypointType><WorldPosition>N52° 10' 50.00",W1° 6' 52.00",+024000.00</WorldPosition><ATCAirway>UL612</ATCAirway><ICAO><ICAOIdent>DTY</ICAOIdent></ICAO></ATCWaypoint>
<ATCWaypoint id="TNT"><ATCWaypointType>VOR</ATCWaypointType><WorldPosition>N53° 3' 14.00",W1° 40' 12.00",+010000.00</WorldPosition><ArrivalFP>TNT1A</ArrivalFP><ICAO><ICAOIdent>TNT</ICAOIdent></ICAO></ATCWaypoint>
<ATCWaypoint id="EGCC"><ATCWaypointType>Airport</ATCWaypointType><WorldPosition>N53° 21' 13.00",W2° 16' 30.00",+000257.00</WorldPosition><ICAO><ICAOIdent>EGCC</ICAOIdent></ICAO></ATCWaypoint>
</FlightPlan.FlightPlan></SimBase.Document>`;

describe("MSFS .PLN flight plans", () => {
  it("reads positions in degrees, minutes and seconds", () => {
    const p = parseWorldPosition(`N51° 28' 39.00",W0° 27' 41.00",+000083.00`)!;
    expect(p.lat).toBeCloseTo(51.4775, 3); expect(p.lon).toBeCloseTo(-0.46139, 3); expect(p.altFt).toBe(83);
  });
  it("turns a plan into airports, waypoints, SID and STAR", () => {
    const p = FlightPlan.parse(parsePln(PLN, 1));
    expect(p.source).toBe("msfs");
    expect(p.origin.icao).toBe("EGLL"); expect(p.destination.icao).toBe("EGCC"); expect(p.origin.runway).toBe("27");
    expect(p.fixes.map((f) => f.ident)).toEqual(["BPK", "DTY", "TNT"]);
    expect(p.fixes[0]!.proc).toBe("sid"); expect(p.fixes[2]!.proc).toBe("star");
    expect(p.sid).toBe("BPK7G"); expect(p.star).toBe("TNT1A");
    expect(p.cruiseAltitudeFt).toBe(24000);
    expect(p.route).toBe("BPK7G UL612 DTY TNT1A");
    expect(p.distanceNm).toBeGreaterThan(120); expect(p.distanceNm).toBeLessThan(170);
  });
  it("refuses files that aren't flight plans", () => { expect(() => parsePln("<x/>")).toThrow(); });
});
