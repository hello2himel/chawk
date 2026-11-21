"""Stage 4: candidate curve models and model selection.

Every model exposes the same shape (``FitResult``) so that segmentation and
rendering never need to know which model won:

* ``sample(n)`` -> a dense polyline of the fitted curve over its own domain
* ``rmse`` / ``max_error`` / ``r_squared`` -> geometric, measured as
  point-to-curve distance in pixels, so all model families are comparable
* ``bic`` -> used to pick the simplest model that explains the segment

All fits are done in original-image pixel coordinates.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field
from typing import Any, Callable

import numpy as np
from scipy import interpolate, optimize

from . import geom
from .config import Config

_SUPERSCRIPT = {2: "\u00b2", 3: "\u00b3", 4: "\u2074", 5: "\u2075", 6: "\u2076"}


# --------------------------------------------------------------------------
# result container
# --------------------------------------------------------------------------

@dataclass
class FitResult:
    model: str
    equation: str
    params: dict[str, Any]
    sampler: Callable[[int], np.ndarray] = field(repr=False)
    n_params: int
    domain: dict[str, Any] = field(default_factory=dict)
    rmse: float = float("inf")
    max_error: float = float("inf")
    r_squared: float = 0.0
    bic: float = float("inf")
    n_points: int = 0

    def sample(self, n: int = 200) -> np.ndarray:
        return self.sampler(max(2, int(n)))


def _fmt(v: float, precision: int = 4) -> str:
    if v is None or not np.isfinite(v):
        return "nan"
    av = abs(v)
    if av != 0 and (av < 1e-3 or av >= 1e6):
        return f"{v:.{max(2, precision - 1)}e}"
    s = f"{v:.{precision}f}".rstrip("0").rstrip(".")
    return s if s not in ("-0", "") else "0"


def _pow(var: str, p: int) -> str:
    if p == 0:
        return ""
    if p == 1:
        return var
    return f"{var}{_SUPERSCRIPT.get(p, '^' + str(p))}"


def poly_equation(coeffs: np.ndarray, dep: str, indep: str, precision: int = 4) -> str:
    """Render numpy.polyfit coefficients (highest power first) as a string."""
    deg = len(coeffs) - 1
    terms: list[str] = []
    for i, c in enumerate(coeffs):
        p = deg - i
        if abs(c) < 1e-12 and deg > 0 and p != 0:
            continue
        mag = _fmt(abs(c), precision)
        body = _pow(indep, p)
        if p == 0:
            term = mag
        elif mag == "1":
            term = body
        else:
            term = f"{mag}{body}"
        sign = "-" if c < 0 else "+"
        terms.append((sign, term))
    if not terms:
        return f"{dep} = 0"
    head_sign, head = terms[0]
    out = f"{dep} = " + ("-" if head_sign == "-" else "") + head
    for sign, term in terms[1:]:
        out += f" {sign} {term}"
    return out


# --------------------------------------------------------------------------
# scoring
# --------------------------------------------------------------------------

def score_fit(result: FitResult, points: np.ndarray, cfg: Config,
              samples: int | None = None) -> FitResult:
    """Fill in geometric error metrics + BIC for a candidate fit."""
    pts = np.asarray(points, dtype=np.float64)
    n = len(pts)
    if n == 0 or not np.all(np.isfinite(pts)):
        result.rmse = result.max_error = float("inf")
        result.r_squared = 0.0
        result.bic = float("inf")
        result.n_points = n
        return result
    dense = result.sample(samples or max(120, min(1500, 6 * n)))
    if dense is None or len(dense) < 2 or not np.all(np.isfinite(dense)):
        result.rmse = result.max_error = float("inf")
        result.r_squared = 0.0
        result.bic = float("inf")
        return result

    d = geom.point_to_polyline_distance(pts, dense)
    sse = float(np.sum(d ** 2))
    result.rmse = float(np.sqrt(sse / n))
    result.max_error = float(np.max(d))
    result.n_points = n

    centroid = pts.mean(axis=0)
    sst = float(np.sum((pts - centroid) ** 2))
    result.r_squared = 1.0 - sse / sst if sst > 1e-12 else (1.0 if sse < 1e-12 else 0.0)
    result.r_squared = float(min(1.0, result.r_squared))

    # Gaussian BIC on the residual distances; 2n observations (x and y).
    # sigma2 is clamped at a noise floor: rasterization, anti-aliasing and
    # skeletonization mean sub-pixel differences are not real signal. Without
    # the floor, sse -> 0 makes m*log(sigma2) diverge and swamp the parameter
    # penalty, so a degree-4 polynomial would always beat a straight line.
    m = 2 * n
    floor = max(float(cfg.error_floor_px), 1e-3) ** 2
    sigma2 = max(sse / m, floor)
    result.bic = m * np.log(sigma2) + result.n_params * np.log(m)
    return result


# --------------------------------------------------------------------------
# models
# --------------------------------------------------------------------------

def fit_line(points: np.ndarray, cfg: Config) -> FitResult | None:
    """Total-least-squares line (works for vertical lines too)."""
    pts = np.asarray(points, dtype=np.float64)
    if len(pts) < 2 or not np.all(np.isfinite(pts)):
        return None
    centroid = pts.mean(axis=0)
    try:
        u, s, vt = np.linalg.svd(pts - centroid, full_matrices=False)
    except (np.linalg.LinAlgError, ValueError):
        return None
    direction = vt[0]
    t = (pts - centroid) @ direction
    t0, t1 = float(t.min()), float(t.max())
    p0 = centroid + t0 * direction
    p1 = centroid + t1 * direction

    dx, dy = direction
    if abs(dx) >= abs(dy):
        m = dy / dx if abs(dx) > 1e-12 else 0.0
        b = centroid[1] - m * centroid[0]
        equation = poly_equation(np.array([m, b]), "y", "x", cfg.float_precision)
        params = {"form": "y = m*x + b", "m": m, "b": b}
        domain = {"variable": "x", "start": float(min(p0[0], p1[0])), "end": float(max(p0[0], p1[0]))}
    else:
        m = dx / dy if abs(dy) > 1e-12 else 0.0
        b = centroid[0] - m * centroid[1]
        equation = poly_equation(np.array([m, b]), "x", "y", cfg.float_precision)
        params = {"form": "x = m*y + b", "m": m, "b": b}
        domain = {"variable": "y", "start": float(min(p0[1], p1[1])), "end": float(max(p0[1], p1[1]))}

    params.update({"p0": [float(p0[0]), float(p0[1])], "p1": [float(p1[0]), float(p1[1])]})

    def sampler(n: int, p0=p0, p1=p1) -> np.ndarray:
        tt = np.linspace(0.0, 1.0, n)[:, None]
        return p0[None, :] + tt * (p1 - p0)[None, :]

    # A line y = m*x + b (or x = m*y + b) has 2 free parameters. (The endpoints
    # are set by the data extent, not fitted.) Using 4 here used to penalize
    # straight lines against quadratics in BIC comparison.
    return FitResult("line", equation, params, sampler, n_params=2, domain=domain)


def fit_polynomial(points: np.ndarray, degree: int, cfg: Config) -> FitResult | None:
    """Fit y = f(x) (or x = f(y) for steep segments) in the image frame."""
    pts = np.asarray(points, dtype=np.float64)
    if len(pts) < degree + 2:
        return None
    steep = geom.is_steep(pts)
    indep, dep = (pts[:, 1], pts[:, 0]) if steep else (pts[:, 0], pts[:, 1])

    order = np.argsort(indep)
    iv, dv = indep[order], dep[order]
    span = float(iv[-1] - iv[0])
    if span < 1e-6:
        return None
    # Reject when the independent variable is not (nearly) monotonic along the
    # path: y = f(x) simply cannot represent a fold-back.
    raw = indep
    steps = np.diff(raw)
    if len(steps):
        fwd = float(np.sum(np.abs(steps[steps > 0])))
        bwd = float(np.sum(np.abs(steps[steps < 0])))
        if min(fwd, bwd) > 0.18 * max(fwd, bwd, 1e-9):
            return None

    try:
        coeffs = np.polyfit(iv, dv, degree)
    except Exception:
        return None
    if not np.all(np.isfinite(coeffs)):
        return None

    lo, hi = float(iv[0]), float(iv[-1])
    var_i, var_d = ("y", "x") if steep else ("x", "y")
    equation = poly_equation(coeffs, var_d, var_i, cfg.float_precision)
    params = {
        "coefficients": [float(c) for c in coeffs],
        "degree": int(degree),
        "independent": var_i,
        "dependent": var_d,
    }

    def sampler(n: int, coeffs=coeffs, lo=lo, hi=hi, steep=steep) -> np.ndarray:
        t = np.linspace(lo, hi, n)
        v = np.polyval(coeffs, t)
        return np.column_stack([v, t]) if steep else np.column_stack([t, v])

    name = "line" if degree == 1 else f"polynomial{degree}"
    return FitResult(
        name, equation, params, sampler,
        n_params=degree + 1,
        domain={"variable": var_i, "start": lo, "end": hi},
    )


def _kasa_circle(pts: np.ndarray) -> tuple[float, float, float] | None:
    x, y = pts[:, 0], pts[:, 1]
    if not np.all(np.isfinite(pts)):
        return None
    if float(np.ptp(x)) < 1e-9 and float(np.ptp(y)) < 1e-9:
        return None  # single repeated point: no circle to fit
    A = np.column_stack([x, y, np.ones(len(pts))])
    b = x * x + y * y
    try:
        sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    except np.linalg.LinAlgError:
        return None
    h, k = sol[0] / 2.0, sol[1] / 2.0
    val = sol[2] + h * h + k * k
    if val <= 0 or not np.isfinite(val):
        return None
    return float(h), float(k), float(np.sqrt(val))


def _angle_range(pts: np.ndarray, h: float, k: float) -> tuple[float, float]:
    """Unwrapped start/end angle following the path order (handles wraparound)."""
    ang = np.unwrap(np.arctan2(pts[:, 1] - k, pts[:, 0] - h))
    return float(ang[0]), float(ang[-1])


def fit_circle(points: np.ndarray, cfg: Config) -> FitResult | None:
    pts = np.asarray(points, dtype=np.float64)
    if len(pts) < 5:
        return None
    init = _kasa_circle(pts)
    if init is None:
        return None
    h, k, r = init

    def residual(p):
        return np.hypot(pts[:, 0] - p[0], pts[:, 1] - p[1]) - p[2]

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            sol = optimize.least_squares(residual, [h, k, r], method="lm", max_nfev=400)
        h, k, r = (float(v) for v in sol.x)
    except Exception:
        pass
    if not np.isfinite(r) or r <= 1e-6:
        return None
    span = float(np.linalg.norm(pts.max(axis=0) - pts.min(axis=0)))
    if r > 60 * max(span, 1.0):
        return None  # degenerate: effectively a straight line

    a0, a1 = _angle_range(pts, h, k)
    sweep = a1 - a0
    closed = abs(sweep) >= 2 * np.pi - 0.35
    if closed:
        a0, a1 = 0.0, 2 * np.pi

    equation = (f"(x - {_fmt(h, cfg.float_precision)})\u00b2 + "
                f"(y - {_fmt(k, cfg.float_precision)})\u00b2 = "
                f"{_fmt(r, cfg.float_precision)}\u00b2")
    params = {
        "h": h, "k": k, "r": r,
        "theta_start_deg": float(np.rad2deg(a0)),
        "theta_end_deg": float(np.rad2deg(a1)),
        "closed": bool(closed),
        "parametric": "x = h + r*cos(t), y = k + r*sin(t)",
    }

    def sampler(n: int, h=h, k=k, r=r, a0=a0, a1=a1) -> np.ndarray:
        t = np.linspace(a0, a1, n)
        return np.column_stack([h + r * np.cos(t), k + r * np.sin(t)])

    model = "circle" if closed else "circular_arc"
    return FitResult(
        model, equation, params, sampler, n_params=3,
        domain={"variable": "theta", "start": float(np.rad2deg(a0)), "end": float(np.rad2deg(a1))},
    )


def fit_ellipse(points: np.ndarray, cfg: Config) -> FitResult | None:
    pts = np.asarray(points, dtype=np.float64)
    if len(pts) < 8:
        return None
    try:
        import cv2
        (cx, cy), (d1, d2), angle_deg = cv2.fitEllipse(pts.astype(np.float32))
    except Exception:
        return None
    a, b = d1 / 2.0, d2 / 2.0
    if not all(np.isfinite(v) for v in (cx, cy, a, b)) or min(a, b) <= 1e-6:
        return None
    # cv2.fitEllipse returns the rotation of the (d1) axis from the x axis,
    # so phi is angle_deg directly. (A previous +90° offset rotated every
    # ellipse perpendicular and meant the model never won selection.)
    phi = np.deg2rad(angle_deg)
    cos_p, sin_p = np.cos(phi), np.sin(phi)

    dx, dy = pts[:, 0] - cx, pts[:, 1] - cy
    u = (dx * cos_p + dy * sin_p) / a
    v = (-dx * sin_p + dy * cos_p) / b
    t = np.unwrap(np.arctan2(v, u))
    t0, t1 = float(t[0]), float(t[-1])
    closed = abs(t1 - t0) >= 2 * np.pi - 0.35
    if closed:
        t0, t1 = 0.0, 2 * np.pi

    equation = (f"((x-{_fmt(cx, cfg.float_precision)})cos\u03c6 + (y-{_fmt(cy, cfg.float_precision)})sin\u03c6)\u00b2"
                f"/{_fmt(a, cfg.float_precision)}\u00b2 + "
                f"(-(x-{_fmt(cx, cfg.float_precision)})sin\u03c6 + (y-{_fmt(cy, cfg.float_precision)})cos\u03c6)\u00b2"
                f"/{_fmt(b, cfg.float_precision)}\u00b2 = 1, \u03c6 = {_fmt(np.rad2deg(phi), 2)}\u00b0")
    params = {
        "cx": float(cx), "cy": float(cy), "a": float(a), "b": float(b),
        "phi_deg": float(np.rad2deg(phi)),
        "t_start_deg": float(np.rad2deg(t0)), "t_end_deg": float(np.rad2deg(t1)),
        "closed": bool(closed),
        "parametric": "x = cx + a*cos(t)*cos(phi) - b*sin(t)*sin(phi); y = cy + a*cos(t)*sin(phi) + b*sin(t)*cos(phi)",
    }

    def sampler(n: int, cx=cx, cy=cy, a=a, b=b, cos_p=cos_p, sin_p=sin_p, t0=t0, t1=t1) -> np.ndarray:
        t = np.linspace(t0, t1, n)
        uu, vv = a * np.cos(t), b * np.sin(t)
        return np.column_stack([cx + uu * cos_p - vv * sin_p, cy + uu * sin_p + vv * cos_p])

    return FitResult(
        "ellipse" if closed else "elliptical_arc", equation, params, sampler, n_params=5,
        domain={"variable": "t", "start": float(np.rad2deg(t0)), "end": float(np.rad2deg(t1))},
    )


def fit_sinusoid(points: np.ndarray, cfg: Config) -> FitResult | None:
    """y = A*sin(B*x + C) + D, fitted by harmonic least squares.

    For a fixed frequency the model is linear in (a, b, D):
        y = a*sin(Bx) + b*cos(Bx) + D
    so each frequency costs one small lstsq instead of a 4-parameter
    nonlinear least squares. The FFT seeds the frequency, a coarse sweep
    picks the right period, and a bounded 1-D refinement polishes it.
    """
    pts = np.asarray(points, dtype=np.float64)
    if len(pts) < 12:
        return None
    steep = geom.is_steep(pts)
    indep, dep = (pts[:, 1], pts[:, 0]) if steep else (pts[:, 0], pts[:, 1])
    order = np.argsort(indep)
    iv, dv = indep[order], dep[order]
    span = float(iv[-1] - iv[0])
    if span < 8:
        return None

    # Uniform resample for a meaningful FFT.
    grid = np.linspace(iv[0], iv[-1], max(32, len(iv)))
    vals = np.interp(grid, iv, dv)
    detr = vals - vals.mean()
    spec = np.abs(np.fft.rfft(detr))
    freqs = np.fft.rfftfreq(len(grid), d=(grid[1] - grid[0]))
    if len(spec) < 3:
        return None
    peak = int(np.argmax(spec[1:]) + 1)
    f0 = float(freqs[peak])
    if f0 <= 0:
        return None
    B0 = 2 * np.pi * f0
    if B0 * span < 1.2:
        return None  # less than ~1/5 of a period: a polynomial is honest here

    ones = np.ones_like(iv)

    def solve(B: float) -> tuple[float, float, float, float]:
        sin = np.sin(B * iv)
        cos = np.cos(B * iv)
        design = np.column_stack([sin, cos, ones])
        coef, *_ = np.linalg.lstsq(design, dv, rcond=None)
        a, b, D = (float(v) for v in coef)
        resid = dv - (a * sin + b * cos + D)
        return float(np.dot(resid, resid)), a, b, D

    best = None
    for scale in np.linspace(0.5, 2.0, 31):
        B = B0 * scale
        if B * span < 1.2 or B * span > 200:
            continue
        sse, a, b, D = solve(B)
        if best is None or sse < best[0]:
            best = (sse, B, a, b, D)
    if best is None:
        return None

    B_lo = max(1e-6, best[1] * 0.88)
    B_hi = best[1] * 1.12
    if B_lo * span < 1.2:
        B_lo = 1.2 / span
    if B_hi * span > 200:
        B_hi = 200 / span
    if B_hi > B_lo:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                opt = optimize.minimize_scalar(
                    lambda B: solve(B)[0], bounds=(B_lo, B_hi),
                    method="bounded", options={"xatol": 1e-4},
                )
            if opt.success and np.isfinite(opt.x):
                sse, a, b, D = solve(float(opt.x))
                if sse < best[0]:
                    best = (sse, float(opt.x), a, b, D)
        except Exception:
            pass

    sse, B, a, b, D = best
    A = float(np.hypot(a, b))
    C = float(np.arctan2(b, a))
    if not all(np.isfinite(v) for v in (A, B, C, D)) or abs(B) < 1e-9:
        return None
    if abs(B) * span > 200:
        return None
    resid = float(np.sqrt(sse / len(iv)))

    lo, hi = float(iv[0]), float(iv[-1])
    var_i, var_d = ("y", "x") if steep else ("x", "y")
    eq = (f"{var_d} = {_fmt(A, cfg.float_precision)}\u00b7sin("
          f"{_fmt(B, cfg.float_precision)}{var_i} "
          f"{'+' if C >= 0 else '-'} {_fmt(abs(C), cfg.float_precision)}) "
          f"{'+' if D >= 0 else '-'} {_fmt(abs(D), cfg.float_precision)}")
    params = {"A": A, "B": B, "C": C, "D": D,
              "independent": var_i, "dependent": var_d,
              "period": float(2 * np.pi / abs(B)), "_resid": resid}

    def sampler(n: int, A=A, B=B, C=C, D=D, lo=lo, hi=hi, steep=steep) -> np.ndarray:
        t = np.linspace(lo, hi, max(2, int(n)))
        y = A * np.sin(B * t + C) + D
        return np.column_stack([y, t]) if steep else np.column_stack([t, y])

    return FitResult("sinusoid", eq, params, sampler, n_params=4)


def fit_spline(points: np.ndarray, cfg: Config) -> FitResult | None:
    """Parametric cubic spline in arc length: the honest fallback."""
    pts = np.asarray(points, dtype=np.float64)
    n = len(pts)
    if n < 6 or not np.all(np.isfinite(pts)):
        return None
    s = geom.arc_length_param(pts)
    total = float(s[-1])
    if total < 1e-6:
        return None
    t = s / total

    # Choose the fewest interior knots that reach the error target.
    target = max(cfg.rmse_tolerance * 0.75, 0.4)
    best: FitResult | None = None
    max_knots = max(1, min(cfg.spline_max_knots, (n // 6) or 1))
    for n_knots in range(1, max_knots + 1):
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                k = 3 if n > 2 * (n_knots + 4) else min(3, max(1, n - 2))
                smooth = max(1e-6, n * (target ** 2))
                tck, u = interpolate.splprep([pts[:, 0], pts[:, 1]], u=t, s=smooth,
                                             k=k, nest=max(2 * (n_knots + k + 1), 2 * k + 3))
        except Exception:
            continue
        knots = np.asarray(tck[0], dtype=float)
        n_free = 2 * (len(knots) - k - 1)

        def sampler(m: int, tck=tck) -> np.ndarray:
            uu = np.linspace(0.0, 1.0, m)
            xs, ys = interpolate.splev(uu, tck)
            return np.column_stack([np.asarray(xs), np.asarray(ys)])

        cx, cy = np.asarray(tck[1][0], dtype=float), np.asarray(tck[1][1], dtype=float)
        params = {
            "degree": int(k),
            "n_control_points": int(len(cx)),
            "knots_normalized": [round(float(v), 6) for v in knots],
            "control_points_x": [round(float(v), 3) for v in cx],
            "control_points_y": [round(float(v), 3) for v in cy],
            "arc_length": total,
            "form": "piecewise cubic B-spline, parametrized by normalized arc length u in [0,1]",
        }
        equation = (f"piecewise cubic: (x(u), y(u)), u \u2208 [0,1], "
                    f"{len(cx)} control points, arc length {_fmt(total, 1)}px")
        cand = score_fit(FitResult("spline", equation, params, sampler,
                                   n_params=n_free,
                                   domain={"variable": "u", "start": 0.0, "end": 1.0}), pts, cfg)
        if best is None or cand.bic < best.bic - 1e-9:
            best = cand
        if cand.rmse <= cfg.rmse_tolerance and cand.max_error <= cfg.max_error_tolerance:
            break
    return best


# --------------------------------------------------------------------------
# model selection
# --------------------------------------------------------------------------

_COMPLEXITY = {
    "line": 0, "polynomial2": 1, "polynomial3": 2, "polynomial4": 3,
    "circular_arc": 1, "circle": 1, "elliptical_arc": 2, "ellipse": 2,
    "sinusoid": 3, "spline": 6,
}


def _num(v: float, places: int = 2) -> str:
    out = f"{v:.{places}f}".rstrip("0").rstrip(".")
    return "0" if out in ("", "-0") else out


def _fourier_line(mean: float, cos: list[float], sin: list[float],
                  shown: int, label: str, harmonic: int = 1) -> str:
    """One line of a real Fourier series with actual coefficients."""
    parts = [f"{label}(t) = {_num(mean)}"]
    for k in range(1, min(shown, len(cos) - 1) + 1):
        a, b = cos[k], sin[k]
        if abs(a) > 5e-3:
            parts.append(f" + {_num(abs(a))}cos {2 * k}πt" if a >= 0
                         else f" − {_num(abs(a))}cos {2 * k}πt")
        if abs(b) > 5e-3:
            parts.append(f" + {_num(abs(b))}sin {2 * k}πt" if b >= 0
                         else f" − {_num(abs(b))}sin {2 * k}πt")
    if harmonic > shown:
        parts.append(" + …")
    return "".join(parts)


def fit_closed_spline(points: np.ndarray, cfg: Config,
                      smoothing: float = 1.5) -> FitResult:
    """A periodic Fourier series through a closed boundary.

    Colour-region vectorisation reuses this: one compact parametric equation
    per boundary (outer contour or hole) instead of segmenting it into many
    analytic pieces. Coefficients are taken from the FFT of the arclength-
    uniform contour, and just enough harmonics are kept to stay within a
    pixel of the ink.
    """
    pts = np.asarray(points, dtype=np.float64)
    if len(pts) < 6:
        raise ValueError("need at least 6 points for a closed spline")
    if np.linalg.norm(pts[0] - pts[-1]) < 1e-9:
        pts = pts[:-1]
    keep = np.ones(len(pts), dtype=bool)
    keep[1:] = np.linalg.norm(np.diff(pts, axis=0), axis=1) > 1e-9
    pts = pts[keep]
    if len(pts) < 6:
        raise ValueError("degenerate closed contour")

    # Resample the polygon uniformly by arclength so the FFT sees one period.
    closed = np.vstack([pts, pts[0]])
    seg = np.hypot(*np.diff(closed, axis=0).T)
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    total = float(cum[-1])
    if total <= 1e-9:
        raise ValueError("degenerate closed contour")
    n = 192
    u = np.linspace(0.0, total, n, endpoint=False)
    x = np.interp(u, cum, closed[:, 0])
    y = np.interp(u, cum, closed[:, 1])
    z = x + 1j * y
    zhat = np.fft.fft(z) / n

    # Keep harmonics until the omitted amplitude is sub-pixel.
    max_k = min(n // 2 - 2, 64)
    k_max = 4
    while k_max < max_k:
        # z(t) is complex, so the spectrum is not conjugate-symmetric: the
        # negative-frequency bins zhat[n-k] carry the opposite winding.
        tail = np.abs(zhat[k_max + 1:n // 2]) + np.abs(zhat[n // 2 + 1:n - k_max])
        if float(tail.sum()) <= 1.5:
            break
        k_max += 1
    k_max = max(4, min(k_max, max_k))

    def evaluate(t: np.ndarray) -> np.ndarray:
        zt = np.full(np.shape(t), zhat[0], dtype=complex)
        for k in range(1, k_max + 1):
            zt = zt + zhat[k] * np.exp(2j * np.pi * k * t)
            zt = zt + zhat[n - k] * np.exp(-2j * np.pi * k * t)
        return zt

    def sampler(m: int = 240) -> np.ndarray:
        t = np.linspace(0.0, 1.0, max(3, int(m)), endpoint=False)
        zt = evaluate(t)
        out = np.column_stack([zt.real, zt.imag])
        return np.vstack([out, out[0]])

    curve = sampler(240)
    perimeter = float(np.hypot(*np.diff(curve, axis=0).T).sum())
    cos_x = [0.0]
    sin_x = [0.0]
    cos_y = [0.0]
    sin_y = [0.0]
    for k in range(1, k_max + 1):
        a, b = zhat[k], zhat[n - k]
        cos_x.append(float(a.real + b.real))
        sin_x.append(float(-a.imag + b.imag))
        cos_y.append(float(a.imag + b.imag))
        sin_y.append(float(a.real - b.real))
    equation = (
        _fourier_line(float(zhat[0].real), cos_x, sin_x, 2, "x")
        + "\n"
        + _fourier_line(float(zhat[0].imag), cos_y, sin_y, 2, "y")
    )
    params = {
        "kind": "fourier_series",
        "harmonics": k_max,
        "coefficients": [[round(float(c.real), 6), round(float(c.imag), 6)]
                         for c in zhat[:k_max + 1]],
        "perimeter": round(perimeter, 3),
    }
    return FitResult(
        "closed_spline", equation, params, sampler, n_params=2 * (k_max + 1),
        domain={"variable": "t", "start": 0.0, "end": 360.0},
    )


def fit_segment(points: np.ndarray, cfg: Config, closed: bool = False,
                allow_spline: bool = True) -> FitResult:
    """Try every enabled model on one segment and return the best tradeoff.

    ``allow_spline=False`` restricts the search to closed-form models, which is
    what the segmentation stage uses while growing spans so that a flexible
    spline cannot mask how far a real equation would have reached.
    """
    pts = np.asarray(points, dtype=np.float64)
    if pts.size and not np.all(np.isfinite(pts)):
        pts = pts[np.all(np.isfinite(pts), axis=1)]
    if len(pts) == 0:
        pts = np.zeros((1, 2))
    candidates: list[FitResult] = []

    def add(result: FitResult | None) -> None:
        if result is None:
            return
        if result.bic == float("inf") and result.rmse == float("inf"):
            result = score_fit(result, pts, cfg)
        if np.isfinite(result.rmse):
            candidates.append(result)

    if not closed:
        add(fit_line(pts, cfg))
        for deg in range(2, max(2, int(cfg.max_poly_degree)) + 1):
            add(fit_polynomial(pts, deg, cfg))
    if cfg.enable_circle:
        add(fit_circle(pts, cfg))
    if cfg.enable_ellipse:
        add(fit_ellipse(pts, cfg))
    if cfg.enable_sinusoid and not closed:
        add(fit_sinusoid(pts, cfg))

    for c in candidates:
        if c.bic == float("inf"):
            score_fit(c, pts, cfg)

    acceptable = [c for c in candidates
                  if c.rmse <= cfg.rmse_tolerance and c.max_error <= cfg.max_error_tolerance]

    if acceptable:
        pool = acceptable
    else:
        if cfg.enable_spline and allow_spline:
            spline = fit_spline(pts, cfg)
            if spline is not None:
                candidates.append(spline)
        pool = candidates

    if not pool:
        # Absolute last resort: a straight line between the endpoints.
        line = fit_line(pts, cfg)
        if line is None:
            p = pts[0] if len(pts) else np.zeros(2)
            return FitResult("point", f"({_fmt(p[0])}, {_fmt(p[1])})", {"x": float(p[0]), "y": float(p[1])},
                             lambda n, p=p: np.repeat(p[None, :], n, axis=0), n_params=2)
        return score_fit(line, pts, cfg)

    def key(c: FitResult) -> tuple:
        return (round(c.bic, 6), _COMPLEXITY.get(c.model, 4), c.rmse)

    best = min(pool, key=key)
    # Prefer a simpler model when its BIC is within the margin.
    for c in pool:
        if (_COMPLEXITY.get(c.model, 4) < _COMPLEXITY.get(best.model, 4)
                and c.bic <= best.bic + cfg.bic_margin
                and c.rmse <= max(cfg.rmse_tolerance, best.rmse * 1.05)):
            best = c
    return best
