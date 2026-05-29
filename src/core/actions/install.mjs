import {
  check as checkAiContext,
  install as installAiContext,
  syncProjects as syncAiContextProjects,
  validate as validateAiContext
} from "../../../scripts/install-ai-context.mjs";
import {
  actionCommands,
  actionError,
  createFileOnce,
  createMinimalProfileConfig,
  runInstallModuleAction
} from "./shared.mjs";

export const installActions = {
  install_ai_context: {
    run: ({ rootPath, actionId }) => runInstallModuleAction(rootPath, actionId, "install", () => installAiContext({ rootDir: rootPath }))
  },
  validate_ai_context: {
    run: ({ rootPath, actionId }) => runInstallModuleAction(rootPath, actionId, "validate", () => validateAiContext({ rootDir: rootPath }))
  },
  check_ai_context: {
    run: ({ rootPath, actionId }) => runInstallModuleAction(rootPath, actionId, "check", () => checkAiContext({ rootDir: rootPath }))
  },
  sync_project_entry: {
    run: syncProjectEntry
  },
  create_minimal_profile_json: {
    run: createMinimalProfileConfig
  },
  create_minimal_person_profile: {
    run: ({ rootPath, actionId }) => createFileOnce(rootPath, actionId, "docs/person/profile.md", "# Profile\n\nTODO: fill in real long-term preferences and collaboration context.\n")
  }
};

export async function syncProjectEntry({ rootPath, actionId, body }) {
  const projectId = body?.projectId;
  if (!projectId || typeof projectId !== "string" || projectId.includes("/") || projectId.includes("..")) {
    return actionError(actionId, "invalid_project_id", "sync_project_entry requires a safe projectId.");
  }

  const commands = await actionCommands(rootPath);
  const project = await commands.getProject(projectId);
  if (!project) {
    return actionError(actionId, "invalid_project_id", `Unknown projectId: ${projectId}`);
  }

  return runInstallModuleAction(rootPath, actionId, "sync-projects", () => syncAiContextProjects({
    rootDir: rootPath,
    projectId,
    write: true
  }));
}
