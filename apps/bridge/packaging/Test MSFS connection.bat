@echo off
title Glidepath Bridge - MSFS probe
cd /d "%USERPROFILE%\Desktop"
echo Make sure MSFS is running with an aircraft loaded.
"%~dp0GlidepathBridge.exe" --probe
echo.
echo The report msfs-probe-report.json is on your Desktop. Send it back to the developer.
pause
