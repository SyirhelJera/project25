@echo off
REM Double-clickable version of `node scripts/valorant-login-window.mjs`.
REM
REM Opens a login window in your default browser, waits for you to sign in, and writes the fresh
REM session into scripts/.valorant-session.json. Nothing else has to be running for this — not the
REM local helper server, not the app.
REM
REM With one saved account it refreshes that one. With several it asks which. Pass a label to skip
REM the question (a new label adds an account instead of refreshing one):
REM     valorant-login-window.cmd main
REM
REM Unlike the .vbs launchers next to it, this one keeps its console window: it reports progress
REM and may need an answer from you.

cd /d "%~dp0.."
node scripts/valorant-login-window.mjs %*
echo.
pause
