@echo off
title Glidepath Bridge - MSFS probe
cd /d "%~dp0"
echo Make sure MSFS is running with an aircraft loaded.
GlidepathBridge.exe --probe
echo.
echo Send msfs-probe-report.json from this folder back to the developer.
pause
