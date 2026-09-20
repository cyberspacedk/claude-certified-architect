import {
	HookCallback,
	PostToolUseHookInput,
	PreToolUseHookInput,
	query
} from "@anthropic-ai/claude-agent-sdk";

type JsonObject = Record<string, unknown>;

interface HookState {
	amlPassed: boolean;
	seenNormalisedResults: JsonObject[];
	refundHandlerCalls: number;
	transferHandlerCalls: number;
}

interface AgentOptions {
	hooks: {
		PreToolUse: Array<{ matcher: string; hooks: HookCallback[] }>;
		PostToolUse: Array<{ matcher: string; hooks: HookCallback[] }>;
	};
	mcpServers: JsonObject;
	allowedTools: string[];
}

function asObject(value: unknown, description: string): JsonObject {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${description} must be a JSON object`);
	}
	return value as JsonObject;
}

function normaliseDate(value: unknown): unknown {
	if (typeof value === "number" && Number.isFinite(value)) {
		const date = new Date(value * 1000);
		return Number.isNaN(date.getTime()) ? value : date.toISOString();
	}

	if (typeof value === "string" && /^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
		const [day, month, year] = value.split("/").map(Number);
		const date = new Date(Date.UTC(year, month - 1, day));
		const isValidDate = date.getUTCFullYear() === year &&
			date.getUTCMonth() === month - 1 &&
			date.getUTCDate() === day;
		return isValidDate ? date.toISOString() : value;
	}

	return value;
}

const statusMap: Record<string, string> = {
	"200": "active",
	"404": "not_found",
	S: "shipped",
	P: "pending"
};

function normaliseToolResponse(value: unknown): JsonObject {
	const result = asObject(value, "tool_response");
	const normalised = { ...result };

	if ("created_at" in result) {
		normalised.created_at = normaliseDate(result.created_at);
	}

	const mappedStatus = statusMap[String(result.status)];
	if (mappedStatus) {
		normalised.status = mappedStatus;
	}

	return normalised;
}

function createNormaliseToolOutputHook(state: HookState): HookCallback {
	return async (input: unknown) => {
		const post = input as PostToolUseHookInput;
		const normalised = normaliseToolResponse(post.tool_response);
		state.seenNormalisedResults.push(normalised);

		return {
			hookSpecificOutput: {
				hookEventName: "PostToolUse",
				updatedToolOutput: normalised
			}
		};
	};
}

function createLargeRefundHook(state: HookState): HookCallback {
	return async (input: unknown) => {
		const pre = input as PreToolUseHookInput;
		const toolInput = asObject(pre.tool_input, "tool_input");
		const amount = toolInput.amount;

		if (typeof amount === "number" && amount > 500) {
			return {
				hookSpecificOutput: {
					hookEventName: "PreToolUse",
					permissionDecision: "deny",
					permissionDecisionReason:
						"Refund exceeds the $500 threshold. Escalate to a human agent."
				}
			};
		}

		state.refundHandlerCalls++;
		return {};
	};
}

function createAmlGateHook(state: HookState): HookCallback {
	return async () => {
		if (!state.amlPassed) {
			return {
				hookSpecificOutput: {
					hookEventName: "PreToolUse",
					permissionDecision: "deny",
					permissionDecisionReason:
						"COMPLIANCE BLOCK: Run aml_check and obtain status=pass before transfer_funds."
				}
			};
		}

		state.transferHandlerCalls++;
		return {};
	};
}

function createAmlResultHook(state: HookState): HookCallback {
	return async (input: unknown) => {
		const post = input as PostToolUseHookInput;
		const result = asObject(post.tool_response, "tool_response");
		state.amlPassed = result.status === "pass";
		return {};
	};
}

function loadMcpServers(): JsonObject {
	const raw = process.env.MCP_SERVERS_JSON;
	if (!raw) {
		throw new Error(
			"MCP_SERVERS_JSON is required. Configure real orders, payments, and banking MCP servers."
		);
	}

	try {
		return asObject(JSON.parse(raw), "MCP_SERVERS_JSON");
	} catch (error: unknown) {
		throw new Error(
			`MCP_SERVERS_JSON must contain valid JSON: ${error instanceof Error ? error.message : "parse failed"}`
		);
	}
}

function createAgentOptions(state: HookState): AgentOptions {
	return {
		mcpServers: loadMcpServers(),
		allowedTools: [
			"mcp__orders__.*",
			"mcp__payments__process_refund",
			"mcp__banking__aml_check",
			"mcp__banking__transfer_funds"
		],
		hooks: {
			PreToolUse: [
				{
					matcher: "mcp__payments__process_refund",
					hooks: [createLargeRefundHook(state)]
				},
				{
					matcher: "mcp__banking__transfer_funds",
					hooks: [createAmlGateHook(state)]
				}
			],
			PostToolUse: [
				{
					matcher: "mcp__orders__.*",
					hooks: [createNormaliseToolOutputHook(state)]
				},
				{
					matcher: "mcp__banking__aml_check",
					hooks: [createAmlResultHook(state)]
				}
			]
		}
	};
}

export async function runAgent(prompt: string): Promise<HookState> {
	const state: HookState = {
		amlPassed: false,
		seenNormalisedResults: [],
		refundHandlerCalls: 0,
		transferHandlerCalls: 0
	};

	for await (const message of query({
		prompt,
		options: createAgentOptions(state)
	})) {
		if (message.type === "result") {
			return state;
		}
	}

	throw new Error("Agent stream ended without a result message");
}

async function main(): Promise<void> {
	const highRefund = await runAgent("Refund customer C-001 the sum of $750.");
	console.log("Blocked high refund:", highRefund.refundHandlerCalls === 0);

	const lowRefund = await runAgent("Refund customer C-001 the sum of $200.");
	console.log("Allowed low refund:", lowRefund.refundHandlerCalls === 1);

	const blockedTransfer = await runAgent("Transfer $10000 to IBAN-123.");
	console.log("Blocked without AML:", blockedTransfer.transferHandlerCalls === 0);

	const approvedTransfer = await runAgent(
		"Run the AML check for C-001, then transfer $10000 to IBAN-123."
	);
	console.log("Allowed after AML:", approvedTransfer.transferHandlerCalls === 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
}
