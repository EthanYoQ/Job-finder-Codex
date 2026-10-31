// Offline Windows checks reuse TypeScript's JS transpiler; production uses restored tsx.
import { registerHooks, createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const original = new URL('../../package.json', import.meta.url);
const requireOriginal = createRequire(original);
const ts = requireOriginal('typescript');
registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); }
    catch (error) {
      if (specifier.startsWith('.')) {
        const url = new URL(specifier, context.parentURL);
        for (const extension of ['.ts', '.mts', '/index.ts']) {
          if (existsSync(fileURLToPath(url) + extension)) return next(url.href + extension, context);
        }
      } else if (!specifier.startsWith('node:') && !specifier.startsWith('file:')) {
        return next(specifier, { ...context, parentURL: original.href });
      }
      throw error;
    }
  },
  load(url, context, next) {
    if (/\.(?:ts|mts)$/.test(url)) return { format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { fileName: fileURLToPath(url),
        compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText };
    return next(url, context);
  }
});
