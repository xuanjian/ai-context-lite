import { collectJsonMigrationSnapshot, applyMigrationSnapshot } from "../../src/core/storage/migrate-from-json.mjs";
import { defaultDbPath, initializeSchema, openDevFlowDatabase } from "../../src/core/storage/schema.mjs";

export async function seedSqliteFromJsonFixture(rootDir, { dbPath = defaultDbPath(rootDir) } = {}) {
  const snapshot = await collectJsonMigrationSnapshot({ rootDir, dbPath });
  const db = openDevFlowDatabase({ rootDir, dbPath });
  try {
    initializeSchema(db);
    const sanityChecks = applyMigrationSnapshot(db, snapshot);
    return { snapshot, sanityChecks };
  } finally {
    db.close();
  }
}
