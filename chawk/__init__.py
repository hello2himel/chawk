"""Chawk - convert line art into mathematical equations."""

from .config import Config, PRESETS, build_config
from .pipeline import NoStrokesDetected, Result, process_image

__version__ = "1.0.0"
__all__ = [
    "Config",
    "PRESETS",
    "build_config",
    "process_image",
    "Result",
    "NoStrokesDetected",
    "__version__",
]
