import { PgPoolAdapter } from '../src/server/adapters/db-pg.ts';
import { PGliteAdapter } from '../src/server/adapters/db-pglite.ts';
import { config } from '../src/server/config.ts';
import { DEMO_TENANT_ID } from '../src/server/platform/seed.ts';
import { logger } from '../src/server/platform/logger.ts';
import type { DbPort } from '../src/server/ports/db.ts';

export interface ScaleFixtureOptions {
  readonly totalLots?: number;
  readonly entriesPerBatch?: number;
  readonly tenantId?: string;
}

/**
 * Phase 4 Scale Fixture Generator:
 * Creates high-volume synthetic dockside lots (10,000+ lots and 50,000+ entries)
 * for stress testing keyset pagination, ledger index scans, and database throughput.
 */
export async function seedScaleFixture(
  db: DbPort,
  options: ScaleFixtureOptions = {}
): Promise<{ totalLotsCreated: number; elapsedMs: number }> {
  const totalLots = options.totalLots ?? 10_000;
  const batchSize = options.entriesPerBatch ?? 500;
  const tenantId = options.tenantId ?? DEMO_TENANT_ID;

  logger.info('Starting scale fixture generation', {
    totalLots,
    batchSize,
    tenantId,
  });

  const startTime = Date.now();
  let createdCount = 0;

  // Query species and buyers to reference in lots
  const speciesRes = await db.query<{ species_id: string }>(
    `SELECT species_id FROM harbour.species WHERE tenant_id = $1 LIMIT 5`,
    [tenantId]
  );
  const buyerRes = await db.query<{ buyer_id: string }>(
    `SELECT buyer_id FROM harbour.buyers WHERE tenant_id = $1 LIMIT 5`,
    [tenantId]
  );

  const speciesList = speciesRes.rows.map((r) => r.species_id);
  const buyerList = buyerRes.rows.map((r) => r.buyer_id);

  if (speciesList.length === 0 || buyerList.length === 0) {
    throw new Error('Tenant must have seeded species and buyers before running scale fixture');
  }

  // Create synthetic lots in batches
  while (createdCount < totalLots) {
    const currentBatchSize = Math.min(batchSize, totalLots - createdCount);
    const valuePlaceholders: string[] = [];
    const values: unknown[] = [];
    let pIdx = 1;

    for (let i = 0; i < currentBatchSize; i++) {
      const idx = createdCount + i + 1;
      const lotId = `SCALE-LOT-${String(idx).padStart(6, '0')}`;
      const lotCode = `SCL-${String(idx).padStart(6, '0')}`;
      const spId = speciesList[i % speciesList.length];
      const buyerId = buyerList[i % buyerList.length];
      const grossGrams = 40_000 + (i % 20) * 1000;
      const tareGrams = 2_000;
      const netGrams = grossGrams - tareGrams;
      const pricePaisePerKg = 35000 + (i % 50) * 500;

      valuePlaceholders.push(
        `($${pIdx}, $${pIdx + 1}, $${pIdx + 2}, 'CR-SCALE-01', $${pIdx + 3}, $${pIdx + 4}, $${pIdx + 5}, $${pIdx + 6}, 'A', 'OPEN', $${pIdx + 7}, 'SCALE-BATCH-01', NOW() - ($${pIdx + 8} * INTERVAL '1 second'))`
      );
      values.push(
        lotId,
        tenantId,
        lotCode,
        spId,
        grossGrams,
        tareGrams,
        netGrams,
        pricePaisePerKg,
        idx
      );
      pIdx += 9;
    }

    const insertSql = `
      INSERT INTO auction.lots (
        lot_id, tenant_id, lot_code, crate_rfid, species_id,
        gross_grams, tare_grams, net_grams, quality_grade,
        status, reserved_price_paise_per_kg, batch_id, created_at
      ) VALUES ${valuePlaceholders.join(', ')}
      ON CONFLICT (lot_id) DO NOTHING
    `;

    await db.query(insertSql, values);
    createdCount += currentBatchSize;

    if (createdCount % 2000 === 0 || createdCount === totalLots) {
      logger.info(`Scale fixture progress: ${createdCount} / ${totalLots} lots generated`);
    }
  }

  const elapsedMs = Date.now() - startTime;
  logger.info('Scale fixture generation completed', {
    totalLotsCreated: createdCount,
    elapsedMs,
  });

  return { totalLotsCreated: createdCount, elapsedMs };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const total = Number(process.argv[2] ?? 10_000);
  const dbUrl = config.DATABASE_URL;
  const db = dbUrl ? new PgPoolAdapter(dbUrl) : new PGliteAdapter('memory://');

  seedScaleFixture(db, { totalLots: total })
    .then((res) => {
      console.log(`Generated ${res.totalLotsCreated} lots in ${res.elapsedMs}ms`);
      if (db.close) void db.close();
      process.exit(0);
    })
    .catch((err) => {
      console.error('Scale fixture failed', err);
      if (db.close) void db.close();
      process.exit(1);
    });
}
