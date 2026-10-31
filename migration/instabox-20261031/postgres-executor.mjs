/** Internal adapter for fresh, reviewed native SQL only; not an HTTP/SQL endpoint.
 * createClient supplies an approved pg.Client with the existing bounded timeouts.
 * The owning relay retains request review, durable dispatch marks and outcome reads.
 */
export function createPostgresExecutor(createClient) {
  return async function execute(sql) {
    const client = createClient();
    client.on('error', () => {});
    let submitted = false;
    try {
      await client.connect();
      submitted = true;
      // One simple query preserves the producer's transaction and lock boundaries.
      const result = await client.query(sql);
      const results = Array.isArray(result) ? result : [result];
      return {status: 'SUCCEEDED', rows: results.flatMap(item => item.rows)};
    } catch {
      // A lost response can follow a commit. No retry or fabricated rollback.
      return {status: 'FAILED', outcome: submitted ? 'UNKNOWN' : 'NOT_DISPATCHED'};
    } finally {
      await client.end().catch(() => {});
    }
  };
}
