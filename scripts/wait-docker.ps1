$dockerExe = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
$maxWait = 180
$elapsed = 0

while ($elapsed -lt $maxWait) {
    try {
        $result = & $dockerExe info 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Docker engine is ready!"
            & $dockerExe version
            exit 0
        }
    } catch {}
    $msg = "Waiting for Docker engine... ({0}s)" -f $elapsed
    Write-Host $msg
    Start-Sleep -Seconds 5
    $elapsed += 5
}
Write-Host "Timed out waiting for Docker engine"
exit 1
