Add-Type -AssemblyName System.Drawing
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..\docs\awakening\continuity')
$refs = Join-Path $root 'refs'
$screens = Join-Path $root 'screens'

function New-Board {
  param($Path, $Items, [int]$Cols, [int]$CellW, [int]$CellH, [int]$LabelH = 36)
  $rows = [Math]::Ceiling($Items.Count / $Cols)
  $bmp = New-Object System.Drawing.Bitmap ($Cols * $CellW), ($rows * ($CellH + $LabelH))
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::FromArgb(236, 236, 236))
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $font = New-Object System.Drawing.Font 'Segoe UI', 14, ([System.Drawing.FontStyle]::Bold)
  $brush = [System.Drawing.Brushes]::Black
  for ($i = 0; $i -lt $Items.Count; $i++) {
    $col = $i % $Cols
    $row = [Math]::Floor($i / $Cols)
    $x = $col * $CellW
    $y = $row * ($CellH + $LabelH)
    $g.FillRectangle([System.Drawing.Brushes]::White, $x + 8, $y + 8, $CellW - 16, $LabelH + $CellH - 16)
    $g.DrawString($Items[$i].Label, $font, $brush, $x + 16, $y + 12)
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

$lock = @(
  @{ Label = 'A  Character front'; File = Join-Path $refs 'character-front.jpg' },
  @{ Label = 'B  Character rear'; File = Join-Path $refs 'character-rear.jpg' },
  @{ Label = 'C  Character 3/4'; File = Join-Path $refs 'character-three-quarter.jpg' },
  @{ Label = 'E  Plaza'; File = Join-Path $refs 'plaza.jpg' },
  @{ Label = 'F  Closed case'; File = Join-Path $refs 'case-closed.jpg' },
  @{ Label = 'G  Open case'; File = Join-Path $refs 'case-open.jpg' },
  @{ Label = 'H  Laptop'; File = Join-Path $refs 'laptop.jpg' },
  @{ Label = 'I  Printer'; File = Join-Path $refs 'printer.jpg' },
  @{ Label = 'J  Scanner'; File = Join-Path $refs 'scanner.jpg' },
  @{ Label = 'K  Product'; File = Join-Path $refs 'product-box.jpg' },
  @{ Label = 'L  Complete station'; File = Join-Path $refs 'station.jpg' },
  @{ Label = 'D  Outfit lock = A/B/C'; File = Join-Path $refs 'character-front.jpg' }
)
New-Board (Join-Path $root 'continuity-board.png') $lock 4 640 420

$money = @(
  @{ Label = 'A  Nearly empty'; File = Join-Path $refs 'money-a.jpg' },
  @{ Label = 'B  Several bills'; File = Join-Path $refs 'money-b.jpg' },
  @{ Label = 'C  Short stacks'; File = Join-Path $refs 'money-c.jpg' },
  @{ Label = 'D  Fuller, still plausible'; File = Join-Path $refs 'money-d.jpg' }
)
New-Board (Join-Path $root 'money-progression.png') $money 2 900 420

# Laptop screen plane. The photo is a three-quarter laptop; the safe area is the inner bezel.
$lap = [System.Drawing.Image]::FromFile((Join-Path $refs 'laptop.jpg'))
$safe = New-Object System.Drawing.Bitmap $lap.Width, $lap.Height
$sg = [System.Drawing.Graphics]::FromImage($safe)
$sg.DrawImage($lap, 0, 0, $lap.Width, $lap.Height)
$penOuter = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 37, 99, 235)), 4
$penInner = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 22, 163, 74)), 4
$penOuter.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash
# Measured against this plate: screen plane sits inside the dark bezel.
$plane = New-Object System.Drawing.Rectangle ([int]($lap.Width * 0.325)), ([int]($lap.Height * 0.175)), ([int]($lap.Width * 0.35)), ([int]($lap.Height * 0.30))
$inset = [int]($lap.Width * 0.012)
$inner = New-Object System.Drawing.Rectangle ($plane.X + $inset), ($plane.Y + $inset), ($plane.Width - 2 * $inset), ($plane.Height - 2 * $inset)
$sg.DrawRectangle($penOuter, $plane)
$sg.DrawRectangle($penInner, $inner)
$labelFont = New-Object System.Drawing.Font 'Segoe UI', 18, ([System.Drawing.FontStyle]::Bold)
$sg.DrawString('BLUE  screen plane / tracking boundary', $labelFont, [System.Drawing.Brushes]::White, 24, 24)
$sg.DrawString('GREEN safe area for ZELVERO captures', $labelFont, [System.Drawing.Brushes]::White, 24, 56)
$sg.DrawString('16:10 capture  1080 x 640 CSS', $labelFont, [System.Drawing.Brushes]::White, 24, $lap.Height - 48)
$safe.Save((Join-Path $root 'laptop-safe-area.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$lap.Dispose(); $sg.Dispose(); $safe.Dispose()
$plates = @(
  @{ Label = '1  POS empty'; File = Join-Path $screens '01-pos-empty.png' },
  @{ Label = '2  POS product added'; File = Join-Path $screens '02-pos-added.png' },
  @{ Label = '3  Checkout'; File = Join-Path $screens '03-checkout.png' },
  @{ Label = '4  Sale success'; File = Join-Path $screens '04-sale-success.png' },
  @{ Label = '5  Receipt'; File = Join-Path $screens '05-receipt.png' },
  @{ Label = '6  Reports sales'; File = Join-Path $screens '06-reports-sales.png' },
  @{ Label = '7  Reports profit'; File = Join-Path $screens '07-reports-profit.png' }
)
New-Board (Join-Path $root 'screen-plate-board.png') $plates 4 720 460
Write-Output 'boards written'
