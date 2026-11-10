GLIDEPATH BRIDGE 0.8.5 (EARLY TEST BUILD) - WINDOWS
====================================================

The Bridge runs on the PC where you fly Microsoft Flight Simulator. It reads
your flight from the simulator and shows it live on your iPad or phone over
your home Wi-Fi. It also records every flight and grades your landings.

THIS IS AN EARLY TEST BUILD
- It has not been tested on Windows yet: you are the first tester.
- It is not code-signed yet, so Windows SmartScreen will warn you.
  Click "More info" -> "Run anyway". (Signed builds come before public release.)
- If your antivirus removes GlidepathBridge.exe, restore it from the
  antivirus quarantine and allow it. Unsigned new programs get flagged.

INSTALLING
  Easiest: run GlidepathBridge-Setup.exe from the website. Windows asks once
  for permission: the installer opens the Windows Firewall for the Bridge,
  so your iPad can reach it over Wi-Fi. It adds Glidepath to the Start menu
  and the desktop, and can be removed in Settings > Apps.
  Using the zip instead? When Windows asks about network access, tick BOTH
  Private and Public networks and click Allow.
  Or use this zip: right-click it, Extract All, then open the extracted
  folder. Don't run the Bridge from inside the zip without extracting.
- The native iPad/iPhone app with Lock Screen Live Activities is not built yet.
  Your iPad gets the full Glidepath web app from the Bridge instead (live map,
  flight trail, flight monitor, logbook, airports). Add it to your Home Screen.

WHAT YOU SEE IN THE WINDOW
  A black window with log lines is normal: that IS the Bridge. Keep it open
  while you fly; close it to stop the Bridge. It says "Waiting for Microsoft
  Flight Simulator" until you start the sim, then connects by itself.

STEP 1 - TRY THE DEMO (no simulator needed)
  Start menu > Glidepath > Glidepath demo flight
  (or double-click "Run demo flight.bat" in the extracted zip).
  It replays a SYNTHETIC test flight (generated, not real) from London Heathrow
  to Manchester at 20x speed. Everything shows a REPLAY badge.

SOMETHING NOT WORKING?
  Start menu > Glidepath > Bridge logs. Send the newest bridge-....log file,
  plus a photo of the Bridge window.

STEP 2 - CONNECT YOUR iPAD (same Wi-Fi as this PC)
  1. On the iPad, open Safari and go to:   glidepath.local:4810
  2. Type the 6-digit code shown in the Bridge window on this PC.
  That's it: Glidepath opens, connected to your PC.
  Or: open the Glidepath website on the iPad, type the same code on the
  Home screen and tap Connect. (Uses a secure address for your PC under
  local-ip.sh; your flight data still goes straight across your Wi-Fi.)
  To keep it as an app: tap Share, then Add to Home Screen.
  If glidepath.local doesn't open, the Bridge window also shows your PC's
  number address (http://192.168...:4810), or scan the QR code on the
  page the Bridge opens on this PC.

STEP 3 - FLY FOR REAL
  1. Start Microsoft Flight Simulator 2020 or 2024 and load a flight.
  2. Double-click "Start Bridge.bat".
  3. The Bridge connects by itself once the sim is running.
  Nothing is installed in your Community folder.

COCKPIT TOOLS (NEW IN 0.6)
  In the app, open Cockpit tools (on a phone: More, then Cockpit tools).
  The Bridge checks which add-on web pages are running on this PC and lets
  you open them on your iPad or phone:
    Fenix EFB and MCDU (port 8083), FSLabs EFB (23032), GSX Pro remote
    (8744, GSX 4.0.6 or newer) and FlyByWire SimBridge (8380).
  Add any other port yourself. If Windows asks whether the add-on may use
  the network, allow it on private networks, or the iPad can't reach it.
  PMDG 737 and 777: their EFB isn't a web page, so it can't be opened.
  CDU mirroring through the PMDG SDK is planned.

MAP (NEW IN 0.6)
  The map is now a clean street map in light or dark, like the maps on
  your phone. Runways, taxiways with their letters, aprons, gates and
  stand numbers show when you zoom in on an airport, on every map style.
  On the ground the map zooms in by itself; after take-off it steps back.
  Each airport page in the app has its own airport map. The 3D button
  tilts the map over real terrain and flies a chase camera behind you.

LOGBOOK, TRAFFIC AND ACCOUNTS
  Every flight saves itself when you park. The Logbook shows your hours,
  average landing, records and a year of flying. On the map, the layers
  button picks satellite or one of six map styles, and switches VATSIM,
  IVAO and SayIntentions traffic on or off. Once accounts are switched on,
  sign in under Account to keep your logbook on every device.

DEBRIEF
  When you park, the app writes a debrief of the flight: how the rotation
  and climb-out went, speed and bank, whether the approach was stable at
  1,000 ft, and the landing in plain words with the sink rate. Find it on
  Home, on the Flight page, and in the Logbook.

COPILOT (NEW IN 0.3)
  In the app, open Copilot. It works straight away with no AI service: it
  answers common questions from your live flight, flags problems (sink rate,
  gear, speed, fuel, crosswind, descent timing) and can speak callouts.
  Optional: connect an AI model for any question. Free options:
    - Ollama on this PC (free, private): install from ollama.com, then run
      "ollama pull llama3.2" and pick "Ollama on this PC" in Copilot.
    - Google Gemini or Groq: paste your own free-tier key in Copilot.
  Keys are saved only on this PC (in the Bridge data folder).

STEP 4 - PLEASE RUN THE PROBE ONCE AND SEND ME THE REPORT
  With MSFS running and an aircraft loaded, double-click "Test MSFS connection.bat".
  During the 15 seconds, bank RIGHT and pitch the nose UP.
  It writes msfs-probe-report.json on your Desktop. Send that file back so the
  simulator connection can be verified for your setup.

WHERE YOUR DATA IS
  %APPDATA%\Glidepath\Bridge   (flights.sqlite, logs\, bridge.json)
  bridge.json holds your pairing key. Delete it to generate a new key
  (all paired devices then need the new link).

KNOWN LIMITS OF THIS BUILD
  - Live traffic (VATSIM/IVAO), weather, gates and SimBrief plans are fetched
    by the Bridge from the internet; they have not been tested end to end yet.
  - Add-on aircraft (PMDG, Fenix, FBW, iniBuilds, FSLabs): position, speeds,
    engines and fuel are shown; their autopilot/lights/radios show "-" until
    each aircraft profile is verified.
  - No remote control yet. No X-Plane yet. No Lock Screen card yet (needs the
    native iPad app).
