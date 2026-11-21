"""Colour-illustration vectorisation.

Line art is about centre lines; a flat-colour illustration is about regions.
This module quantises the palette, extracts each colour's connected regions,
and hands their boundaries to the normal fitting pipeline. Each boundary is a
closed spline equation, and the region is filled with its palette colour.
"""

from __future__ import annotations

import cv2
import numpy as np

from . import ink
from .config import Config
from .preprocess import FillContour, FillRegion


def is_colorful(image: np.ndarray, cfg: Config) -> bool:
    """True when the drawing is a colour illustration rather than line art."""
    if cfg.color_count <= 0 or image is None or image.ndim != 3:
        return False
    h, w = image.shape[:2]
    scale = min(1.0, 320.0 / max(h, w))
    small = cv2.resize(image, (max(2, int(w * scale)), max(2, int(h * scale))),
                       interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    sat = hsv[:, :, 1].astype(np.float32)
    val = hsv[:, :, 2]
    visible = (val > 25) & (val < 250)
    if int(visible.sum()) < 50:
        return False
    if float(sat[visible].mean()) <= 40.0:
        return False

    # Flat-colour art quantises tightly; photos and noise do not. Reject the
    # latter here so the line-art density guard still handles them.
    lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)
    k = min(8, len(lab))
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 12, 1.0)
    _c, _l, centers = cv2.kmeans(lab, k, None, criteria, 1, cv2.KMEANS_PP_CENTERS)
    centers = centers.astype(np.float32)
    d = ((lab[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
    err = float(np.sqrt(np.min(d, axis=1).mean()))
    return err <= 18.0


def _assign(lab_flat: np.ndarray, centers: np.ndarray) -> np.ndarray:
    labels = np.empty(len(lab_flat), np.uint8)
    step = 200_000
    for i in range(0, len(lab_flat), step):
        chunk = lab_flat[i:i + step]
        d = ((chunk[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
        labels[i:i + step] = np.argmin(d, axis=1)
    return labels


def vectorize(image: np.ndarray, cfg: Config) -> tuple[list[FillRegion], tuple[int, int, int]]:
    """Quantise the image and return (regions, background_rgb).

    Every region carries its palette colour; ``fill_id`` is unique and shared
    by its outer contour and holes.
    """
    h, w = image.shape[:2]
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    flat = lab.reshape(-1, 3).astype(np.float32)
    k = max(2, int(cfg.color_count))

    step = max(1, len(flat) // 60_000)
    samples = flat[::step]
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _compactness, _labels, centers = cv2.kmeans(
        samples, k, None, criteria, 2, cv2.KMEANS_PP_CENTERS)
    centers = centers.astype(np.float32)

    labels = _assign(flat, centers)
    # Median filter in colour space, then re-assign: kills the 1-px palette
    # speckles that otherwise read as "dandruff" in hair and along edges.
    rgb_centers = cv2.cvtColor(centers.reshape(1, k, 3).astype(np.uint8),
                               cv2.COLOR_LAB2BGR).reshape(k, 3)
    poster = rgb_centers[labels].reshape(h, w, 3)
    poster = cv2.medianBlur(poster, 3)
    lab2 = cv2.cvtColor(poster, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)
    labels = _assign(lab2, centers).reshape(h, w)
    counts = np.bincount(labels.ravel(), minlength=k)
    bg = int(np.argmax(counts))
    rgb = cv2.cvtColor(centers.reshape(1, k, 3).astype(np.uint8),
                       cv2.COLOR_LAB2RGB).reshape(k, 3)

    regions: list[FillRegion] = []
    for label in range(k):
        if label == bg:
            continue
        mask = (labels == label).astype(np.uint8)
        n, comp_labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
        color = ink.to_hex(rgb[label])
        for i in range(1, n):
            area = float(stats[i, cv2.CC_STAT_AREA])
            if area < cfg.color_min_area:
                continue
            comp = (comp_labels == i).astype(np.uint8)
            contours, hierarchy = cv2.findContours(
                comp, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
            if hierarchy is None:
                continue
            hierarchy = hierarchy[0]
            region = FillRegion(fill_id=0, area=area, color=color)
            for ci, contour in enumerate(contours):
                if len(contour) < 4:
                    continue
                role = "outer" if int(hierarchy[ci][3]) == -1 else "hole"
                region.contours.append(
                    FillContour(points=contour.reshape(-1, 2).astype(np.float64), role=role))
            if region.contours:
                regions.append(region)

    for n, region in enumerate(regions, start=1):
        region.fill_id = n
    return regions, tuple(int(v) for v in rgb[bg])


