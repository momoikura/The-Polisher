# Puts the live site's settings in place without showing any secret on screen:
#   - Modal secret "thepolisher-web" (read by the API server)
#   - Cloudflare Pages secret PROXY_SECRET (proves requests came through the site)
# The session and proxy secrets are generated here; the GitHub client secret is
# typed with hidden input. Run from the repo root:  .\deploy\set-secrets.ps1

$ErrorActionPreference = "Stop"
# Windows PowerShell 5.1 turns any stderr line from a program (even a warning) into
# a fatal error under "Stop", so program calls below run under Invoke-Native and are
# judged by their exit code instead.
$env:PYTHONWARNINGS = "ignore::DeprecationWarning"

function Invoke-Native([scriptblock]$Command, [string]$What) {
    $ErrorActionPreference = "Continue"
    & $Command 2>&1 | ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { Write-Host $_.Exception.Message } else { Write-Host $_ } }
    if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)." }
}
$PublicUrl = "https://thepolisher.pages.dev"
$PagesProject = "thepolisher"

function Read-DotEnv([string]$Name, [string]$Default = "") {
    $line = Get-Content ".env" | Where-Object { $_ -match "^\s*$Name\s*=" } | Select-Object -First 1
    if (-not $line) {
        if ($Default) { return $Default }
        throw "$Name is missing from .env"
    }
    return ($line -split "=", 2)[1].Trim().Trim('"')
}

function New-Secret {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

$clientId = (Read-Host "GitHub OAuth App (live) Client ID").Trim()
$secure = Read-Host "GitHub OAuth App (live) Client secret" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $clientSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if ($clientId.Length -lt 10 -or $clientSecret.Length -lt 20) { throw "That Client ID or secret looks too short." }

$proxySecret = New-Secret

$settings = [ordered]@{
    THEPOLISHER_PUBLIC_URL       = $PublicUrl
    THEPOLISHER_PROXY_SECRET     = $proxySecret
    THEPOLISHER_SESSION_SECRET   = New-Secret
    THEPOLISHER_REQUIRE_USER_KEY = "1"
    THEPOLISHER_TABLE            = "thepolisher"
    AWS_REGION                   = "ap-southeast-2"
    GITHUB_CLIENT_ID             = $clientId
    GITHUB_CLIENT_SECRET         = $clientSecret
    SANDBOX_URL                  = Read-DotEnv "SANDBOX_URL"
    SANDBOX_TOKEN                = Read-DotEnv "SANDBOX_TOKEN"
    MODEL_PROVIDER               = "meta"
    MODEL_BASE_URL               = Read-DotEnv "MODEL_BASE_URL"
    MODEL_ID                     = Read-DotEnv "MODEL_ID" "muse-spark-1.3"
}

$tmp = Join-Path $env:TEMP ("tp-" + [guid]::NewGuid() + ".json")
try {
    # JSON (not --from-dotenv, which needs the python-dotenv package); UTF-8 without a BOM.
    [IO.File]::WriteAllText($tmp, ($settings | ConvertTo-Json), (New-Object System.Text.UTF8Encoding $false))
    Invoke-Native { py -m modal secret create thepolisher-web --from-json $tmp --force } "Creating the Modal secret"
    Write-Host "Modal secret 'thepolisher-web' set: $($settings.Keys -join ', ')"
}
finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }

Invoke-Native { $proxySecret | npx wrangler@4 pages secret put PROXY_SECRET --project-name $PagesProject } "Setting the Cloudflare secret"
Write-Host "Cloudflare Pages secret PROXY_SECRET set. Done; no secret was shown."
