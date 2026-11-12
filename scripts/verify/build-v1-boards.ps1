Add-Type -AssemblyName System.Drawing
$v1 = Resolve-Path (Join-Path $PSScriptRoot '..\..\docs\awakening\continuity\v1')
$screens = Resolve-Path (Join-Path $PSScriptRoot '..\..\docs\awakening\continuity\screens')

function New-Board {
  param($Path, $Items, [int]$Cols, [int]$CellW, [int]$CellH, [int]$LabelH = 36)
  $rows = [Math]::Ceiling($Items.Count / $Cols)
  $bmp = New-Object System.Drawing.Bitmap ($Cols * $CellW), ($rows * ($CellH + $LabelH))
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::FromArgb(236, 236, 236))
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $font = New-Object System.Drawing.Font 'Segoe UI', 13, ([System.Drawing.FontStyle]::Bold)
  $brush = [System.Drawing.Brushes]::Black
  for ($i = 0; $i -lt $Items.Count; $i++) {
    $col = $i % $Cols
    $row = [Math]::Floor($i / $Cols)
    $x = $col * $CellW
    $y = $row * ($CellH + $LabelH)
    $g.FillRectangle([System.Drawing.Brushes]::White, $x + 8, $y + 8, $CellW - 16, $LabelH + $CellH - 16)
    $g.DrawString($Items[$i].Label, $font, $brush, $x + 16, $y + 10)
    $img = [System.Drawing.Image]::FromFile($Items[$i].File)
    $maxW = $CellW - 32
    $maxH = $CellH - 16
    $scale = [Math]::Min($maxW / $img.Width, $maxH / $img.Height)
    $dw = [int]($img.Width * $scale)
    $dh = [int]($img.Height * $scale)
    $dx = $x + 16 + [int](($maxW - $dw) / 2)
    $dy = $y + $LabelH + 8
    $g.DrawImage($img, $dx, $dy, $dw, $dh)
    $img.Dispose()
  }
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

function Item($label, $file) { @{ Label = $label; File = $file } }

New-Board (Join-Path $v1 'board-a-character.png') @(
  (Item 'CHARACTER_V1 front / standing' (Join-Path $v1 'character-v1-front.jpg')),
  (Item 'CHARACTER_V1 rear' (Join-Path $v1 'character-v1-rear.jpg')),
  (Item 'CHARACTER_V1 left 3/4' (Join-Path $v1 'character-v1-left.jpg')),
  (Item 'CHARACTER_V1 right 3/4' (Join-Path $v1 'character-v1-right.jpg')),
  (Item 'CHARACTER_V1 walk' (Join-Path $v1 'character-v1-walk.jpg')),
  (Item 'OUTFIT_V1 lock' (Join-Path $v1 'character-v1-front.jpg'))
) 3 460 560

New-Board (Join-Path $v1 'board-b-plaza.png') @(
  (Item 'PLAZA_V1 master' (Join-Path $v1 'plaza-v1-master.jpg')),
  (Item 'A wide rear walk' (Join-Path $v1 'plaza-v1-wide.jpg')),
  (Item 'B medium rear walk' (Join-Path $v1 'plaza-v1-medium.jpg')),
  (Item 'C left-front' (Join-Path $v1 'plaza-v1-left.jpg')),
  (Item 'D over-shoulder' (Join-Path $v1 'plaza-v1-shoulder.jpg')),
  (Item 'E three-quarter' (Join-Path $v1 'plaza-v1-three-quarter.jpg')),
  (Item 'F low angle' (Join-Path $v1 'plaza-v1-low.jpg'))
) 4 480 300

New-Board (Join-Path $v1 'board-c-case.png') @(
  (Item 'A closed front' (Join-Path $v1 'case-v1-closed-front.jpg')),
  (Item 'B closed 3/4' (Join-Path $v1 'case-v1-closed-34.jpg')),
  (Item 'C rear hinges' (Join-Path $v1 'case-v1-rear-hinge.jpg')),
  (Item 'D open front' (Join-Path $v1 'case-v1-open-front.jpg')),
  (Item 'E open top' (Join-Path $v1 'case-v1-open-top.jpg')),
  (Item 'F printer rail' (Join-Path $v1 'case-v1-printer-rail.jpg')),
  (Item 'G scanner rail' (Join-Path $v1 'case-v1-scanner-rail.jpg')),
  (Item 'H money drawer' (Join-Path $v1 'money-v1-a.jpg')),
  (Item 'I station deployed' (Join-Path $v1 'station-v1.jpg'))
) 3 480 420

New-Board (Join-Path $v1 'board-d-hardware.png') @(
  (Item 'LAPTOP_V1' (Join-Path $v1 'laptop-v1.jpg')),
  (Item 'PRINTER_V1' (Join-Path $v1 'printer-v1.jpg')),
  (Item 'SCANNER_V1' (Join-Path $v1 'scanner-v1.jpg')),
  (Item 'PRODUCT_CASE_V1' (Join-Path $v1 'product-v1.jpg'))
) 4 420 420

New-Board (Join-Path $v1 'board-e-station.png') @(
  (Item 'STATION_V1' (Join-Path $v1 'station-v1.jpg'))
) 1 1400 820

New-Board (Join-Path $v1 'board-f-money.png') @(
  (Item 'STATE A few bills' (Join-Path $v1 'money-v1-a.jpg')),
  (Item 'STATE B small stacks' (Join-Path $v1 'money-v1-b.jpg')),
  (Item 'STATE C medium stacks' (Join-Path $v1 'money-v1-c.jpg')),
  (Item 'STATE D fuller stacks' (Join-Path $v1 'money-v1-d.jpg'))
) 2 640 560

New-Board (Join-Path $v1 'board-g-screen-track.png') @(
  (Item 'LAPTOP_V1 blue plane / green safe' (Join-Path $v1 'laptop-v1-tracking.png')),
  (Item 'POS empty corner-pin test' (Join-Path $v1 'laptop-composite-pos-empty.png'))
) 2 720 420

New-Board (Join-Path $v1 'board-h-screens.png') @(
  (Item '1 POS empty' (Join-Path $screens '01-pos-empty.png')),
  (Item '2 POS Phone case added' (Join-Path $screens '02-pos-added.png')),
  (Item '3 Checkout' (Join-Path $screens '03-checkout.png')),
  (Item '4 Sale success' (Join-Path $screens '04-sale-success.png')),
  (Item '5 Receipt' (Join-Path $screens '05-receipt.png')),
  (Item '6 Reports sales' (Join-Path $screens '06-reports-sales.png')),
  (Item '7 Reports profit' (Join-Path $screens '07-reports-profit.png'))
) 4 520 340

Write-Host 'boards written'
