function buildObservedCommand(command, metadata, quote) {
 return [
  '(exec '+command+') &',
  'capture_root_pid=$!',
  'if python3 '+quote(metadata.samplerPath)+' --root-pid "$capture_root_pid" --expected-arg '+quote(metadata.expectedArg)+' --output-dir '+quote(metadata.outputDir)+' --label '+quote(metadata.label)+' --interval 1 --pss-interval 5; then memory_observer_exit=0; else memory_observer_exit=$?; fi',
  'if wait "$capture_root_pid"; then capture_exit=0; else capture_exit=$?; fi',
  "printf 'MEMORY_OBSERVER_EXIT=%s CAPTURE_EXIT=%s\\n' \"$memory_observer_exit\" \"$capture_exit\"",
  'exit "$capture_exit"'
 ].join('\n');
}

export { buildObservedCommand };
