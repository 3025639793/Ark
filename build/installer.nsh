!macro customInstall
  ; A marker distinguishes the installed application from an unpacked ZIP.
  FileOpen $0 "$INSTDIR\.ark-installed" w
  FileWrite $0 "Ark installed application"
  FileClose $0
!macroend
