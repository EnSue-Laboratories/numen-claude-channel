# Remote tail helper for numen-chat.js — runs ON the Windows game machine over SSH.
# Emits "LOG|<line>" for game-log lines and "INBOX|<companion>|<jsonl>" for inbox events.
$base = "$env:APPDATA\PrismLauncher\instances\Numen\minecraft"
$log  = "$base\logs\latest.log"
$conv = "$base\config\numen\conversations"

$offsets = @{}
if (Test-Path $log) { $offsets["LOG"] = (Get-Item $log).Length }
Get-ChildItem $conv -Filter *.inbox.jsonl -ErrorAction SilentlyContinue | ForEach-Object {
    $offsets[$_.Name] = $_.Length
}

function Read-New([string]$path, [long]$off) {
    $fs = [System.IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
    try {
        $len = $fs.Length
        if ($len -le $off) { return @($len, "") }
        $fs.Seek($off, 'Begin') | Out-Null
        $buf = New-Object byte[] ($len - $off)
        $fs.Read($buf, 0, $buf.Length) | Out-Null
        return @($len, [Text.Encoding]::UTF8.GetString($buf))
    } finally { $fs.Close() }
}

while ($true) {
    if (Test-Path $log) {
        $off = $offsets["LOG"]; if ($null -eq $off) { $off = 0 }
        if ((Get-Item $log).Length -lt $off) { $off = 0 }   # log rotated
        $r = Read-New $log $off
        $offsets["LOG"] = $r[0]
        if ($r[1]) { $r[1] -split "`n" | Where-Object { $_.Trim() } | ForEach-Object {
            [Console]::Out.WriteLine("LOG|" + $_.TrimEnd())
        } }
    }
    Get-ChildItem $conv -Filter *.inbox.jsonl -ErrorAction SilentlyContinue | ForEach-Object {
        $off = $offsets[$_.Name]; if ($null -eq $off) { $off = 0 }
        if ($_.Length -lt $off) { $off = 0 }
        $r = Read-New $_.FullName $off
        $offsets[$_.Name] = $r[0]
        if ($r[1]) {
            $cid = $_.Name -replace '\.inbox\.jsonl$', ''
            $r[1] -split "`n" | Where-Object { $_.Trim() } | ForEach-Object {
                [Console]::Out.WriteLine("INBOX|" + $cid + "|" + $_.TrimEnd())
            }
        }
    }
    [Console]::Out.Flush()
    Start-Sleep -Milliseconds 700
}
