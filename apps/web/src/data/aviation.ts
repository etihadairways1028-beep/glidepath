/**
 * Names for codes the networks send: airline ICAO codes (from the callsign or OPR/ in the
 * flight plan) and aircraft type designators. Only well-known codes are listed; anything
 * else is shown as the code itself rather than guessed.
 */
export const AIRLINES: Record<string, string> = {
  AAL: "American Airlines", ACA: "Air Canada", AFR: "Air France", AIC: "Air India", ANA: "All Nippon Airways", ANZ: "Air New Zealand",
  ASA: "Alaska Airlines", AUA: "Austrian Airlines", AVA: "Avianca", AZA: "ITA Airways", ITY: "ITA Airways", BAW: "British Airways", BEL: "Brussels Airlines",
  CAL: "China Airlines", CCA: "Air China", CES: "China Eastern", CSN: "China Southern", CPA: "Cathay Pacific", CMP: "Copa Airlines",
  DAL: "Delta Air Lines", DLH: "Lufthansa", EIN: "Aer Lingus", ELY: "El Al", ETD: "Etihad Airways", ETH: "Ethiopian Airlines",
  EVA: "EVA Air", EZY: "easyJet", EJU: "easyJet Europe", EZS: "easyJet Switzerland", FDB: "flydubai", FIN: "Finnair", GIA: "Garuda Indonesia",
  GFA: "Gulf Air", IBE: "Iberia", ICE: "Icelandair", IGO: "IndiGo", JAL: "Japan Airlines", JBU: "JetBlue", JST: "Jetstar",
  KAL: "Korean Air", KLM: "KLM", KQA: "Kenya Airways", LAN: "LATAM", TAM: "LATAM Brasil", LOT: "LOT Polish Airlines",
  MAS: "Malaysia Airlines", MSR: "EgyptAir", NAX: "Norwegian", NOZ: "Norwegian", NKS: "Spirit Airlines", OMA: "Oman Air", PAL: "Philippine Airlines",
  PIA: "Pakistan International", QFA: "Qantas", QTR: "Qatar Airways", RAM: "Royal Air Maroc", RJA: "Royal Jordanian", ROT: "TAROM",
  RYR: "Ryanair", SAA: "South African Airways", SAS: "Scandinavian Airlines", SIA: "Singapore Airlines", SVA: "Saudia", SWA: "Southwest Airlines",
  SWR: "Swiss", TAP: "TAP Air Portugal", THA: "Thai Airways", THY: "Turkish Airlines", PGT: "Pegasus Airlines", TRA: "Transavia", TVF: "Transavia France",
  UAE: "Emirates", UAL: "United Airlines", VIR: "Virgin Atlantic", VOZ: "Virgin Australia", VLG: "Vueling", WZZ: "Wizz Air", WJA: "WestJet",
  FFT: "Frontier Airlines", SKW: "SkyWest", RPA: "Republic Airways", ENY: "Envoy Air", JZA: "Jazz", EWG: "Eurowings", CFG: "Condor",
  TUI: "TUI fly", TOM: "TUI Airways", EXS: "Jet2", AEE: "Aegean Airlines", CSA: "Czech Airlines", BTI: "airBaltic", LGL: "Luxair",
  KZR: "Air Astana", AXB: "Air India Express", SEJ: "SpiceJet", ALK: "SriLankan Airlines", BBC: "Biman Bangladesh", HVN: "Vietnam Airlines",
  VJC: "VietJet Air", AXM: "AirAsia", CEB: "Cebu Pacific", TGW: "Scoot", HAL: "Hawaiian Airlines", AMX: "Aeroméxico",
  VOI: "Volaris", ARG: "Aerolíneas Argentinas", GLO: "Gol", AZU: "Azul", FDX: "FedEx", UPS: "UPS Airlines", GTI: "Atlas Air", CLX: "Cargolux",
  BOX: "AeroLogic", ABW: "AirBridgeCargo", DHK: "DHL Air", BCS: "European Air Transport", KAC: "Kuwait Airways", MEA: "Middle East Airlines",
  ABY: "Air Arabia", JZR: "Jazeera Airways", IAW: "Iraqi Airways", IRA: "Iran Air", AFL: "Aeroflot", SBI: "S7 Airlines", UTA: "UTair",
  DAH: "Air Algérie", TUN: "Tunisair", RWD: "RwandAir", ANG: "Air Niugini", FJI: "Fiji Airways", MAU: "Air Mauritius", SEY: "Air Seychelles",
};

