"""Correct CASE_V1 hinges, remove extra pulls, and rebuild the money states.

Still images only. Does not touch the accepted cashier plates.
"""
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2] / "docs" / "awakening" / "continuity" / "v1"
FONT = Path(r"C:\Windows\Fonts\segoeui.ttf")
FONT_B = Path(r"C:\Windows\Fonts\segoeuib.ttf")


def read(name: str) -> np.ndarray:
    image = cv2.imread(str(ROOT / name))
    if image is None:
        raise FileNotFoundError(name)
    return image


def write(name: str, image: np.ndarray) -> None:
    cv2.imwrite(str(ROOT / name), image)


def hinge_patch() -> np.ndarray:
    rear = read("case-v1-rear-hinge.jpg")
    # Left butt hinge: plate, four screws, barrel. Includes a little shell.
    return rear[402:518, 142:238].copy()


def hinge_alpha(patch: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 18, 55)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    bright = (gray > np.median(gray) + 12).astype(np.uint8) * 255
    alpha = cv2.bitwise_or(edges, bright)
    return cv2.GaussianBlur(alpha, (5, 5), 0)


def paint_hinge(image: np.ndarray, center: tuple[int, int], width: int) -> None:
    patch = hinge_patch()
    alpha0 = hinge_alpha(patch)
    scale = width / patch.shape[1]
    height = max(8, int(patch.shape[0] * scale))
    sprite = cv2.resize(patch, (width, height), interpolation=cv2.INTER_AREA)
    alpha = cv2.resize(alpha0, (width, height), interpolation=cv2.INTER_AREA)
    x = int(center[0] - width / 2)
    y = int(center[1] - height / 2)
    h, w = image.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(w, x + width), min(h, y + height)
    sx0, sy0 = x0 - x, y0 - y
    sprite = sprite[sy0 : sy0 + (y1 - y0), sx0 : sx0 + (x1 - x0)]
    alpha = alpha[sy0 : sy0 + (y1 - y0), sx0 : sx0 + (x1 - x0)]
    dest = image[y0:y1, x0:x1].astype(np.float32)
    a = (alpha.astype(np.float32) / 255.0)[:, :, None]
    image[y0:y1, x0:x1] = (dest * (1 - a) + sprite.astype(np.float32) * a).astype(np.uint8)


def wipe(image: np.ndarray, box: tuple[int, int, int, int]) -> None:
    x, y, w, h = box
    mask = np.zeros(image.shape[:2], np.uint8)
    mask[y : y + h, x : x + w] = 255
    painted = cv2.inpaint(image, mask, 7, cv2.INPAINT_TELEA)
    image[:] = painted


# Lid spans measured at the open rim. Hinges sit 13% in from each side,
# matching the rear plate. The old side stays are covered first.
HINGE_PLATES = {
    "case-v1-open-front.jpg": ((258, 838, 348), (246, 300, 40, 100), (800, 300, 46, 100)),
    "case-v1-printer-rail.jpg": ((297, 839, 348), (285, 300, 40, 100), (800, 300, 48, 100)),
    "case-v1-scanner-rail.jpg": ((274, 751, 340), (250, 300, 42, 90), (720, 300, 46, 90)),
}


def install_rear_hinges(name: str, image: np.ndarray) -> np.ndarray:
    out = image.copy()
    left, right, axis = HINGE_PLATES[name][0]
    covers = HINGE_PLATES[name][1:]
    for box in covers:
        wipe(out, box)
    span = right - left
    width = max(48, int(span * 0.12))
    centers = (int(left + span * 0.13), int(right - span * 0.13))
    for center in centers:
        paint_hinge(out, (center, axis), width)
    return out


def remove_scanner_pull(image: np.ndarray) -> np.ndarray:
    """Clone the plain lower panel over the pull and the seam the closed front lacks."""
    out = image.copy()
    x0, x1, y0, y1 = 240, 980, 636, 722
    clean = out[726:758, x0:x1]
    out[y0:y1, x0:x1] = cv2.resize(clean, (x1 - x0, y1 - y0), interpolation=cv2.INTER_LINEAR)
    return out


