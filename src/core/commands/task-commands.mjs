import fs from "node:fs/promises";
import path from "node:path";
import { normalizeCommandResult, normalizeWorkset } from "../contracts/devflow-types.mjs";
import { formatTaskSpecLine, mergeTaskSpec, normalizeTaskSpec } from "../task-spec.mjs";

export async function startTask(repository, input = {}) {
  const taskId = input.taskId || slugify(input.title || "task");
  const handoffPath = `runtime/tasks/${taskId}/handoff.md`;
  const workset = normalizeWorkset({
    id: `workset-${taskId}`,
    taskId,
    sourceText: input.title || "",
    confidence: "manual",
    reason: input.note || "Started from command service.",
    sceneTemplateId: input.templateId,
    projects: (input.projectIds || []).map((id) => ({ id, role: "primary" })),
    skills: [],
    rules: []
  });
  const task = {
    id: taskId,
    title: input.title || taskId,
    gate: input.gate || "",
    currentGate: input.gate || "",
    level: input.level || "",
    taskLevel: input.level || "",
    status: "active",
    note: input.note || "",
    nextAction: input.nextAction || "",
    recoveryPoint: input.recoveryPoint || "",
    spec: normalizeTaskSpec(input.spec),
    workset,
    paths: {
      handoff: handoffPath
    }
  };

  await repository.writeTask(task);
  await writeHandoff(input.rootDir, task, [`Started: ${new Date().toISOString()}`, input.note].filter(Boolean));
  await repository.setRuntimeState({
    activeTaskId: taskId,
    activeTaskPath: "",
    activeWorksetId: workset.id,
    activeProjectIds: input.projectIds || [],
    activeSceneTemplateId: input.templateId || "",
    currentGate: input.gate || ""
  });

  return normalizeCommandResult({
    status: "ok",
    action: "startTask",
    entityType: "task",
    entityId: taskId,
    message: `Started task ${taskId}.`,
    paths: [handoffPath]
  });
}

export async function updateTask(repository, input = {}) {
  const task = await repository.getTask(input.taskId);
  if (!task) {
    return normalizeCommandResult({
      status: "error",
      action: "updateTask",
      entityType: "task",
      entityId: input.taskId,
      message: `Task not found: ${input.taskId}`
    });
  }

  const nextTask = {
    ...task,
    gate: input.gate || task.gate,
    currentGate: input.gate || task.currentGate || task.gate || "",
    level: input.level || task.level || task.taskLevel || "",
    taskLevel: input.level || task.taskLevel || task.level || "",
    recoveryPoint: input.recoveryPoint || task.recoveryPoint || "",
    spec: mergeTaskSpec(task.spec, input.spec),
    notes: appendNote(task.notes, input.note)
  };
  await repository.writeTask(nextTask);
  await writeHandoff(input.rootDir, nextTask, [`Updated: ${new Date().toISOString()}`, input.note].filter(Boolean));
  await repository.setRuntimeState({
    activeTaskId: nextTask.id,
    activeTaskPath: "",
    activeWorksetId: nextTask.workset?.id || "",
    activeProjectIds: nextTask.projectIds || nextTask.workset?.projects?.map((project) => project.id).filter(Boolean) || [],
    activeSceneTemplateId: nextTask.workset?.sceneTemplateId || "",
    currentGate: nextTask.currentGate || nextTask.gate || ""
  });

  return normalizeCommandResult({
    status: "ok",
    action: "updateTask",
    entityType: "task",
    entityId: nextTask.id,
    message: `Updated task ${nextTask.id}.`,
    paths: task.paths?.handoff ? [task.paths.handoff] : [`runtime/tasks/${nextTask.id}/handoff.md`]
  });
}

export async function finishTask(repository, input = {}) {
  const task = await repository.getTask(input.taskId);
  if (!task) {
    return normalizeCommandResult({
      status: "error",
      action: "finishTask",
      entityType: "task",
      entityId: input.taskId,
      message: `Task not found: ${input.taskId}`
    });
  }

  const nextTask = {
    ...task,
    status: "finished",
    gate: "G7",
    currentGate: "G7",
    finishedNote: input.note || "",
    notes: appendNote(task.notes, input.note)
  };
  const activeTask = await repository.getActiveTask();
  await repository.writeTask(nextTask);
  await writeHandoff(input.rootDir, nextTask, [`Finished: ${new Date().toISOString()}`, input.note].filter(Boolean));
  if (activeTask?.id === nextTask.id) {
    await repository.setRuntimeState({
      activeTaskId: "",
      activeTaskPath: "",
      activeWorksetId: "",
      activeProjectIds: [],
      activeSceneTemplateId: "",
      currentGate: ""
    });
  }

  return normalizeCommandResult({
    status: "ok",
    action: "finishTask",
    entityType: "task",
    entityId: nextTask.id,
    message: `Finished task ${nextTask.id}.`,
    paths: task.paths?.handoff ? [task.paths.handoff] : [`runtime/tasks/${nextTask.id}/handoff.md`]
  });
}

export async function deleteTask(repository, input = {}) {
  const task = await repository.getTask(input.taskId);
  if (!task) {
    return normalizeCommandResult({
      status: "error",
      action: "deleteTask",
      entityType: "task",
      entityId: input.taskId,
      message: `Task not found: ${input.taskId}`
    });
  }

  const activeTask = await repository.getActiveTask();
  await repository.deleteTask(task.id);
  if (activeTask?.id === task.id) {
    await repository.setRuntimeState({
      activeTaskId: "",
      activeTaskPath: "",
      activeWorksetId: "",
      activeProjectIds: [],
      activeSceneTemplateId: "",
      currentGate: ""
    });
  }

  return normalizeCommandResult({
    status: "ok",
    action: "deleteTask",
    entityType: "task",
    entityId: task.id,
    message: `Deleted task ${task.id} from SQLite state.`,
    paths: ["data/devflow.db"]
  });
}

function appendNote(notes, note) {
  const nextNotes = Array.isArray(notes) ? [...notes] : [];
  if (note) {
    nextNotes.push(note);
  }
  return nextNotes;
}

function slugify(value) {
  return String(value || "task")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "task";
}

async function writeHandoff(rootDir, task, lines = []) {
  if (!rootDir) return;
  const handoffPath = task.paths?.handoff || `runtime/tasks/${task.id}/handoff.md`;
  const absolutePath = path.join(rootDir, handoffPath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const body = [
    `# ${task.title || task.id}`,
    "",
    `Task: ${task.id}`,
    task.workset?.id ? `Workset: ${task.workset.id}` : "",
    task.workset?.sceneTemplateId ? `Scene Template: ${task.workset.sceneTemplateId}` : "",
    formatTaskSpecLine(task.spec),
    task.recoveryPoint ? `Recovery: ${task.recoveryPoint}` : "",
    "",
    ...lines
  ].filter((line) => line !== "").join("\n") + "\n";
  await fs.writeFile(absolutePath, body, "utf8");
}
