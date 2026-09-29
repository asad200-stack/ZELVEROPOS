from __future__ import annotations

from pathlib import Path

from PIL import Image


def remove_near_white_to_transparent(im: Image.Image) -> Image.Image:
    """
    Convert neutral near-white pixels to transparent.
    Keeps colored highlights (where RGB channels differ significantly).
    """
    im = im.convert("RGBA")
    pixels = list(im.getdata())
    out = []
    for r, g, b, a in pixels:
        if a == 0:
            out.append((r, g, b, a))
            continue
        mx = max(r, g, b)
        mn = min(r, g, b)
        if r > 245 and g > 245 and b > 245 and (mx - mn) < 10:
            out.append((r, g, b, 0))
        else:
            out.append((r, g, b, a))
    im.putdata(out)
    return im


def make_master_canvas(logo: Image.Image, master_size: int = 1024, pad_ratio: float = 0.14) -> Image.Image:
    # Crop to visible alpha
    alpha = logo.split()[-1]
    bbox = alpha.getbbox()
    if bbox:
        logo = logo.crop(bbox)

    pad = int(master_size * pad_ratio)
    max_dim = master_size - pad * 2

    w, h = logo.size
    scale = min(max_dim / w, max_dim / h)
    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))
    resized = logo.resize((new_w, new_h), Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", (master_size, master_size), (0, 0, 0, 0))
    off = ((master_size - new_w) // 2, (master_size - new_h) // 2)
    canvas.paste(resized, off, resized)
    return canvas


def make_maskable_canvas(
    logo: Image.Image,
    master_size: int = 1024,
    pad_ratio: float = 0.22,
    background: tuple[int, int, int, int] = (15, 23, 42, 255),  # #0f172a
) -> Image.Image:
    """
    Create a maskable icon canvas:
    - Solid background (Android masks nicely)
    - Extra padding so the logo doesn't get clipped by system masks
    """
    logo = logo.convert("RGBA")
    alpha = logo.split()[-1]
    bbox = alpha.getbbox()
    if bbox:
        logo = logo.crop(bbox)

    pad = int(master_size * pad_ratio)
    max_dim = master_size - pad * 2

    w, h = logo.size
    scale = min(max_dim / w, max_dim / h)
    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))
    resized = logo.resize((new_w, new_h), Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", (master_size, master_size), background)
    off = ((master_size - new_w) // 2, (master_size - new_h) // 2)
    canvas.paste(resized, off, resized)
    return canvas


def main() -> None:
    workspace = Path(__file__).resolve().parents[1]
    public_dir = workspace / "public"
    icons_dir = public_dir / "icons"
    icons_dir.mkdir(parents=True, exist_ok=True)

    # Source logo path (user-provided image saved by Cursor)
    src = Path(
        r"C:\Users\asad2\.cursor\projects\c-Users-asad2-OneDrive-V-1\assets\c__Users_asad2_AppData_Roaming_Cursor_User_workspaceStorage_e7cea4437459b7e9bdf2d98b5b96175a_images_WhatsApp_Image_2026-02-07_at_12.39.51_PM-db46f806-b4bf-4bfb-9ec8-ec545d5cf5ec.png"
    )
    if not src.exists():
        raise SystemExit(f"Source logo not found: {src}")

    logo = Image.open(src)
    logo = remove_near_white_to_transparent(logo)
    master = make_master_canvas(logo, master_size=1024, pad_ratio=0.14)
    maskable = make_maskable_canvas(logo, master_size=1024, pad_ratio=0.22)

    out_map: dict[int, list[Path]] = {
        16: [public_dir / "favicon-16x16.png", icons_dir / "icon-16.png"],
        32: [public_dir / "favicon-32x32.png", icons_dir / "icon-32.png"],
        48: [public_dir / "favicon-48x48.png", icons_dir / "icon-48.png"],
        180: [public_dir / "apple-touch-icon.png", icons_dir / "icon-180.png"],
        192: [public_dir / "android-chrome-192x192.png", icons_dir / "icon-192.png"],
        512: [public_dir / "android-chrome-512x512.png", icons_dir / "icon-512.png"],
    }

    for size, paths in out_map.items():
        out = master.resize((size, size), Image.Resampling.LANCZOS)
        for p in paths:
            p.parent.mkdir(parents=True, exist_ok=True)
            out.save(p, format="PNG", optimize=True)

    # Multi-size .ico for old browsers / Windows
    master.save(public_dir / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

    # Compatibility icon name (some installers/tools look for icon.png)
    (master.resize((512, 512), Image.Resampling.LANCZOS)).save(public_dir / "icon.png", format="PNG", optimize=True)

    # Maskable icons (Android)
    (maskable.resize((192, 192), Image.Resampling.LANCZOS)).save(
        public_dir / "maskable-192x192.png", format="PNG", optimize=True
    )
    (maskable.resize((512, 512), Image.Resampling.LANCZOS)).save(
        public_dir / "maskable-512x512.png", format="PNG", optimize=True
    )

    print("Generated icons OK:")
    for size, paths in out_map.items():
        for p in paths:
            print(f"- {size}x{size}: {p}")
    print(f"- ICO: {public_dir / 'favicon.ico'}")
    print(f"- icon.png: {public_dir / 'icon.png'}")
    print(f"- maskable 192: {public_dir / 'maskable-192x192.png'}")
    print(f"- maskable 512: {public_dir / 'maskable-512x512.png'}")


if __name__ == "__main__":
    main()

