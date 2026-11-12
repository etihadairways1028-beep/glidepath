; Glidepath Bridge installer. Built on Linux with makensis (free).
; Installs to Program Files and opens the Windows Firewall for the Bridge,
; so iPads and phones on your Wi-Fi can reach it. Needs one admin prompt.
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
InstallDir "$PROGRAMFILES64\Glidepath Bridge"
InstallDirRegKey HKCU "Software\Glidepath\Bridge" "InstallDir"
RequestExecutionLevel admin
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
!define MUI_WELCOMEPAGE_TEXT "The Bridge runs on the PC with Microsoft Flight Simulator and sends your flight to the Glidepath app on your iPad or phone over Wi-Fi.$\r$\n$\r$\nWindows will ask once for permission: the installer opens the Windows Firewall for the Bridge so your iPad can connect over Wi-Fi."
!define MUI_FINISHPAGE_RUN "$INSTDIR\GlidepathBridge.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Start Glidepath Bridge now"
!define MUI_FINISHPAGE_TEXT "Glidepath Bridge is installed and the firewall is open for it. You'll find it in the Start menu and on your desktop.$\r$\n$\r$\nTo connect your iPad: in Safari go to glidepath.local:4810 and type the code shown in the Bridge window."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  SetShellVarContext current
FunctionEnd
Function un.onInit
  SetShellVarContext current
FunctionEnd

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
  CreateDirectory "$APPDATA\Glidepath\Bridge\logs"
  CreateShortcut "$SMPROGRAMS\Glidepath\Bridge logs (send these if something breaks).lnk" "$APPDATA\Glidepath\Bridge\logs"
  CreateShortcut "$SMPROGRAMS\Glidepath\Uninstall Glidepath Bridge.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\Glidepath Bridge.lnk" "$INSTDIR\GlidepathBridge.exe" "" "$INSTDIR\glidepath.ico"

  ; Firewall: let devices on your network reach the Bridge (all network types,
  ; because Windows often marks home Wi-Fi as "Public").
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Glidepath Bridge"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Glidepath Bridge" dir=in action=allow program="$INSTDIR\GlidepathBridge.exe" enable=yes profile=any'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Glidepath Bridge" dir=in action=allow protocol=TCP localport=4810 enable=yes profile=any'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Glidepath Bridge" dir=in action=allow protocol=TCP localport=4811 enable=yes profile=any'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Glidepath Bridge" dir=in action=allow protocol=UDP localport=5353 program="$INSTDIR\GlidepathBridge.exe" enable=yes profile=any'

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
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Glidepath Bridge"'
  Sleep 800
  Delete "$DESKTOP\Glidepath Bridge.lnk"
  RMDir /r "$SMPROGRAMS\Glidepath"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\GlidepathBridge"
  DeleteRegKey HKCU "Software\Glidepath\Bridge"
  ; Your flights stay in %APPDATA%\Glidepath\Bridge unless you delete that folder yourself.
SectionEnd
