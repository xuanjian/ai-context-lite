export const version = 4;
export const description = "Add project product domain and role metadata";

export function up(db) {
  addColumnIfMissing(db, "products", "TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing(db, "domains", "TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing(db, "role", "TEXT NOT NULL DEFAULT ''");

  const rows = db.prepare("SELECT id, products, domains, role, raw_json FROM projects").all();
  const update = db.prepare(`
    UPDATE projects
    SET products = @products, domains = @domains, role = @role, raw_json = @rawJson
    WHERE id = @id
  `);
  for (const row of rows) {
    const project = JSON.parse(row.raw_json);
    const products = normalizeStringList(project.products ?? parseJsonArray(row.products));
    const domains = normalizeStringList(project.domains ?? parseJsonArray(row.domains));
    const role = normalizeString(project.role ?? row.role);
    update.run({
      id: row.id,
      products: JSON.stringify(products),
      domains: JSON.stringify(domains),
      role,
      rawJson: JSON.stringify({ ...project, products, domains, role })
    });
  }
}

function addColumnIfMissing(db, columnName, definition) {
  const columns = db.prepare("PRAGMA table_info(projects)").all().map((row) => row.name);
  if (columns.includes(columnName)) return;
  db.exec(`ALTER TABLE projects ADD COLUMN ${columnName} ${definition}`);
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeStringList(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeString(value))
    .filter(Boolean))];
}

function normalizeString(value) {
  return String(value ?? "").trim();
}
