import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {isIP} from 'node:net';
import {createPostgresExecutor} from './postgres-executor.mjs';

const run = promisify(execFile);
export const INSTABOX_TARGET = 'INSTABOX_POSTGRESQL_V1';
export const INSTABOX_APP_ROOT = '/data/job-finder/app';

async function containerAddress() {
  // Do not inspect Config.Env: it can contain the database password.
  const {stdout} = await run('docker', ['inspect', '--format',
    '{{.NetworkSettings.Networks.bridge.IPAddress}}', 'jobfinder-postgres'], {timeout: 10_000});
  return stdout.trim();
}

/** Uses only the selected machine's existing container; never a supplied DSN.
 * passwordProvider is separately approved machine-side configuration, not a file parser.
 */
export function createInstaboxDatabase({Client, PrismaClient, passwordProvider, getAddress = containerAddress}) {
  async function address() {
    const host = await getAddress();
    if (isIP(host) !== 4) throw Error('INSTABOX_DATABASE_ADDRESS_UNAVAILABLE');
    return host;
  }
  const executeSql = createPostgresExecutor(async () => {
    const host = await address();
    return new Client({host, port: 5432, database: 'jobfinder', user: 'jobfinder', password: passwordProvider,
      connectionTimeoutMillis: 10_000, statement_timeout: 8_000, lock_timeout: 1_000,
      idle_in_transaction_session_timeout: 130_000,
      options: '-c search_path=pg_catalog,public,extensions -c timezone=UTC -c synchronous_commit=on'});
  });
  async function createReaderDatabase() {
    const host = await address(), password = await passwordProvider();
    if (typeof password !== 'string' || !password) throw Error('INSTABOX_DATABASE_PASSWORD_UNAVAILABLE');
    const url = new URL(`postgresql://jobfinder@${host}:5432/jobfinder`);
    url.password = password;
    url.searchParams.set('connection_limit', '1');
    url.searchParams.set('connect_timeout', '10');
    url.searchParams.set('pool_timeout', '10');
    return new PrismaClient({datasources: {db: {url: url.href}}});
  }
  return Object.freeze({target: INSTABOX_TARGET, appRoot: INSTABOX_APP_ROOT, executeSql, createReaderDatabase});
}
