/**
 * "What's new" — shown once, the first time a new version of the app opens.
 * New users (nothing stored yet) don't see it; they get the welcome instead.
 * Keep APP_VERSION in step with the version in Settings and the site (release checklist).
 */
import { useEffect, useState } from "react";
import { Icon } from "./ui";

export const APP_VERSION = "1.4.4";
const KEY = "glidepath.seenVersion";

export type WnIcon = "map" | "flight" | "remote" | "book" | "gear" | "spark" | "download" | "search" | "tower" | "cloud" | "layers" | "target" | "headset";
export interface WnItem { v: string; ic: WnIcon; t: string; d: string }
export const WHATS_NEW: WnItem[] = [
  { v: "1.4.4", ic: "flight", t: "One flight card", d: "The Flight screen no longer shows two profiles. The live card now holds the full climb, cruise and descent profile with your aircraft on it, and the plan below keeps its runways, SID, STAR, figures, route and waypoints." },
  { v: "1.4.3", ic: "layers", t: "A chart library for every airport", d: "Charts now lists every chart for the airport in one place: the airport diagram, every STAR, approach and SID, grouped and searchable, with your flight's own procedures pinned at the top. Pinch or double-tap any chart to zoom, and step through them with the arrows." },
  { v: "1.4.3", ic: "spark", t: "Lighter liquid glass", d: "Glass panels now have a light rim that catches at the top, and they blur once instead of stacking blurs inside blurs. Cards below the fold aren't drawn until you scroll to them, so long screens scroll smoother." },
  { v: "1.4.2", ic: "layers", t: "Approach charts: minimums and the final descent", d: "Every approach chart now shows TCH and the missed approach altitude, and a table of your altitude at each mile to the threshold on the glidepath. Type your baro DA or MDA from your official chart once: it's drawn on the profile, with your height above the threshold, and kept for that approach." },
  { v: "1.4.2", ic: "map", t: "Airport diagrams, properly", d: "Taxi charts now show the airport's elevation, variation and ATIS, ground and tower frequencies, each runway's magnetic heading, length and width, threshold markings, a scale and north arrow. Taxiway names never overlap. Tap Full screen for the whole display." },
  { v: "1.4.1", ic: "search", t: "Charts for any airport, including the biggest hubs", d: "Search any airport by code, name or city. Big hubs no longer time out while the sim sends thousands of taxiways, and airports you've opened before load instantly. Zoom in and more taxiway names appear." },
  { v: "1.4.1", ic: "spark", t: "Smoother everywhere", d: "The background no longer moves behind the glass panels, which made iPads stutter. Charts redraw only your aircraft with each update, and panning a big airport stays fluid." },
  { v: "1.4.0", ic: "map", t: "Taxi charts for every airport in MSFS", d: "Charts › Taxi chart draws any airport from your simulator's own scenery: runways and their numbers, every taxiway with its name, hold-short bars, gates and stands, with your aircraft moving on it. Day and night, pinch to zoom." },
  { v: "1.4.0", ic: "layers", t: "Procedure charts", d: "Charts › Procedure charts draws any approach, STAR or SID from the sim's navigation data in printed-chart style: title block, fix symbols, altitude and speed restrictions, course and distance on every leg, holds, the missed approach and the approach profile. Tap Chart next to any procedure in your flight setup." },
  { v: "1.3.3", ic: "target", t: "Real holding patterns", d: "Holds now come from the sim's own navdata: the published inbound course (magnetic, like your chart), turn direction, leg length in nm or minutes, and speed and altitude limits. Your chosen approach's holds draw by themselves. Anywhere else, type the hold from your chart or ATC." },
  { v: "1.3.3", ic: "book", t: "Unload a flight any time", d: "On Home, Unload flight saves it to your logbook with the hours so far, landed or not, after asking you first. If your PC isn't reachable, it's sent the moment it is." },
  { v: "1.3.3", ic: "map", t: "Procedures stay after the sim closes", d: "Once your PC has read an airport's SIDs, STARs and approaches from the sim, the Bridge and this device keep them, so you can plan and pick your approach with the sim closed. If they can't load, you'll see why and a Try again button." },
  { v: "1.3.2", ic: "remote", t: "Pair once, then just open the app", d: "Add Glidepath to your iPad's Home Screen after pairing and it opens already connected every time, on the page you left, with no code. Your PC also remembers your SimBrief name, so every device loads your flight by itself." },
  { v: "1.3.2", ic: "map", t: "The whole approach, to the runway", d: "Pick an approach and the map draws it from the end of your STAR through every fix and altitude to the runway. While choosing, every approach shows with its name in a box, like a chart app. Paths come from the sim's own navdata." },
  { v: "1.3.2", ic: "spark", t: "ATIS and weather on the airport cards", d: "See the information letter (Information Golf) from VATSIM or IVAO when ATIS is online, tap for the full text, plus wind, visibility, cloud, temperature and QNH at a glance." },
  { v: "1.3.2", ic: "layers", t: "A smoother flight profile", d: "Climb, cruise and descent drawn as curves, coloured by phase, with clear TOC, TOD and cruise level labels." },
  { v: "1.3.1", ic: "target", t: "Pick your SID, STAR and approach like a chart app", d: "Open the flight plan on the map: a route bar, Origin and Destination cards with runway wind, and lists of departures, arrivals and approaches by runway with transitions. Point at a runway to see its final approach course on the map; Glidepath warns you when a procedure doesn't fit the runway." },
  { v: "1.3.1", ic: "book", t: "Logbook cards", d: "Your totals at the top, and each flight as a card: callsign, route, block time, landing rate, aircraft, registration and simulator." },
  { v: "1.3.0", ic: "spark", t: "A new look for every page", d: "Every button, switch, field, card and list was rebuilt as one design: calmer glass, a single blue accent, clearer text and the same controls everywhere, in dark and light." },
  { v: "1.3.0", ic: "map", t: "A real navlog", d: "The flight plan is grouped into Departure, En route and Arrival with your SID and STAR, top of climb and descent between the waypoints, the next waypoint highlighted with a progress bar, ticks on passed ones and live ETAs." },
  { v: "1.2.0", ic: "book", t: "Every flight reaches your logbook", d: "Home shows what's being logged, with block and flight time as you go. After landing, press Finish flight to save it. If you close the sim after landing, or leave it at the gate, it's still saved as a finished flight with its times." },
  { v: "1.2.0", ic: "spark", t: "A much faster logbook", d: "It opens instantly with the copy saved on this device, then refreshes from your PC with a list that's many times smaller than before." },
  { v: "1.1.9", ic: "spark", t: "Smoother everywhere", d: "Screens cross-fade into each other instead of jumping, cards arrive in a gentle cascade, panels glide in, and buttons ease instead of snapping." },
  { v: "1.1.8", ic: "map", t: "SimBrief waypoints fixed", d: "Newer SimBrief plans store the route differently, and Glidepath read them as having no waypoints, SID or STAR. Every waypoint from your latest SimBrief plan now comes through." },
  { v: "1.1.8", ic: "spark", t: "Direct-to can't empty your plan", d: "Before and after a flight you always see the full plan, it starts fresh after landing, and it never drops more than half the route or your TOC and TOD." },
  { v: "1.1.8", ic: "flight", t: "A calmer route card", d: "The climb and descent profile is now a compact, flat strip, easier to read at a glance." },
  { v: "1.1.7", ic: "map", t: "Your full route, even with Fenix and PMDG", d: "When the route is only in the aircraft's MCDU, the sim just knows \"direct to the destination\". Glidepath now spots that, fetches your SimBrief plan for the same flight by itself, and explains what to do if it can't." },
  { v: "1.1.7", ic: "flight", t: "Climb, cruise and descent at a glance", d: "Your route card shows the vertical profile with top of climb and top of descent, how far away they are, and where you are now." },
  { v: "1.1.7", ic: "headset", t: "A hands-free copilot", d: "Ask out loud with the mic button, have answers read back, and see phase, what's next, fuel at arrival and arrival time at the top." },
  { v: "1.1.7", ic: "target", t: "Minimums and crab angle", d: "Set your minimums for an \"approaching minimums\" and \"minimums\" call and countdown. The landing helper also shows the crab angle the wind needs." },
  { v: "1.1.7", ic: "remote", t: "A better remote and cockpit tools", d: "See your actual speed, heading, altitude and V/S next to what's set, drag a value like a knob, and read the active modes at a glance. Open several add-on screens as tabs, two side by side." },
  { v: "1.1.7", ic: "book", t: "Logbook without the PC", d: "If Glidepath can't reach your PC, the logbook shows your last saved flights and says why, instead of \"Failed to fetch\"." },
  { v: "1.1.6", ic: "target", t: "A simpler landing helper", d: "One target: the centre is the perfect path, the dot is you. A big plain instruction with arrows (\"Ease right\", \"Descend a bit more\"), a descent-rate gauge, and distance, height and wind. The ILS view is one tap away." },
  { v: "1.1.6", ic: "map", t: "Your flight plan on the live map", d: "A new Flight plan button on the map shows the whole route, with runways, SID, STAR and every waypoint to tap. A newly loaded plan is shown in full straight away." },
  { v: "1.1.6", ic: "spark", t: "New plan after a finished flight", d: "A SimBrief plan you load after landing now shows everywhere at once, instead of waiting for the next flight to start. Your SimBrief plan also beats a thinner plan from the sim." },
  { v: "1.1.5", ic: "target", t: "Approach guide for low visibility", d: "A synthetic ILS for any runway, RNAV approaches included: glidepath and centreline diamonds, a side and top view, the descent rate you need, a stable-approach check and optional spoken callouts. It pops up on Home and the map on final." },
  { v: "1.1.5", ic: "download", t: "Import your plan from Home", d: "Load SimBrief straight from Home and see the whole route: runways, SID, STAR and every waypoint with its airway, plus fuel, weights and times." },
  { v: "1.1.5", ic: "map", t: "Direct-to follows your MCDU", d: "Fly direct to a later waypoint and Glidepath notices within seconds, drops the waypoints you skipped from the map and navlog, and lets you put them back." },
  { v: "1.1.5", ic: "spark", t: "A Home that's ready before you fly", d: "Before a flight, Home shows your connection, sim and plan at a glance. Also fixed: the slim iPad sidebar could stay wide after Glance mode." },
  { v: "1.1.4", ic: "flight", t: "Takeoff and landing performance", d: "A new Performance page, EFB style: V1, VR, V2, flex, trim, Vapp, autobrake and runway distances for over 40 aircraft, filled in from your plan and the live METAR. Change the runway, SID and STAR right there." },
  { v: "1.1.4", ic: "layers", t: "Pick your look", d: "Settings → Look: Liquid glass, Cockpit (avionics readouts), Sunset or Neon night. It changes every screen, on every device." },
  { v: "1.1.4", ic: "spark", t: "Light mode fixed", d: "On a device set to light mode, page titles and the Home tiles were hard to read. They're clear now." },
  { v: "1.1.3", ic: "remote", t: "The code keeps you in the app", d: "Typing the code never takes you to another page. Opening your PC's address on an iPad now moves you to the newest Glidepath, already connected." },
  { v: "1.1.3", ic: "layers", t: "Polished liquid glass", d: "Soft colour drifts behind every panel, so the glass really looks like glass: brighter edges, deeper shadows, a floating sidebar and tab bar." },
  { v: "1.1.3", ic: "spark", t: "More room on iPad", d: "In landscape, the sidebar becomes a slim icon rail so the map and dashboard get the space." },
  { v: "1.1.2", ic: "remote", t: "A real autopilot panel", d: "Remote now looks like the glareshield: glowing orange displays, chunky keys and green bars that light when AP, FD or A/THR are on." },
  { v: "1.1.2", ic: "target", t: "Checklists that feel good", d: "A ring that fills as you tick, items that turn green, and a jump straight to the next checklist when you finish." },
  { v: "1.1.2", ic: "book", t: "Your rank, on your shoulder", d: "Career shows a gold-striped shoulder board for your rank. The logbook welcomes you properly before your first flight." },
  { v: "1.1.1", ic: "target", t: "Your landing, celebrated", d: "Touch down and your grade lands on screen with your fpm and g. Nail it and there's confetti." },
  { v: "1.1.1", ic: "cloud", t: "A sky that flies with you", d: "Clouds drift behind the app, the sun or moon follows the time where your aircraft is, and stars come out at night and in cruise." },
  { v: "1.1.1", ic: "spark", t: "A glowing flight card", d: "Your live flight card has a soft light running around its edge." },
  { v: "1.1.0", ic: "spark", t: "A new Home while you fly", d: "A live dashboard: the map, altitude, speed, vertical speed and fuel with their trend, your next waypoint, and the weather where you're going." },
  { v: "1.1.0", ic: "search", t: "Easier to read", d: "Bigger labels everywhere, smoother text and numbers that line up, so you can read it at a glance." },
  { v: "1.1.0", ic: "layers", t: "A cleaner, more modern look", d: "Glowing highlights, quick actions as compact buttons, and cards that react when you tap them." },
  { v: "1.0.9", ic: "remote", t: "Pair by code on any Wi-Fi", d: "Type the code on your iPad and stay right where you are. If your router blocks the direct link, Glidepath goes through its own relay instead. Your PC still checks the code." },
  { v: "1.0.9", ic: "download", t: "A new Updates page", d: "See which version of the app and the Bridge you have, check for updates and watch them install." },
  { v: "1.0.9", ic: "spark", t: "Better on iPad and phone", d: "Bigger tab bar, notifications that stay out of the way, and your live flight first on the Flight screen." },
  { v: "1.0.8", ic: "download", t: "Updates by itself", d: "The app on your iPad, phone and PC switches to the newest version by itself. The Bridge installs its updates while the sim is closed." },
  { v: "1.0.7", ic: "map", t: "Your MSFS flight plan on the map", d: "Plan in the MSFS world map (or load a .PLN) and Glidepath shows the route, SID and STAR by itself. SimBrief loads by itself too once you've saved your SimBrief name." },
  { v: "1.0.7", ic: "target", t: "Safer with the simulator", d: "The Bridge only reads your own aircraft. Sim AI traffic and the sim's SID/STAR lists are off, so they can't upset MSFS." },
  { v: "1.0.5", ic: "gear", t: "A new Bridge", d: "A cleaner Bridge window: live altitude, speed and heading, and one place to connect your iPad by code, account or QR." },
  { v: "1.0.5", ic: "search", t: "Flight cards like a tracker", d: "Tap any aircraft for a bold flight card, live data tiles and a smooth trail. Search with Ctrl+F." },
  { v: "1.0.5", ic: "cloud", t: "SimBrief without the Bridge", d: "Load your latest plan on any device and see it on the map before you start the sim." },
  { v: "1.0.4", ic: "layers", t: "Your plan on the live map", d: "Route, SID and STAR with every waypoint's planned altitude, top of climb and descent, your active leg, and holds at any waypoint." },
  { v: "1.0.4", ic: "gear", t: "Glidepath in its own window", d: "On your PC, the Bridge opens Glidepath in its own app window, already connected." },
  { v: "1.0.3", ic: "flight", t: "A full flight plan", d: "Route, every waypoint with airway, altitude and distance, where you are along it, fuel and weights." },
  { v: "1.0.3", ic: "remote", t: "Connects by itself", d: "Open Glidepath on the sim PC and it's connected. Paired devices stay paired and reconnect when the Bridge opens." },
  { v: "1.0.2", ic: "tower", t: "Online now", d: "Search any callsign or airport on the live map, see the busiest airports, follow pilots with a star, and spot emergencies." },
  { v: "1.0.2", ic: "book", t: "Your logbook, mapped", d: "Every flight on one map, a short replay video of each, and you can delete flights." },
];

