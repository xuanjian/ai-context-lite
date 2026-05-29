import { actionCommands, actionError, actionOk } from "./shared.mjs";

export const taskActions = {
  finish_task: { run: finishTask },
  delete_task: { run: deleteTask }
};

export async function finishTask({ rootPath, actionId, body }) {
  const commands = await actionCommands(rootPath);
  const taskId = taskIdFromBody(body);
  if (!taskId) return actionError(actionId, "invalid_task_id", "完成任务需要填写 taskId。");

  const task = await commands.getTask(taskId);
  if (!task) return actionError(actionId, "unknown_task", `Unknown taskId: ${taskId}`);

  const result = await commands.finishTask({
    taskId,
    note: String(body?.note || "")
  });
  if (result.status !== "ok") {
    return actionError(actionId, "finish_task_failed", result.message || `Failed to finish task: ${taskId}`);
  }
  return actionOk(actionId, `完成任务 ${taskId}。`, ["data/devflow.db", ...(result.paths || [])]);
}

export async function deleteTask({ rootPath, actionId, body }) {
  const commands = await actionCommands(rootPath);
  const taskId = taskIdFromBody(body);
  if (!taskId) return actionError(actionId, "invalid_task_id", "删除任务需要填写 taskId。");

  const task = await commands.getTask(taskId);
  if (!task) return actionError(actionId, "unknown_task", `Unknown taskId: ${taskId}`);

  const result = await commands.deleteTask({ taskId });
  if (result.status !== "ok") {
    return actionError(actionId, "delete_task_failed", result.message || `Failed to delete task: ${taskId}`);
  }
  return actionOk(actionId, `删除任务 ${taskId}。runtime/tasks 下的 markdown 不会被删除。`, ["data/devflow.db"]);
}

function taskIdFromBody(body = {}) {
  return String(body?.taskId || body?.id || "")
    .trim()
    .replace(/^task:/, "");
}
