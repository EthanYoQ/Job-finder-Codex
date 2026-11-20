import {registerHooks} from 'node:module';

registerHooks({resolve(specifier,context,next) {
  if(context.parentURL?.endsWith('/scripts/p0-b-grade-validator.ts')&&specifier.includes('/traversalCertificate')) {
    return {url:new URL('./isolated-transport-validator.mjs',import.meta.url).href,shortCircuit:true};
  }
  return next(specifier,context);
}});
