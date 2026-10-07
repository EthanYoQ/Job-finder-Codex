"""Read-only full-byte comparison of a source-only restoration."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name('restore-lib.py')))['main']('verify', __file__)
