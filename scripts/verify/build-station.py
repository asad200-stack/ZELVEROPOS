"""Composite STATION_V1 from the locked prop photographs.

The laptop, printer, scanner, product box, character, plaza, and open case
are cut out of their locked masters. Nothing here is a newly generated device.
"""

from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2] / "docs" / "awakening" / "continuity" / "v1"
CACHE = ROOT / "_crops"


def gray_alpha(im, val_lo=95, val_hi=220, sat_max=34):
    b, g, r = cv2.split(im)
    mx = np.maximum(np.maximum(b, g), r).astype(np.int16)
    mn = np.minimum(np.minimum(b, g), r).astype(np.int16)
    sat = (mx - mn).astype(np.uint8)
    val = ((b.astype(np.int16) + g.astype(np.int16) + r.astype(np.int16)) // 3).astype(np.uint8)
    cand = ((sat < sat_max) & (val > val_lo) & (val < val_hi)).astype(np.uint8) * 255
    count, labels = cv2.connectedComponents(cand)
    border = np.zeros(count, np.bool_)
    edge = np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])
    border[np.unique(edge)] = True
    border[0] = False
    bg = border[labels].astype(np.uint8) * 255
    bg = cv2.dilate(bg, np.ones((5, 5), np.uint8))
    alpha = cv2.medianBlur(255 - bg, 5)
    return alpha


