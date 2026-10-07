"""Exact source-only restoration, not host execution or historical conversion."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name('restore-lib.py')))['main']('restore', __file__)
