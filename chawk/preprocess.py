"""Stage 1: load an image and reduce it to a clean 1px-wide stroke mask."""

from __future__ import annotations

from dataclasses import dataclass, replace

import cv2
import numpy as np
from skimage.morphology import skeletonize

from .config import Config


@dataclass
class Preprocessed:
    original: np.ndarray
    """Original BGR image at input resolution."""

    gray: np.ndarray
    """Working-resolution grayscale image."""

    binary: np.ndarray
    """Working-resolution stroke mask, uint8 {0, 255}, strokes = 255."""

    skeleton: np.ndarray
    """1px-wide version of ``binary``, uint8 {0, 255}."""

    scale: float
    """working_size = original_size * scale (<= 1.0)."""

    stroke_thickness: float
    """Estimated mean stroke width in working pixels."""

    ink_ratio: float


def _flatten_alpha(image: np.ndarray) -> np.ndarray:
    """Flatten transparency onto an opaque background.

    Dropping the alpha channel (the OpenCV default) turns transparent regions
    black, which makes dark-on-transparent art (logos, icons) come out as
    black-on-black and therefore "blank". The background colour is picked from
    the visible pixels instead: dark artwork goes onto white, light artwork
    (e.g. white dark-mode logos) onto black. The normal polarity detection
    downstream then orients the strokes correctly either way.
    """
    if image.ndim == 3 and image.shape[2] == 4:
        bgr = image[:, :, :3].astype(np.float32)
        alpha = (image[:, :, 3:4].astype(np.float32)) / 255.0
        # Any faintly visible pixel counts: art stored at low opacity (e.g.
        # alpha=100 watermarks) must still pick the background correctly.
        # Below ~3% opacity there is effectively nothing to see.
        visible = alpha[:, :, 0] > 0.03
        if np.any(visible):
            w = alpha[visible][:, 0]
            mean_brightness = float(np.average(bgr[visible].reshape(-1, 3), axis=0,
                                               weights=w).mean())
        else:
            mean_brightness = 255.0
        bg = 0.0 if mean_brightness > 127.0 else 255.0
        return (bgr * alpha + bg * (1.0 - alpha)).astype(np.uint8)
    if image.ndim == 3 and image.shape[2] == 2:
        gray = image[:, :, 0:1].astype(np.float32)
        alpha = (image[:, :, 1:2].astype(np.float32)) / 255.0
        vis = gray[alpha[:, :, 0] > 0.03]
        bg = 0.0 if vis.size and float(vis.mean()) > 127.0 else 255.0
        flat = (gray * alpha + bg * (1.0 - alpha)).astype(np.uint8)
        return cv2.cvtColor(flat, cv2.COLOR_GRAY2BGR)
    return image


