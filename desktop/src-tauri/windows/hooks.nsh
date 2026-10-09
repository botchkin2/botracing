; Installer and uninstaller hooks for the tray (Tauri's NSIS template calls
; these macros). Per-user: nothing here needs admin.
;
;  install:    ask a running tray to quit (it closes the open recording with
;              its end time), then remove the old LapUploader / LapRecorder
;              logon tasks if they exist (exact names only)
;  uninstall:  ask the tray to quit; then remove the Start with Windows entry
;              (and Task Manager's switch for it), the Credential Manager
;              sign-in and the token file. %LOCALAPPDATA%\BotRacing stays
;              unless "Delete the application data" is ticked, and then only
;              that folder: %LOCALAPPDATA%\lap-capture is raw race data shared
;              with the Python tools and is never touched.
;
; An update run by the tray ($UpdateMode = 1) keeps everything: the tray has
; already stopped itself, and a person's data, settings and sign-in stay.

!define BOTRACING_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define BOTRACING_APPROVED_KEY "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
!define BOTRACING_DATA "$LOCALAPPDATA\BotRacing"

; `botracing.exe --quit` goes to the running tray through its single-instance
; hold; it stops the watcher and the recorder, then exits. Wait up to 5 s.
!macro BOTRACING_QUIT_TRAY
  Push $0
  Push $1
  Push $2
  nsExec::ExecToStack '"$INSTDIR\${MAINBINARYNAME}.exe" --quit'
  Pop $0
  Pop $1
  StrCpy $2 0
  ${Do}
    nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq ${MAINBINARYNAME}.exe" /NH | find /I "${MAINBINARYNAME}.exe"'
    Pop $0
    Pop $1
    ; find exits 0 while the exe is still listed
    ${If} $0 <> 0
      ${Break}
    ${EndIf}
    IntOp $2 $2 + 1
    ${If} $2 >= 10
      ${Break}
    ${EndIf}
    Sleep 500
  ${Loop}
  Pop $2
  Pop $1
  Pop $0
!macroend

; Ends and deletes one old logon task if it is there. Absent is not an error;
; a refusal (a task made with the highest privileges) is written for the tray
; to say once, never an installer error.
!macro BOTRACING_REMOVE_TASK NAME
  Push $0
  Push $1
  Push $2
  nsExec::ExecToStack 'schtasks /Query /TN "${NAME}"'
  Pop $0
  Pop $1
  ${If} $0 = 0
    nsExec::ExecToStack 'schtasks /End /TN "${NAME}"'
    Pop $0
    Pop $1
    nsExec::ExecToStack 'schtasks /Delete /TN "${NAME}" /F'
    Pop $0
    Pop $1
    CreateDirectory "${BOTRACING_DATA}"
    ${If} $0 = 0
      DetailPrint "Removed the old ${NAME} logon task"
    ${Else}
      DetailPrint "Could not remove the old ${NAME} task: ask Task Scheduler"
      FileOpen $2 "${BOTRACING_DATA}\old-tasks.txt" a
      FileSeek $2 0 END
      FileWrite $2 "${NAME}$\r$\n"
      FileClose $2
    ${EndIf}
    FileOpen $2 "${BOTRACING_DATA}\install.log" a
    FileSeek $2 0 END
    FileWrite $2 "old task ${NAME}: delete exit code $0$\r$\n"
    FileClose $2
  ${EndIf}
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  ${If} $UpdateMode <> 1
    !insertmacro BOTRACING_QUIT_TRAY
  ${EndIf}
  !insertmacro BOTRACING_REMOVE_TASK "LapUploader"
  !insertmacro BOTRACING_REMOVE_TASK "LapRecorder"
!macroend

!macro NSIS_HOOK_POSTINSTALL
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    !insertmacro BOTRACING_QUIT_TRAY
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "${BOTRACING_RUN_KEY}" "BotRacing"
    DeleteRegValue HKCU "${BOTRACING_APPROVED_KEY}" "BotRacing"
    ; keyring's target name: "<user>.<service>" = account.BotRacing
    nsExec::ExecToStack 'cmdkey /delete:account.BotRacing'
    Pop $0
    Pop $1
    Delete "${BOTRACING_DATA}\token"
    Delete "${BOTRACING_DATA}\token.tmp"
    ${If} $DeleteAppDataCheckboxState = 1
      RMDir /r "${BOTRACING_DATA}"
    ${EndIf}
  ${EndIf}
!macroend
