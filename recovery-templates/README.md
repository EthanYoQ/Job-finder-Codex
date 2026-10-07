# Restore the Gilead host source

This addendum supersedes the historical statements that the installed host is
still unbound. The successful C52 host is bound. Its archived loader and starter
are retained as executed source, but they are not the input templates for a new
binder invocation. The two `*.unbound.js` files here are the exact original
pre-activation sources saved at 07:22 UTC, with their original null markers.
`TEMPLATE_PROVENANCE.json` fixes their origin, target and SHA256 values. No private
activation, registration response or control file was copied with them.

## Offline staging and binding

Restore the full clean producer commit d6190919d17c8ba4ee721daa2087d3c09bded7fa,
its exact physical installed runtime and the pinned Node v22.23.3 binary first,
at the fixed paths in `hosts/gilead/host/host-config.template.json`. Source-only
archives do not contain node_modules or the Node binary. Rebuilding or relocating
these dependencies must satisfy the existing build/profile identity checks; this
recipe does not authorize changing their identity or execution environment.

Run `python3 recovery-templates/restore-unbound-host.py <new-staging-directory>`.
The destination must not exist and must not be the installed host or producer.
The helper validates and copies only the host safe-source allowlist, substitutes
the two explicit unbound templates, and creates synthetic null control/activation
files. It sets the staging host-config root for the binder's path check. A
`producer` symlink exists only to resolve relative module imports into the already
verified physical producer; the binder still checks that physical repo, Git HEAD,
runtime tree and actual Node. This staging tree is not a launchable second host.

From the fixed physical producer working directory, invoke the unchanged binder
in that staging tree using the pinned Node and producer tsx loader, with
JOBFINDER_CLOUD_SOURCE_ID=source-gilead-china-social and its existing three args:
owner input, registration readback, new prepared output directory. For recovery,
the sole owner provides actual matching inputs privately. Synthetic inputs in
tests never establish registration authority. The binder emits only PREPARED
files. The rendered loader/starter continue targeting the original fixed runtime
and exact namespace. Installation and REGISTERED_VERIFIED activation remain with
the same sole owner under the existing binding procedure.

For the narrow synthetic proof, run `bash host-gate-tests/run-offline.sh --restore-only`.
It restores the allowlisted source, invokes the real binder with invented rows,
checks exact output hashes and context bytes, and reproduces rejection if the
bound loader is supplied instead. It refuses an existing destination, preserves
the installed host, and confirms there is no publisher-state file in its output.
When testing an extracted source-only archive elsewhere, provide an import bridge
`producer` at that extracted root pointing to the exact existing physical producer;
this bridge is a declared test dependency, never a replacement production runtime.

## Complete test source closure

`host-gate-tests/HOST_GATE_SOURCE_CLOSURE.json` lists the seven harness sources and
their declared host/producer/tool dependencies. No generated report/run directory,
NEW_LOCAL_BUILD_IDENTITY.json, actual control, activation or registration row is
required. Build data comes from the safe null control template. Host tests read
the retained unbound source and run binder checks in separate staging trees.

The continuous-owner test source likewise takes safe config/build/null templates
and overlays every private binding read with synthetic bytes. Its three owner
entrypoints and five host dependency pins are unchanged. The missing
`continuous-owner/tests/original-22-case-names.json` is included explicitly.
The original 118 host and 51 owner suites are historical results; they were not
rerun wholesale for this closure fix. Narrow restore and selected synthetic wiring
results are recorded separately, without claiming new production evidence.

## One publisher state

The successful completion source stays exactly
3eb561c5c3dc1aa4a8897d83ac9bd857830bee33e1a39702b173e63934793527.
The only publisher state is the existing parent's
/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/PUBLISHER-ACTIVE-STATE.json.
The restore helper never reads, copies or creates it, and never rebases it into
the new runtime or staging directory. Keep the existing unique-state recovery
checks. Actual activation/control/registration/HTTP/DB evidence remains private.
