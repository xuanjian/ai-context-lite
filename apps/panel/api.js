async function requestJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export function fetchGraph() {
  return requestJson("/api/graph");
}

export function fetchNodeDetails(nodeId) {
  return requestJson(`/api/nodes/${encodeURIComponent(nodeId)}`);
}

export function fetchChecks() {
  return requestJson("/api/checks");
}

export function fetchProfileDocument() {
  return requestJson("/api/profile-document");
}

export function runAction(actionId, body = {}) {
  return requestJson(`/api/actions/${encodeURIComponent(actionId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}
