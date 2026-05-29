import { execFileSync } from "node:child_process";

export const OPENSPEC_MISSING_MESSAGE = "OpenSpec CLI missing; full tasks will skip the spec layer unless OpenSpec is installed.";

export function probeOpenSpecCli({ cwd, timeoutMs = 5000 } = {}) {
  try {
    const detail = execFileSync("openspec", ["--version"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: timeoutMs
    }).trim();
    return {
      ok: true,
      detail: detail || "installed"
    };
  } catch {
    return {
      ok: false,
      detail: "missing"
    };
  }
}

export function openSpecCliCheck({ cwd } = {}) {
  const result = probeOpenSpecCli({ cwd });
  return {
    id: "openspec_cli",
    title: "OpenSpec CLI",
    area: "install",
    status: result.ok ? "pass" : "warning",
    message: result.ok
      ? `OpenSpec CLI available: ${result.detail}`
      : OPENSPEC_MISSING_MESSAGE
  };
}

export function openSpecMissingWarning({ cwd } = {}) {
  return probeOpenSpecCli({ cwd }).ok ? null : {
    code: "openspec_missing",
    command: "openspec --version",
    message: OPENSPEC_MISSING_MESSAGE
  };
}
