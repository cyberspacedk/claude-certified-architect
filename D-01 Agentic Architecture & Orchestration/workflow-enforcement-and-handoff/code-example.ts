import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const MODEL = "claude-sonnet-5";
const MAX_ITERATIONS = 12;

type ToolInput = Record<string, unknown>;

interface Customer {
	id: string;
	name: string;
	email: string;
	verified: boolean;
}

interface Order {
	id: string;
	customerId: string;
	amount: number;
	status: "delivered" | "return_requested";
}

export interface HandoffSummary {
	customer_id: string;
	conversation_summary: string;
	root_cause_analysis: string;
	refund_amount: number | null;
	recommended_action: string;
}

interface SessionState {
	verifiedCustomerId: string | null;
}

interface SupportBackendConfig {
	customerLookupUrl: string;
	orderLookupUrl: string;
	refundUrl: string;
	handoffUrl: string;
	authToken: string;
}

class SupportBackend {
	constructor(private readonly config: SupportBackendConfig) {}

	private async request<T>(url: string, init: RequestInit): Promise<T> {
		const response = await fetch(url, {
			...init,
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.config.authToken}`,
				...init.headers
			}
		});

		const body = await response.text();

		if (!response.ok) {
			throw new Error(`Support API ${response.status}: ${body || response.statusText}`);
		}

		try {
			return JSON.parse(body) as T;
		} catch {
			throw new Error("Support API returned invalid JSON");
		}
	}

	async getCustomer(query: string): Promise<Customer> {
		return this.request<Customer>(
			`${this.config.customerLookupUrl}?query=${encodeURIComponent(query)}`,
			{ method: "GET" }
		);
	}

	async lookupOrder(orderId: string): Promise<Order> {
		return this.request<Order>(
			`${this.config.orderLookupUrl}/${encodeURIComponent(orderId)}`,
			{ method: "GET" }
		);
	}

	async processRefund(customerId: string, amount: number): Promise<string> {
		const result = await this.request<unknown>(this.config.refundUrl, {
			method: "POST",
			body: JSON.stringify({ customer_id: customerId, amount })
		});
		return JSON.stringify(result);
	}

	async escalate(summary: HandoffSummary): Promise<string> {
		const result = await this.request<unknown>(this.config.handoffUrl, {
			method: "POST",
			body: JSON.stringify(summary)
		});
		return JSON.stringify(result);
	}
}

function createBackend(): SupportBackend {
	const required = {
		customerLookupUrl: process.env.CUSTOMER_LOOKUP_URL,
		orderLookupUrl: process.env.ORDER_LOOKUP_URL,
		refundUrl: process.env.REFUND_URL,
		handoffUrl: process.env.HANDOFF_URL,
		authToken: process.env.SUPPORT_API_TOKEN
	};

	const missing = Object.entries(required)
		.filter(([, value]) => !value)
		.map(([name]) => name);

	if (missing.length > 0) {
		throw new Error(`Missing support API environment variables: ${missing.join(", ")}`);
	}

	return new SupportBackend(required as SupportBackendConfig);
}

//  AI code
const tools: Anthropic.Tool[] = [
	{
		name: "get_customer",
		description: "Look up and verify a customer by name or email",
		input_schema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Customer name or email" }
			},
			required: ["query"]
		}
	},
	{
		name: "lookup_order",
		description: "Look up order details by order ID",
		input_schema: {
			type: "object",
			properties: { order_id: { type: "string" } },
			required: ["order_id"]
		}
	},
	{
		name: "process_refund",
		description: "Process a refund for a verified customer",
		input_schema: {
			type: "object",
			properties: {
				customer_id: { type: "string" },
				amount: { type: "number", minimum: 0.01 }
			},
			required: ["customer_id", "amount"]
		}
	},
	{
		name: "escalate_to_human",
		description: "Escalate an unresolved issue with a self-contained summary",
		input_schema: {
			type: "object",
			properties: {
				customer_id: { type: "string" },
				conversation_summary: { type: "string" },
				root_cause_analysis: { type: "string" },
				refund_amount: { type: ["number", "null"] },
				recommended_action: { type: "string" }
			},
			required: [
				"customer_id",
				"conversation_summary",
				"root_cause_analysis",
				"refund_amount",
				"recommended_action"
			]
		}
	}
];

function asString(input: ToolInput, field: string): string {
	const value = input[field];

	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`Invalid ${field}: expected a non-empty string`);
	}
	return value.trim();
}

function asAmount(input: ToolInput): number {
	const amount = input.amount;

	if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
		throw new Error("Invalid amount: expected a positive number");
	}
	return amount;
}

function validateHandoff(input: ToolInput): HandoffSummary {
	const refundAmount = input.refund_amount;

	if (refundAmount !== null &&
		(typeof refundAmount !== "number" || !Number.isFinite(refundAmount) || refundAmount < 0)) {
		throw new Error("Invalid refund_amount: expected a non-negative number or null");
	}

	return {
		customer_id: asString(input, "customer_id"),
		conversation_summary: asString(input, "conversation_summary"),
		root_cause_analysis: asString(input, "root_cause_analysis"),
		refund_amount: refundAmount as number | null,
		recommended_action: asString(input, "recommended_action")
	};
}

async function executeTool(
	name: string,
	input: ToolInput,
	session: SessionState,
	backend: SupportBackend
): Promise<string> {
	try {
		if (name === "get_customer") {
			const customer = await backend.getCustomer(asString(input, "query"));

			if (customer.verified) {
				session.verifiedCustomerId = customer.id;
			}

			return JSON.stringify(customer);
		}

		if (name === "lookup_order") {
			return JSON.stringify(await backend.lookupOrder(asString(input, "order_id")));
		}

		if (name === "process_refund") {
			const customerId = asString(input, "customer_id");
			const amount = asAmount(input);

			// Deterministic gate: the model cannot bypass identity verification.
			if (!session.verifiedCustomerId) {
				return "BLOCKED: Customer identity is not verified. Call get_customer first.";
			}

			if (customerId !== session.verifiedCustomerId) {
				return "BLOCKED: The requested customer does not match the verified customer.";
			}

			return await backend.processRefund(customerId, amount);
		}

		if (name === "escalate_to_human") {
			return await backend.escalate(validateHandoff(input));
		}

		return `ERROR: Unknown tool ${name}`;
	} catch (error: unknown) {
		return `ERROR: ${error instanceof Error ? error.message : "Tool execution failed"}`;
	}
}

function textFromResponse(response: Anthropic.Message): string {
	const textBlock = response.content.find((block) => block.type === "text");
	return textBlock?.type === "text" ? textBlock.text : "";
}

export async function runSupportAgent(userPrompt: string): Promise<string> {
	const backend = createBackend();
	const session: SessionState = { verifiedCustomerId: null };
	const messages: Anthropic.MessageParam[] = [{ role: "user", content: userPrompt }];

	for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
		const response = await client.messages.create({
			model: MODEL,
			max_tokens: 2048,
			system: [
				"You are a customer support coordinator.",
				"Decompose multi-concern requests and address every concern.",
				"Before any refund, use get_customer and confirm verified=true.",
				"If the request cannot be resolved, use escalate_to_human with every required field."
			].join(" "),
			tools,
			messages
		});

		if (response.stop_reason === "end_turn") {
			return textFromResponse(response);
		}

		const toolUseBlocks = response.content.filter((block) => block.type === "tool_use");

		if (toolUseBlocks.length === 0) {
			throw new Error(`Agent stopped without text or tool use at iteration ${iteration}`);
		}

		messages.push({ role: "assistant", content: response.content });
		
		messages.push({
			role: "user",
			content: await Promise.all(toolUseBlocks.map(async (block) => ({
				type: "tool_result" as const,
				tool_use_id: block.id,
				content: await executeTool(block.name, block.input as ToolInput, session, backend)
			})))
		});
	}

	throw new Error(`Agent exceeded the ${MAX_ITERATIONS}-iteration safety limit`);
}

async function main(): Promise<void> {
	const prompt = process.argv.slice(2).join(" ") ||
		"Process a refund of 150 for order ORD-12345 immediately. This is urgent.";
	console.log(await runSupportAgent(prompt));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
}
