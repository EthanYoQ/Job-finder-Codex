from pathlib import Path
import subprocess
import hashlib
import sys
from replay_tool_support import exit_status, new_run, preserve_report, run_child, write_json


def main(root=None, runner=subprocess.run):
    root = Path(root or Path(__file__).resolve().parent)
    node = root / 'runtime/node-v22.19.0-linux-x64/bin/node'
    env={'PATH':str(node.parent)+':/usr/bin:/bin','HOME':str(root/'task-home'),'TMPDIR':str(root/'tmp'),'LANG':'C.UTF-8','TZ':'UTC','CI':'true','NODE_ENV':'test','NODE_OPTIONS':'--require '+str(root/'no-network.cjs'),'CHECKPOINT_DISABLE':'1','PRISMA_HIDE_UPDATE_MESSAGE':'1','PRISMA_QUERY_ENGINE_LIBRARY':str(root/'runtime/prisma-engines/libquery_engine-debian-openssl-3.0.x.so.node'),'PRISMA_SCHEMA_ENGINE_BINARY':str(root/'runtime/prisma-engines/schema-engine-debian-openssl-3.0.x'),'PRISMA_GENERATE_SKIP_AUTOINSTALL':'1'}
    run_dir = new_run(root, 'prisma-generate')
    report_path = root / 'prisma-generation-results.json'
    preserve_report(report_path, run_dir)
    results = []
    write_json(report_path, results)
    for candidate in ['main', 'fallback']:
        args = [str(node), 'node_modules/prisma/build/index.js', 'generate', '--schema', 'prisma/schema.prisma', '--no-hints']
        result = run_child(args, cwd=root / candidate, env=env, log=run_dir / f'{candidate}.log', timeout=90, runner=runner)
        result.update(candidate=candidate)
        try:
            result['schema_sha256'] = hashlib.sha256((root / candidate / 'prisma/schema.prisma').read_bytes()).hexdigest()
        except OSError as error:
            result.update(exit_code=None, schema_error=str(error))
        results.append(result)
        write_json(report_path, results)
    return exit_status(results)


if __name__ == '__main__':
    sys.exit(main())
