export const CURRENT_RUNTIME_KEY = "current";

// Fresh runtime default. runtime/current.json will be removed after devflow migrate from-json (Round 2).
export const DEFAULT_CURRENT = {
  "version": 1,
  "activeTaskId": "",
  "activeTaskPath": "",
  "activeWorksetId": "",
  "activeProjectIds": [],
  "activeSceneTemplateId": "",
  "activeSceneIds": [],
  "currentGate": "",
  "recentTaskIds": []
};
