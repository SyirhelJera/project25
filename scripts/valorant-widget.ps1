<#
.SYNOPSIS
  Always-on-top desktop widget showing today's Valorant store.

.DESCRIPTION
  Reads scripts/.valorant-latest-store.json - the local snapshot written by every store check
  (valorant-check-store.mjs, the scheduled task, and the Valorant tab's "Check Store Now" button
  alike, via writeStoreSnapshot() in valorant-lib.mjs) - and draws it as a small borderless panel
  pinned above other windows. No network calls of its own except downloading each skin's art once
  into a local cache, and no dependencies beyond what ships with Windows: plain WinForms, which is
  why this is a .ps1 and not an Electron/Tauri app (this repo has no build step - see CLAUDE.md).

  Drag anywhere to move; the position is remembered in .valorant-widget-config.json.
  Click the account name to cycle accounts, the refresh glyph to run a fresh store check
  (shells out to `node scripts/valorant-check-store.mjs <label>`), and x to close.

.PARAMETER Label
  Account to show first. Defaults to the first one in the snapshot.

.PARAMETER NoAutoCheck
  Don't automatically run a store check when the snapshot is older than the current rotation.
  Refreshing by hand still works.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File scripts\valorant-widget.ps1

  Start it at login by putting a shortcut to that command in shell:startup.
