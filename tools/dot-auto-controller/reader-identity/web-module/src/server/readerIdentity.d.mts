import type {IncomingMessage, ServerResponse} from 'node:http';
export const READER_IDENTITY_PATH: '/.well-known/jobfinder-reader-identity.json';
export const READER_IDENTITY_PROJECT: 'yiopvxysxrtrnvqxwgbx';
export const READER_IDENTITY_FILES: readonly string[];
export type ReaderIdentityHandler = (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;
export function createReaderIdentitySession(): Promise<{
  role: 'main' | 'fallback';
  sealAfterApplicationLoad(): Promise<void>;
  handle: ReaderIdentityHandler;
}>;
export function createReaderIdentityAggregator(session: Awaited<ReturnType<typeof createReaderIdentitySession>>): ReaderIdentityHandler;