def grab_alpha(im, margin=0.02):
    h, w = im.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    rect = (int(w * margin), int(h * margin), int(w * (1 - 2 * margin)), int(h * (1 - 2 * margin)))
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(im, mask, rect, bgd, fgd, 4, cv2.GC_INIT_WITH_RECT)
    alpha = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    alpha = cv2.morphologyEx(alpha, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    return cv2.GaussianBlur(alpha, (3, 3), 0)


def drop_floor_shadow(im, alpha):
    """Remove only the gray contact shadow along the bottom. Leave the nameplate."""
    b, g, r = cv2.split(im)
    mx = np.maximum(np.maximum(b, g), r).astype(np.int16)
    mn = np.minimum(np.minimum(b, g), r).astype(np.int16)
    sat = mx - mn
    val = (b.astype(np.int16) + g.astype(np.int16) + r.astype(np.int16)) // 3
    h = alpha.shape[0]
    shadow = (val > 85) & (val < 200) & (sat < 35) & (alpha > 0)
    shadow[: int(h * 0.78), :] = False
    cleaned = alpha.copy()
    cleaned[shadow] = 0
    return cleaned


def load_cut(name, method, trim_shadow=False):
    CACHE.mkdir(exist_ok=True)
    alpha_path = CACHE / f"alpha-{Path(name).stem}.png"
    im = cv2.imread(str(ROOT / name))
    if im is None:
        raise FileNotFoundError(ROOT / name)
    if alpha_path.exists():
        alpha = cv2.imread(str(alpha_path), cv2.IMREAD_GRAYSCALE)
        if alpha is None:
            raise FileNotFoundError(alpha_path)
    else:
        alpha = grab_alpha(im) if method == "grab" else gray_alpha(im)
        cv2.imwrite(str(alpha_path), alpha)
    if trim_shadow:
        alpha = drop_floor_shadow(im, alpha)
    ys, xs = np.where(alpha > 16)
    if ys.size == 0 or xs.size == 0:
        raise ValueError(f"empty cutout mask for {name}")
    y0, y1, x0, x1 = int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1
    return im[y0:y1, x0:x1].copy(), alpha[y0:y1, x0:x1].copy()


def scale_pair(im, alpha, width):
    h, w = im.shape[:2]
    height = max(1, int(round(h * (width / w))))
    return (
        cv2.resize(im, (width, height), interpolation=cv2.INTER_AREA),
        cv2.resize(alpha, (width, height), interpolation=cv2.INTER_AREA),
    )


def paint_shadow(dst, cx, cy, rx, ry, strength=0.45):
    layer = np.zeros(dst.shape[:2], np.float32)
    cv2.ellipse(layer, (int(cx), int(cy)), (max(1, int(rx)), max(1, int(ry))), 0, 0, 360, 1.0, -1)
    layer = cv2.GaussianBlur(layer, (0, 0), sigmaX=18, sigmaY=8)
    shade = np.clip(1 - layer * strength, 0, 1)
    dst[:] = (dst.astype(np.float32) * shade[:, :, None]).astype(np.uint8)


def paste(dst, im, alpha, cx, bottom, warm=True):
    h, w = im.shape[:2]
    x0 = int(round(cx - w / 2))
    y0 = int(round(bottom - h))
    dh, dw = dst.shape[:2]
    sx0, sy0 = max(0, -x0), max(0, -y0)
    dx0, dy0 = max(0, x0), max(0, y0)
    x1, y1 = min(dw, x0 + w), min(dh, y0 + h)
    if x1 <= dx0 or y1 <= dy0:
        return
    crop = im[sy0 : sy0 + (y1 - dy0), sx0 : sx0 + (x1 - dx0)].astype(np.float32)
    if warm:
        crop[:, :, 0] *= 0.90
        crop[:, :, 1] *= 0.98
        crop[:, :, 2] *= 1.05
        crop = np.clip(crop, 0, 255)
    a = (alpha[sy0 : sy0 + (y1 - dy0), sx0 : sx0 + (x1 - dx0)].astype(np.float32) / 255.0)[:, :, None]
    base = dst[dy0:y1, dx0:x1].astype(np.float32)
    dst[dy0:y1, dx0:x1] = (base * (1 - a) + crop * a).astype(np.uint8)


def main():
    plaza = cv2.imread(str(ROOT / "plaza-v1-low.jpg"))
    if plaza is None:
        raise FileNotFoundError(ROOT / "plaza-v1-low.jpg")
    case, case_a = load_cut("case-v1-open-front.jpg", "gray", trim_shadow=True)
    printer, printer_a = load_cut("printer-v1.jpg", "gray")
    scanner, scanner_a = load_cut("scanner-v1.jpg", "grab")
    product, product_a = load_cut("product-v1.jpg", "grab")
    laptop, laptop_a = load_cut("laptop-composite-pos-empty.png", "grab")
    person, person_a = load_cut("character-v1-front.jpg", "grab")

    case, case_a = scale_pair(case, case_a, 600)
    case_w, case_h = case.shape[1], case.shape[0]
    printer, printer_a = scale_pair(printer, printer_a, int(case_w * 0.24))
    scanner, scanner_a = scale_pair(scanner, scanner_a, int(case_w * 0.18))
    product, product_a = scale_pair(product, product_a, 136)
    laptop, laptop_a = scale_pair(laptop, laptop_a, int(case_w * 0.30))
    person, person_a = scale_pair(person, person_a, 200)

    case_cx, case_bottom = 470, 690
    case_top = case_bottom - case_h

    paint_shadow(plaza, case_cx, case_bottom + 8, case_w * 0.42, 16, 0.5)
    paint_shadow(plaza, 1080, 704, 70, 12, 0.4)
    paste(plaza, case, case_a, case_cx, case_bottom)
    # Left bay, clear of the lid word. Center rail. Right rail.
    paste(plaza, laptop, laptop_a, case_cx - int(case_w * 0.30), case_top + int(case_h * 0.60))
    paste(plaza, printer, printer_a, case_cx - int(case_w * 0.02), case_top + int(case_h * 0.64))
    paste(plaza, scanner, scanner_a, case_cx + int(case_w * 0.30), case_top + int(case_h * 0.66))
    paste(plaza, product, product_a, case_cx + int(case_w * 0.46), case_bottom - 2)
    paste(plaza, person, person_a, 1080, 708)

    cv2.imwrite(str(ROOT / "station-v1.jpg"), plaza, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
    print("station", plaza.shape)


if __name__ == "__main__":
    main()
