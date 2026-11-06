GLIDEPATH BRIDGE 0.6.0 (EARLY TEST BUILD) - WINDOWS
====================================================

The Bridge runs on the PC where you fly Microsoft Flight Simulator. It reads
your flight from the simulator and shows it live on your iPad or phone over
your home Wi-Fi. It also records every flight and grades your landings.

THIS IS AN EARLY TEST BUILD
- It has not been tested on Windows yet: you are the first tester.
- It is not code-signed yet, so Windows SmartScreen will warn you.
  Click "More info" -> "Run anyway". (Signed builds come before public release.)
- The native iPad/iPhone app with Lock Screen Live Activities is not built yet.
  Your iPad gets the full Glidepath web app from the Bridge instead (live map,
  flight trail, flight monitor, logbook, airports). Add it to your Home Screen.

WHAT YOU SEE IN THE WINDOW
  A black window with log lines is normal: that IS the Bridge. Keep it open
  while you fly; close it to stop the Bridge. It says "Waiting for Microsoft
  Flight Simulator" until you start the sim, then connects by itself.

STEP 1 - TRY THE DEMO (no simulator needed)
  Double-click "Run demo flight.bat".
  It replays a SYNTHETIC test flight (generated, not real) from London Heathrow
  to Manchester at 20x speed. Everything shows a REPLAY badge.

STEP 2 - CONNECT YOUR iPAD
  The Bridge opens  http://localhost:4810  in your browser by itself.
  That page shows a QR code and a link for your iPad: scan it with the
  iPad camera. There is also an "Open Glidepath" button for this PC.
  Open that link on your iPad (same Wi-Fi). It opens the Glidepath app.
  In Safari, tap Share -> "Add to Home Screen" to get a Glidepath icon
  that opens straight to your live flight.
  If Windows Firewall asks, allow Glidepath Bridge on PRIVATE networks only.
  The link contains your private pairing key: only open it on your own devices.

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
  Runways, taxiways with their letters, aprons, gates and stand numbers
  show when you zoom in on an airport, on every map style. The 3D button
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
  It writes msfs-probe-report.json in this folder. Send that file back so the
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
