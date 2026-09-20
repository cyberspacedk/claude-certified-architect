// 1.
// Create an agent with three MCP tools that return data in different formats: 
// Tool A returns Unix timestamps and numeric status codes, 
// Tool B returns ISO 8601 dates and string statuses, 
// Tool C returns DD/MM/YYYY dates and single-character status codes

// WHY: 
// This recreates the data format chaos example from the exam. 
// Without normalisation, the model must interpret three different date formats and three different status representations, leading to inconsistent parsing across iterations.

// Define three mock tool handlers that return objects 
// with created_at and status fields, each using a different format convention for both fields.

function toolAHandler(): Record<string, unknown> {
  return {
    customer_id: "C-001",
    created_at: 1710489600,
    status: 200
  };
}

function toolBHandler(): Record<string, unknown> {
  return {
    order_id: "ORD-42",
    created_at: "2024-03-15T12:00:00Z",
    status: "active"
  };
}

function toolCHandler(): Record<string, unknown> {
  return {
    shipment_id: "SHP-7",
    created_at: "15/03/2024",
    status: "S"
  };
}

// 2. 
// Implement a PostToolUse hook that 
// intercepts all tool results 
// and normalises dates to ISO 8601 format 
// and status codes to human-readable English strings

// WHY: 
// PostToolUse hooks run after execution but before the model processes the result. 
// This is the correct hook direction for data normalisation — the exam tests whether you know that PostToolUse transforms data after execution, not before.

// The callback argument is a PostToolUseHookInput, so the result arrives as tool_response. 
// To replace what the model sees, return hookSpecificOutput with hookEventName PostToolUse and updatedToolOutput set to your rewritten object. 
// An empty object leaves the result alone. Register the callback under PostToolUse with a matcher for your MCP tools.

import { query, HookCallback, PostToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";

const normaliseToolOutput: HookCallback = async (input) => {
  const post = input as PostToolUseHookInput;
  const result = post.tool_response as Record<string, unknown>;
  const normalised = { ...result };

  // Normalise dates
  if (typeof result.created_at === "number") {
    normalised.created_at = new Date(result.created_at * 1000).toISOString();
  } else if (typeof result.created_at === "string" && /^\d{2}\/\d{2}\/\d{4}$/.test(result.created_at)) {
    const [day, month, year] = result.created_at.split("/");
    normalised.created_at = new Date(`${year}-${month}-${day}`).toISOString();
  }

  // Normalise status
  const statusMap: Record<string, string> = {
    "200": "active",
    "404": "not_found",
    "S": "shipped",
    "P": "pending"
  };

  if (statusMap[String(result.status)]) {
    normalised.status = statusMap[String(result.status)];
  }

  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      updatedToolOutput: normalised
    }
  };
};

// Register it. The matcher decides which tools the callback sees;
// MCP tool names follow the pattern mcp__<server>__<action>.
const options = {
  hooks: {
    PostToolUse: [{
      matcher: "mcp__orders__.*",
      hooks: [normaliseToolOutput]
    }]
  }
};

// 3. 
// Verify the model receives consistent data by testing with queries that require results from all three tools

// WHY: 
// Consistent data eliminates interpretation errors. 
// Without normalisation, the model might confuse day/month order in DD/MM/YYYY or misinterpret status code P as processed instead of pending. 
// Verification proves the hook works across all tool outputs.

// Record the normalised object inside the normalising hook itself. 
// Sibling PostToolUse hooks all receive the original tool_response, so a separate observer hook would log the raw value and tell you nothing.

const seen: Record<string, unknown>[] = [];

// Inside normaliseToolOutput, just before the return:
//   seen.push(normalised);

const testPrompt = "Look up customer C-001, find their order ORD-42, and check shipment SHP-7 status.";

for await (const message of query({ prompt: testPrompt, options })) {
  if (message.type === "result") break;
}

// Tool A: created_at should be "2024-03-15T12:00:00.000Z", not 1710489600
// Tool C: status should be "shipped", not "S"
console.log("All dates ISO 8601:", seen.every((o) => String(o.created_at).includes("T")));
console.log("All statuses readable:", seen.every((o) => typeof o.status === "string" && (o.status as string).length > 1));

