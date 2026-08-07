' scripts/valorant-widget.vbs
'
' Starts valorant-widget.ps1 with no console window at all. `powershell -WindowStyle Hidden`
' still flashes a black console for a moment as it starts, which is fine from a terminal and
' ugly at login - so put a shortcut to THIS file in shell:startup instead of the .ps1.
'
' Double-click to run, or: wscript scripts\valorant-widget.vbs
' Pass the same switches through if you want them, e.g. -Label main -NoAutoCheck.

Dim shell, here, cmd, extraArgs, i
Set shell = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

extraArgs = ""
For i = 0 To WScript.Arguments.Count - 1
  extraArgs = extraArgs & " " & WScript.Arguments(i)
Next

cmd = "powershell -ExecutionPolicy Bypass -NoProfile -File """ & here & "valorant-widget.ps1""" & extraArgs
shell.Run cmd, 0, False
