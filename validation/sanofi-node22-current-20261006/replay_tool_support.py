"""Local replay-tool process handling; no network or application work at import time."""
from pathlib import Path
from datetime import datetime, timezone
import json
import shutil
import subprocess
import time
import uuid


def new_run(root: Path, label: str) -> Path:
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    path = root / 'logs' / f'{label}-{stamp}-{uuid.uuid4().hex[:8]}'
    path.mkdir(parents=True, exist_ok=False)
    return path


def preserve_report(path: Path, run_dir: Path) -> None:
    """Keep existing result bytes before a future invocation updates its report."""
    if path.exists():
        shutil.copy2(path, run_dir / ('previous-' + path.name))


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
    temporary.replace(path)


def exit_status(results) -> int:
    return 0 if results and all(item.get('exit_code') == 0 for item in results) else 1


def as_text(value) -> str:
    return value.decode('utf8', errors='replace') if isinstance(value, bytes) else value or ''


def run_child(args, *, cwd, env, log: Path, timeout, runner=subprocess.run, capture=False):
    started = time.monotonic()
    result = {'command': [str(x) for x in args], 'log': str(log)}
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open('w') as output:
        try:
            if capture:
                process = runner(args, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
                result.update(stdout=as_text(process.stdout), stderr=as_text(process.stderr))
                output.write(result['stdout'])
                output.write(result['stderr'])
            else:
                process = runner(args, cwd=cwd, env=env, stdout=output, stderr=subprocess.STDOUT, timeout=timeout)
            result['exit_code'] = process.returncode
        except subprocess.TimeoutExpired as error:
            result.update(exit_code=None, timeout_seconds=timeout, error='SUBPROCESS_TIMEOUT')
            if capture:
                result.update(stdout=as_text(error.stdout), stderr=as_text(error.stderr))
                output.write(result['stdout'])
                output.write(result['stderr'])
            output.write(f'\nSUBPROCESS_TIMEOUT after {timeout} seconds\n')
        except OSError as error:
            result.update(exit_code=None, error=type(error).__name__, error_message=str(error))
            output.write(f'\n{type(error).__name__}: {error}\n')
    result['duration_seconds'] = round(time.monotonic() - started, 3)
    return result