def remove_opentop_pull(image: np.ndarray) -> np.ndarray:
    """Fill the recessed front door and its handle so the face is flush."""
    out = image.copy()
    h, w = out.shape[:2]
    gray = cv2.cvtColor(out, cv2.COLOR_BGR2GRAY)
    # Handle and recessed door live in the lower front, left of center.
    region = gray[int(h * 0.58) : int(h * 0.86), int(w * 0.28) : int(w * 0.62)]
    # The door border is a slight edge. Build a mask from the brighter handle
    # and a fixed quad that matches the recessed panel in this plate.
    mask = np.zeros(gray.shape, np.uint8)
    quad = np.array([[430, 560], [760, 545], [790, 700], [400, 720]], np.int32)
    cv2.fillConvexPoly(mask, quad, 255)
    # Keep the corner hardware and the latch on the right by clipping the quad.
    mask[:, 800:] = 0
    mask[:540, :] = 0
    out = cv2.inpaint(out, mask, 9, cv2.INPAINT_TELEA)
    # Remove the silver laptop that is not LAPTOP_V1. Fill with the empty bay.
    bright = (gray > 145) & (gray < 230)
    bright[: int(h * 0.42), :] = False
    bright[:, int(w * 0.55) :] = False
    bay = (bright.astype(np.uint8) * 255)
    bay = cv2.morphologyEx(bay, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    if cv2.countNonZero(bay) > 400:
        bay = cv2.dilate(bay, np.ones((7, 7), np.uint8), iterations=1)
        out = cv2.inpaint(out, bay, 6, cv2.INPAINT_TELEA)
    return out


def empty_drawer(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    notes = np.zeros(gray.shape, np.uint8)
    interior = gray.copy()
    interior[:300, :] = 0
    interior[560:, :] = 0
    interior[:, :180] = 0
    interior[:, 1120:] = 0
    notes[(interior > 55)] = 255
    notes = cv2.morphologyEx(notes, cv2.MORPH_CLOSE, np.ones((21, 21), np.uint8))
    notes = cv2.dilate(notes, np.ones((9, 9), np.uint8), iterations=1)
    return cv2.inpaint(image, notes, 8, cv2.INPAINT_TELEA)


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    path = FONT_B if bold and FONT_B.exists() else FONT
    return ImageFont.truetype(str(path), size)


def _cedar(draw: ImageDraw.ImageDraw, cx: int, cy: int, ink: tuple[int, int, int]) -> None:
    """Flat-topped cedar, not a pine."""
    green = (42, 96, 58)
    draw.polygon([(cx - 34, cy + 6), (cx + 34, cy + 6), (cx + 22, cy - 2), (cx - 22, cy - 2)], fill=green)
    draw.polygon([(cx - 28, cy - 2), (cx + 28, cy - 2), (cx + 16, cy - 12), (cx - 16, cy - 12)], fill=(36, 84, 50))
    draw.polygon([(cx - 18, cy - 12), (cx + 18, cy - 12), (cx + 8, cy - 22), (cx - 8, cy - 22)], fill=(30, 72, 44))
    draw.rectangle((cx - 3, cy + 6, cx + 3, cy + 16), fill=(78, 58, 40))


def draw_note(width: int, height: int, kind: str, value: str) -> np.ndarray:
    """Camera-readable prop note. Large denomination only, no microtext."""
    rng = np.random.default_rng(abs(hash(kind + value)) % (2**32))
    if kind == "usd":
        base = np.array([150, 176, 132])
        ink = (48, 72, 40)
    elif value == "100000":
        base = np.array([186, 166, 196])
        ink = (78, 48, 72)
    else:
        base = np.array([176, 156, 168])
        ink = (82, 52, 64)
    paper = np.clip(base + rng.integers(-5, 6, (height, width, 3)), 0, 255).astype(np.uint8)
    canvas = Image.fromarray(paper, "RGB")
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((2, 2, width - 3, height - 3), outline=ink, width=2)
    draw.rectangle((7, 7, width - 8, height - 8), outline=ink, width=1)
    corner = _font(max(16, height // 5), bold=True)
    for pos in ((12, 8), (width - 18 - len(value) * (height // 7), height - height // 4)):
        draw.text(pos, value, font=corner, fill=ink)
    if kind == "usd":
        draw.ellipse((width // 2 - 26, height // 2 - 20, width // 2 + 26, height // 2 + 20), outline=ink, width=2)
        draw.text((width // 2 - 16, height // 2 - 8), value, font=_font(max(12, height // 7), True), fill=ink)
    else:
        _cedar(draw, width // 2, height // 2, ink)
        label = Image.open(ROOT / "_crops" / "arabic-lebanon.png").convert("RGBA")
        label.thumbnail((width // 3, height // 3))
        canvas.paste(label, (width - label.width - 14, height // 2 - label.height // 2), label)
    return cv2.cvtColor(np.array(canvas.convert("RGB")), cv2.COLOR_RGB2BGR)


def place_note(image: np.ndarray, note: np.ndarray, origin: tuple[int, int], layers: int) -> None:
    x, y = origin
    h, w = note.shape[:2]
    floor = min(505, y + h)
    stack_px = layers * 3
    y = max(300, floor - h - stack_px)
    # Solid paper edge under the note. Bottom stays on the same drawer floor.
    if stack_px:
        paper = np.clip(note.mean(axis=(0, 1)) - 30, 0, 255).astype(np.uint8)
        for i in range(stack_px):
            yy = y + h + i
            if yy >= 518:
                break
            image[yy, x : x + w] = paper
            if i % 3 == 2:
                image[yy, x : x + w] = np.clip(paper.astype(np.int16) - 16, 0, 255)
    y1 = min(image.shape[0], y + h)
    image[y:y1, x : x + w] = note[: y1 - y, :w]
    # Soft contact shadow under the paper.
    shadow = np.zeros(image.shape[:2], np.float32)
    cv2.ellipse(shadow, (x + w // 2, min(518, y + h + stack_px)), (w // 2, 8), 0, 0, 360, 0.35, -1)
    shadow = cv2.GaussianBlur(shadow, (0, 0), 3)
    image[:] = np.clip(image.astype(np.float32) * (1 - shadow[:, :, None] * 0.45), 0, 255).astype(np.uint8)


def build_money() -> None:
    money_src = ROOT / "_before" / "money-v1-a.jpg"
    money = cv2.imread(str(money_src))
    if money is None:
        raise FileNotFoundError(money_src)
    base = empty_drawer(money)
    # Same two footprints in every state. Left is USD, right is LBP.
    usd_box = (250, 372, 250, 118)
    lbp_box = (690, 378, 250, 118)
    states = {
        "money-v1-a.jpg": [("usd", "20", 0), ("lbp", "100000", 0)],
        "money-v1-b.jpg": [("usd", "20", 6), ("lbp", "100000", 6)],
        "money-v1-c.jpg": [("usd", "20", 12), ("usd", "100", 12), ("lbp", "50000", 12), ("lbp", "100000", 12)],
        "money-v1-d.jpg": [("usd", "20", 22), ("usd", "100", 22), ("lbp", "50000", 22), ("lbp", "100000", 22)],
    }
    for name, spec in states.items():
        frame = base.copy()
        if len(spec) == 2:
            spots = [usd_box, lbp_box]
        else:
            spots = [
                (230, 390, 200, 100),
                (450, 390, 200, 100),
                (680, 390, 200, 100),
                (900, 390, 200, 100),
            ]
        for (kind, value, layers), (x, y, w, h) in zip(spec, spots):
            note = draw_note(w, h, kind, value)
            place_note(frame, note, (x, y), layers)
        write(name, frame)


def main() -> None:
    build_money()
    print("money")


if __name__ == "__main__":
    main()
