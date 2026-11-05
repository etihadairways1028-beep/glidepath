@echo off
title Glidepath Bridge - DEMO (synthetic flight)
cd /d "%~dp0"
echo Replaying a SYNTHETIC test flight at 20x speed. Open http://localhost:4810 to pair your iPad.
GlidepathBridge.exe --adapter replay --replay "demo\SYNTHETIC-EGLL-EGCC.ndjson" --speed 20
pause
