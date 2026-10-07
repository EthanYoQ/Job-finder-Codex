import importlib.util
import json
import sys
spec = importlib.util.spec_from_file_location('machine_json', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
rows = []
warning = '(node:2) [UNDICI-EHPA] Warning: EnvHttpProxyAgent is experimental, expect them to change at any time.\n(Use `node --trace-warnings ...` to show where the warning was created)\n'
assert module.parse_machine_json('{"ok":true}', warning, rows.append) == {'ok': True}
assert rows[0]['stderr'] == warning
for unknown in ['{}', '[]', 'unknown stderr\n', '(node:2) [UNDICI-OTHER] Warning: test\n', '(Use `node --trace-warnings ...` to show where the warning was created)\n']:
    try:
        module.parse_machine_json('{"ok":true}', unknown, rows.append)
    except ValueError:
        pass
    else:
        raise AssertionError('UNKNOWN_STDERR_ACCEPTED')

try:
    module.parse_machine_json('', '{}', rows.append)
except ValueError:
    pass
else:
    raise AssertionError('JSON_STDERR_ACCEPTED_AS_STDOUT')

print('passed')
