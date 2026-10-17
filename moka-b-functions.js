// Inactive Functions hook. No writer, relay, database or registration operation.
async function captureMokaBDom({ source, directory, browserSource, deadline }) {
  if (!['bayer', 'servier'].includes(source)) throw Error('MOKA_B_SOURCE');
  const marker = 'MOKA_B_DOM_RESULT:', pages = [];
  const put = async (name, value) => {
    const result = await tools.apply_patch('*** Begin Patch\n*** Add File: ' + directory + '/' + name + '\n' + JSON.stringify(value, null, 2).split('\n').map(line => '+' + line).join('\n') + '\n*** End Patch');
    if (result?.isError) throw Error('MOKA_B_DOM_ARCHIVE_WRITE');
  };
  const emit = expression => 'nodeRepl.write(' + JSON.stringify(marker) + '+JSON.stringify(' + expression + '));';
  async function call(code) {
    const result = await tools.mcp__cua_repl__js({ code, timeout_ms: 120000, title: '读取原 Bayer/Servier 独立 DOM 证据' });
    const output = result.content.filter(x => x.type === 'text').map(x => x.text).join('\n');
    if (result.isError) throw Error(output);
    const offset = output.lastIndexOf(marker);
    if (offset < 0) throw Error('MOKA_B_DOM_RESULT_MISSING:' + output.slice(-1200));
    return JSON.parse(output.slice(offset + marker.length));
  }
  await tools.mcp__cua_repl__js({ code: 'await cua.getState();', title: '检查 dot 云浏览器' });
  let started;
  try {
    started = await call(browserSource + '\n' + emit('await mokaBDomRuntime.start(' + JSON.stringify(source) + ',' + JSON.stringify(deadline ?? null) + ')'));
    for (let pageNumber = 1; pageNumber <= 100; pageNumber++) {
      if (Date.now() >= started.deadline) throw Error('MOKA_B_ORIGINAL_CAPTURE_DEADLINE');
      const page = await call(emit('await mokaBDomRuntime.readPage()'));
      await put('page-' + String(pageNumber).padStart(3, '0') + '.json', page);
      pages.push(page);
      if (page.nextDisabled) {
        const capture = { schemaVersion: source + '-cua-dom-list-v1', observedAt: pages[0].capturedAt, pages };
        await put('dom-capture.json', capture);
        return capture;
      }
      await call(emit('await mokaBDomRuntime.advance()'));
    }
    throw Error('MOKA_B_ORIGINAL_100_PAGE_LIMIT');
  } finally {
    if (started) await call('await mokaBDomRuntime.close();' + emit('{closed:true}'));
  }
}
return { captureMokaBDom };
