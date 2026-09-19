// The coordinator needs a 
// system prompt
//  a list of available subagent definitions
//  and logic to process a topic through decomposition, delegation, and aggregation phases.
const coordinator = {
  systemPrompt: "You are a research coordinator. Decompose topics into comprehensive subtopics, delegate to specialist subagents, aggregate results, and identify coverage gaps.",

  subagents: [webSearchAgent, docAnalysisAgent],

  async research(topic: string) {
    const subtopics = await this.decompose(topic);
    // delegation and aggregation follow
  }
};


//==========================================================

//  Implement task decomposition logic that breaks the topic into at least 5 distinct subtopics covering the full breadth of the subject

// WHY: 
// Narrow decomposition is a specific exam failure pattern. 
// The coordinator that only assigns solar and wind for renewable energy misses entire categories. 
// The exam expects you to recognise that incomplete output traces back to the coordinator decomposition.

// Use a two-phase approach: 
// first generate broad categories, 
// then validate that no major area is missing. 

// The coordinator prompt should instruct the model to consider all major subcategories of the topic.
async decompose(topic: string): Promise < string[] > {
  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: `List ALL major subtopics for: ${topic}. Ensure comprehensive breadth — missing an entire category is a critical failure. Return as JSON array.`
    }]
  });

  return JSON.parse(response.content.find(b => b.type === "text").text);
}


//==========================================================


// Spawn two subagents (web search and document analysis) with explicit context passing — include all relevant information in each subagent prompt

// WHY: 
// Subagent isolation means no shared memory and no inherited context. 
// The exam heavily tests this: if a subagent produces poor results, check whether the coordinator gave it sufficient context, not whether the subagent itself is flawed.

// Remember: subagents start with a blank slate. What information do they need to do their job effectively?
// Each subagent prompt must include: 
// the specific subtopic assigned, 
// the broader research goal for context, 
// the expected output format, 
// and any prior findings relevant to its task. 

// Do not assume the subagent knows anything.
async delegateToSubagent(agent: AgentDefinition, subtopic: string, context: string) {
  return await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 2048,
    system: agent.systemPrompt,
    messages: [{
      role: "user",
      content: `Research subtopic: ${subtopic}\nBroader goal: ${context}\nReturn structured findings with source URLs and confidence levels.`
    }]
  });
}

//==========================================================

// Aggregate results from both subagents and evaluate coverage completeness

// WHY: 
// The coordinator must evaluate whether the combined results cover the full breadth of the original topic. 
// This is where iterative refinement starts — gaps detected here trigger re-delegation.

// What does the coordinator need to check? 
// Compare the subtopics assigned against the findings actually returned.
async evaluateCoverage(subtopics: string[], results: Finding[]): Promise < CoverageReport > {
  const covered = subtopics.filter(st =>
    results.some(r => r.subtopic === st && r.findings.length > 0)
  );

  const gaps = subtopics.filter(st => !covered.includes(st));

  return {
    covered,
    gaps,
    completeness: covered.length / subtopics.length
  };
}

//==========================================================

// Implement an iterative refinement loop: 
// if the coordinator identifies coverage gaps, re-delegate to subagents with targeted queries and re-invoke until coverage is sufficient

// WHY:
// Iterative refinement is a core coordinator responsibility the exam tests. 
// A single-shot delegation is not enough — the coordinator must evaluate output and re-delegate for gaps. 
// This distinguishes a coordinator from a simple dispatcher.

// What triggers another iteration? What stops the loop?
// The loop continues while coverage is below a threshold (e.g., 90%). 
// Each iteration targets only the gaps, not the already-covered subtopics. 
// A maximum iteration count prevents infinite loops.

let coverage = await this.evaluateCoverage(subtopics, allResults);
let iterations = 0;

while (coverage.completeness < 0.9 && iterations < 3) {
  for (const gap of coverage.gaps) {
    const newResults = await this.delegateToSubagent(webSearchAgent, gap, topic);
    allResults.push(...newResults);
  }
  coverage = await this.evaluateCoverage(subtopics, allResults);
  iterations++;
}

// Test with the topic renewable energy technologies and verify that the final output covers solar, wind, geothermal, tidal, biomass, and fusion

// WHY: 
// This specific test case maps to the exam narrow decomposition failure pattern. 
// If your output only covers solar and wind, the root cause is the coordinator decomposition — the exact diagnostic the exam expects you to make.

// Run your coordinator and check the output. 
// If categories are missing, where in the pipeline did it go wrong?

// If the output is missing categories, trace back: did the decomposition include them? 
// If not, fix the decomposition. 
// If it did, did the subagents receive the assignment? 
// Check the context passing.

const report = await coordinator.research("renewable energy technologies");

const required = ["solar", "wind", "geothermal", "tidal", "biomass", "fusion"];

const missing = required.filter(cat =>
  !report.sections.some(s => s.topic.toLowerCase().includes(cat))
);

console.log(missing.length === 0 ? "Full coverage" : `Missing: ${missing.join(", ")}`);
