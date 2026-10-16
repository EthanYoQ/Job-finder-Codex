#!/usr/bin/python3
"""Read-only profile, canonical-input and deterministic source checks."""
from pathlib import Path
import ast
import hashlib
import json
import socket
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
PACKAGE = HERE.parent.parent
H = HERE.parent / 'hengrui'
CHANGES = (
    ('source-hengrui-social', 'source-viatris-social'),
    ('company-hengrui', 'company-viatris'),
    ('dot-cloud-hengrui-social-pilot', 'dot-cloud-viatris-social-pilot'),
    ('93dcadb4a572da022694b3ab3040fad541fe674107e3dc66fd2323709e374b4e',
     '5eab6bd8ba6973176376f492b9ce2105d81d8cae5afd4d3518daa6ad3dfcdad9'),
    ('hengrui', 'viatris'), ('Hengrui', 'Viatris'), ('HENGRUI', 'VIATRIS'),
)


def adapt(text):
    for old, new in CHANGES:
        text = text.replace(old, new)
    return text


def module(name):
    path = HERE / name
    result = types.ModuleType(name)
    result.__file__ = str(path)
    exec(compile(path.read_bytes(), str(path), 'exec'), result.__dict__)
    return result


class ProfileTests(unittest.TestCase):
    def test_safety_templates_are_identity_only_substitutions(self):
        for name in ('fixed-preimport-launch.py.in', 'fixed-preflight.mjs.in',
                     'fixed-recovery-helper.mts.in', 'lifecycle-activation.template.js'):
            with self.subTest(name=name):
                self.assertEqual((HERE / name).read_text(), adapt((H / name).read_text()))

    def test_body_retains_original_safety_and_native_projection(self):
        body = adapt((H / 'body.template.js').read_text())
        body = body.replace("ob.equalEvidenceData(receipt.binding,tuple()),'UI_COMMITTED_RECEIPT_BINDING'",
            "ob.equalEvidenceData(receipt.binding,tuple())&&typeof receipt.observedAt==='string'&&Number.isFinite(Date.parse(receipt.observedAt)),'UI_COMMITTED_RECEIPT_BINDING'")
        body = body.replace("check(fields.every(k=>own(p,k))&&sha(canonical({schemaVersion:'job-persisted-projection-v1',projection}))",
            "check(p.sourceId===SOURCE&&p.companyId==='company-viatris'&&fields.every(k=>own(p,k))&&sha(canonical({schemaVersion:'job-persisted-projection-v1',projection}))")
        body = body.replace('ui.createCuaBrowserPort({enabled:true,toolCall:fixedTools.mcp__cua_repl__js})',
            'ui.createCuaBrowserPort({enabled:true,toolCall:fixedTools.mcp__cua_repl__js,expected:e})')
        self.assertEqual((HERE / 'body.template.js').read_text(), body)
        self.assertIn('return {sourceJobId:p.sourceJobId,officialTitle:p.officialTitle,officialUrl:p.officialUrl};', body)
        self.assertLess(body.index("'UI_PROJECTION_RECEIPT_HASH'"), body.index('ui.createCuaBrowserPort('))

    def test_closed_pins_deterministic_disabled_entry(self):
        build = module('build-functions-entry.py')
        inputs = build.load_source_inputs()
        self.assertEqual(build.render_entry(inputs), (HERE / 'functions-entry.js').read_bytes())
        self.assertEqual(build.render_entry(inputs), build.render_entry(inputs))
        self.assertIn(b'"enabled":false,"mode":"LIVE"', build.render_entry(inputs))

    def test_viatris_method_is_independently_selected(self):
        build = module('build-functions-entry.py')
        relay = (PACKAGE / build.DEPENDENCIES[3]).read_text()
        original = build.compile_original_read_outcome(relay)
        self.assertEqual(hashlib.sha256(original.encode()).hexdigest(),
                         '9e0c909bc5a31d1f37e9a112c9d7b28e875b189f2ec27b7a6114c7a30f168442')
        for other in ('Takeda', 'Biogen', 'Hengrui', 'Ucb'):
            self.assertEqual(original, build.compile_original_read_outcome(
                relay.replace('async readAndVerifyOwned' + other + 'Outcome(', 'async ignoredOutcome(')))
        with self.assertRaisesRegex(RuntimeError, 'FIXED_ORIGINAL_OUTCOME_COMPILER'):
            build.compile_original_read_outcome(relay.replace('async readAndVerifyOwnedViatrisOutcome(', 'async ignoredViatrisOutcome('))
        with self.assertRaisesRegex(RuntimeError, 'FIXED_ORIGINAL_OUTCOME_COMPILER'):
            build.compile_original_read_outcome(relay + 'async readAndVerifyOwnedViatrisOutcome(')

    def test_changed_original_viatris_sql_fails_closed(self):
        build = module('build-functions-entry.py')
        relay = (PACKAGE / build.DEPENDENCIES[3]).read_text()
        before, section = relay.split('async readAndVerifyOwnedViatrisOutcome(', 1)
        with self.assertRaisesRegex(RuntimeError, 'FIXED_ORIGINAL_OUTCOME_BYTES'):
            build.compile_original_read_outcome(before + 'async readAndVerifyOwnedViatrisOutcome(' +
                section.replace("id='formal-crawl'", "id='changed-lock'", 1))

    def test_actual_wrapper_due_policy_and_owner(self):
        cli = (HERE / 'fixed-preimport-launch.py.in').read_text()
        due = (HERE / 'fixed-recovery-helper.mts.in').read_text()
        self.assertIn('connector-gate/viatris-run-with-owned-publication-pipe.mjs', cli)
        self.assertNotIn('ucb-run-with-owned-publication-pipe.mjs', cli)
        self.assertIn('evaluateViatrisSourceDue(context.latestAccepted,x.captureStartedAtMs)', due)
        self.assertIn("P+'/connector-gate/viatris-due-policy.mts'", due)
        self.assertIn('dot-cloud-viatris-social-pilot', (HERE / 'fixed-preflight.mjs.in').read_text())

    def test_original_cadence_contract_is_retained(self):
        due = (PACKAGE / 'connector-gate/viatris-due-policy.mts').read_text()
        for item in ("INTERVAL_MS=12*60*60_000", 'captureStartedAtMs>=next',
                     'at!==Date.parse(receipt.observedAt)', 'row.observations.length!==1',
                     "['successful','transportSucceeded','adapterSucceeded','completenessVerified','atomicCommitSucceeded']",
                     'o.sourceResultId!==row.id', 'o.batchId!==row.batchId',
                     'o.releaseCandidateId!==row.releaseCandidateId', 'at>captureStartedAtMs'):
            self.assertIn(item, due)

    def test_schema50_16_fields_41_plan_40_required(self):
        cli = (HERE / 'fixed-preimport-launch.py.in').read_text()
        preflight = (HERE / 'fixed-preflight.mjs.in').read_text()
        self.assertIn('jobfinder-portable-required-40', cli)
        self.assertIn('migrations.length===50', preflight)
        self.assertIn('e.minimumStableCompanyCount===41&&e.plans.length===41', preflight)
        self.assertIn('Object.keys(expectedRow).length===16', preflight)
        fields = ast.literal_eval(next(line.partition('=')[2] for line in cli.splitlines()
                                       if line.startswith('REGISTRATION_FIELDS=')))
        self.assertEqual(len(fields), 16)
        self.assertEqual(set(fields), module('build-functions-entry.py').ROW_KEYS)

    def test_template_pins_and_python_syntax(self):
        renderer = module('render-viatris-source.py')
        templates = renderer.load_templates()
        rendered = renderer.render_bytes(templates)
        ast.parse(rendered['fixed-preimport-launch.py'].decode())
        for name in templates:
            changed = dict(templates)
            changed[name] += b'\n'
            with self.assertRaisesRegex(RuntimeError, 'FIXED_TEMPLATE_PIN'):
                renderer.render_bytes(changed)
        self.assertIn("raise RuntimeError('VIATRIS_PROFILE_LIBRARY_ONLY_NO_EMIT')",
                      (HERE / 'render-viatris-source.py').read_text())

    def test_shared_core_exact_pure_generation_and_mutation_guards(self):
        core = module('build-shared-cores.py')
        pipe = (PACKAGE / 'connector-gate/viatris-functions-bundle.js').read_bytes()
        observer = (PACKAGE / 'connector-gate/dispatch-observer.functions.js').read_bytes()
        outputs = core.render_shared_cores(pipe, observer)
        self.assertIn("o.sourceId==='source-viatris-social'", outputs['pipe-core.functions.js'])
        self.assertNotIn('source-ucb-china-social', outputs['pipe-core.functions.js'])
        self.assertEqual(hashlib.sha256(outputs['observer-core.functions.js'].encode()).hexdigest(),
                         '3c6d04db391ac05d4de3f15d9dcc59196d4a3985bbb80d67b34e850c7012f2d3')
        failure = AssertionError('UNEXPECTED_IO')
        with patch('builtins.open', side_effect=failure), patch.object(Path, 'open', side_effect=failure), patch.object(socket, 'socket', side_effect=failure):
            self.assertEqual(core.render_shared_cores(pipe.decode(), observer.decode()), outputs)
        for a, b in ((pipe+b' ', observer), (pipe, observer+b' '), (observer, pipe)):
            with self.assertRaisesRegex(core.SharedCoreSourceError, 'SHARED_CORE_INPUT_SHA256'):
                core.render_shared_cores(a, b)
        with patch.object(core, '_render_pipe', return_value='wrong output'):
            with self.assertRaisesRegex(core.SharedCoreSourceError, 'SHARED_CORE_OUTPUT_SHA256'):
                core.render_shared_cores(pipe, observer)
        for text, old in (('aa', 'a'), ('a', 'b')):
            with self.assertRaisesRegex(core.SharedCoreSourceError, 'SHARED_CORE_TRANSFORM_COUNT'):
                core._replace_exact(text, old, 'c')


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(ProfileTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    print(json.dumps({'kind':'VIATRIS_FIXED_PROFILE_SOURCE_TESTS',
                      'testsRun':result.testsRun, 'failures':len(result.failures),
                      'errors':len(result.errors), 'skipped':len(result.skipped),
                      'productionQualified':False}))
    raise SystemExit(0 if result.wasSuccessful() else 1)
