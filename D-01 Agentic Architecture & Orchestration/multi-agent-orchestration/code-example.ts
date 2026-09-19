import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const MODEL = "claude-sonnet-5";
const MAX_REFINEMENT_ITERATIONS = 3;
const COVERAGE_THRESHOLD = 0.9;

type AgentDefinition = {
	name: string;
	systemPrompt: string;
};

type Finding = {
	subtopic: string;
	agent: string;
	findings: string[];
	sources: string[];
	confidence: "low" | "medium" | "high";
};

type CoverageReport = {
	covered: string[];
	gaps: string[];
	completeness: number;
};

type ResearchReport = {
	topic: string;
	subtopics: string[];
	findings: Finding[];
	coverage: CoverageReport;
};

const webSearchAgent: AgentDefinition = {
	name: "web-search",
	systemPrompt:
		"You are a web research specialist. Research only the assigned subtopic and return concise, factual findings."
};

const docAnalysisAgent: AgentDefinition = {
	name: "document-analysis",
	systemPrompt:
		"You are a document analysis specialist. Analyse the assigned subtopic using authoritative sources and return structured findings."
};

function textFromResponse(response: Anthropic.Message): string {
	const textBlock = response.content.find((block) => block.type === "text");
	if (!textBlock || textBlock.type !== "text") {
		throw new Error("Claude returned no text content");
	}
	return textBlock.text;
}

function parseJson<T>(text: string): T {
	const json = text.match(/[\[{][\s\S]*[\]}]/)?.[0];
	if (!json) {
		throw new Error(`Expected JSON, received: ${text}`);
	}
	return JSON.parse(json) as T;
}

function normaliseFinding(
	subtopic: string,
	agent: AgentDefinition,
	value: Partial<Finding>
): Finding {
	return {
		subtopic,
		agent: agent.name,
		findings: value.findings ?? [],
		sources: value.sources ?? [],
		confidence: value.confidence ?? "medium"
	};
}

const coordinator = {
	systemPrompt:
		"You are a research coordinator. Decompose topics broadly, delegate to specialist subagents, aggregate results, and identify coverage gaps.",

	subagents: [webSearchAgent, docAnalysisAgent],

	async decompose(topic: string): Promise<string[]> {
		const response = await client.messages.create({
			model: MODEL,
			max_tokens: 1024,
			system: this.systemPrompt,
			messages: [{
				role: "user",
				content: `List all major subtopics for: ${topic}. Include at least 5 distinct categories and do not omit an entire technology family. Return only a JSON array of strings.`
			}]
		});

		const subtopics = parseJson<string[]>(textFromResponse(response));

		if (subtopics.length < 5) {
			throw new Error("Decomposition must contain at least five subtopics");
		}
    
		return [...new Set(subtopics)];
	},

	async delegateToSubagent(
		agent: AgentDefinition,
		topic: string,
		subtopic: string,
		priorFindings: Finding[]
	): Promise<Finding> {
		const response = await client.messages.create({
			model: MODEL,
			max_tokens: 2048,
			system: agent.systemPrompt,
			messages: [{
				role: "user",
				content: [
					`Assigned subtopic: ${subtopic}`,
					`Broader research goal: ${topic}`,
					`Prior findings supplied by the coordinator: ${JSON.stringify(priorFindings)}`,
					"Return only JSON with this shape: { findings: string[], sources: string[], confidence: \"low\" | \"medium\" | \"high\" }."
				].join("\n")
			}]
		});

		return normaliseFinding(
			subtopic,
			agent,
			parseJson<Partial<Finding>>(textFromResponse(response))
		);
	},

	evaluateCoverage(subtopics: string[], findings: Finding[]): CoverageReport {
		const covered = subtopics.filter((subtopic) =>
			findings.some(
				(finding) =>
					finding.subtopic === subtopic && finding.findings.length > 0
			)
		);
		const gaps = subtopics.filter((subtopic) => !covered.includes(subtopic));

		return {
			covered,
			gaps,
			completeness: subtopics.length === 0 ? 1 : covered.length / subtopics.length
		};
	},

	async research(topic: string): Promise<ResearchReport> {
		const subtopics = await this.decompose(topic);
		let findings: Finding[] = [];

		for (const subtopic of subtopics) {
			// Both agents receive context from the coordinator; they never call one another.
			const results = await Promise.all(
				this.subagents.map((agent) =>
					this.delegateToSubagent(agent, topic, subtopic, findings)
				)
			);
			findings.push(...results);
		}

		let coverage = this.evaluateCoverage(subtopics, findings);
		let iterations = 0;

		while (
			coverage.completeness < COVERAGE_THRESHOLD &&
			iterations < MAX_REFINEMENT_ITERATIONS
		) {
			const retryResults = await Promise.all(
				coverage.gaps.map((gap) =>
					this.delegateToSubagent(webSearchAgent, topic, gap, findings)
				)
			);
			findings.push(...retryResults);
			coverage = this.evaluateCoverage(subtopics, findings);
			iterations++;
		}

		return { topic, subtopics, findings, coverage };
	}
};

async function main(): Promise<void> {
	const topic = "renewable energy technologies";
	const report = await coordinator.research(topic);
	const required = ["solar", "wind", "geothermal", "tidal", "biomass", "fusion"];
	const coveredText = report.findings.map((finding) => finding.subtopic.toLowerCase());
	const missing = required.filter((category) =>
		!coveredText.some((subtopic) => subtopic.includes(category))
	);

	console.log(JSON.stringify(report, null, 2));
	console.log(missing.length === 0 ? "Full coverage" : `Missing: ${missing.join(", ")}`);
}

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
