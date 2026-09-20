// 1.
// Create a code review agent that accepts a directory path containing at least 10 source files

// WHY:
// The 10+ file threshold is where attention dilution becomes observable. 
// The exam uses a 14-file example where detailed feedback for early files degrades to superficial analysis for later files. 
// Your setup must replicate this scale.

// Create or use a directory with 10-15 source files that contain a mix of good code, bugs, and repeated patterns. 
// Include at least one bug pattern that appears in multiple files.

import fs from "fs";
import path from "path";

async function loadCodebase(dirPath: string): Promise<Map<string, string>> {
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith(".ts") || f.endsWith(".js"));

  const codebase = new Map<string, string>();

  for (const file of files) {
    codebase.set(file, fs.readFileSync(path.join(dirPath, file), "utf-8"));
  }

  console.log(`Loaded ${codebase.size} files for review`);

  return codebase;
}

// 2. 
// Implement a single-pass review that processes all files at once and record the results

// WHY:
// The single-pass approach is the baseline that demonstrates attention dilution. 
// The exam expects you to recognise the symptoms: thorough analysis for early files, shallow analysis for later files, and contradictory pattern evaluation.

// Concatenate all file contents into a single prompt and ask for a code review. 
// Record the number of issues found per file and the level of detail for each.

async function singlePassReview(codebase: Map<string, string>): Promise<ReviewResult[]> {
  const allCode = Array.from(codebase.entries())
    .map(([name, content]) => `=== ${name} ===\n${content}`)
    .join("\n\n");

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4096,
    messages: [{
      role: "user",
      content: `Review all files for bugs, style issues, and security vulnerabilities. Provide specific line references for each issue.\n\n${allCode}`
    }]
  });

  return parseReviewResults(response.content.find(b => b.type === "text").text);
}

// 3.
// Implement per-file local analysis passes that produce structured feedback 
// for each file individually (bug count, severity, specific line references)

// WHY:
// Per-file passes give each file the full attention budget. 
// This is the first layer of multi-pass architecture. 
// The exam contrasts this with single-pass to show 
// that structural decomposition solves attention dilution, not better prompts or larger context windows.

interface FileReview {
  fileName: string;
  issues: {
    line: number;
    severity: string;
    description: string
  }[];
  bugCount: number;
}

async function perFileReview(codebase: Map<string, string>): Promise<FileReview[]> {
  const reviews: FileReview[] = [];

  for (const [name, content] of codebase) {
    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: `Review this file for bugs, style issues, and security vulnerabilities. Return JSON with issues array (line, severity, description).\n\n=== ${name} ===\n${content}`
      }]
    });

    reviews.push(JSON.parse(response.content.find(b => b.type === "text").text));
  }

  return reviews;
}

// 4.
// Implement a cross-file integration pass that checks for data flow issues, API consistency, and pattern usage consistency across all files

// WHY:
// Per-file passes catch local issues but miss cross-cutting concerns. 
// The exam tests whether you include a cross-file integration pass — batching without it still misses data flow issues and pattern inconsistencies across files.

// Feed the per-file review summaries 
// plus file structure information into a dedicated cross-file prompt.
// Ask specifically about data flow, import chains, API consistency, and contradictory pattern usage.

async function crossFilePass(codebase: Map<string, string>, perFileResults: FileReview[]): Promise<CrossFileIssue[]> {
  const summary = perFileResults.map(r =>
    `${r.fileName}: ${r.bugCount} issues - ${r.issues.map(i => i.description).join("; ")}`
  ).join("\n");

  const imports = extractImportGraph(codebase);

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 2048,
    messages: [{
      role: "user",
      content: `Cross-file integration review. Check for:\n1. Data flow issues between modules\n2. Inconsistent API usage across files\n3. Same pattern handled differently in different files\n\nPer-file summaries:\n${summary}\n\nImport graph:\n${JSON.stringify(imports)}`
    }]
  });
  return JSON.parse(response.content.find(b => b.type === "text").text);
}

// 5. 
// Compare results: 
// document which issues the single-pass review caught
// versus the multi-pass approach, paying special attention to consistency of analysis depth across all files

// WHY: 
// This comparison demonstrates the exam argument quantitatively. 
// Attention dilution is not a model capability problem — it is an architectural problem. 
// The same model produces better results with multi-pass architecture, proving the fix is structural.

// For each file, compare the number of issues found in single-pass vs per-file pass. 
// Calculate the standard deviation of issues per file for each approach — lower deviation means more consistent analysis.

function compareResults(singlePass: ReviewResult[], multiPass: FileReview[]) {
  console.log("=== Consistency Comparison ===");

  for (let i = 0; i < multiPass.length; i++) {
    const sp = singlePass.find(r => r.fileName === multiPass[i].fileName);
    console.log(`${multiPass[i].fileName}: single-pass=${sp?.issues.length ?? 0}, multi-pass=${multiPass[i].bugCount}`);
  }

  const spCounts = singlePass.map(r => r.issues.length);
  const mpCounts = multiPass.map(r => r.bugCount);

  console.log(`Single-pass std dev: ${stdDev(spCounts).toFixed(2)}`);
  console.log(`Multi-pass std dev: ${stdDev(mpCounts).toFixed(2)}`);
}

// 6. 
// Record any cases where the single-pass review flagged a pattern in one file but approved identical code in another — these are attention dilution artefacts

// WHY:
// Contradictory pattern evaluation is the clearest symptom of attention dilution. 
// The exam uses the forEach example: flagged as inefficient in File 3, approved without comment in File 11.
// Documenting these artefacts proves the structural nature of the problem.

// Compare the single-pass findings for files that contain the same patterns. 
// Look for cases where a pattern was flagged in an early file but ignored in a later file.

function findContradictions(results: ReviewResult[], codebase: Map<string, string>): string[] {
  const contradictions: string[] = [];

  const patternFiles = findDuplicatePatterns(codebase);

  for (const [pattern, files] of patternFiles) {
    const flagged = files.filter(f =>
      results.find(r => r.fileName === f)?.issues.some(i => i.description.includes(pattern))
    );

    const notFlagged = files.filter(f => !flagged.includes(f));

    if (flagged.length > 0 && notFlagged.length > 0) {
      contradictions.push(
        `Pattern "${pattern}" flagged in [${flagged.join(", ")}] but approved in [${notFlagged.join(", ")}]`
      );
    }
  }

  return contradictions;
}