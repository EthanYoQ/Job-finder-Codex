from pathlib import Path
import subprocess
import sys
from replay_tool_support import exit_status, new_run, preserve_report, run_child, write_json


def main(root=None, runner=subprocess.run):
    root = Path(root or Path(__file__).resolve().parent)
    node = root / 'runtime/node-v22.19.0-linux-x64/bin/node'
    env={'PATH':str(node.parent)+':/usr/bin:/bin','HOME':str(root/'task-home'),'TMPDIR':str(root/'tmp'),'LANG':'C.UTF-8','TZ':'UTC','NODE_OPTIONS':'--require '+str(root/'no-network.cjs')}
    run_dir = new_run(root, 'prisma-probe')
    report_path = root / 'prisma-client-runtime-probes.json'
    preserve_report(report_path, run_dir)
    results = []
    write_json(report_path, results)
    code='const {PrismaClient,Prisma}=require("@prisma/client"); const native=require("./node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node"); const client=new PrismaClient(); client.$disconnect().then(()=>console.log(JSON.stringify({node:process.version,clientVersion:Prisma.prismaVersion,nativeVersion:native.version(),models:Prisma.dmmf.datamodel.models.length,constructedAndDisconnected:true,databaseCalls:false})));'
    for candidate in ['main', 'fallback']:
        result = run_child([str(node), '-e', code], cwd=root / candidate, env=env, log=run_dir / f'{candidate}.log', timeout=30, runner=runner, capture=True)
        result.update(candidate=candidate)
        results.append(result)
        write_json(report_path, results)
    return exit_status(results)


if __name__ == '__main__':
    sys.exit(main())
