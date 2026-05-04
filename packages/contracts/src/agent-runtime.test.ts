import assert from "node:assert/strict";
import test from "node:test";

import { parsePlannerDecisionEnvelope, plannerDecisionSchema } from "./agent-runtime.js";

test("planner envelope parses direct final response", () => {
  const decision = parsePlannerDecisionEnvelope({
    decisionType: "final_response",
    responseText: "Final answer."
  });
  assert.equal(decision.decisionType, "final_response");
  if (decision.decisionType === "final_response") {
    assert.equal(decision.responseText, "Final answer.");
  }
});

test("planner envelope parses tool action proposal", () => {
  const decision = parsePlannerDecisionEnvelope({
    decisionType: "action_proposal",
    proposal: {
      proposalType: "tool_invocation",
      proposalId: "proposal:1",
      toolId: "tool.web-search",
      purpose: "Fetch current info",
      input: { query: "manasvi architecture" }
    }
  });
  assert.equal(decision.decisionType, "action_proposal");
  if (decision.decisionType === "action_proposal") {
    assert.equal(decision.proposal.proposalType, "tool_invocation");
  }
});

test("planner envelope normalizes tool proposal when proposalId is missing", () => {
  const decision = parsePlannerDecisionEnvelope({
    decisionType: "action_proposal",
    proposal: {
      proposalType: "tool_invocation",
      toolId: "tool.web-search",
      input: { query: "typescript 5.5" }
    }
  });
  assert.equal(decision.decisionType, "action_proposal");
  if (decision.decisionType === "action_proposal" && decision.proposal.proposalType === "tool_invocation") {
    assert.equal(decision.proposal.proposalId, "proposal:auto");
    assert.equal(decision.proposal.purpose, "Use tool to complete request");
  }
});

test("planner decision schema rejects missing fields", () => {
  assert.equal(
    plannerDecisionSchema.safeParse({
      decisionType: "final_response"
    }).success,
    false
  );
});
