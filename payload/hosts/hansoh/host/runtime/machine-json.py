"""Exact Node EnvHttpProxyAgent warning boundary for machine JSON only."""
import json
import re
_WARNING = re.compile(r'^\(node:[1-9][0-9]*\) \[UNDICI-EHPA\] Warning: EnvHttpProxyAgent is experimental, expect them to change at any time\.$')
_TRACE = '(Use `node --trace-warnings ...` to show where the warning was created)'

def parse_machine_json(stdout, stderr, record):
    if not isinstance(stdout, str) or not isinstance(stderr, str) or not callable(record):
        raise ValueError('HOST_MACHINE_JSON_ARGUMENT')
    lines = stderr.split('\n')
    kept, warnings, index = [], [], 0
    while index < len(lines):
        line = lines[index]
        if _WARNING.fullmatch(line):
            warnings.append(line)
            if index + 1 < len(lines) and lines[index + 1] == _TRACE:
                index += 1
                warnings.append(lines[index])
        else:
            kept.append(line)
        index += 1
    record({'stdout': stdout, 'stderr': stderr, 'recognizedWarningLines': warnings})
    if '\n'.join(kept).strip():
        raise ValueError('HOST_MACHINE_STDERR')
    return json.loads(stdout)
