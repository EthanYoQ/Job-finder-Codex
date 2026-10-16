import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const files = ['workday-id.mjs','contract.mjs','compare.mjs','machine.mjs','actual-ax.mjs','cua-port.mjs'];
let source = '// GENERATED from contract.mjs, compare.mjs, machine.mjs, actual-ax.mjs, cua-port.mjs. No real tools bound.\n(() => {\n';
for (const file of files) source += '\n// ' + file + '\n' + readFileSync(new URL(file, root), 'utf8')
  .replace(/^import\s[\s\S]*?from\s'[^']+';\n/gm, '').replace(/^export /gm, '');
source += '\nreturn Object.freeze({TARGET, LIMITS, UNBOUND_PORT, BrowserProtocolTimeout, createPublicVerifier, runPublicVerification, comparePublicList, compareSourceMinute, createCuaBrowserPort, buildCuaCall, parseCuaPacket, validateDecodedAx, resolveFreshControl, mergeRenderedList, parseVisibleSourceCard, UNBOUND_AX_DECODER, ACTUAL_PUBLIC_UI_DECODER, decodeActualAx, assertActualStartupResult});\n})()\n';
writeFileSync(new URL('functions-bundle.js', root), source);
