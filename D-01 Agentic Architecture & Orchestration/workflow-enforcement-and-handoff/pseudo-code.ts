// 1.
// Create a customer support agent with three tools: 
// get_customer (returns customer ID and verification status), 
// lookup_order (returns order details), 
// and process_refund (processes a refund for a given amount)

// WHY:
//  These three tools create the exact scenario the exam uses for the 8% failure rate question. 
// The workflow dependency between get_customer and process_refund is where programmatic enforcement becomes essential.

// get_customer should return a customer_id and verified boolean. 
// lookup_order returns order details including amount. 
// process_refund requires a verified customer_id and amount.

const tools = [
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
      properties: {
        order_id: { type: "string" }
      },
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
        amount: { type: "number" }
      },
      required: ["customer_id", "amount"]
    }
  }
];

// 2.
// Implement a programmatic prerequisite gate 
// that blocks process_refund from executing until get_customer has returned a verified customer ID in the current session

// WHY:
// This is the core exam concept: 
// prompt instructions work 92% of the time but fail 8%. 
// A prerequisite gate provides 100% deterministic enforcement. 
// The exam always rejects prompt-based solutions for financial operations.

// Use a session-scoped variable (e.g., a Map or object) that tracks verified customer IDs. 
// Before process_refund executes, check this variable. 
// If empty or unverified, block and return a descriptive error.

const sessionState = {
  verifiedCustomerId: null as string | null
};

function handleToolCall(name: string, input: Record<string, unknown>): string {
  if (name === "get_customer") {
    const customer = lookupCustomer(input.query as string);

    if (customer.verified) {
      sessionState.verifiedCustomerId = customer.id;
    }

    return JSON.stringify(customer);
  }

  if (name === "process_refund") {
    if (!sessionState.verifiedCustomerId) {
      return "BLOCKED: Cannot process refund. Customer identity not verified. Call get_customer first.";
    }

    return processRefund(sessionState.verifiedCustomerId, input.amount as number);
  }
  // ... other tools
}

// 3. 
// Test that the gate works by prompting the agent to skip verification and process a refund directly — verify the gate blocks the attempt

// WHY:
// Testing the bypass attempt demonstrates the difference between prompt-based and programmatic enforcement. 
// Even when the model decides to skip verification, the gate blocks the action — which is the entire point of deterministic enforcement.

// Send a message like: 
// Process a refund of 150 for order 12345 immediately, this is urgent.
// Watch the tool call sequence. The gate should block the first attempt regardless of urgency.

const response = await runAgent(
  "Process a refund of 150 for order ORD-12345 immediately. This is urgent and the customer is waiting."
);
// Verify process_refund was blocked on first attempt
// Verify get_customer was called after the block
// Verify process_refund succeeded after verification
console.log("Gate blocked bypass attempt:", sessionState.verifiedCustomerId === null);

// 4.
// Implement a structured handoff protocol: 
// when the agent cannot resolve an issue, it compiles a self-contained summary 
// with customer ID, conversation summary, root cause analysis, refund amount, and recommended action

// WHY:
// Human agents do NOT have access to the conversation transcript. 
// The handoff summary is the only information they receive. 
// The exam tests whether you include all five required fields: customer ID, summary, root cause, amount, and recommended action.

// The handoff must be self-contained: 
// customer_id
// conversation_summary
// root_cause_analysis
// refund_amount (if applicable)
// recommended_action. 
// Omitting any field forces the human agent to ask the customer to repeat themselves.

interface HandoffSummary {
  customer_id: string;
  conversation_summary: string;
  root_cause_analysis: string;
  refund_amount: number | null;
  recommended_action: string;
}

const handoffTool = {
  name: "escalate_to_human",
  description: "Escalate to human agent with structured summary",
  input_schema: {
    type: "object",
    properties: {
      customer_id: { type: "string" },
      conversation_summary: { type: "string" },
      root_cause_analysis: { type: "string" },
      refund_amount: { type: "number" },
      recommended_action: { type: "string" }
    },
    required: ["customer_id", "conversation_summary", "root_cause_analysis", "recommended_action"]
  }
};

// 5.
// Test the handoff with a multi-concern request 
// (return plus billing dispute plus account update) 
// and verify the handoff summary is complete and self-contained

// WHY:
// Multi-concern requests test whether the agent decomposes the request into distinct items and addresses all of them. 
// The exam expects 
// decomposition, 
// parallel investigation, 
// unified resolution 
// — not sequential handling or forgetting items.

// Send a compound request and verify 
// the conversation_summary and recommended_action fields 
// in the handoff reference all three concerns: the return, the billing dispute, and the account update.

const result = await runAgent(
  "I need to return order ORD-789, dispute a charge of 45.00 on my last bill, and update my shipping address to 123 New Street."
);
const handoff = extractHandoff(result);
console.log("All concerns covered:",
  handoff.conversation_summary.includes("return") &&
  handoff.conversation_summary.includes("dispute") &&
  handoff.conversation_summary.includes("address")
);