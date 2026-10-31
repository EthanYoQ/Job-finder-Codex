export function memoryDb() {
  let holder = '', jobWrites = 0;
  const rows = [], batches = [], artifacts = [];
  const db = {
    async $transaction(work) { return work(db); },
    async $queryRawUnsafe(sql, ...values) {
      if (sql.startsWith('INSERT INTO "CrawlCoordinatorLock"')) { holder = values[1]; return [{ holderId: holder }]; }
      if (sql.startsWith('SELECT "id"')) return [{ id: 'formal-crawl' }];
      if (sql.includes('SET "holderId" = \'\'')) { holder = ''; return [{ holderId: '' }]; }
      return [{ holderId: holder }];
    },
    crawlBatch: {
      async create({ data }) { batches.push({ ...data }); return data; },
      async update({ where, data }) { Object.assign(batches.find(row => row.id === where.id), data); return data; }
    },
    crawlBatchSourceResult: {
      async create({ data }) { rows.push({ ...data }); return data; },
      async updateMany({ where, data }) {
        const row = rows.find(row => row.id === where.id);
        if (!row || row.atomicCommitState !== 'PENDING') return { count: 0 };
        Object.assign(row, data); return { count: 1 };
      },
      async findMany() { return rows; }
    },
    job: { async upsert() { jobWrites++; } },
    evidenceArtifact: { async create({ data }) { artifacts.push(data); } },
    paginationEvidence: { async create() {} }, lossLedgerEntry: { async create() {} },
    transportAttemptEvidence: { async create() {} }, transportAttemptArtifact: { async create() {} },
    crawlObservation: { async create() {} }, lifecycleSetEvidenceMember: { async create() {} }
  };
  return { db, rows, batches, artifacts, jobWrites: () => jobWrites };
}

