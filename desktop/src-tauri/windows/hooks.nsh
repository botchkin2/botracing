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
; An update run by the tray ($UpdateMode = 1) keeps everything: a person's
; data, settings and sign-in stay. The tray is already quitting (it started
; this installer), so the installer only waits for it to be gone.

!define BOTRACING_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define BOTRACING_APPROVED_KEY "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
!define BOTRACING_DATA "$LOCALAPPDATA\BotRacing"

; `botracing.exe --quit` goes to the running tray through its single-instance
; hold, or, when the tray is in another session or window station, through the
; quit-request file in its data folder (quit_request.rs), which its poll loop
; reads every 5 s. It stops the watcher and both recorders, then exits.
!macro BOTRACING_QUIT_TRAY
  Push $0
  Push $1
  nsExec::ExecToStack '"$INSTDIR\${MAINBINARYNAME}.exe" --quit'
  Pop $0
  Pop $1
  Pop $1
  Pop $0
  !insertmacro BOTRACING_WAIT_TRAY_GONE
!macroend

; Waits up to 15 s until this user's tray is gone (another user's is not ours
; to wait for). An update needs it too: the tray starts the installer and then
; exits, and an installer that wrote first met "Error opening file for writing:
; ...\botracing.exe" (update rehearsal, 1 run in 5; pit wall thread 71). A tray
; still running after 15 s is written to install.log and the install goes on
; into NSIS's own Retry dialog: nothing here ever ends a process.
!macro BOTRACING_WAIT_TRAY_GONE
  Push $0
  Push $1
  Push $2
  StrCpy $2 0
  ${Do}
    nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq ${MAINBINARYNAME}.exe" /FI "USERNAME eq %USERNAME%" /NH | find /I "${MAINBINARYNAME}.exe"'
    Pop $0
    Pop $1
    ; find exits 0 while the exe is still listed
    ${If} $0 <> 0
      ${Break}
    ${EndIf}
    IntOp $2 $2 + 1
    ${If} $2 >= 30
      ${Break}
    ${EndIf}
    Sleep 500
  ${Loop}
  ${If} $2 > 0
    CreateDirectory "${BOTRACING_DATA}"
    FileOpen $1 "${BOTRACING_DATA}\install.log" a
    FileSeek $1 0 END
    ${If} $0 = 0
      FileWrite $1 "tray still running after 15 s (update mode $UpdateMode)$\r$\n"
    ${Else}
      IntOp $2 $2 * 500
      FileWrite $1 "waited $2 ms for the tray to exit (update mode $UpdateMode)$\r$\n"
    ${EndIf}
    FileClose $1
  ${EndIf}
  ; Gone from the process list is not the same as free: in the rehearsal the
  ; write still failed after the tray was gone (pit wall thread 71). Wait,
  ; again up to 15 s, until the exe opens for writing; opening it changes
  ; nothing.
  StrCpy $2 0
  ${If} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
    ${Do}
      ClearErrors
      FileOpen $0 "$INSTDIR\${MAINBINARYNAME}.exe" a
      ${IfNot} ${Errors}
        FileClose $0
        ${Break}
      ${EndIf}
      IntOp $2 $2 + 1
      ${If} $2 >= 30
        ${Break}
      ${EndIf}
      Sleep 500
    ${Loop}
  ${EndIf}
  ${If} $2 > 0
    CreateDirectory "${BOTRACING_DATA}"
    FileOpen $1 "${BOTRACING_DATA}\install.log" a
    FileSeek $1 0 END
    IntOp $2 $2 * 500
    FileWrite $1 "waited $2 ms for the exe to be writable (update mode $UpdateMode)$\r$\n"
    FileClose $1
  ${EndIf}
  Pop $2
  Pop $1
  Pop $0
!macroend

; Which hook ran and with what command line, so a rehearsal failure says
; whether the installer knew it was an update (pit wall thread 71).
!macro BOTRACING_LOG_HOOK NAME
  Push $1
  CreateDirectory "${BOTRACING_DATA}"
  FileOpen $1 "${BOTRACING_DATA}\install.log" a
  FileSeek $1 0 END
  FileWrite $1 "${NAME}: update mode [$UpdateMode], command line [$CMDLINE]$\r$\n"
  FileClose $1
  Pop $1
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
  !insertmacro BOTRACING_LOG_HOOK "preinstall"
  ${If} $UpdateMode <> 1
    !insertmacro BOTRACING_QUIT_TRAY
  ${Else}
    !insertmacro BOTRACING_WAIT_TRAY_GONE
  ${EndIf}
  !insertmacro BOTRACING_REMOVE_TASK "LapUploader"
  !insertmacro BOTRACING_REMOVE_TASK "LapRecorder"
!macroend

!macro NSIS_HOOK_POSTINSTALL
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro BOTRACING_LOG_HOOK "preuninstall"
  ${If} $UpdateMode <> 1
    !insertmacro BOTRACING_QUIT_TRAY
  ${Else}
    !insertmacro BOTRACING_WAIT_TRAY_GONE
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
