@echo off
title Glidepath Bridge - DEMO (synthetic flight)
echo Replaying a SYNTHETIC test flight at 20x speed. Open http://localhost:4810 to pair your iPad.
"%~dp0GlidepathBridge.exe" --adapter replay --replay "%~dp0demo\SYNTHETIC-EGLL-EGCC.ndjson" --speed 20
pause
