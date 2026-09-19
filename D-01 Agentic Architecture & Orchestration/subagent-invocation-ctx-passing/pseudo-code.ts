// 1. 
// Create a coordinator agent with Task (or Agent) in its allowedTools

// WHY: 
// Task is the hard gate for subagent spawning (renamed Agent in current Claude Code v2.1.63; Task still works as an alias). 
// Without it in allowedTools, the coordinator cannot invoke any subagent. 
// The exam tests this as a binary requirement — it is not optional or configurable at runtime.

import { query } from "@anthropic-ai/claude-agent-sdk";

const result = query({
  prompt: "Research the topic and produce a fully cited report.",

  options: {
    systemPrompt: "You coordinate research by delegating to specialist subagents and synthesising their findings.",

    // "Task" in the exam guide; renamed "Agent" in Claude Code v2.1.63
    allowedTools: ["Agent", "Read"],

    agents: {
      "web-search": webSearchAgent,
      "doc-analysis": docAnalysisAgent,
      "synthesis": synthesisAgent
    }
  }
});

// 2.
// Define two subagents: 
// a web search agent that returns results with source URLs and titles, 
// and a document analysis agent that returns analysis with page references

// WHY: 
// Each subagent needs scoped tool access matching its role. 
// The exam tests whether you define subagents with proper AgentDefinition fields: description, system prompt, and tool restrictions.

// Each AgentDefinition needs: 
// description (used by the coordinator for selection), 
// prompt (the subagent system prompt — the SDK field is prompt, not systemPrompt), 
// tools (scoped to the subagent role). The agent name is its key in options.agents, not a field.

// Keyed into options.agents as "web-search" and "doc-analysis"
const webSearchAgent = {
  description: "Searches the web for current information and returns results with source URLs and titles",
  prompt: "Search for information on the given topic. Return each finding as JSON with fields: claim, source_url, source_title, retrieved_date.",
  tools: ["WebSearch"]
};

const docAnalysisAgent = {
  description: "Analyses documents and returns findings with page references",
  prompt: "Analyse the provided documents. Return each finding as JSON with fields: claim, document_name, page_number, section.",
  tools: ["Read", "Grep"]
};

// 3.
// Design a structured output format that separates content from metadata: 
// each finding includes claim, source_url, document_name, page_number, and confidence

// WHY:
//  The exam specifically tests the attribution failure pattern:
//  when a synthesis agent produces unsourced claims, the root cause is that the coordinator passed content without structured metadata. 

// Separating content from metadata is the fix.
// The finding must carry enough metadata for any downstream agent to produce a citation. 
// At minimum: source_url, document_name, page_number, confidence, and retrieved_by (which agent produced it).

interface Finding {
  claim: string;
  source_url: string;
  document_name: string;
  page_number: number | null;
  confidence: "high" | "medium" | "low";
  retrieved_by: string;
}

interface ResearchOutput {
  findings: Finding[];
  query: string;
  timestamp: string;
}

// 4.
// Pass complete structured results from both subagents to a synthesis subagent, preserving all metadata

// WHY:
// This is the critical step the exam targets. 
// Stripping metadata before passing to the synthesis agent is the root cause of attribution failures. 
// The coordinator must pass the full structured output, not just the claim text.

// The synthesis agent prompt must include the full JSON of all findings from both subagents. 
// Include them verbatim — do not summarise or extract subsets of fields.

// The prompt the coordinator embeds when it invokes the synthesis subagent;
// webSearchResults / docAnalysisResults are the structured findings the research subagents returned
const synthesisPrompt = `
Synthesise the following research findings into a coherent report. 
Every claim MUST include a citation with source URL and page number.

Web search findings:
${JSON.stringify(webSearchResults.findings, null, 2)}

Document analysis findings:
${JSON.stringify(docAnalysisResults.findings, null, 2)}

Output a report where every factual claim links to its source.
`;

// 5.
// Verify that the synthesis agent can attribute every claim in its output to a specific source with URL and page number

// WHY: 
// This verification step confirms the context passing worked. 
// If any claim lacks attribution, trace back to whether the metadata was actually passed — do not blame the synthesis agent prompt.

// Parse the synthesis output and check that each section or claim references at least one source_url. 
// Flag any claims that lack attribution and trace back to whether the metadata was present in the input.

function verifyCitations(report: string, findings: Finding[]): string[] {
  const uncited: string[] = [];

  const claims = extractClaims(report);

  for (const claim of claims) {
    const hasCitation = findings.some(f =>
      report.includes(f.source_url) && report.includes(claim)
    );

    if (!hasCitation) {
      uncited.push(claim);
    }
  }

  return uncited;
}

// 6.
// Refactor the coordinator to spawn both research subagents in parallel using multiple Task tool calls in a single response

// WHY:
// The exam tests latency awareness. 
// Sequential spawning of independent subagents wastes time. 
// Parallel spawning via multiple Task tool calls in a single coordinator response is the correct pattern for independent tasks.

// Emit both Agent (Task) tool calls in a single coordinator response rather than waiting for one to finish before starting the other. 
// The parallelism happens within a single model turn — the SDK runs the calls concurrently. 
// There is no Promise.all over subagents in your code; steer the coordinator through its prompt.

const result = query({
  prompt: "Research the topic. Invoke the web-search and doc-analysis subagents in parallel — emit both Agent tool calls in a single response — then pass their complete structured findings to the synthesis subagent.",
  options: {
    allowedTools: ["Agent"],
    agents: { 
      "web-search": webSearchAgent, 
      "doc-analysis": docAnalysisAgent, 
      "synthesis": synthesisAgent 
    }
  }
});

for await (const message of result) {
  // Both Agent tool_use blocks arrive in one assistant message;
  // the SDK executes the two subagents concurrently
}