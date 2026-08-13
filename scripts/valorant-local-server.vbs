' scripts/valorant-local-server.vbs
'
' Starts valorant-local-server.mjs with no console window, so it can sit in shell:startup and
' just be there — the Valorant tab's Live Match panel, "Check Store Now" and "+ Add Account"
' all need it running, and none of them are worth opening a terminal for every time.
'
' Put a shortcut to THIS file in shell:startup (Win+R -> shell:startup). See README.md,
' "Leaving the local helper running".
'
' Double-click to run, or: wscript scripts\valorant-local-server.vbs
'
' There is intentionally no restart-on-crash logic here: this is a plain node:http server with
' no state of its own beyond an in-memory cache, so if it ever does die, starting it again is
' the whole recovery. Use the Task Scheduler recipe in the README if you want that anyway.

Dim shell, here, cmd, extraArgs, i
Set shell = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

extraArgs = ""
For i = 0 To WScript.Arguments.Count - 1
  extraArgs = extraArgs & " " & WScript.Arguments(i)
Next

' `node` is resolved off PATH the same way the README's Task Scheduler entry does. Quoted
' because this repo's own path contains a space on a normal Windows install.
cmd = "node """ & here & "valorant-local-server.mjs""" & extraArgs
shell.Run cmd, 0, False
