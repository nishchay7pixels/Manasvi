#!/usr/bin/env node

const gatewayBaseUrl = process.env.GATEWAY_BASE_URL ?? "http://localhost:4100";
const tenantId = process.env.HARNESS_TENANT_ID ?? "tenant-local";
const workspaceId = process.env.HARNESS_WORKSPACE_ID ?? "workspace-local";

async function postMessage(message, sessionId) {
  const response = await fetch(`${gatewayBaseUrl}/test-harness/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      tenantId,
      workspaceId,
      actorPrincipalId: "user:smoke-tester",
      actorPrincipalType: "human_user",
      channelPrincipalId: "channel:smoke",
      message,
      ...(sessionId ? { sessionId } : {})
    })
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Harness request failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

const first = await postMessage("Summarize the current Manasvi harness status.");
const firstSessionId = first?.result?.sessionId;
if (!firstSessionId) {
  throw new Error(`First response did not include sessionId: ${JSON.stringify(first)}`);
}
console.log(JSON.stringify({ step: "first-message", sessionId: firstSessionId, eventId: first.eventId }));

const second = await postMessage("Use the same session and respond with one concise sentence.", firstSessionId);
const secondSessionId = second?.result?.sessionId;
if (!secondSessionId) {
  throw new Error(`Second response did not include sessionId: ${JSON.stringify(second)}`);
}
if (secondSessionId !== firstSessionId) {
  throw new Error(
    `Session reuse failed: first=${firstSessionId}, second=${secondSessionId}, secondResponse=${JSON.stringify(second)}`
  );
}
console.log(JSON.stringify({ step: "second-message", sessionId: secondSessionId, eventId: second.eventId }));
console.log(JSON.stringify({ ok: true, message: "Milestone 5 harness smoke completed." }));
