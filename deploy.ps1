# ==========================================================================
# AUSTSec website - deploy script
#   Usage:  powershell -ExecutionPolicy Bypass -File deploy.ps1
#           powershell -ExecutionPolicy Bypass -File deploy.ps1 -Message "what changed"
#
# NOTE: This file is intentionally ASCII-only. Windows PowerShell 5.1 reads
#       .ps1 files using the system ANSI codepage (GBK on zh-CN systems), so
#       non-ASCII characters here would be mis-decoded. Keep it ASCII.
# ==========================================================================
param(
  [string]$Message = ""
)

$ErrorActionPreference = "Stop"

$git = "C:\Program Files\Git\cmd\git.exe"
if (-not (Test-Path $git)) { $git = "git" }

$remote = "https://github.com/Aust-Sec/Aust-Sec.github.io.git"
$repo   = $PSScriptRoot

Write-Host ""
Write-Host "=== AUSTSec deploy ===" -ForegroundColor Cyan
Write-Host "repo:   $repo"
Write-Host "remote: $remote"
Write-Host ""

Push-Location $repo
try {
  # ---------- 1. init ----------
  if (-not (Test-Path ".git")) {
    Write-Host "[1/5] git init ..." -ForegroundColor Yellow
    & $git init | Out-Null
    & $git branch -M main
    & $git remote add origin $remote
  } else {
    Write-Host "[1/5] repo already initialized" -ForegroundColor DarkGray
    $existing = & $git remote get-url origin 2>$null
    if ($existing -ne $remote) {
      Write-Host "      fixing remote: $existing -> $remote"
      & $git remote set-url origin $remote
    }
  }

  # ---------- 2. identity ----------
  $name  = & $git config user.name
  $email = & $git config user.email
  if (-not $name) {
    Write-Host ""
    Write-Host "!! git identity not set. Run these first:" -ForegroundColor Red
    Write-Host '   git config --global user.name  "YourName"'
    Write-Host '   git config --global user.email "you@example.com"'
    Write-Host ""
    exit 1
  }
  Write-Host "[2/5] identity: $name <$email>" -ForegroundColor DarkGray

  # ---------- 3. stage ----------
  Write-Host "[3/5] staging ..." -ForegroundColor Yellow
  & $git add -A

  $staged = & $git diff --cached --name-only
  if (-not $staged) {
    Write-Host "      nothing to commit" -ForegroundColor DarkGray
  } else {
    $count = ($staged | Measure-Object).Count
    Write-Host "      $count file(s):"
    $staged | ForEach-Object { Write-Host "        $_" -ForegroundColor DarkGray }
  }

  # ---------- 4. commit ----------
  if ($staged) {
    if (-not $Message) {
      $Message = "update site " + (Get-Date -Format 'yyyy-MM-dd HH:mm')
    }
    Write-Host "[4/5] commit: $Message" -ForegroundColor Yellow
    & $git commit -m $Message | Out-Null
  } else {
    Write-Host "[4/5] skip commit" -ForegroundColor DarkGray
  }

  # ---------- 5. push ----------
  Write-Host "[5/5] push to GitHub ..." -ForegroundColor Yellow
  & $git push -u origin main
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "PUSH FAILED. Common causes:" -ForegroundColor Red
    Write-Host "  - Login required: a browser / credential window should appear."
    Write-Host "    Finish the sign-in, then run this script again."
    Write-Host "  - Remote has newer commits: run  git pull --rebase origin main"
    Write-Host ""
    exit 1
  }

  Write-Host ""
  Write-Host "PUSH OK" -ForegroundColor Green
  Write-Host ""
  Write-Host "Live in 1-2 minutes at:  https://aust-sec.github.io/" -ForegroundColor Cyan
  Write-Host "(repo name = <org>.github.io, so Pages is published at the domain root)"
  Write-Host ""
}
finally {
  Pop-Location
}
