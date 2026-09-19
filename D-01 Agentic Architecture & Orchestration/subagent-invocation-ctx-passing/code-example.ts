import { query } from "@anthropic-ai/claude-agent-sdk";

type Confidence = "high" | "medium" | "low";

interface Finding {
	claim: string;
	source_url: string;
	source_title: string;
	document_name: string;
	page_number: number | null;
	section: string | null;
	confidence: Confidence;
	retrieved_by: "web-search" | "doc-analysis";
}

interface CitedClaim {
	claim: string;
	source_url: string;
	page_number: number | null;
}

interface SynthesisOutput {
	report: string;
	citations: CitedClaim[];
	uncited_claims: string[];
}

const findingSchema = `
{
  "claim": "string",
  "source_url": "string",
  "source_title": "string",
  "document_name": "string",
  "page_number": "number | null",
  "section": "string | null",
  "confidence": "high | medium | low",
  "retrieved_by": "web-search | doc-analysis"
}`;

const webSearchAgent = {
	description:
		"Searches the web for current information and returns findings with source URLs and titles.",
	prompt: [
		"You are the web-search specialist.",
		"Research only the assigned question and return complete structured data.",
		"Do not communicate with other subagents and do not delegate work.",
		"Every finding must include a source_url, source_title, claim, confidence, and retrieved_by=web-search.",
		"Use page_number=null and document_name for the relevant web page.",
		"Return only valid JSON in this shape: { findings: Finding[], query: string, timestamp: string }.",
		`Finding shape: ${findingSchema}`
	].join("\n"),
	tools: ["WebSearch"]
};

const docAnalysisAgent = {
	description:
		"Analyses supplied documents and returns findings with document, page, and section references.",
	prompt: [
		"You are the document-analysis specialist.",
		"Analyse only the assigned documents and return complete structured data.",
		"Do not communicate with other subagents and do not delegate work.",
		"Every finding must preserve the document_name, page_number, section, claim, confidence, and retrieved_by=doc-analysis.",
		"Return only valid JSON in this shape: { findings: Finding[], query: string, timestamp: string }.",
		`Finding shape: ${findingSchema}`
	].join("\n"),
	tools: ["Read", "Grep"]
};

const synthesisAgent = {
	description:
		"Synthesises complete research outputs into a report with verifiable citations.",
	prompt: [
		"You are the synthesis specialist.",
		"Use only findings explicitly supplied by the coordinator.",
		"Never invent a source, URL, page number, or claim.",
		"Every factual claim in report must have a matching item in citations.",
		"Use page_number=null for web sources and include the source URL in every citation.",
		"Return only valid JSON: { report: string, citations: CitedClaim[], uncited_claims: string[] }.",
		"uncited_claims must be non-empty if any factual claim cannot be attributed."
	].join("\n"),
	tools: []
};

const coordinatorPrompt = `
You are the research coordinator.

Research question:
{{QUERY}}

You must complete this workflow:
1. Invoke web-search and doc-analysis as independent subagents.
2. Emit both Agent tool calls in the same assistant response so they run in parallel.
3. Wait for both complete structured outputs.
4. Invoke synthesis with the complete JSON output from both agents. Pass every field verbatim; do not flatten findings to claim strings or remove metadata.
5. Return the synthesis agent's JSON unchanged.

The subagents have isolated context. They cannot see this conversation, each other, or previous results unless you explicitly include the required data in their prompt.

Direct subagent-to-subagent communication is forbidden. All communication goes through this coordinator.
`;

function parseSynthesisResult(text: string): SynthesisOutput {
	const fencedJson = text.match(/```json\s*([\s\S]*?)\s*```/i)?.[1];

	const candidate = (fencedJson ?? text).match(/\{[\s\S]*\}/)?.[0];

	if (!candidate) {
		throw new Error("The coordinator did not return a JSON synthesis result");
	}

	const result = JSON.parse(candidate) as Partial<SynthesisOutput>;

	if (typeof result.report !== "string" || !Array.isArray(result.citations)) {
		throw new Error("Synthesis result is missing report or citations");
	}

	return {
		report: result.report,
		citations: result.citations,
		uncited_claims: result.uncited_claims ?? []
	};
}

function isSuccessfulResult(message: unknown): message is { type: "result"; result: string } {
	if (!message || typeof message !== "object") {
		return false;
	}

	const candidate = message as { type?: unknown; result?: unknown };

	return candidate.type === "result" && typeof candidate.result === "string";
}

async function runCoordinator(queryText: string): Promise<SynthesisOutput> {
	const stream = query({
		prompt: coordinatorPrompt.replace("{{QUERY}}", queryText),
        
		options: {
			systemPrompt:
				"Coordinate specialist agents, preserve structured provenance, and never fabricate citations.",

			allowedTools: ["Agent"],
            
			agents: {
				"web-search": webSearchAgent,
				"doc-analysis": docAnalysisAgent,
				"synthesis": synthesisAgent
			}
		}
	});

	for await (const message of stream) {
		if (isSuccessfulResult(message)) {
			const synthesis = parseSynthesisResult(message.result);

			if (synthesis.uncited_claims.length > 0) {
				throw new Error(
					`Citation verification failed for ${synthesis.uncited_claims.length} claim(s)`
				);
			}
            
			return synthesis;
		}
	}

	throw new Error("Coordinator finished without a successful result");
}

const topic = process.argv.slice(2).join(" ") || "the impact of multi-agent orchestration";

runCoordinator(topic)
	.then((result) => console.log(result.report))
	.catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
