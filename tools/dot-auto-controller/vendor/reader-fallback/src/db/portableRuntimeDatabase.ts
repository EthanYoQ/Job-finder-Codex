import { fencePortableCrawlPublication, type PortableCrawlLease, type PortableLeaseTransaction } from "../crawler/portableCrawlLease";

interface RuntimeTransaction extends PortableLeaseTransaction {
  crawlBatch: { update(args: unknown): Promise<unknown> };
}
interface RuntimeDatabase {
  $transaction<T>(work: (tx: RuntimeTransaction) => Promise<T>, options?: {maxWait?:number;timeout?:number}): Promise<T>;
  crawlBatch: { update(args: unknown): Promise<unknown> };
}

/** Narrow adapter for runP0CrawlBatch's two write seams: interactive transactions
 * and final crawlBatch.update. Read methods retain the original Prisma receiver.
 * It does not make unrelated direct model writes safe; old runners must stop at cutover. */
export function createPortableFencedRuntimeDatabase<T extends object>(database:T, lease:PortableCrawlLease):T {
  const db=database as unknown as RuntimeDatabase;
  const transaction=<R>(work:(tx:RuntimeTransaction)=>Promise<R>, options?:{maxWait?:number;timeout?:number}) => {
    if(typeof work!=="function")throw new Error("PORTABLE_INTERACTIVE_TRANSACTION_REQUIRED");
    const maxWait=Math.min(options?.maxWait??10_000,10_000),timeout=Math.min(options?.timeout??120_000,120_000);
    if(!Number.isSafeInteger(maxWait)||maxWait<=0||!Number.isSafeInteger(timeout)||timeout<=0)
      throw new Error("PORTABLE_TRANSACTION_BOUND_INVALID");
    return db.$transaction(async tx=>{await fencePortableCrawlPublication(tx,lease);return work(tx);},{maxWait,timeout});
  };
  const batch=new Proxy(db.crawlBatch,{get(target,key){
    if(key==="update")return (args:unknown)=>{const snapshot=structuredClone(args);return transaction(tx=>tx.crawlBatch.update(snapshot));};
    const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
  }});
  return new Proxy(database,{get(target,key){
    if(key==="$transaction")return transaction;
    if(key==="crawlBatch")return batch;
    const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
  }});
}
