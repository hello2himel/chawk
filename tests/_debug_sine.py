import numpy as np
from chawk.config import build_config
from chawk.preprocess import load_image, preprocess
from chawk.trace import trace_strokes
from chawk import models

cfg = build_config()
pre = preprocess(load_image("tests/images/sine_wave.png"), cfg)
strokes = trace_strokes(pre, cfg)
s = strokes[0]
pts = s.points
print("n points", len(pts), "closed", s.closed, "len", s.length)
for n in (128, 200, 256, 300, len(pts)):
    sub = pts[:n]
    fit = models.fit_sinusoid(sub, cfg)
    if fit is None:
        print(n, "sinusoid: None")
    else:
        models.score_fit(fit, sub)
        print(n, "sinusoid:", fit.model, round(fit.rmse, 3), round(fit.max_error, 3), fit.equation)
    best = models.fit_segment(sub, cfg)
    print("   best:", best.model, round(best.rmse, 3), round(best.max_error, 3))
