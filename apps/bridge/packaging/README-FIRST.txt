GLIDEPATH BRIDGE 0.1.0 (EARLY TEST BUILD) - WINDOWS
====================================================

The Bridge runs on the PC where you fly Microsoft Flight Simulator. It reads
your flight from the simulator and shows it live on your iPad or phone over
your home Wi-Fi. It also records every flight and grades your landings.

THIS IS AN EARLY TEST BUILD
- It has not been tested on Windows yet: you are the first tester.
- It is not code-signed yet, so Windows SmartScreen will warn you.
  Click "More info" -> "Run anyway". (Signed builds come before public release.)
- The native iPad/iPhone app with Lock Screen Live Activities is not built yet.
  For now, your iPad shows the live flight in Safari.

STEP 1 - TRY THE DEMO (no simulator needed)
  Double-click "Run demo flight.bat".
  It replays a SYNTHETIC test flight (generated, not real) from London Heathrow
  to Manchester at 20x speed. Everything shows a REPLAY badge.

STEP 2 - CONNECT YOUR iPAD
  On this PC, open  http://localhost:4810  in a browser.
  It shows a link for each network address of this PC.
  Open that link on your iPad (same Wi-Fi). Tip: in Safari, tap Share ->
  "Add to Home Screen" to open it like an app.
  If Windows Firewall asks, allow Glidepath Bridge on PRIVATE networks only.
  The link contains your private pairing key: only open it on your own devices.

STEP 3 - FLY FOR REAL
  1. Start Microsoft Flight Simulator 2020 or 2024 and load a flight.
  2. Double-click "Start Bridge.bat".
  3. The Bridge connects by itself once the sim is running.
  Nothing is installed in your Community folder.

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
  - Departure/arrival airports are not filled in yet (needs SimBrief, next stage).
  - Add-on aircraft (PMDG, Fenix, FBW, iniBuilds, FSLabs): position, speeds,
    engines and fuel are shown; their autopilot/lights/radios show "-" until
    each aircraft profile is verified.
  - No remote control yet. No X-Plane yet.
