import assert from "node:assert/strict";
import test from "node:test";

import { buildIngressSubmission, pollForEventResult } from "./harness.js";

test("buildIngressSubmission defaults actor/channel and message id", () => {
  const submission = buildIngressSubmission({
    tenantId: "tenant-a",
    workspaceId: "workspace-a",
    message: "hello"
  });
  assert.equal(submission.actor.principalType, "human_user");
  assert.equal(submission.actor.principalId, "user:local-dev");
  assert.equal(submission.channel.principalType, "channel");
  assert.match(submission.channel.messageId, /^msg:/);
});

test("pollForEventResult returns completed when orchestrator returns 200", async () => {
  const result = await pollForEventResult({
    eventId: "event-1",
    orchestratorBaseUrl: "http://orchestrator",
    authToken: "token",
    traceId: "trace",
    correlationId: "corr",
    timeoutMs: 1000,
    intervalMs: 5,
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          result: {
            status: "completed",
            responseText: "ok"
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
  });
  assert.equal(result.status, "completed");
});
