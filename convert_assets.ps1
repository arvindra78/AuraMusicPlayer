Add-Type -AssemblyName System.Drawing
$logo = [System.Drawing.Image]::FromFile("D:\CustomWebplayer\static\img\logo.png")
$logo.Save("D:\CustomWebplayer\static\img\logo.bmp", [System.Drawing.Imaging.ImageFormat]::Bmp)
$logo.Dispose()
$icon = [System.Drawing.Image]::FromFile("D:\CustomWebplayer\static\img\logo-icon.png")
$icon.Save("D:\CustomWebplayer\static\img\logo-icon.bmp", [System.Drawing.Imaging.ImageFormat]::Bmp)
$icon.Dispose()
