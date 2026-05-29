export const version = 3;
export const description = "Drop unused owner documents table";

export function up(db) {
  db.exec("DROP TABLE IF EXISTS documents;");
}