#>
[CmdletBinding()]
param(
  [string]$Label,
  [switch]$NoAutoCheck
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
[System.Windows.Forms.Application]::EnableVisualStyles()

$ScriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoDir      = Split-Path -Parent $ScriptDir
$SnapshotFile = Join-Path $ScriptDir '.valorant-latest-store.json'
$ConfigFile   = Join-Path $ScriptDir '.valorant-widget-config.json'
$CacheDir     = Join-Path $ScriptDir '.valorant-widget-cache'
$CheckScript  = Join-Path $ScriptDir 'valorant-check-store.mjs'
$LogFile      = Join-Path $ScriptDir '.valorant-widget.log'

# WinForms swallows exceptions thrown inside event handlers, so a widget started with
# -WindowStyle Hidden would otherwise just stop updating with no clue why. Every handler runs
# through Invoke-Guarded, which appends the failure here.
function Write-WidgetLog($msg) {
  try { "$([datetime]::Now.ToString('s')) $msg" | Out-File -FilePath $LogFile -Append -Encoding utf8 } catch { }
}
function Invoke-Guarded([scriptblock]$block) {
  try { & $block } catch { Write-WidgetLog "ERROR: $($_.Exception.Message) [$($_.InvocationInfo.ScriptLineNumber)]" }
}

# Same dark palette as the app's dark theme (styles.css :root / [data-theme="dark"]).
$ColBg       = [System.Drawing.Color]::FromArgb(28, 31, 43)    # --surface
$ColBgAlt    = [System.Drawing.Color]::FromArgb(36, 40, 56)    # --surface-alt
$ColText     = [System.Drawing.Color]::FromArgb(231, 233, 245) # --text
$ColMuted    = [System.Drawing.Color]::FromArgb(156, 163, 184) # --muted
$ColFaint    = [System.Drawing.Color]::FromArgb(91, 97, 120)   # --faint
$ColViolet   = [System.Drawing.Color]::FromArgb(129, 140, 248) # --violet
$ColGold     = [System.Drawing.Color]::FromArgb(251, 191, 36)  # --gold
$ColDanger   = [System.Drawing.Color]::FromArgb(248, 113, 113) # --danger

$FontTitle  = New-Object System.Drawing.Font('Segoe UI Semibold', 9)
$FontName   = New-Object System.Drawing.Font('Segoe UI', 9)
$FontPrice  = New-Object System.Drawing.Font('Segoe UI Semibold', 9)
$FontSmall  = New-Object System.Drawing.Font('Segoe UI', 8)
$FontGlyph  = New-Object System.Drawing.Font('Segoe UI Symbol', 9)

$WidgetWidth = 340

# ---------------------------------------------------------------- state

$script:Snapshot     = $null
$script:Labels       = @()
$script:ActiveLabel  = $Label
$script:CheckProc    = $null
$script:LastAutoTry  = [datetime]::MinValue
$script:RenderedKey  = ''
$script:StatusText   = ''
$script:Dragging     = $false
$script:DragOrigin   = $null
$script:FormOrigin   = $null

# ---------------------------------------------------------------- data

function Read-Snapshot {
  if (-not (Test-Path $SnapshotFile)) { return $null }
  try { Get-Content $SnapshotFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $null }
}

function Get-AccountLabels($snap) {
  if ($null -eq $snap -or $null -eq $snap.accounts) { return @() }
  @($snap.accounts.PSObject.Properties | ForEach-Object { $_.Name } | Sort-Object)
}

function Get-Account($snap, $label) {
  if ($null -eq $snap -or $null -eq $snap.accounts -or -not $label) { return $null }
  $prop = $snap.accounts.PSObject.Properties[$label]
  if ($null -eq $prop) { return $null }
  $prop.Value
}

function ConvertFrom-EpochMs([double]$ms) {
  if (-not $ms) { return $null }
  [System.DateTimeOffset]::FromUnixTimeMilliseconds([long]$ms).LocalDateTime
}

function Format-Checked([datetime]$checked) {
  $ago = [datetime]::Now - $checked
  if ($ago.TotalMinutes -lt 1) { return 'checked just now' }
  'checked ' + (Format-Duration $ago) + ' ago'
}

function Format-Duration([timespan]$ts) {
  if ($ts.TotalSeconds -le 0) { return 'now' }
  if ($ts.TotalDays -ge 1)    { return ('{0}d {1}h' -f [int]$ts.TotalDays, $ts.Hours) }
  if ($ts.TotalHours -ge 1)   { return ('{0}h {1}m' -f [int]$ts.TotalHours, $ts.Minutes) }
  return ('{0}m' -f [Math]::Max(1, [int]$ts.TotalMinutes))
}

# When the current rotation ends, per the storefront's own countdown taken at checkedAt. Falls
# back to the next 00:00 UTC for snapshots written before itemsRemainingSeconds was recorded.
function Get-RotationEnd($acct) {
  $checked = ConvertFrom-EpochMs $acct.checkedAt
  if ($null -eq $checked) { return $null }
  if ($acct.itemsRemainingSeconds) { return $checked.AddSeconds([double]$acct.itemsRemainingSeconds) }
  [datetime]::UtcNow.Date.AddDays(1).ToLocalTime()
}

# ---------------------------------------------------------------- images

# Two layers: the .png files survive restarts, the in-memory table stops a rebuild from decoding
# the same four images (and leaking the previous Image objects) every time the panel redraws.
$script:ImageCache = @{}

function Get-SkinImage([string]$url) {
  if (-not $url) { return $null }
  if ($script:ImageCache.ContainsKey($url)) { return $script:ImageCache[$url] }
  if (-not (Test-Path $CacheDir)) { New-Item -ItemType Directory -Path $CacheDir -Force | Out-Null }

  $md5  = [System.Security.Cryptography.MD5]::Create()
  $hash = ($md5.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($url)) | ForEach-Object { $_.ToString('x2') }) -join ''
  $md5.Dispose()
  $file = Join-Path $CacheDir "$hash.png"

  if (-not (Test-Path $file)) {
    try {
      $old = $ProgressPreference; $ProgressPreference = 'SilentlyContinue'
      Invoke-WebRequest -Uri $url -OutFile $file -UseBasicParsing -TimeoutSec 15
      $ProgressPreference = $old
    } catch { return $null }
  }
  try {
    # via bytes, not Image::FromFile, so the cached file isn't locked for the widget's lifetime
    $bytes  = [System.IO.File]::ReadAllBytes($file)
    $stream = New-Object System.IO.MemoryStream (,$bytes)
    $img    = [System.Drawing.Image]::FromStream($stream)
    $script:ImageCache[$url] = $img
    $img
  } catch { $null }
}

