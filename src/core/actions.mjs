import { installActions } from "./actions/install.mjs";
import { commandActions } from "./actions/run-command.mjs";
import { projectActions } from "./actions/project.mjs";
import { sceneActions } from "./actions/scene.mjs";
import { skillActions } from "./actions/skill.mjs";
import { ruleActions } from "./actions/rule.mjs";
import { taskActions } from "./actions/task.mjs";
import { actionError } from "./actions/shared.mjs";
import { toPath } from "./paths.mjs";

const ACTIONS = {
  ...commandActions,
  ...installActions,
  ...projectActions,
  ...sceneActions,
  ...skillActions,
  ...ruleActions,
  ...taskActions
};

export async function runAction({ rootDir = process.cwd(), actionId, body = {} } = {}) {
  const rootPath = toPath(rootDir);
  const action = ACTIONS[actionId];
  if (!action) {
    return actionError(actionId, "unsupported_action", `Unsupported action: ${actionId}`);
  }

  try {
    return await action.run({ rootPath, actionId, body });
  } catch (error) {
    return actionError(actionId, "action_failed", error?.message || String(error));
  }
}
