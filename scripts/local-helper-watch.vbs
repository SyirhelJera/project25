' scripts/local-helper-watch.vbs
'
' Starts local-helper-watch.mjs with no console window. This is the one to put in shell:startup
' (Win+R -> shell:startup) if you want the local helper to exist only while a Riot client is open
' — the watcher starts it when Riot appears and stops it when Riot goes.
'
' Use this INSTEAD of valorant-local-server.vbs, not alongside it. Running both is harmless (the
' watcher checks the port and won't start a second server) but pointless: the always-on one would
' never let the watcher stop anything.
'
' Double-click to run, or: wscript scripts\local-helper-watch.vbs
'
' Because it's windowless you stop it from Task Manager (node.exe) rather than with Ctrl+C —
' killing the watcher also kills the helper it started. See README.md, "Leaving the local helper
' running".

Dim shell, here, cmd, extraArgs, i
Set shell = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

extraArgs = ""
For i = 0 To WScript.Arguments.Count - 1
  extraArgs = extraArgs & " " & WScript.Arguments(i)
Next

' `node` is resolved off PATH the same way the README's Task Scheduler entry does. Quoted
' because this repo's own path contains a space on a normal Windows install.
cmd = "node """ & here & "local-helper-watch.mjs""" & extraArgs
shell.Run cmd, 0, False
