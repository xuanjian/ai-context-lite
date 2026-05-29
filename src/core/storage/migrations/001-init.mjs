export const version = 1;
export const description = "Initial DevFlow schema";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT,
      technology_family_id TEXT,
      source_path TEXT,
      doc_path TEXT,
      raw_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS capabilities (
      id TEXT PRIMARY KEY,
      raw_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scene_templates (
      id TEXT PRIMARY KEY,
      name TEXT,
      summary TEXT,
      source_path TEXT,
      raw_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT,
      source_path TEXT,
      raw_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rules (
      id TEXT PRIMARY KEY,
      name TEXT,
      source_path TEXT,
      raw_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_skill_mounts (
      project_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (project_id, skill_id)
    );

    CREATE TABLE IF NOT EXISTS project_rule_mounts (
      project_id TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (project_id, rule_id)
    );

    CREATE TABLE IF NOT EXISTS scene_template_capabilities (
      scene_template_id TEXT NOT NULL,
      capability_id TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (scene_template_id, capability_id)
    );

    CREATE TABLE IF NOT EXISTS scene_template_project_hints (
      scene_template_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (scene_template_id, project_id)
    );

    CREATE TABLE IF NOT EXISTS scene_template_skill_hints (
      scene_template_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (scene_template_id, skill_id)
    );

    CREATE TABLE IF NOT EXISTS scene_template_rule_hints (
      scene_template_id TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (scene_template_id, rule_id)
    );

    CREATE TABLE IF NOT EXISTS worksets (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      scene_template_id TEXT,
      confidence TEXT,
      reason TEXT,
      raw_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workset_projects (
      workset_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (workset_id, project_id)
    );

    CREATE TABLE IF NOT EXISTS workset_capabilities (
      workset_id TEXT NOT NULL,
      capability_id TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (workset_id, capability_id)
    );

    CREATE TABLE IF NOT EXISTS workset_skills (
      workset_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (workset_id, skill_id)
    );

    CREATE TABLE IF NOT EXISTS workset_rules (
      workset_id TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (workset_id, rule_id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT,
      status TEXT,
      current_gate TEXT,
      workset_id TEXT,
      raw_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_gates (
      task_id TEXT NOT NULL,
      gate_id TEXT NOT NULL,
      status TEXT,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (task_id, gate_id)
    );

    CREATE TABLE IF NOT EXISTS task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runtime_state (
      key TEXT PRIMARY KEY,
      raw_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS graph_edges (
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (from_id, to_id, relation)
    );
  `);
}
