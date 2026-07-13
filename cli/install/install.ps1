[CmdletBinding()]
param(
    [string]$Version,
    [string]$InstallDir = $env:SHARESLICES_INSTALL_DIR
)

$ErrorActionPreference = 'Stop'
$repository = 'walnut1024/ShareSlices'

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    $InstallDir = Join-Path $env:LOCALAPPDATA 'ShareSlices\bin'
}

$architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
if ($architecture -ne 'x64') {
    throw "Unsupported Windows architecture: $architecture"
}

$archive = 'shareslices-x86_64-pc-windows-msvc.zip'
if ($env:SHARESLICES_RELEASE_BASE_URL) {
    $releaseBase = $env:SHARESLICES_RELEASE_BASE_URL.TrimEnd('/')
} elseif ($Version) {
    $releaseBase = "https://github.com/$repository/releases/download/cli-v$Version"
} else {
    $releaseBase = "https://github.com/$repository/releases/latest/download"
}

$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "shareslices-$([System.Guid]::NewGuid())"
New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null

try {
    $archivePath = Join-Path $temporaryDirectory $archive
    $checksumsPath = Join-Path $temporaryDirectory 'SHA256SUMS'
    Invoke-WebRequest -Uri "$releaseBase/$archive" -OutFile $archivePath
    Invoke-WebRequest -Uri "$releaseBase/SHA256SUMS" -OutFile $checksumsPath

    $expectedChecksum = $null
    foreach ($line in Get-Content -Path $checksumsPath) {
        $parts = $line -split '\s+'
        if ($parts[-1] -eq $archive) {
            $expectedChecksum = $parts[0]
            break
        }
    }

    if (-not $expectedChecksum) {
        throw "No checksum was published for $archive."
    }

    $actualChecksum = (Get-FileHash -Algorithm SHA256 -Path $archivePath).Hash
    if ($actualChecksum -ne $expectedChecksum.ToUpperInvariant()) {
        throw "Checksum verification failed for $archive."
    }

    Expand-Archive -Path $archivePath -DestinationPath $temporaryDirectory -Force
    $executable = Join-Path $temporaryDirectory 'shareslices.exe'
    if (-not (Test-Path -Path $executable -PathType Leaf)) {
        throw 'The archive did not contain the shareslices executable.'
    }

    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Move-Item -Path $executable -Destination (Join-Path $InstallDir 'shareslices.exe') -Force
    Write-Output "Installed shareslices to $(Join-Path $InstallDir 'shareslices.exe')"

    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $pathEntries = @($userPath -split ';' | Where-Object { $_ })
    if ($pathEntries -notcontains $InstallDir) {
        [Environment]::SetEnvironmentVariable('Path', (($pathEntries + $InstallDir) -join ';'), 'User')
        Write-Output 'Added the install directory to your user PATH. Open a new terminal before using shareslices.'
    }
} finally {
    Remove-Item -Path $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
