import * as m001 from "./001-init.mjs";
import * as m002 from "./002-config-tables.mjs";
import * as m003 from "./003-drop-documents.mjs";
import * as m004 from "./004-project-metadata.mjs";
import * as m005 from "./005-project-components.mjs";

export const migrations = [m001, m002, m003, m004, m005].sort((a, b) => a.version - b.version);
