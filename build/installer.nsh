; DeepSeek Harness Desktop — NSIS customization.
;
; Adds an "Uninstall" shortcut next to the app shortcut in the Start Menu
; folder, so uninstalling is reachable from the Start Menu (not only from
; Control Panel → Programs and Features).
;
; electron-builder merges this file via `nsis.include` (build/installer.nsh).
; The two macros below are inserted at well-known points:
;   customInstall   → end of the install section (after the app shortcut exists)
;   customUnInstall → start of the uninstall section (before shortcut cleanup)

!ifndef UNINSTALL_SHORTCUT_NAME
  !define UNINSTALL_SHORTCUT_NAME "卸载 DeepSeek Harness"
!endif

!macro customInstall
  ; The uninstaller executable is written to $INSTDIR\Uninstall <product>.exe
  ; by installApplicationFiles before this macro runs.
  !ifdef MENU_FILENAME
    CreateDirectory "$SMPROGRAMS\${MENU_FILENAME}"
    CreateShortCut "$SMPROGRAMS\${MENU_FILENAME}\${UNINSTALL_SHORTCUT_NAME}.lnk" "$INSTDIR\${UNINSTALL_FILENAME}" "" "$INSTDIR\${UNINSTALL_FILENAME}" 0
  !else
    CreateShortCut "$SMPROGRAMS\${UNINSTALL_SHORTCUT_NAME}.lnk" "$INSTDIR\${UNINSTALL_FILENAME}" "" "$INSTDIR\${UNINSTALL_FILENAME}" 0
  !endif
!macroend

!macro customUnInstall
  ; Remove our uninstall shortcut first, so the standard cleanup can then
  ; RMDir the now-empty Start Menu folder without leaving residue behind.
  !ifdef MENU_FILENAME
    Delete "$SMPROGRAMS\${MENU_FILENAME}\${UNINSTALL_SHORTCUT_NAME}.lnk"
    ClearErrors
  !else
    Delete "$SMPROGRAMS\${UNINSTALL_SHORTCUT_NAME}.lnk"
    ClearErrors
  !endif
!macroend

; Force a per-user install so the assisted installer skips the "who should this
; be installed for" page (no admin/UAC needed). The user still gets the
; directory-selection page via allowToChangeInstallationDirectory.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
