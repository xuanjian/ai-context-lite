export const version = 5;
export const description = "Add reusable project component metadata";

export function up(db) {
  addColumnIfMissing(db, "components", "TEXT NOT NULL DEFAULT '[]'");

  const rows = db.prepare("SELECT id, components, raw_json FROM projects").all();
  const update = db.prepare(`
    UPDATE projects
    SET components = @components, raw_json = @rawJson
    WHERE id = @id
  `);
  for (const row of rows) {
    const project = JSON.parse(row.raw_json);
    const components = normalizeComponents(project.components ?? parseJsonArray(row.components));
    update.run({
      id: row.id,
      components: JSON.stringify(components),
      rawJson: JSON.stringify({ ...project, components })
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

function normalizeComponents(values) {
  const components = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const component = {
      name: normalizeString(value?.name),
      purpose: normalizeString(value?.purpose),
      path: normalizeString(value?.path)
    };
    if (!component.name || !component.path) continue;
    const key = `${component.name}\0${component.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    components.push(component);
  }
  return components;
}

function normalizeString(value) {
  return String(value ?? "").trim();
}