export const AIRCRAFT: Record<string, string> = {
  A19N: "Airbus A319neo", A20N: "Airbus A320neo", A21N: "Airbus A321neo", A318: "Airbus A318", A319: "Airbus A319", A320: "Airbus A320", A321: "Airbus A321",
  A332: "Airbus A330-200", A333: "Airbus A330-300", A338: "Airbus A330-800neo", A339: "Airbus A330-900neo", A342: "Airbus A340-200", A343: "Airbus A340-300",
  A345: "Airbus A340-500", A346: "Airbus A340-600", A359: "Airbus A350-900", A35K: "Airbus A350-1000", A388: "Airbus A380-800", A306: "Airbus A300-600",
  A310: "Airbus A310", BCS1: "Airbus A220-100", BCS3: "Airbus A220-300",
  B712: "Boeing 717", B732: "Boeing 737-200", B733: "Boeing 737-300", B734: "Boeing 737-400", B735: "Boeing 737-500", B736: "Boeing 737-600",
  B737: "Boeing 737-700", B738: "Boeing 737-800", B739: "Boeing 737-900", B37M: "Boeing 737 MAX 7", B38M: "Boeing 737 MAX 8", B39M: "Boeing 737 MAX 9",
  B3XM: "Boeing 737 MAX 10", B744: "Boeing 747-400", B748: "Boeing 747-8", B752: "Boeing 757-200", B753: "Boeing 757-300",
  B762: "Boeing 767-200", B763: "Boeing 767-300", B764: "Boeing 767-400", B772: "Boeing 777-200", B77L: "Boeing 777-200LR", B773: "Boeing 777-300",
  B77W: "Boeing 777-300ER", B778: "Boeing 777-8", B779: "Boeing 777-9", B788: "Boeing 787-8", B789: "Boeing 787-9", B78X: "Boeing 787-10",
  MD11: "McDonnell Douglas MD-11", MD82: "McDonnell Douglas MD-82", MD83: "McDonnell Douglas MD-83", MD88: "McDonnell Douglas MD-88", DC10: "McDonnell Douglas DC-10",
  CONC: "Concorde", E170: "Embraer 170", E175: "Embraer 175", E190: "Embraer 190", E195: "Embraer 195", E290: "Embraer E190-E2", E295: "Embraer E195-E2",
  E135: "Embraer ERJ-135", E145: "Embraer ERJ-145", CRJ2: "Bombardier CRJ200", CRJ7: "Bombardier CRJ700", CRJ9: "Bombardier CRJ900", CRJX: "Bombardier CRJ1000",
  AT72: "ATR 72", AT76: "ATR 72-600", AT75: "ATR 72-500", AT45: "ATR 42-500", AT46: "ATR 42-600", DH8D: "De Havilland Dash 8-400", DH8C: "De Havilland Dash 8-300",
  SF34: "Saab 340", JS41: "BAe Jetstream 41", B461: "BAe 146-100", B462: "BAe 146-200", B463: "BAe 146-300", RJ85: "Avro RJ85", RJ1H: "Avro RJ100",
  C172: "Cessna 172 Skyhawk", C152: "Cessna 152", C182: "Cessna 182 Skylane", C208: "Cessna 208 Caravan", C25A: "Cessna Citation CJ2", C25B: "Cessna Citation CJ3",
  C25C: "Cessna Citation CJ4", C510: "Cessna Citation Mustang", C68A: "Cessna Citation Latitude", C700: "Cessna Citation Longitude", BE58: "Beechcraft Baron 58",
  BE36: "Beechcraft Bonanza", BE9L: "Beechcraft King Air C90", B350: "Beechcraft King Air 350", BE20: "Beechcraft King Air 200", PC12: "Pilatus PC-12",
  PC24: "Pilatus PC-24", TBM9: "Daher TBM 930", TBM8: "Daher TBM 850", SR22: "Cirrus SR22", SF50: "Cirrus Vision Jet", DA40: "Diamond DA40", DA42: "Diamond DA42",
  DA62: "Diamond DA62", PA28: "Piper Cherokee", P28A: "Piper Cherokee", PA34: "Piper Seneca", PA46: "Piper Malibu", GLF4: "Gulfstream IV", GLF5: "Gulfstream V",
  GLF6: "Gulfstream G650", GLEX: "Bombardier Global Express", GL7T: "Bombardier Global 7500", CL60: "Bombardier Challenger 600", LJ45: "Learjet 45",
  F2TH: "Dassault Falcon 2000", FA7X: "Dassault Falcon 7X", FA8X: "Dassault Falcon 8X", H25B: "Hawker 800", E50P: "Embraer Phenom 100", E55P: "Embraer Phenom 300",
  DHC6: "De Havilland Twin Otter", DHC2: "De Havilland Beaver", C130: "Lockheed C-130 Hercules", C17: "Boeing C-17 Globemaster", A400: "Airbus A400M",
  EC35: "Airbus H135", EC45: "Airbus H145", H160: "Airbus H160", B06: "Bell 206", B407: "Bell 407", R44: "Robinson R44", AS50: "Airbus H125",
  ICON: "Icon A5", J3: "Piper J-3 Cub", DR40: "Robin DR400", C310: "Cessna 310", C414: "Cessna 414", KODI: "Daher Kodiak",
};

const WAKE: Record<string, string> = { L: "Light", M: "Medium", H: "Heavy", J: "Super" };
export const wakeName = (w: string | null) => (w ? WAKE[w.toUpperCase()] ?? w : null);

/** Airline from a callsign like SIA005 (three letters then a number), or from the filed operator. */
export function airlineOf(callsign: string, operator?: string | null): { code: string; name: string } | null {
  const code = (operator ?? callsign.match(/^([A-Z]{3})\d/)?.[1] ?? "").toUpperCase();
  return code && AIRLINES[code] ? { code, name: AIRLINES[code]! } : null;
}
export const aircraftName = (type: string | null, model?: string | null) => (type ? AIRCRAFT[type.toUpperCase()] ?? (model ? model : null) : model ?? null);