def load_image(path_or_bytes) -> np.ndarray:
    """Read an image from a path or raw bytes into BGR (alpha flattened)."""
    if isinstance(path_or_bytes, (bytes, bytearray, memoryview)):
        buf = np.frombuffer(bytes(path_or_bytes), dtype=np.uint8)
        if buf.size == 0:
            raise ValueError("Could not decode image (empty input, 0 bytes). "
                             "Supported formats: PNG, JPG, BMP, TIFF, WEBP.")
        image = cv2.imdecode(buf, cv2.IMREAD_UNCHANGED)
    else:
        image = cv2.imread(str(path_or_bytes), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise ValueError("Could not decode image. Supported formats: PNG, JPG, BMP, TIFF, WEBP.")
    return _flatten_alpha(image)


def _flatten_background(gray: np.ndarray) -> np.ndarray:
    """Divide out slowly varying illumination so scans/photos threshold well."""
    k = max(15, (min(gray.shape[:2]) // 8) | 1)
    # Never use a kernel larger than the image itself (tiny inputs).
    k = min(k, (min(gray.shape[:2]) | 1))
    if k < 3:
        return gray
    background = cv2.morphologyEx(
        gray, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    )
    background = cv2.GaussianBlur(background, (0, 0), k / 6.0)
    flat = cv2.divide(gray, background, scale=255)
    return flat


def _binarize(gray: np.ndarray, cfg: Config) -> np.ndarray:
    """Return a mask where strokes are 255 (foreground)."""
    work = gray
    if cfg.blur_kernel and cfg.blur_kernel > 1:
        k = int(cfg.blur_kernel) | 1
        # medianBlur kernel must fit inside the image; shrink for tiny inputs.
        cap = int(min(work.shape[:2]) | 1)
        if cap >= 3:
            k = min(k, cap if cap % 2 == 1 else cap - 1)
        if k >= 3:
            work = cv2.medianBlur(work, k)

    # Normalize to dark-strokes-on-light BEFORE background flattening: the
    # flatten step divides out illumination assuming a bright background, and
    # applying it to light-on-dark art wipes the strokes out (thick blobby
    # mask -> ladder skeleton -> traced loops). The ratio-based flip below
    # stays as a backstop in case the probe guesses wrong.
    if cfg.invert == "dark_strokes":
        strokes_dark = True
    elif cfg.invert == "light_strokes":
        strokes_dark = False
    else:
        _, probe = cv2.threshold(work, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        strokes_dark = float(np.count_nonzero(probe)) / probe.size > 0.5
    if not strokes_dark:
        work = cv2.bitwise_not(work)

    mode = cfg.threshold_mode
    candidates: list[np.ndarray] = []

    if mode in ("auto", "otsu"):
        flat = _flatten_background(work)
        _, otsu = cv2.threshold(flat, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        candidates.append(otsu)
    if mode in ("auto", "adaptive"):
        block = max(3, cfg.adaptive_block | 1)
        # adaptiveThreshold requires blockSize <= min(image dim); cap for tiny inputs.
        cap = int(min(work.shape[:2]) | 1)
        if cap >= 3:
            block = min(block, cap if cap % 2 == 1 else cap - 1)
        else:
            block = 0
        if block >= 3:
            adaptive = cv2.adaptiveThreshold(
                work, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, block, cfg.adaptive_C
            )
            candidates.append(adaptive)

    if not candidates:  # unknown mode -> plain Otsu
        _, fallback = cv2.threshold(work, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        candidates.append(fallback)

    def score(mask: np.ndarray) -> float:
        """Prefer masks whose ink coverage looks like line art (sparse)."""
        ratio = float(np.count_nonzero(mask)) / mask.size
        if ratio <= 0.0005 or ratio >= 0.75:
            return -1e9
        # Ideal line art covers a few percent of the canvas.
        return -abs(np.log(ratio / 0.04))

    mask = max(candidates, key=score)

    # Polarity: line art should have fewer ink pixels than background.
    ratio = float(np.count_nonzero(mask)) / mask.size
    if cfg.invert == "light_strokes":
        mask = cv2.bitwise_not(mask)
    elif cfg.invert == "auto" and ratio > 0.5:
        mask = cv2.bitwise_not(mask)

    return mask


def _remove_specks(mask: np.ndarray, min_area: int) -> np.ndarray:
    if min_area <= 1:
        return mask
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    keep = np.zeros(count, dtype=bool)
    for i in range(1, count):
        keep[i] = stats[i, cv2.CC_STAT_AREA] >= min_area
    if not keep[1:].any():  # everything is tiny; keep the largest so we fail softly
        areas = stats[1:, cv2.CC_STAT_AREA]
        if areas.size:
            keep[1 + int(np.argmax(areas))] = True
    return np.where(keep[labels], np.uint8(255), np.uint8(0))


def _estimate_thickness(mask: np.ndarray, skeleton: np.ndarray) -> float:
    ink = float(np.count_nonzero(mask))
    bones = float(np.count_nonzero(skeleton))
    if bones < 1:
        return 1.0
    return max(1.0, ink / bones)


def preprocess(image: np.ndarray, cfg: Config) -> Preprocessed:
    """Grayscale -> binarize -> denoise -> skeletonize."""
    if image is None:
        raise ValueError("preprocess received None instead of an image array.")
    arr = np.asarray(image)
    if arr.size == 0:
        raise ValueError("preprocess received an empty image (zero pixels).")
    if arr.ndim == 2:
        work_bgr = cv2.cvtColor(arr.astype(np.uint8), cv2.COLOR_GRAY2BGR)
    elif arr.ndim == 3 and arr.shape[2] in (2, 4):
        # Flatten transparency (see _flatten_alpha).
        work_bgr = _flatten_alpha(arr.astype(np.uint8))
        if work_bgr.ndim == 2:
            work_bgr = cv2.cvtColor(work_bgr, cv2.COLOR_GRAY2BGR)
    elif arr.ndim == 3 and arr.shape[2] == 3:
        work_bgr = arr.astype(np.uint8)
    else:
        raise ValueError(
            f"unsupported image shape {arr.shape}: expected HxW, HxWx3 or HxWx4."
        )
    h, w = work_bgr.shape[:2]
    if h < 2 or w < 2:
        raise ValueError(f"image too small ({w}x{h}): need at least 2x2 pixels.")
    original_bgr = work_bgr
    scale = 1.0
    if cfg.max_dimension and max(h, w) > cfg.max_dimension:
        scale = cfg.max_dimension / float(max(h, w))
        work_bgr = cv2.resize(
            work_bgr, (max(1, int(round(w * scale))), max(1, int(round(h * scale)))),
            interpolation=cv2.INTER_AREA,
        )

    gray = cv2.cvtColor(work_bgr, cv2.COLOR_BGR2GRAY)
    mask = _binarize(gray, cfg)

    # Thin-stroke fallback: median blur erases ~1px lines (CAD art, small text)
    # before thresholding ever sees them. If blurring left almost nothing,
    # retry unblurred and keep whichever mask actually found ink.
    if cfg.blur_kernel and cfg.blur_kernel > 1:
        floor = max(10.0, 0.0005 * mask.size)
        if float(np.count_nonzero(mask)) < floor:
            retry = _binarize(gray, replace(cfg, blur_kernel=1))
            if float(np.count_nonzero(retry)) > float(np.count_nonzero(mask)):
                mask = retry

    if cfg.close_gaps and cfg.close_gaps > 0:
        r = int(cfg.close_gaps)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

    mask = _remove_specks(mask, int(cfg.min_component_area))

    skeleton = skeletonize(mask > 0).astype(np.uint8) * 255
    # Skeletonizing thick strokes can leave 1px specks of its own.
    skeleton = _remove_specks(skeleton, 2)

    ink_ratio = float(np.count_nonzero(mask)) / mask.size
    return Preprocessed(
        original=original_bgr,
        gray=gray,
        binary=mask,
        skeleton=skeleton,
        scale=scale,
        stroke_thickness=_estimate_thickness(mask, skeleton),
        ink_ratio=ink_ratio,
    )
