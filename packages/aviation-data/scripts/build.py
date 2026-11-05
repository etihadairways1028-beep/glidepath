"""Builds compact airport, runway and frequency files from OurAirports
(https://ourairports.com/data/, public domain). Run:
    python3 scripts/build.py <dir-with-airports.csv-runways.csv-airport-frequencies.csv>
Writes data/airports.json, data/runways.json, data/frequencies.json, data/meta.json.
"""
import csv, json, math, sys, datetime, os

src = sys.argv[1]
out = os.path.join(os.path.dirname(__file__), "..", "data")
TYPES = {"large_airport": "L", "medium_airport": "M", "small_airport": "S"}

def f(v, nd=None):
    try:
        x = float(v)
        return round(x, nd) if nd is not None else x
    except (TypeError, ValueError):
        return None

airports, keep = [], {}
with open(os.path.join(src, "airports.csv"), newline="", encoding="utf-8") as fh:
    for r in csv.DictReader(fh):
        t = TYPES.get(r["type"])
        if not t:
            continue
        lat, lon = f(r["latitude_deg"], 5), f(r["longitude_deg"], 5)
        if lat is None or lon is None:
            continue
        code = (r["icao_code"] or r["gps_code"] or r["ident"]).strip().upper()
        elev = f(r["elevation_ft"])
        # [code, iata, name, city, country, lat, lon, elevFt, type]
        airports.append([code, r["iata_code"] or "", r["name"], r["municipality"] or "", r["iso_country"], lat, lon, None if elev is None else int(elev), t])
        keep[r["ident"]] = (code, t)

def heading(lat1, lon1, lat2, lon2):
    p1, p2, dl = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360

runways = {}
with open(os.path.join(src, "runways.csv"), newline="", encoding="utf-8") as fh:
    for r in csv.DictReader(fh):
        k = keep.get(r["airport_ident"])
        if not k or r["closed"] == "1":
            continue
        code, t = k
        le = (f(r["le_latitude_deg"], 6), f(r["le_longitude_deg"], 6))
        he = (f(r["he_latitude_deg"], 6), f(r["he_longitude_deg"], 6))
        if None in le or None in he:
            continue  # no threshold coordinates: cannot be used for touchdown analysis
        length, width = f(r["length_ft"]), f(r["width_ft"])
        hl = f(r["le_heading_degT"]) or heading(*le, *he)
        hh = f(r["he_heading_degT"]) or heading(*he, *le)
        # [leIdent, leLat, leLon, leHdgT, heIdent, heLat, heLon, heHdgT, lengthFt, widthFt, surface, lighted, leDisplacedFt, heDisplacedFt]
        runways.setdefault(code, []).append([
            r["le_ident"], le[0], le[1], round(hl, 1), r["he_ident"], he[0], he[1], round(hh, 1),
            None if length is None else int(length), None if width is None else int(width),
            (r["surface"] or "").upper()[:12], r["lighted"] == "1", int(f(r["le_displaced_threshold_ft"]) or 0), int(f(r["he_displaced_threshold_ft"]) or 0),
        ])

freqs = {}
with open(os.path.join(src, "airport-frequencies.csv"), newline="", encoding="utf-8") as fh:
    for r in csv.DictReader(fh):
        k = keep.get(r["airport_ident"])
        mhz = f(r["frequency_mhz"], 3)
        if not k or k[1] == "S" or mhz is None:
            continue
        freqs.setdefault(k[0], []).append([r["type"], r["description"], mhz])

os.makedirs(out, exist_ok=True)
json.dump(airports, open(os.path.join(out, "airports.json"), "w"), separators=(",", ":"), ensure_ascii=False)
json.dump(runways, open(os.path.join(out, "runways.json"), "w"), separators=(",", ":"), ensure_ascii=False)
json.dump(freqs, open(os.path.join(out, "frequencies.json"), "w"), separators=(",", ":"), ensure_ascii=False)
json.dump({"source": "OurAirports (https://ourairports.com/data/), public domain", "built": datetime.date.today().isoformat(),
           "airports": len(airports), "airportsWithRunways": len(runways), "airportsWithFrequencies": len(freqs)},
          open(os.path.join(out, "meta.json"), "w"), indent=2)
print(json.load(open(os.path.join(out, "meta.json"))))
