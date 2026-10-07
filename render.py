#!/usr/bin/env python3
"""Reconstruct source bytes only. Never import or execute generated controllers."""
import argparse
import ast
import hashlib
import json
import pathlib
import re


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def require(condition, code):
    if not condition:
        raise ValueError(code)


def validate_bindings(schema, supplied):
    require(type(supplied) is dict and set(supplied) == {'schemaVersion', 'values'}
            and supplied['schemaVersion'] == 1, 'BINDING_SCHEMA')
    values = supplied['values']
    require(type(values) is dict and set(values) == set(schema['fields']), 'BINDING_KEYS')
    patterns = {
        'text': r'[A-Za-z0-9/_.:\-]+',
        'uint': r'[1-9][0-9]*',
        'sha1': r'[0-9a-f]{40}',
        'sha256': r'[0-9a-f]{64}',
        'metadata_tuple': r'\([1-9][0-9]*,[1-9][0-9]*,[0-9]+,[0-9]+,0o[0-7]{3,4}\)',
    }
    for key, spec in schema['fields'].items():
        value = values[key]
        require(type(value) is str and len(value) <= 2048 and '__' not in value
                and re.fullmatch(patterns[spec['type']], value) is not None,
                'BINDING_VALUE_' + key)
    return values


def reconstruct(package, supplied, expected=None):
    """Return a fully verified in-memory source set, without deployment actions."""
    package = pathlib.Path(package)
    recipe = json.loads((package / 'recipe.json').read_text())
    schema = json.loads((package / recipe['bindingSchema']).read_text())
    values = validate_bindings(schema, supplied)
    replacements = {'__BIND_' + key + '__': value for key, value in values.items()}
    facet = recipe['facet']
    facet_raw = (package / facet['path']).read_bytes()
    require(sha(facet_raw) == facet['sha256'], 'FACET_SOURCE_HASH')
    replacements['__SHA_FACET__'] = sha(facet_raw)
    replacements['__ASSET_FILE__'] = recipe['assetFilenamePrefix'] + values['ASSET_MANIFEST_SHA256'][:12] + '.json'
    records = {}
    token = re.compile(r'__(?:BIND|SHA|FILE)_[A-Z0-9_]+__|__ASSET_FILE__')
    for component in recipe['components']:
        raw = (package / component['template']).read_bytes()
        require(sha(raw) == component['templateSha256'], 'TEMPLATE_HASH_' + component['id'])
        text = raw.decode('utf-8')
        require(text.startswith(recipe['guard']), 'UNBOUND_GUARD_MISSING')
        body = text[len(recipe['guard']):]
        require(set(token.findall(body)) <= set(replacements), 'MISSING_BINDING_OR_DEPENDENCY')
        body = token.sub(lambda match: replacements[match.group(0)], body)
        require(token.search(body) is None, 'UNRESOLVED_BINDING')
        ast.parse(body, feature_version=(3, 6))
        result = body.encode('utf-8')
        digest = sha(result)
        filename = component['filenamePrefix'] + digest[:12] + '.py'
        require(pathlib.PurePath(filename).name == filename, 'OUTPUT_FILENAME')
        records[component['id']] = {'filename': filename, 'sha256': digest, 'bytes': result}
        replacements['__SHA_' + component['token'] + '__'] = digest
        replacements['__FILE_' + component['token'] + '__'] = filename
    if expected is not None:
        require(set(expected) == set(records), 'EXPECTED_SOURCE_SET')
        for name, item in records.items():
            require(expected[name] == {'filename': item['filename'], 'sha256': item['sha256']},
                    'EXPECTED_SOURCE_HASH_' + name)
    records['facet'] = {'filename': 'facet_projection.js', 'sha256': sha(facet_raw), 'bytes': facet_raw}
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bindings', required=True)
    parser.add_argument('--output', required=True, help='New local directory; existing paths are refused')
    parser.add_argument('--expected', help='Optional private original filename/hash map; validated before output')
    args = parser.parse_args()
    supplied = json.loads(pathlib.Path(args.bindings).read_text())
    expected = json.loads(pathlib.Path(args.expected).read_text()) if args.expected else None
    records = reconstruct(pathlib.Path(__file__).resolve().parent, supplied, expected)
    target = pathlib.Path(args.output)
    target.mkdir(mode=0o700, exist_ok=False)
    for item in records.values():
        with (target / item['filename']).open('xb') as stream:
            stream.write(item['bytes'])
    summary = {name: {key: value for key, value in item.items() if key != 'bytes'} for name, item in records.items()}
    with (target / 'RECONSTRUCTED.json').open('x') as stream:
        json.dump(summary, stream, indent=2, sort_keys=True)
        stream.write('\n')
    print('Reconstructed {} source files; no controller executed'.format(len(records)))


if __name__ == '__main__':
    main()