# ---------------------------------------------------------------- config (window position)

function Read-Config {
  if (-not (Test-Path $ConfigFile)) { return $null }
  try { Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $null }
}

function Save-Config {
  try {
    @{ x = $form.Location.X; y = $form.Location.Y; label = $script:ActiveLabel } |
      ConvertTo-Json | Out-File -FilePath $ConfigFile -Encoding utf8
  } catch { }
}

# ---------------------------------------------------------------- form

$form                 = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'
$form.ShowInTaskbar   = $false
$form.TopMost         = $true
$form.BackColor       = $ColBg
$form.Width           = $WidgetWidth
$form.Height          = 320
$form.StartPosition   = 'Manual'
$form.Opacity         = 0.96
$form.Text            = 'Valorant Store'

$cfg = Read-Config
if ($cfg -and $null -ne $cfg.x) {
  $form.Location = New-Object System.Drawing.Point([int]$cfg.x, [int]$cfg.y)
} else {
  $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $form.Location = New-Object System.Drawing.Point(($wa.Right - $WidgetWidth - 24), ($wa.Top + 24))
}
if (-not $script:ActiveLabel -and $cfg -and $cfg.label) { $script:ActiveLabel = $cfg.label }

# DWM doesn't round a borderless WinForms window on its own, so the panel gets its corners from a
# region clipped to a rounded path. Re-applied on every rebuild, since the form's height changes
# with the number of items. Don't dispose $path afterwards - the Region keeps using it.
function Set-RoundedRegion($ctl, [int]$radius) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($ctl.Width - $d - 1, 0, $d, $d, 270, 90)
  $path.AddArc($ctl.Width - $d - 1, $ctl.Height - $d - 1, $d, $d, 0, 90)
  $path.AddArc(0, $ctl.Height - $d - 1, $d, $d, 90, 90)
  $path.CloseFigure()
  $ctl.Region = New-Object System.Drawing.Region $path
}

# Dragging: child controls swallow the form's own mouse events, so the handlers get attached to
# every non-button control as it's created (see Add-DragHandlers below).
$onMouseDown = {
  if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
    $script:Dragging   = $true
    $script:DragOrigin = [System.Windows.Forms.Cursor]::Position
    $script:FormOrigin = $form.Location
  }
}
$onMouseMove = {
  if ($script:Dragging) {
    $now = [System.Windows.Forms.Cursor]::Position
    $form.Location = New-Object System.Drawing.Point(
      ($script:FormOrigin.X + $now.X - $script:DragOrigin.X),
      ($script:FormOrigin.Y + $now.Y - $script:DragOrigin.Y))
  }
}
$onMouseUp = {
  if ($script:Dragging) { $script:Dragging = $false; Save-Config }
}
$form.Add_MouseDown($onMouseDown)
$form.Add_MouseMove($onMouseMove)
$form.Add_MouseUp($onMouseUp)

function Add-DragHandlers($ctl) {
  $ctl.Add_MouseDown($onMouseDown)
  $ctl.Add_MouseMove($onMouseMove)
  $ctl.Add_MouseUp($onMouseUp)
}

# ---------------------------------------------------------------- store check

