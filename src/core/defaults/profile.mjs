export const PROFILE_CONFIG_KEY = "profile";

// Mirrored from config/profile.json. JSON file will be removed after devflow migrate from-json (Round 2).
export const DEFAULT_PROFILE = {
  "version": 1,
  "name": "",
  "role": "",
  "languagePreference": {},
  "products": [],
  "strengths": [],
  "collaborationPreferences": [],
  "privacy": [
    "Do not store secrets, tokens, credentials, private account identifiers, personal project paths, or company task evidence in the public DevFlow template.",
    "Run devflow-init on each local machine to create private profile details outside the public skeleton."
  ],
  "devFlowIntegration": {
    "enabled": true,
    "defaultBehavior": "on-demand",
    "taskTrackingDefault": "none until the user request needs resume, light, or full tracking"
  },
  "whenToReadFullProfile": "Fresh installs have no private profile. Run devflow-init to create local profile details.",
  "whenToReadCurrentTask": "Read runtime/current.json only when the current request is resume, task-status, light tracking, or full tracking."
};
