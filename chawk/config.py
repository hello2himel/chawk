"""Configuration for the Chawk line-art -> equations pipeline."""

from __future__ import annotations

from dataclasses import dataclass, asdict, field
from typing import Any


@dataclass
class Config:
    """Tunable knobs for every pipeline stage.

    All distances/areas are in pixels of the (possibly rescaled) working image.
    """

    # ---------------- preprocessing ----------------
    max_dimension: int = 1600
    """Longest side of the working image. Larger inputs are downscaled (the
    render step scales results back up to the original resolution)."""

    blur_kernel: int = 3
    """Median blur kernel (odd, <=1 disables) applied before thresholding."""

    threshold_mode: str = "auto"
    """``auto`` (Otsu, then adaptive fallback for uneven lighting), ``otsu``
    or ``adaptive``."""

    adaptive_block: int = 35
    adaptive_C: int = 7

    invert: str = "auto"
    """``auto`` picks the polarity so that strokes (the minority class) become
    foreground. ``dark_strokes`` / ``light_strokes`` force it."""

    min_component_area: int = 12
    """Connected components smaller than this are treated as specks."""

    close_gaps: int = 0
    """Morphological closing radius used to bridge anti-aliasing gaps."""

    # ---------------- tracing ----------------
    min_stroke_length: float = 12.0
    """Traced paths shorter than this (px) are dropped as noise."""

    prune_spur_length: float = 8.0
    """Dead-end twigs hanging off a junction shorter than this are removed."""

    junction_link_angle: float = 55.0
    """Max direction change (degrees) allowed when walking *through* a
    junction so self-intersecting curves keep going straight instead of
    turning onto the crossing branch."""

    merge_endpoint_distance: float = 14.0
    """Endpoints of separate paths closer than this may be merged (dashed
    lines, anti-aliasing breaks)."""

    merge_endpoint_angle: float = 40.0
    """Max tangent disagreement (degrees) for such a merge."""

    resample_spacing: float = 2.0
    """Arc-length spacing used to resample a traced path before fitting."""

    smoothing_window: int = 5
    """Odd window for the moving-average smoothing of resampled paths."""

    # ---------------- segmentation ----------------
    rmse_tolerance: float = 2.0
    """Target geometric RMSE (px). Segments are split until each fit is at or
    below this, so the segment count stays minimal."""

    max_error_tolerance: float = 6.0
    """Hard cap on the worst-case point-to-curve distance of a segment."""

    min_segment_points: int = 8
    """Segments shorter than this get merged into a neighbour / fit as a line."""

    min_segment_length: float = 10.0
    """Minimum arc length (px) of a stand-alone segment."""

    max_segments_per_stroke: int = 24
    """Safety valve for pathological strokes."""

    rdp_epsilon: float = 2.5
    """Ramer-Douglas-Peucker tolerance for corner candidate detection."""

    corner_angle: float = 38.0
    """Turn angle (degrees) over a ``corner_window`` neighbourhood above which
    a vertex may be called a corner and force a split."""

    corner_window: float = 6.0
    """Arc length (px) on each side used to measure the corner angle."""

    corner_concentration: float = 0.55
    """A candidate is only a corner if its small-window angle is at least this
    fraction of its wide-window angle. Along a smooth arc the angle keeps
    growing with the window, so the ratio stays low and no split happens; at a
    true corner the whole turn is already in the small window."""

    # ---------------- fitting ----------------
    max_poly_degree: int = 4
    enable_circle: bool = True
    enable_ellipse: bool = True
    enable_sinusoid: bool = True
    enable_spline: bool = True
    spline_max_knots: int = 12
    bic_margin: float = 2.0
    """A more complex model must beat the simpler one's BIC by this much."""

    error_floor_px: float = 0.4
    """Noise floor for model comparison. Residuals below this are treated as
    rasterization/anti-aliasing noise rather than signal, which stops BIC from
    preferring a high-degree polynomial over a straight line on clean art."""

    # ---------------- rendering ----------------
    label_equations: bool = True
    max_labels: int = 60
    """Cap on drawn equation labels (dense drawings get the longest segments
    labelled; the JSON always lists everything)."""

    label_fontsize: float = 6.5
    overlay_linewidth: float = 1.6
    dpi: int = 150
    color_by: str = "stroke"
    """``stroke`` or ``segment`` colour cycling."""

    # ---------------- misc ----------------
    max_strokes: int = 400
    float_precision: int = 4

    extras: dict[str, Any] = field(default_factory=dict)

    def _validate_impl(self) -> None:
        """Raise ValueError for parameter values that would break the pipeline.

        This is the reliability gate: bad values used to cause hangs (e.g.
        ``resample_spacing=0`` explodes the point count) or silent nonsense
        (negative tolerances). Failing fast with a clear message is better.
        """
        def _need(name: str, cond: bool, hint: str) -> None:
            if not cond:
                raise ValueError(f"invalid config {name}={getattr(self, name)!r}: {hint}")

        _need("max_dimension", self.max_dimension is None or self.max_dimension >= 128,
              "use None to disable scaling, or a value >= 128")
        _need("blur_kernel", int(self.blur_kernel) >= 0, "must be >= 0 (0/1 disables)")
        _need("threshold_mode", self.threshold_mode in ("auto", "otsu", "adaptive"),
              "must be 'auto', 'otsu' or 'adaptive'")
        _need("invert", self.invert in ("auto", "dark_strokes", "light_strokes"),
              "must be 'auto', 'dark_strokes' or 'light_strokes'")
        _need("min_component_area", self.min_component_area >= 0, "must be >= 0")
        _need("close_gaps", self.close_gaps >= 0, "must be >= 0")
        _need("min_stroke_length", self.min_stroke_length > 0, "must be > 0")
        _need("prune_spur_length", self.prune_spur_length >= 0, "must be >= 0")
        _need("junction_link_angle", 0 < self.junction_link_angle <= 90,
              "must be in (0, 90] degrees")
        _need("merge_endpoint_distance", self.merge_endpoint_distance >= 0, "must be >= 0")
        _need("merge_endpoint_angle", 0 <= self.merge_endpoint_angle <= 90,
              "must be in [0, 90] degrees")
        _need("resample_spacing", self.resample_spacing >= 0.5,
              "must be >= 0.5px (smaller values explode the point count)")
        _need("smoothing_window", self.smoothing_window >= 0, "must be >= 0 (0/<3 disables)")
        _need("rmse_tolerance", self.rmse_tolerance > 0, "must be > 0")
        _need("max_error_tolerance", self.max_error_tolerance > 0, "must be > 0")
        _need("min_segment_points", self.min_segment_points >= 3, "must be >= 3")
        _need("min_segment_length", self.min_segment_length > 0, "must be > 0")
        _need("max_segments_per_stroke", self.max_segments_per_stroke >= 1, "must be >= 1")
        _need("rdp_epsilon", self.rdp_epsilon > 0, "must be > 0")
        _need("corner_angle", 0 < self.corner_angle < 180,
              "must be in (0, 180) degrees")
        _need("corner_window", self.corner_window > 0, "must be > 0")
        _need("corner_concentration", 0 < self.corner_concentration < 1,
              "must be in (0, 1)")
        _need("max_poly_degree", 1 <= int(self.max_poly_degree) <= 6,
              "must be an int in [1, 6]")
        _need("spline_max_knots", self.spline_max_knots >= 1, "must be >= 1")
        _need("bic_margin", self.bic_margin >= 0, "must be >= 0")
        _need("error_floor_px", self.error_floor_px > 0, "must be > 0")
        _need("max_labels", 0 <= self.max_labels <= 200,
              "must be in [0, 200] (larger values make label layout quadratic)")
        _need("label_fontsize", self.label_fontsize > 0, "must be > 0")
        _need("overlay_linewidth", self.overlay_linewidth > 0, "must be > 0")
        _need("dpi", 50 <= self.dpi <= 600, "must be in [50, 600]")
        _need("color_by", self.color_by in ("stroke", "segment"),
              "must be 'stroke' or 'segment'")
        _need("max_strokes", self.max_strokes >= 1, "must be >= 1")
        _need("float_precision", 0 <= self.float_precision <= 6, "must be in [0, 6]")

    def validate(self) -> None:
        """Check all knobs; raise ValueError (never TypeError) for anything bad."""
        try:
            self._validate_impl()
        except TypeError as exc:
            raise ValueError(f"invalid config value (wrong type): {exc}") from exc

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "Config":
        if not data:
            return cls()
        known = {f for f in cls.__dataclass_fields__ if f != "extras"}
        kwargs: dict[str, Any] = {}
        extras: dict[str, Any] = {}
        for key, value in data.items():
            if key in known:
                kwargs[key] = value
            else:
                extras[key] = value
        cfg = cls(**kwargs)
        cfg.extras = extras
        return cfg


