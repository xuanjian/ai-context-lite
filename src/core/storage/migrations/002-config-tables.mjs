export const version = 2;
export const description = "Add config and task document tables";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      raw_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_documents (
      task_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      path TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (task_id, kind, path)
    );

    CREATE INDEX IF NOT EXISTS idx_task_documents_task_id ON task_documents(task_id);
  `);
}
