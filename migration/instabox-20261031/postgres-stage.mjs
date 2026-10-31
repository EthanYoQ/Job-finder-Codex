/** The current 36-source serial relay's host stage, with PostgreSQL transport.
 * Keep the original host file/binding/review functions; only replace DB I/O.
 * scope comes from a NEW migration installation, never an old pending request.
 */
import {join} from 'node:path';

export function createPostgresStage({host, database, scope}) {
  if (database.target !== 'INSTABOX_POSTGRESQL_V1' || !/^round-[a-f0-9]{32}$/.test(scope.roundId) ||
      !scope.candidateId?.startsWith('instabox-')) throw Error('MIGRATION_TARGET_REQUIRED');
  const {executeSql} = database;
  const relayDirectory = join(database.appRoot, 'rounds', scope.roundId, 'connector-host-task/relay');
  const producerRoot = join(database.appRoot, 'five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source');
  const {cfg} = host;
  const h = {...host, sqlDispatch};

  async function check(request, directory) {
    const binding = await host.binding();
    if (directory !== relayDirectory || directory !== binding.relayDirectory || binding.repo !== producerRoot ||
        binding.candidateId !== scope.candidateId || binding.buildContentSha256 !== scope.buildContentSha256) {
      throw Error('MIGRATION_SCOPE_MISMATCH');
    }
    if (request.expired || request.dispatchRecorded || Date.now() >= Date.parse(request.expiresAt) ||
        request.payload.dispatchBefore && Date.now() >= Date.parse(request.payload.dispatchBefore)) {
      throw Error('HOST_STALE_OR_UNCERTAIN_REQUEST');
    }
    // projectId is the existing native protocol namespace, not a DB host/router.
    if (request.payload.projectId !== cfg.project) throw Error('HOST_SQL_BINDING');
    return binding;
  }

  async function sqlDispatch(request, directory, sql) {
    await check(request, directory);
    if (!['READ_PUBLICATION_CONTEXT', 'READ_OUTCOME', 'PUBLISH'].includes(request.kind) ||
        typeof sql !== 'string' || sql !== request.payload.sql) throw Error('HOST_SQL_BINDING');
    await host.mark(request, directory);
    const result = await executeSql(sql);
    await host.respond(request, directory, result);
    return result;
  }

  async function handle(request, directory, readPreCaptureContext) {
    const binding = await check(request, directory);
    if (request.kind === 'READ_CONTEXT' || request.kind === 'READ_PUBLICATION_CONTEXT') {
      const packet = JSON.parse(await host.cmd('node ' + host.q(cfg.root + '/host-files.mts') +
        ' connector-context ' + host.q(directory + '/' + request.requestId + '.request.json')));
      if (packet.requestId !== request.requestId || packet.requestSha256 !== request.requestSha256 ||
          packet.candidateId !== binding.candidateId || packet.buildContentSha256 !== binding.buildContentSha256) {
        throw Error('HOST_CONTEXT_PACKET_BINDING');
      }
      if (request.kind === 'READ_PUBLICATION_CONTEXT') return sqlDispatch(request, directory, packet.sql);
      if (request.payload.sourceId !== binding.sourceId ||
          request.payload.sourceConfigSha256 !== binding.sourceConfigSha256 || request.payload.purpose !== 'PRE_CAPTURE') {
        throw Error('HOST_CONTEXT_SOURCE_BINDING');
      }
      await host.mark(request, directory);
      let context;
      if (readPreCaptureContext) context = await readPreCaptureContext(request);
      else {
        const result = await executeSql(packet.sql);
        if (result.status !== 'SUCCEEDED') throw Error(result.code);
        if (result.rows.length !== 1 || !result.rows[0].context) throw Error('HOST_CONTEXT_RESPONSE');
        context = result.rows[0].context;
      }
      if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+]00:00)$/.test(context.checkedAt)) throw Error('HOST_CONTEXT_UTC');
      await host.respond(request, directory, {...context, checkedAt: new Date(context.checkedAt).toISOString()});
      return {status: 'READ_CONTEXT'};
    }
    if (request.kind === 'READ_OUTCOME') return sqlDispatch(request, directory, request.payload.sql);
    if (request.kind === 'PUBLISH') {
      const packet = JSON.parse(await host.cmd('node ' + host.q(cfg.root + '/host-files.mts') +
        ' connector-publish ' + host.q(directory + '/' + request.requestId + '.request.json')));
      if (packet.requestId !== request.requestId || packet.requestSha256 !== request.requestSha256 ||
          packet.projectId !== cfg.project || packet.candidateId !== binding.candidateId ||
          packet.buildContentSha256 !== binding.buildContentSha256) throw Error('HOST_PUBLISH_PACKET_BINDING');
      // The unchanged serial loop calls the original reviewer BEFORE sqlDispatch.
      return {...packet, status: 'AWAITING_PARENT_REVIEW', requestId: request.requestId,
        requestSha256: request.requestSha256, sqlPath: packet.output, characters: request.payload.sql.length};
    }
    throw Error('HOST_DB_STARTED_KIND');
  }
  return {h, handle};
}