PRESETS: dict[str, dict[str, Any]] = {
    "balanced": {},
    "precise": {
        "rmse_tolerance": 1.2,
        "max_error_tolerance": 4.0,
        "resample_spacing": 1.5,
        "rdp_epsilon": 1.8,
        "max_segments_per_stroke": 48,
    },
    "simple": {
        "rmse_tolerance": 3.5,
        "max_error_tolerance": 10.0,
        "resample_spacing": 3.0,
        "rdp_epsilon": 4.0,
        "max_segments_per_stroke": 12,
        "min_segment_length": 16.0,
    },
    "complex": {
        # Dense/detailed artwork: keep more strokes, label fewer of them.
        "max_dimension": 1800,
        "min_stroke_length": 9.0,
        "rmse_tolerance": 2.0,
        "resample_spacing": 1.8,
        "max_segments_per_stroke": 40,
        "max_strokes": 1200,
        "max_labels": 24,
        "label_fontsize": 5.5,
        "overlay_linewidth": 1.2,
    },
}


def build_config(preset: str = "balanced", **overrides: Any) -> Config:
    base = dict(PRESETS.get(preset, {}))
    base.update({k: v for k, v in overrides.items() if v is not None})
    cfg = Config.from_dict(base)
    cfg.validate()
    return cfg
