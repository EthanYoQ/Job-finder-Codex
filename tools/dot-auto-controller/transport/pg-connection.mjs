import { PROJECT_ID } from './restricted-transport.mjs';

export const WRITER_ROLE = 'dot_jobfinder_writer';
const EXPECTED_SESSION = `SELECT current_user AS role, session_user AS session_role,
current_database() AS database, current_setting('transaction_isolation') AS isolation,
current_setting('synchronous_commit') AS synchronous_commit,
(SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls
 FROM pg_catalog.pg_roles WHERE rolname=current_user) AS elevated`;

/**
 * Deployment supplies the already-installed pg.Client and a secret provider.
 * This file does not fetch, create, save, print, or configure credentials.
 * verifiedHost must be independently verified in this project's dashboard.
 */
export function createPgConnectionFactory({ Client, config, passwordProvider, now = Date.now,
  schedule = setTimeout, unschedule = clearTimeout }) {
  const expectedKeys = ['ca', 'database', 'host', 'mode', 'port', 'projectId', 'user', 'verifiedHost'];
  if (!config || Object.keys(config).sort().join(',') !== expectedKeys.sort().join(',') ||
      config.projectId !== PROJECT_ID || config.database !== 'postgres' || config.port !== 5432 ||
      !['direct', 'session'].includes(config.mode) || config.host !== config.verifiedHost ||
      typeof config.ca !== 'string' || !config.ca.includes('-----BEGIN CERTIFICATE-----') ||
      typeof Client !== 'function' || typeof passwordProvider !== 'function') throw Error('PG_CONFIG_REJECTED');
  if (config.mode === 'direct' && (config.host !== `db.${PROJECT_ID}.supabase.co` || config.user !== WRITER_ROLE)) throw Error('PG_TARGET_REJECTED');
  if (config.mode === 'session' && (!/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(config.host) ||
      config.user !== `${WRITER_ROLE}.${PROJECT_ID}`)) throw Error('PG_TARGET_REJECTED');
  const frozen = Object.freeze({ ...config });
  return async ({ deadline, kind }) => {
    if (!Number.isSafeInteger(deadline) || now() >= deadline) throw Error('PG_CONNECT_EXPIRED');
    const password = await passwordProvider();
    if (typeof password !== 'string' || password.length < 20) throw Error('PG_SECRET_UNAVAILABLE');
    const left = deadline - now();
    if (left <= 0) throw Error('PG_CONNECT_EXPIRED');
    const client = new Client({ host: frozen.host, port: frozen.port, user: frozen.user,
      database: frozen.database, password,
      ssl: { ca: frozen.ca, rejectUnauthorized: true, servername: frozen.host },
      connectionTimeoutMillis: Math.min(left, 10000), application_name: 'dot_jobfinder_restricted_v1',
      statement_timeout: kind === 'PUBLISH' ? 120000 : 8000, lock_timeout: 1000, idle_in_transaction_session_timeout: 130000,
      options: '-c search_path=pg_catalog,public,extensions -c synchronous_commit=on' });
    // Idle client errors must not become uncaught process exceptions. The query
    // promise and the durable claim remain the outcome authority.
    client.on('error', () => {});
    const close = () => { try { Promise.resolve(client.end()).catch(() => {}); } catch {} };
    let timer;
    try {
      await Promise.race([(async () => {
        await client.connect();
        if (now() >= deadline) throw Error('PG_CONNECT_EXPIRED');
        const checked = await client.query(EXPECTED_SESSION), row = checked.rows?.[0];
        if (checked.rows?.length !== 1 || row.role !== WRITER_ROLE || row.session_role !== WRITER_ROLE ||
            row.database !== 'postgres' || row.isolation !== 'read committed' || row.synchronous_commit !== 'on' || row.elevated !== false) throw Error('PG_SESSION_IDENTITY_REJECTED');
      })(), new Promise((_, reject) => {
        timer = schedule(() => { close(); reject(Error('PG_CONNECT_EXPIRED')); }, Math.max(1, deadline - now()));
      })]);
      if (now() >= deadline) throw Error('PG_CONNECT_EXPIRED');
    } catch {
      close();
      // Never return driver connection/error text containing a password or DSN.
      throw Object.assign(new Error('PG_CONNECTION_UNAVAILABLE'), { code: 'PG_CONNECTION_UNAVAILABLE' });
    } finally { if (timer !== undefined) unschedule(timer); }
    return { query: value => client.query(value), close: () => client.end() };
  };
}
