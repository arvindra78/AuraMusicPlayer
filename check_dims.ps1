Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile("D:\CustomWebplayer\static\img\logo-icon.png")
Write-Host "Width: $($img.Width)"
Write-Host "Height: $($img.Height)"
$img.Dispose()
