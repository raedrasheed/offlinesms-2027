# Compute the Android SMS Retriever 11-char app hash (PowerShell / Windows).
#
# The hash = SHA-256( "<package> " + signingCertBytes ) -> first 9 bytes
#            -> base64 -> first 11 chars   (Google's AppSignatureHelper algorithm).
# It depends on the signing certificate, so use the cert that signs the app users
# install:
#   - Local release keystore  -> pass -Keystore/-Alias/-StorePass
#   - Play App Signing         -> download the app-signing cert (.der) from
#     Play Console (Test and release > App integrity) and pass -CertFile.
#
# Examples:
#   .\scripts\apphash.ps1 -Package com.offlinesms.app -Keystore .\release.keystore -Alias upload -StorePass secret
#   .\scripts\apphash.ps1 -Package com.offlinesms.app -CertFile .\deployment_cert.der
#
# Requires keytool on PATH only when using a keystore (ships with the JDK /
# Android Studio). The -CertFile mode needs no external tools.
param(
  [Parameter(Mandatory = $true)][string]$Package,
  [string]$CertFile,
  [string]$Keystore,
  [string]$Alias,
  [string]$StorePass
)

$ErrorActionPreference = 'Stop'

function Get-CertBytes {
  if ($CertFile) {
    if (-not (Test-Path $CertFile)) { throw "CertFile not found: $CertFile" }
    return [System.IO.File]::ReadAllBytes((Resolve-Path $CertFile))
  }
  if (-not ($Keystore -and $Alias -and $StorePass)) {
    throw "Provide either -CertFile, or all of -Keystore -Alias -StorePass."
  }
  if (-not (Test-Path $Keystore)) { throw "Keystore not found: $Keystore" }
  if (-not (Get-Command keytool -ErrorAction SilentlyContinue)) {
    throw "keytool not found on PATH. It ships with the JDK / Android Studio (e.g. 'C:\Program Files\Android\Android Studio\jbr\bin'). Add that to PATH, or list aliases first with:`n  keytool -list -v -keystore '$Keystore' -storepass '<password>'"
  }
  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    # keytool writes its "Certificate stored in file…" status to stderr. With
    # $ErrorActionPreference='Stop' that stderr write is otherwise treated as a
    # terminating NativeCommandError, so relax it just for this call and judge
    # success by the exit code + the output file instead.
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = & keytool -exportcert -alias $Alias -keystore $Keystore -storepass $StorePass -file $tmp 2>&1
    $exit = $LASTEXITCODE
    $ErrorActionPreference = $prevEAP
    if ($exit -ne 0 -or -not (Test-Path $tmp) -or (Get-Item $tmp).Length -eq 0) {
      throw "keytool could not export alias '$Alias' from '$Keystore'. Check the alias name, the store password, and that the file is a valid keystore.`nkeytool said:`n$out"
    }
    return [System.IO.File]::ReadAllBytes($tmp)
  } finally {
    if (Test-Path $tmp) { Remove-Item $tmp -Force }
  }
}

$certBytes = Get-CertBytes

# input = UTF8("<package> ") + certBytes
$prefix = [System.Text.Encoding]::UTF8.GetBytes("$Package ")
$buf = New-Object byte[] ($prefix.Length + $certBytes.Length)
[Array]::Copy($prefix, 0, $buf, 0, $prefix.Length)
[Array]::Copy($certBytes, 0, $buf, $prefix.Length, $certBytes.Length)

$hash = [System.Security.Cryptography.SHA256]::Create().ComputeHash($buf)
$appHash = [Convert]::ToBase64String([byte[]]($hash[0..8])).Substring(0, 11)

Write-Output $appHash
