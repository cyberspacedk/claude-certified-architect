import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const MAX_ITERATIONS = 20;

const tools = [
  {
    name: "calculator",
    description: "Evaluates a mathematical expression and returns the numeric result",
    input_schema: {
      type: "object" as const,
      properties: { expression: { type: "string", description: "The mathematical expression to evaluate" } },
      required: ["expression"]
    }
  },
  {
    name: "web_search",
    description: "Searches the web and returns relevant results",
    input_schema: {
      type: "object" as const,
      properties: { query: { type: "string", description: "The search query" } },
      required: ["query"]
    }
  }
];

function executeTool(name: string, input: Record<string, string>): string {
  if (name === "calculator") {
    try {
      return String(eval(input.expression));
    } catch {
      return "Error: invalid expression";
    }
  }

  if (name === "web_search") {
    return JSON.stringify({
      results: [{
        title: "Mock result",
        snippet: "Bitcoin price: $65,000 USD"
      }]
    });
  }

  return "Unknown tool";
}

async function runAgentLoop(userPrompt: string): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ 
    role: "user", content: userPrompt 
  }];

  let iterations = 0;

  while (true) {
    if (iterations >= MAX_ITERATIONS) {
      console.warn("Safety iteration cap reached");
      break;
    }

    iterations++;

    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      tools,
      messages
    });

    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find(b => b.type === "text");
      return textBlock?.text ?? "";
    }

    // stop_reason is "tool_use" — execute tools and continue
    messages.push({ 
      role: "assistant", 
      content: response.content 
    });

    const toolUseBlocks = response.content.filter(b => b.type === "tool_use");

    const toolResults = toolUseBlocks.map(block => ({
      type: "tool_result" as const,
      tool_use_id: block.id,
      content: executeTool(block.name, block.input as Record<string, string>)
    }));

    messages.push({ 
      role: "user", 
      content: toolResults 
    });
  }
  
  return "Agent terminated by safety cap";
}
