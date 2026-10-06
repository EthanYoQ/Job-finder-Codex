from pathlib import Path
import subprocess
import sys
from replay_tool_support import exit_status, new_run, preserve_report, run_child, write_json


def main(root=None, runner=subprocess.run):
    root = Path(root or Path(__file__).resolve().parent)
    node = root / 'runtime/node-v22.19.0-linux-x64/bin/node'
    env={'PATH':str(node.parent)+':/usr/bin:/bin','HOME':str(root/'task-home'),'TMPDIR':str(root/'tmp'),'LANG':'C.UTF-8','TZ':'UTC','CI':'true','NODE_ENV':'test','NODE_OPTIONS':'--require '+str(root/'no-network.cjs')}
    shared=['tests/server/portableSnapshotReader.test.ts','tests/server/portableSnapshotRefresh.test.ts','tests/server/portableSnapshotResponseBarrier.test.ts']
    extra={'main':['tests/server/portableSnapshotNonblocking.test.ts','tests/server/portableSnapshotTiming.test.ts'],'fallback':[]}
    specific={'main':['tests/server/sanofiSnapshotNonblocking.test.ts','-t','verifies the independent publisher packet|rechecks changed external artifact commitments'], 'fallback':['tests/server/sanofiA775Fallback.test.ts','-t','rechecks persisted metadata changes']}
    run_dir = new_run(root, 'server-verification')
    report_path = root / 'execution-results.json'
    preserve_report(report_path, run_dir)
    results = []
    write_json(report_path, results)
    for candidate in ['main', 'fallback']:
        for stage, selection in [('server', shared + extra[candidate]), ('sanofi-current', specific[candidate]), ('sanofi-domain', ['tests/domain/sanofiPublicTransition.test.ts', '-t', 'rechecks unchanged certificates when persisted Sanofi artifact'])]:
            args = [str(node), 'node_modules/vitest/vitest.mjs', 'run', '--config', 'sanofi-reader.vitest.config.ts', '--maxWorkers', '1', '--reporter=default', '--reporter=json', '--outputFile=' + str(run_dir / f'{candidate}-{stage}.json'), *selection]
            result = run_child(args, cwd=root / candidate, env=env, log=run_dir / f'{candidate}-{stage}.log', timeout=180, runner=runner)
            result.update(candidate=candidate, stage=stage)
            results.append(result)
            write_json(report_path, results)
    return exit_status(results)


if __name__ == '__main__':
    sys.exit(main())