function read(): string | null { try { return localStorage.getItem(KEY); } catch { return null; } }
function write(v: string) { try { localStorage.setItem(KEY, v); } catch { /* private mode: show again next time, harmless */ } }

/** Open the sheet from anywhere (Settings › What's new). */
export function showWhatsNew() { window.dispatchEvent(new Event("gp-whatsnew")); }

export function WhatsNew() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const seen = read();
    if (seen === null) write(APP_VERSION); // first ever open: nothing to compare against
    else if (seen !== APP_VERSION) { const id = setTimeout(() => setOpen(true), 900); return () => clearTimeout(id); }
  }, []);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener("gp-whatsnew", on);
    return () => window.removeEventListener("gp-whatsnew", on);
  }, []);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);
  const close = () => { write(APP_VERSION); setOpen(false); };
  if (!open) return null;
  const latest = WHATS_NEW.filter((x) => x.v === WHATS_NEW[0]!.v);
  const earlier = WHATS_NEW.filter((x) => x.v !== WHATS_NEW[0]!.v).slice(0, 6);
  return (
    <div className="wn-scrim" onClick={close}>
      <div className="wn-sheet" role="dialog" aria-modal="true" aria-labelledby="wn-title" onClick={(e) => e.stopPropagation()}>
        <div className="wn-hero" aria-hidden="true">
          <svg viewBox="0 0 400 150" className="wn-sky">
            <defs><linearGradient id="wnl" x1="0" x2="1"><stop offset="0" stopColor="#5E5CE6" stopOpacity="0" /><stop offset=".5" stopColor="#64D2FF" /><stop offset="1" stopColor="#5E5CE6" stopOpacity="0" /></linearGradient></defs>
            <path className="wn-arc" d="M-10 130 C 120 10, 280 10, 410 130" fill="none" stroke="url(#wnl)" strokeWidth="2.5" strokeLinecap="round" />
            <g className="wn-plane"><path d={PLANE} fill="#fff" /></g>
            {[[40, 30], [90, 70], [160, 22], [250, 55], [330, 28], [370, 80], [210, 100]].map(([x, y], k) => <circle key={k} cx={x} cy={y} r={k % 2 ? 1.2 : 1.8} className="wn-star" style={{ animationDelay: `${k * 0.35}s` }} />)}
          </svg>
          <div className="wn-ver">Glidepath {APP_VERSION}</div>
        </div>
        <div className="wn-body">
          <h2 id="wn-title">What's new</h2>
          <div className="wn-cards">
            {latest.map((x, k) => (
              <div className="wn-card" key={x.t} style={{ animationDelay: `${150 + k * 90}ms` }}>
                <span className="wn-ic">{Icon[x.ic]()}</span>
                <div><b>{x.t}</b><p>{x.d}</p></div>
              </div>
            ))}
          </div>
          {earlier.length > 0 && <>
            <p className="wn-h">Recently</p>
            <ul className="wn-list">
              {earlier.map((x, k) => <li key={x.t} style={{ animationDelay: `${450 + k * 60}ms` }}><span className="wn-tag">{x.v}</span><div><b>{x.t}</b><span>{x.d}</span></div></li>)}
            </ul>
          </>}
        </div>
        <div className="wn-foot">
          <a className="btn" href="#/updates" onClick={close}>All updates</a>
          <button className="btn primary" onClick={close} autoFocus>Continue</button>
        </div>
      </div>
    </div>
  );
}

const PLANE = "M15 0C15-1.3 13.4-2.2 11.5-2.2H3L-5.5-14h-3l4 11.8H-11L-14.5-7h-2l1.6 4.8V2.2L-16.5 7h2L-11 2.2h6.5l-4 11.8h3L3 2.2h8.5C13.4 2.2 15 1.3 15 0z";
