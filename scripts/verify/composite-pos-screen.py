"""Corner-pin the accepted POS empty plate onto LAPTOP_V1. Still test only."""
import json
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2] / "docs" / "awakening" / "continuity"
LAPTOP = ROOT / "v1" / "laptop-v1.jpg"
PLATE = ROOT / "screens" / "01-pos-empty.png"
OUT = ROOT / "v1" / "laptop-composite-pos-empty.png"
ZOOM = ROOT / "v1" / "laptop-composite-zoom.png"
TRACK = ROOT / "v1" / "laptop-v1-tracking.png"
META = ROOT / "v1" / "laptop-v1-corners.json"

# Screen plane on the 1280x720 LAPTOP_V1 plate. Order: TL, TR, BR, BL.
# Glass corners measured on laptop-v1.jpg (1280x720). Order: TL, TR, BR, BL.
# All four points sit on the dark glass, inside the bezel. Order: TL, TR, BR, BL.
PLANE = np.asarray([[240, 88], [690, 62], [750, 355], [305, 440]], dtype=np.float32)


def inset(pts: np.ndarray, amount: float) -> np.ndarray:
    center = pts.mean(axis=0)
    return np.asarray(center + (pts - center) * (1 - amount), dtype=np.float32)


def crop_plate(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    ink = gray < 236
    rows = np.where(ink.any(axis=1))[0]
    cols = np.where(ink.any(axis=0))[0]
    if len(rows) == 0:
        return image
    y0, y1 = int(rows[0]), int(rows[-1])
    x0, x1 = int(cols[0]), int(cols[-1])
    pad = 8
    y0 = max(0, y0 - pad)
    x0 = max(0, x0 - pad)
    y1 = min(image.shape[0] - 1, y1 + pad)
    x1 = min(image.shape[1] - 1, x1 + pad)
    return image[y0 : y1 + 1, x0 : x1 + 1]


def main() -> None:
    laptop = cv2.imread(str(LAPTOP))
    if laptop is None:
        raise FileNotFoundError(LAPTOP)
    plate_raw = cv2.imread(str(PLATE))
    if plate_raw is None:
        raise FileNotFoundError(PLATE)
    plate = crop_plate(plate_raw)
    h, w = laptop.shape[:2]
    ph, pw = plate.shape[:2]
    safe = inset(PLANE, 0.08)
    src = np.asarray([[0, 0], [pw - 1, 0], [pw - 1, ph - 1], [0, ph - 1]], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(src, safe)
    warped = cv2.warpPerspective(plate, matrix, (w, h))
    mask = cv2.warpPerspective(np.full((ph, pw), 255, np.uint8), matrix, (w, h))
    # Sit the UI in the glass: slightly dim, cool, with a thin top highlight only.
    ui = warped.astype(np.float32)
    ui[:, :, 0] *= 0.96
    ui[:, :, 1] *= 0.94
    ui[:, :, 2] *= 0.90
    highlight = np.zeros((h, w), np.float32)
    band = inset(PLANE, 0.08)
    top = np.asarray(
        [band[0], band[1], band[1] + (band[2] - band[1]) * 0.12, band[0] + (band[3] - band[0]) * 0.12],
        dtype=np.float32,
    )
    cv2.fillConvexPoly(highlight, np.asarray(top, dtype=np.int32), 1.0)
    highlight = cv2.GaussianBlur(highlight, (0, 0), 8)
    for channel in range(3):
        ui[:, :, channel] = np.clip(ui[:, :, channel] + highlight * 28, 0, 255)
    alpha = (mask.astype(np.float32) / 255.0)
    alpha = cv2.GaussianBlur(alpha, (0, 0), 1.2)
    # Keep a little of the glass falloff so the plate is not a flat sticker.
    shade = np.linspace(1.0, 0.86, h, dtype=np.float32)[:, None]
    ui *= shade[:, :, None]
    alpha = alpha[:, :, None]
    composed = laptop.astype(np.float32) * (1 - alpha) + ui * alpha
    result = composed.astype(np.uint8)
    cv2.imwrite(str(OUT), result)
    x0, y0 = int(PLANE[:, 0].min()) - 40, int(PLANE[:, 1].min()) - 30
    x1, y1 = int(PLANE[:, 0].max()) + 40, int(PLANE[:, 1].max()) + 30
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(w, x1), min(h, y1)
    cv2.imwrite(str(ZOOM), result[y0:y1, x0:x1])

    track = laptop.copy()
    cv2.polylines(track, [PLANE.astype(np.int32)], True, (235, 90, 20), 2)
    cv2.polylines(track, [safe.astype(np.int32)], True, (70, 170, 40), 2)
    labels = ["TL", "TR", "BR", "BL"]
    for name, point in zip(labels, PLANE):
        x, y = int(point[0]), int(point[1])
        cv2.circle(track, (x, y), 5, (235, 90, 20), -1)
        cv2.putText(track, name, (x + 6, y - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2, cv2.LINE_AA)
    cv2.imwrite(str(TRACK), track)

    norm = (PLANE / np.array([w, h])).round(4).tolist()
    META.write_text(
        json.dumps(
            {
                "id": "LAPTOP_V1",
                "image": "v1/laptop-v1.jpg",
                "pixels": {"width": w, "height": h},
                "order": ["topLeft", "topRight", "bottomRight", "bottomLeft"],
                "planePx": PLANE.round(1).tolist(),
                "planeNorm": norm,
                "safeInset": 0.08,
                "safePx": safe.round(1).tolist(),
                "capture": {"aspect": "16:10", "css": [1080, 640]},
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(json.dumps({"planeNorm": norm, "plate": [pw, ph]}))


if __name__ == "__main__":
    main()
