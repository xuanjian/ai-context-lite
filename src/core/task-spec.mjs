export function normalizeTaskSpec(spec = {}) {
  const source = spec && typeof spec === "object" ? spec : {};
  const status = normalizeString(source.status) || "none";
  const changeId = normalizeString(source.changeId);
  const path = normalizeString(source.path);
  const handoff = normalizeString(source.handoff);
  const tool = normalizeString(source.tool) || (status !== "none" || changeId || path || handoff ? "openspec" : "");

  return {
    tool,
    changeId,
    path,
    status,
    handoff
  };
}

export function mergeTaskSpec(currentSpec, patchSpec) {
  if (patchSpec === undefined) {
    return normalizeTaskSpec(currentSpec);
  }
  const patch = Object.fromEntries(
    Object.entries(patchSpec && typeof patchSpec === "object" ? patchSpec : {})
      .filter(([, value]) => value !== undefined)
  );
  return normalizeTaskSpec({
    ...(currentSpec && typeof currentSpec === "object" ? currentSpec : {}),
    ...patch
  });
}

export function formatTaskSpecLine(spec) {
  const normalized = normalizeTaskSpec(spec);
  if (normalized.status === "none") return "";
  const subject = normalized.changeId || normalized.tool || "openspec";
  const pathPart = normalized.path ? ` ${normalized.path}` : "";
  const handoffPart = normalized.handoff ? ` - ${normalized.handoff}` : "";
  return `Spec: ${subject} (${normalized.status})${pathPart}${handoffPart}`;
}

function normalizeString(value) {
  return String(value ?? "").trim();
}
