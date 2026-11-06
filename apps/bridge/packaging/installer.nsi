; Glidepath Bridge installer. Built on Linux with makensis (free).
; Installs for the current user only, so it needs no admin password.
Unicode true
!include "MUI2.nsh"
!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!ifndef SRC
  !define SRC "Glidepath Bridge"
!endif

Name "Glidepath Bridge"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Glidepath Bridge"
InstallDirRegKey HKCU "Software\Glidepath\Bridge" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "Glidepath ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Glidepath Bridge"
VIAddVersionKey "FileDescription" "Glidepath Bridge installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Glidepath"

!define MUI_ICON "glidepath.ico"
!define MUI_UNICON "glidepath.ico"
!define MUI_WELCOMEPAGE_TITLE "Install Glidepath Bridge ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "The Bridge runs on the PC with Microsoft Flight Simulator and sends your flight to the Glidepath app on your iPad or phone over Wi-Fi.$\r$\n$\r$\nIt installs just for you, no admin password needed."
!define MUI_FINISHPAGE_RUN "$INSTDIR\GlidepathBridge.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Start Glidepath Bridge now"
!define MUI_FINISHPAGE_TEXT "Glidepath Bridge is installed. You'll find it in the Start menu and on your desktop.$\r$\n$\r$\nThe first time it starts, Windows may ask whether it can use the network. Tick Private networks and choose Allow, or your iPad can't reach it."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  ; Stop a running copy so its files can be replaced.
  nsExec::Exec 'taskkill /F /IM GlidepathBridge.exe'
  Sleep 800
  SetOutPath "$INSTDIR"
  File "${SRC}\GlidepathBridge.exe"
  File "${SRC}\README-FIRST.txt"
  File "${SRC}\Start Bridge.bat"
  File "${SRC}\Run demo flight.bat"
  File "${SRC}\Test MSFS connection.bat"
  File "glidepath.ico"
  SetOutPath "$INSTDIR\demo"
  File "${SRC}\demo\SYNTHETIC-EGLL-EGCC.ndjson"
  SetOutPath "$INSTDIR"

  CreateDirectory "$SMPROGRAMS\Glidepath"
  CreateShortcut "$SMPROGRAMS\Glidepath\Glidepath Bridge.lnk" "$INSTDIR\GlidepathBridge.exe" "" "$INSTDIR\glidepath.ico"
  CreateShortcut "$SMPROGRAMS\Glidepath\Glidepath demo flight.lnk" "$INSTDIR\Run demo flight.bat" "" "$INSTDIR\glidepath.ico"
  CreateShortcut "$SMPROGRAMS\Glidepath\Test MSFS connection.lnk" "$INSTDIR\Test MSFS connection.bat" "" "$INSTDIR\glidepath.ico"
  CreateShortcut "$SMPROGRAMS\Glidepath\Read me first.lnk" "$INSTDIR\README-FIRST.txt"
  CreateShortcut "$SMPROGRAMS\Glidepath\Uninstall Glidepath Bridge.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\Glidepath Bridge.lnk" "$INSTDIR\GlidepathBridge.exe" "" "$INSTDIR\glidepath.ico"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Glidepath\Bridge" "InstallDir" "$INSTDIR"
  !define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\GlidepathBridge"
  WriteRegStr HKCU "${UNKEY}" "DisplayName" "Glidepath Bridge"
  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNKEY}" "Publisher" "Glidepath"
  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR\glidepath.ico"
  WriteRegStr HKCU "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM GlidepathBridge.exe'
  Sleep 800
  Delete "$DESKTOP\Glidepath Bridge.lnk"
  RMDir /r "$SMPROGRAMS\Glidepath"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\GlidepathBridge"
  DeleteRegKey HKCU "Software\Glidepath\Bridge"
  ; Your flights stay in %APPDATA%\Glidepath\Bridge unless you delete that folder yourself.
SectionEnd
