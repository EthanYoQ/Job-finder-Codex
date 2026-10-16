#!/usr/bin/python3
"""Small read-only source tests; no runtime build, installation or qualification."""
from pathlib import Path
import ast,hashlib,json,types
HERE=Path(__file__).resolve().parent
PACKAGE=HERE.parent.parent
H=HERE.parent/'hengrui'
changes=(('source-hengrui-social','source-ucb-china-social'),('company-hengrui','company-ucb-china'),('dot-cloud-hengrui-social-pilot','dot-cloud-ucb-china-social-pilot'),('93dcadb4a572da022694b3ab3040fad541fe674107e3dc66fd2323709e374b4e','0423b01f438925ad3e34e29aeda58fe6353fbd264d4472a09bcb1fba281bd146'),('hengrui','ucb'),('Hengrui','Ucb'),('HENGRUI','UCB'))
def adapt(s):
 for a,b in changes:s=s.replace(a,b)
 return s
def module(name):
 p=HERE/name;m=types.ModuleType(name);m.__file__=str(p);exec(compile(p.read_bytes(),str(p),'exec'),m.__dict__);return m
checks=[]
for name in ('fixed-preimport-launch.py.in','fixed-preflight.mjs.in','fixed-recovery-helper.mts.in','lifecycle-activation.template.js'):
 assert (HERE/name).read_text()==adapt((H/name).read_text()),name
 checks.append('original safety skeleton byte equality after explicit UCB identity substitution: '+name)
body=adapt((H/'body.template.js').read_text()).replace('ui.createCuaBrowserPort({enabled:true,toolCall:fixedTools.mcp__cua_repl__js})','ui.createCuaBrowserPort({enabled:true,toolCall:fixedTools.mcp__cua_repl__js,expected:e})')
assert (HERE/'body.template.js').read_text()==body
checks.append('body preserves original promise/sidecar/seal and only adds receipt-bound expected data to UI port')
b=module('build-functions-entry.py');sources=b.load_source_inputs();rendered=b.render_entry(sources)
assert rendered==(HERE/'functions-entry.js').read_bytes()
checks.append('closed exact source pins and deterministic disabled generated entry')
relay=(PACKAGE/'vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts').read_text()
assert b.compile_original_read_outcome(relay)==b.compile_original_read_outcome(relay.replace('async readAndVerifyOwnedHengruiOutcome(','async ignoredHengruiOutcome('))
assert 'readAndVerifyOwnedUcbOutcome' in (HERE/'build-functions-entry.py').read_text()
checks.append('outcome SQL extracted from actual UCB method, independent of Hengrui method')
cli=(HERE/'fixed-preimport-launch.py.in').read_text();due=(HERE/'fixed-recovery-helper.mts.in').read_text()
assert 'connector-gate/ucb-run-with-owned-publication-pipe.mjs' in cli
assert 'evaluateUcbSourceDue' in due and 'connector-gate/ucb-due-policy.mts' in due
assert 'dot-cloud-ucb-china-social-pilot' in (HERE/'fixed-preflight.mjs.in').read_text()
assert 'readReviewedJobProjectionSidecar' not in due # original verified file-reader path is preserved, no new native import.
checks.append('actual UCB wrapper, due policy and fixed owner')
core=module('build-shared-cores.py');outputs=core.render_shared_cores((PACKAGE/'connector-gate/ucb-functions-bundle.js').read_bytes(),(PACKAGE/'connector-gate/dispatch-observer.functions.js').read_bytes())
assert "o.sourceId==='source-ucb-china-social'" in outputs['pipe-core.functions.js']
assert "o.sourceId==='source-hengrui-social'" not in outputs['pipe-core.functions.js']
checks.append('exact pinned original UCB pipe core and shared observer')
r=module('render-ucb-source.py');templates=r.load_templates();cli=r.render_bytes(templates)
ast.parse(cli['fixed-preimport-launch.py'].decode());checks.append('CLI template pins, renderer and Python syntax')
print(json.dumps({'kind':'UCB_FIXED_PROFILE_SMALL_SOURCE_TESTS','checks':checks,'count':len(checks),'productionQualified':False},ensure_ascii=False))