// 4.
// Add a PreToolUse hook that blocks process_refund when the amount exceeds $500 and redirects to a human escalation workflow

// WHY:
//  A PreToolUse hook runs before execution — the refund never processes. 
// The exam specifically warns against using PostToolUse for blocking, because by that point the action has already occurred. 
// Pre-execution interception is the only correct hook direction for policy enforcement.

// Use a PreToolUse hook. 
// The arguments arrive as tool_input on a PreToolUseHookInput. 
// To stop the call, return hookSpecificOutput with hookEventName PreToolUse and permissionDecision deny, plus a permissionDecisionReason so the model knows why and does not simply retry. 
// Return an empty object to let the call through. Give the matcher the tool name so the callback does not have to check it.

import { HookCallback, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";

const blockLargeRefunds: HookCallback = async (input) => {
  const pre = input as PreToolUseHookInput;
  const toolInput = pre.tool_input as Record<string, unknown>;

  if ((toolInput.amount as number) > 500) {

    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "Refund exceeds the $500 threshold. Redirecting to the human escalation queue. Reference: ESC-" + Date.now()
      }
    };
  }

  // Empty object: no opinion, normal permission evaluation continues.
  return {};
};

// The matcher restricts the callback to the refund tool.
const hooks = {
  PreToolUse: [{
    matcher: "mcp__payments__process_refund",
    hooks: [blockLargeRefunds]
  }]
};

// 5.
// Add a second PreToolUse hook that blocks transfer_funds until aml_check has returned a pass result in the current session

// WHY:
// This is the AML compliance scenario from the exam. 
// Prompt instructions achieve 95% compliance, but regulatory requirements demand 100%. 
// The hook provides deterministic enforcement that no prompt can match — a single missed AML check can result in legal penalties.

// Keep a module-scoped flag.
// A PostToolUse hook on aml_check reads tool_response and sets it on a pass;
// a PreToolUse hook on transfer_funds denies while it is false. 
// Two matchers, two callbacks, one flag.

const amlState = { passed: false };

const requireAmlCheck: HookCallback = async () => {
  if (!amlState.passed) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "COMPLIANCE BLOCK: International transfer requires AML verification. Run aml_check first."
      }
    };
  }
  return {};
};

const recordAmlResult: HookCallback = async (input) => {
  const post = input as PostToolUseHookInput;
  const result = post.tool_response as Record<string, unknown>;
  if (result.status === "pass") {
    amlState.passed = true;
  }
  return {};
};

// The matchers, not the callbacks, decide which tool each hook sees.
const hooks = {
  PreToolUse: [{
    matcher: "mcp__banking__transfer_funds",
    hooks: [requireAmlCheck]
  }],
  PostToolUse: [{
    matcher: "mcp__banking__aml_check",
    hooks: [recordAmlResult]
  }]
};

// 6. 
// Test both hooks by attempting to trigger the blocked operations and verify they are prevented before execution

// WHY:
//  Testing confirms that the hooks provide deterministic enforcement.
//  The key verification is that blocked tools never execute — the hook prevents the call, not just logs a warning after the fact.

// Count executions in the tool handlers themselves.
// If the PreToolUse hook did its job, the counter never moves.
// That is the whole point of blocking before execution rather than after.

// Increment these inside the process_refund and transfer_funds handlers.
let refundHandlerCalls = 0;
let transferHandlerCalls = 0;

// Test the refund threshold
await runAgent("Refund customer C-001 the sum of $750.");
console.log("Blocked high refund:", refundHandlerCalls === 0);

await runAgent("Refund customer C-001 the sum of $200.");
console.log("Allowed low refund:", refundHandlerCalls === 1);

// Test the AML prerequisite
await runAgent("Transfer $10000 to IBAN-123.");
console.log("Blocked without AML:", transferHandlerCalls === 0);

await runAgent("Run the AML check for C-001, then transfer $10000 to IBAN-123.");
console.log("Allowed after AML:", transferHandlerCalls === 1);