function Start-StoreCheck {
  if ($script:CheckProc -and -not $script:CheckProc.HasExited) { return }
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    $script:StatusText = 'node not found on PATH'
    Update-Widget -Force
    return
  }
  # not $args - that's an automatic variable
  $nodeArgs = @($CheckScript)
  if ($script:ActiveLabel) { $nodeArgs += $script:ActiveLabel }
  try {
    $script:CheckProc  = Start-Process -FilePath $node.Source -ArgumentList $nodeArgs `
                           -WorkingDirectory $RepoDir -WindowStyle Hidden -PassThru
    $script:StatusText = 'checking...'
    Update-Widget -Force
  } catch {
    $script:StatusText = 'check failed to start'
    Update-Widget -Force
  }
}

# ---------------------------------------------------------------- rendering

$tooltip = New-Object System.Windows.Forms.ToolTip

function New-Label($text, $font, $color, $x, $y, $w, $h) {
  $lbl           = New-Object System.Windows.Forms.Label
  $lbl.Text      = $text
  $lbl.Font      = $font
  $lbl.ForeColor = $color
  $lbl.BackColor = [System.Drawing.Color]::Transparent
  $lbl.Location  = New-Object System.Drawing.Point($x, $y)
  $lbl.Size      = New-Object System.Drawing.Size($w, $h)
  $lbl.AutoSize  = $false
  $lbl
}

function New-GlyphButton($text, $x, $y, $tip) {
  $btn                          = New-Object System.Windows.Forms.Button
  $btn.Text                     = $text
  $btn.Font                     = $FontGlyph
  $btn.ForeColor                = $ColMuted
  $btn.BackColor                = $ColBg
  $btn.FlatStyle                = 'Flat'
  $btn.FlatAppearance.BorderSize = 0
  $btn.FlatAppearance.MouseOverBackColor = $ColBgAlt
  $btn.Location                 = New-Object System.Drawing.Point($x, $y)
  $btn.Size                     = New-Object System.Drawing.Size(22, 20)
  $btn.TabStop                  = $false
  $btn.Cursor                   = [System.Windows.Forms.Cursors]::Hand
  if ($tip) { $tooltip.SetToolTip($btn, $tip) }
  $btn
}

function Update-Widget {
  param([switch]$Force)

  $script:Snapshot = Read-Snapshot
  $script:Labels   = Get-AccountLabels $script:Snapshot
  if (-not $script:ActiveLabel -or ($script:Labels.Count -and $script:Labels -notcontains $script:ActiveLabel)) {
    $script:ActiveLabel = if ($script:Labels.Count) { $script:Labels[0] } else { $null }
  }
  $acct = Get-Account $script:Snapshot $script:ActiveLabel

  # Rebuild only when something actually changed - a 60s poll that cleared and re-added every
  # control would flicker the whole panel for nothing.
  $key = '{0}|{1}|{2}|{3}|{4}' -f $script:ActiveLabel, $acct.checkedAt, $acct.error, $script:StatusText, ($script:Labels -join ',')
  if (-not $Force -and $key -eq $script:RenderedKey) { Update-Countdown $acct; return }
  $script:RenderedKey = $key

  $form.SuspendLayout()
  $form.Controls.Clear()

  $pad = 14
  $y   = 12

  # ---- header
  $title = New-Label 'VALORANT STORE' $FontTitle $ColViolet $pad $y 180 18
  Add-DragHandlers $title
  $form.Controls.Add($title)

  $btnClose = New-GlyphButton 'x' ($WidgetWidth - $pad - 22) ($y - 1) 'Close'
  $btnClose.Add_Click({ Save-Config; $form.Close() })
  $form.Controls.Add($btnClose)

  $btnRefresh = New-GlyphButton ([char]0x21BB) ($WidgetWidth - $pad - 48) ($y - 1) 'Check store now'
  $btnRefresh.Add_Click({ Invoke-Guarded { Start-StoreCheck } })
  $form.Controls.Add($btnRefresh)

  $y += 22

  # ---- account line (click to cycle when more than one is tracked)
  if ($script:ActiveLabel) {
    $accountText = $script:ActiveLabel
    if ($script:Labels.Count -gt 1) { $accountText = "$($script:ActiveLabel)  >" }
    $lblAcct           = New-Label $accountText $FontSmall $ColMuted $pad $y 160 16
    if ($script:Labels.Count -gt 1) {
      $lblAcct.Cursor = [System.Windows.Forms.Cursors]::Hand
      $tooltip.SetToolTip($lblAcct, 'Next account')
      $lblAcct.Add_Click({
        Invoke-Guarded {
          $i = [array]::IndexOf([array]$script:Labels, $script:ActiveLabel)
          $script:ActiveLabel = $script:Labels[(($i + 1) % $script:Labels.Count)]
          Save-Config
          Update-Widget -Force
        }
      })
    } else {
      Add-DragHandlers $lblAcct
    }
    $form.Controls.Add($lblAcct)
  }

  $checked = ConvertFrom-EpochMs $acct.checkedAt
  $stamp   = if ($script:StatusText) { $script:StatusText }
             elseif ($checked)       { Format-Checked $checked }
             else                    { '' }
  $lblStamp           = New-Label $stamp $FontSmall $ColFaint ($WidgetWidth - $pad - 150) $y 150 16
  $lblStamp.TextAlign = 'MiddleRight'
  $lblStamp.Name      = 'stamp'
  Add-DragHandlers $lblStamp
  $form.Controls.Add($lblStamp)
  $y += 24

  # ---- empty / error states
  if ($null -eq $acct) {
    $msg = if ($script:Labels.Count) { 'No data for this account yet.' } else { "No store data yet.`r`nRun: node scripts\valorant-check-store.mjs" }
    $lbl = New-Label $msg $FontName $ColMuted $pad $y ($WidgetWidth - 2 * $pad) 44
    Add-DragHandlers $lbl
    $form.Controls.Add($lbl)
    $y += 52
    $form.Height = $y + 8
    Set-RoundedRegion $form 12
    $form.ResumeLayout()
    return
  }

  if ($acct.error) {
    $lblErr = New-Label $acct.error $FontSmall $ColDanger $pad $y ($WidgetWidth - 2 * $pad) 32
    Add-DragHandlers $lblErr
    $form.Controls.Add($lblErr)
    $y += 36
  }

  # ---- skin rows
  $wishlisted = @()
  if ($acct.wishlisted) { $wishlisted = @($acct.wishlisted) }

  foreach ($item in @($acct.items)) {
    $isWish = $wishlisted -contains $item.name

    $row           = New-Object System.Windows.Forms.Panel
    $row.Location  = New-Object System.Drawing.Point($pad, $y)
    $row.Size      = New-Object System.Drawing.Size(($WidgetWidth - 2 * $pad), 50)
    $row.BackColor = $ColBgAlt
    Add-DragHandlers $row

    $pic           = New-Object System.Windows.Forms.PictureBox
    $pic.Location  = New-Object System.Drawing.Point(6, 6)
    $pic.Size      = New-Object System.Drawing.Size(96, 38)
    $pic.SizeMode  = 'Zoom'
    $pic.BackColor = [System.Drawing.Color]::Transparent
    $img = Get-SkinImage $item.imageUrl
    if ($img) { $pic.Image = $img }
    Add-DragHandlers $pic
    $row.Controls.Add($pic)

    $nameColor = if ($isWish) { $ColGold } else { $ColText }
    $nameText  = if ($isWish) { [string][char]0x2605 + ' ' + $item.name } else { $item.name }
    $lblName   = New-Label $nameText $FontName $nameColor 110 8 ($row.Width - 118) 18
    Add-DragHandlers $lblName
    $row.Controls.Add($lblName)

    $lblPrice = New-Label ('{0:N0} VP' -f [int]$item.price) $FontPrice $ColMuted 110 27 120 16
    Add-DragHandlers $lblPrice
    $row.Controls.Add($lblPrice)

    if ($isWish) {
      # thin gold left edge, drawn rather than added as a control so it can't eat mouse events
      $row.Add_Paint({
        param($s, $e)
        $brush = New-Object System.Drawing.SolidBrush $ColGold
        $e.Graphics.FillRectangle($brush, 0, 0, 3, $s.Height)
        $brush.Dispose()
      })
    }

    $form.Controls.Add($row)
    $y += 56
  }

  # ---- featured bundle
  if ($acct.bundle -and $acct.bundle.name) {
    $bundleText = '{0} - {1:N0} VP' -f $acct.bundle.name, [int]$acct.bundle.price
    $lblBundle  = New-Label $bundleText $FontSmall $ColMuted $pad $y ($WidgetWidth - 2 * $pad) 16
    Add-DragHandlers $lblBundle
    $form.Controls.Add($lblBundle)
    $y += 22
  }

  # ---- rotation countdown (only meaningful when there's actually a rotation on screen; an
  # errored account has no items and its stored countdown is a stale guess)
  if (@($acct.items).Count) {
    $lblRot      = New-Label '' $FontSmall $ColFaint $pad $y ($WidgetWidth - 2 * $pad) 16
    $lblRot.Name = 'rotation'
    Add-DragHandlers $lblRot
    $form.Controls.Add($lblRot)
    $y += 24
  } else {
    $y += 8
  }

  $form.Height = $y
  Set-RoundedRegion $form 12
  $form.ResumeLayout()
  Update-Countdown $acct
}

# Cheap per-tick text-only update, so the countdown ticks without rebuilding the panel.
function Update-Countdown($acct) {
  if ($null -eq $acct) { return }
  $lblRot = $form.Controls['rotation']
  if ($lblRot) {
    $end = Get-RotationEnd $acct
    $lblRot.Text = if ($end) { 'Rotates in ' + (Format-Duration ($end - [datetime]::Now)) } else { '' }
  }
  $lblStamp = $form.Controls['stamp']
  if ($lblStamp -and -not $script:StatusText) {
    $checked = ConvertFrom-EpochMs $acct.checkedAt
    if ($checked) { $lblStamp.Text = Format-Checked $checked }
  }
}

# ---------------------------------------------------------------- timers

# Polls the snapshot file (so a check run from anywhere - terminal, Task Scheduler, the Valorant
# tab's button - shows up here), ticks the countdown, and reaps a refresh started by the button.
$timer          = New-Object System.Windows.Forms.Timer
$timer.Interval = 30000
$timer.Add_Tick({
  Invoke-Guarded {
    if ($script:CheckProc) { return }   # mid-check: the reap timer below owns the next redraw
    Update-Widget

    if (-not $NoAutoCheck) {
      $acct  = Get-Account $script:Snapshot $script:ActiveLabel
      $end   = if ($acct) { Get-RotationEnd $acct } else { $null }
      $stale = ($null -eq $acct) -or ($null -eq $end) -or ($end -lt [datetime]::Now)
      if ($stale -and (([datetime]::Now - $script:LastAutoTry).TotalMinutes -ge 30)) {
        $script:LastAutoTry = [datetime]::Now
        Start-StoreCheck
      }
    }
  }
})
$timer.Start()

# A second, faster timer only for reaping a running check, so "checking..." doesn't linger for up
# to 30s after it finishes.
$procTimer          = New-Object System.Windows.Forms.Timer
$procTimer.Interval = 2000
$procTimer.Add_Tick({
  Invoke-Guarded {
    if ($script:CheckProc -and $script:CheckProc.HasExited) {
      $failed            = $script:CheckProc.ExitCode -ne 0
      $script:CheckProc  = $null
      $script:StatusText = if ($failed) { 'check failed' } else { '' }
      Update-Widget -Force
    }
  }
})
$procTimer.Start()

$form.Add_FormClosing({ $timer.Stop(); $procTimer.Stop(); Save-Config })
$form.Add_Shown({ Invoke-Guarded {
  Update-Widget -Force
  # Setting TopMost before the handle exists doesn't reliably survive to the window - a borderless
  # layered form, shown by a process that never takes the foreground, can end up without
  # WS_EX_TOPMOST and sit silently behind whatever is on screen, looking like it failed to draw.
  # Re-asserting it here is what actually pins the widget.
  $form.TopMost = $false
  $form.TopMost = $true
} })

[System.Windows.Forms.Application]::Run($form)
