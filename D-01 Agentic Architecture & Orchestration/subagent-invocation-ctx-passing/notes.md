# Subagent Invocation and Context Passing

Task Statement is about the mechanics of how a coordinator actually invokes subagents and passes information between them.

## The Task Tool 

The `Task tool` is how a coordinator spawns subagents (the exam guide v0.2 uses this name). 
It's the actual API mechanism that makes multi-agent orchestration work in the Claude Agent SDK, not a naming convention you can skip past. 
Current Claude Code (v2.1.63, February 2026) renamed it to `Agent`; the name `Task` still works as an alias, and the `Agent SDK` emits `Agent` in tool-use blocks. 
> Answer "Task tool" on the exam, and expect to see "Agent" in current code.

There is a **critical configuration requirement**: **the coordinator's** `allowedTools` must include "Task" (or "Agent", its current name in Claude Code).
Without it, the coordinator physically can't spawn subagents. 
It's a binary gate, not a soft preference. 
If neither `Task` nor `Agent` is in `allowedTools`, the **coordinator has no way to invoke subagents at all**.

The exam guide (v1.0) states the rule exactly as above, and that is the keyed answer. 
The current `Agent SDK` docs (September 2026) describe `allowedTools` as an auto-approve list: leaving `Agent` off it does not remove the tool, it sends every spawn through the permission callback, which denies it in an unattended run. 
Same outcome on the exam, different mechanism in production.

Each subagent is defined by an AgentDefinition that specifies three things:

1. **Description** — what the subagent does (used by the coordinator to decide when to invoke it).
2. **System prompt** — the instructions the subagent follows.
3. **Tool restrictions** — which tools the subagent can access (scoped to its role). 

## KEY CONCEPT

The coordinator's `allowedTools` must include "Task" (or "Agent", its current name) to spawn subagents. 
This is a hard requirement. Without it, the coordinator cannot invoke any subagent regardless of how they are defined.

## Context Passing: The Make-or-Break Detail

Context passing is where most multi-agent systems fall over. 
The principle carries straight across: **subagents have isolated context**. 
They **get only what the coordinator writes into their prompt**. Nothing else.

### There are three rules for effective context passing:

1. **Include complete findings from prior agents**. 
If the synthesis subagent needs web search results and document analysis output, the coordinator must pass both — in full — in the synthesis subagent's prompt. 
Do not assume the synthesis agent can "look up" prior results. It cannot.

2. **Use structured data formats that separate content from metadata**. 
When passing research findings between agents, the data must include both the content (the claim, the fact, the analysis) and the metadata (source URL, document name, page number). 
If you pass content without metadata, the downstream agent cannot attribute claims to sources.

This is a specific exam pattern: a synthesis agent produces a report with unsourced claims. 
The web search and document analysis subagents are working correctly. 
*The root cause is that the coordinator passed content without structured metadata* — the synthesis agent literally had no source information to include.

3. **Design coordinator prompts that specify goals, not procedures**. 
The **coordinator prompt should tell subagents what to achieve and what quality criteria to meet, not step-by-step instructions** for how to do it. 
**Goal-oriented prompts enable subagent adaptability**. 
**Procedural instructions constrain subagents** and prevent them from adjusting their approach when they encounter unexpected situations.

## Structured Metadata Format

The structured data format for inter-agent context passing should separate content from metadata cleanly. 
A practical format looks like this:

```json
{
  "findings": [
    {
      "claim": "Solar panel efficiency has increased 25% in the last decade",
      "source_url": "https://example.com/solar-report",
      "document_name": "Annual Solar Industry Report 2024",
      "page_number": 14,
      "confidence": "high",
      "retrieved_by": "web_search_agent"
    }
  ]
}
```

**Each finding carries its source attribution as metadata**. 
When the synthesis agent receives this structured data, it has everything it needs to produce a properly cited report.

## Parallel vs Sequential Spawning. 

When a coordinator needs to invoke multiple subagents for independent tasks, it should emit multiple `Task` tool calls **in a single response rather than invoking them one at a time across separate turns**.

Sequential spawning — one subagent per coordinator turn — **adds latency for nothing**. 
If the web search agent and document analysis agent work independently, there's no reason to make one wait for the other.

The exam tests latency awareness. 
When presented **with independent subagent tasks**, **the correct answer involves parallel spawning**. 
Look for answer options that mention "in a single response" or "simultaneously" — these signal the parallel pattern.

## KEY CONCEPT 

Spawn independent subagents in parallel by emitting multiple `Task` tool calls in a single coordinator response. 
This reduces latency compared to sequential invocation across separate turns.

## fork_session. 

`fork_session` **creates independent branches** from a shared analysis baseline. 
After a coordinator has completed an initial analysis (reading a codebase, understanding a problem), it can fork the session to explore divergent approaches.

**Example**: after analysing a codebase, the coordinator forks to compare two testing strategies. Each fork operates independently after the branching point — they do not see each other's results, and changes in one fork do not affect the other.

Both are Claude Code session controls. --resume is a CLI flag, with a matching resume option in the Agent SDK; `fork_session` is the SDK option (forkSession in TypeScript) and is also on the CLI as --fork-session next to --resume.

`fork_session` is not the same as --resume. Resume continues a specific named session. Fork creates a new independent branch. 
The exam tests this distinction. 
**Use fork when you need divergent exploration** from a shared starting point. 
**Use resume when you want to continue the same line of investigation**.

> Exam guide v1.0 lists --resume and fork_session as two session controls, and that is how the exam frames them. In the Agent SDK (sessions guide, checked September 2026) fork is a modifier on resume, not an alternative to it. You pass both: ClaudeAgentOptions(resume=session_id, fork_session=True). resume names the session to start from, and fork_session says branch off it instead of appending to it. Leave fork_session off and the same call appends to the original. The CLI pairs them the same way: --fork-session only does anything alongside --resume or --continue. So the distinction the exam tests is append versus branch, not one flag versus the other. 

> On the exam, answer as the guide frames it: resume to continue a session, fork to branch from it.

## Practical Example: Attribution Failure

A multi-agent research system has three agents: 
1. `web search`
2. `document analysis`
3. `synthesis`

The `web search` agent returns well-sourced results with URLs and titles. 
The `document analysis` agent returns detailed analysis with page references.

The `coordinator` passes the content from both agents to the `synthesis` agent but strips the metadata — it sends the claims and analysis text without source URLs, document names, or page numbers. 
The `synthesis` agent produces an excellent summary with no source attribution.

The fix is not to modify the synthesis agent's prompt (it cannot cite sources it does not have). 
**The fix is to require the coordinator to pass structured metadata alongside content**, preserving the source URL, document name, and page number for every finding.

## Exam Traps

1. Assuming subagents automatically have access to the coordinator's conversation history or other subagents' outputs.  
Subagents have **isolated context**. Every piece of information they need must be **explicitly included in their prompt by the coordinator**. There is **no automatic context inheritance**.

2. Blaming the synthesis agent for missing citations when the real issue is context passing without metadata.  
The synthesis agent can only cite sources it has been given. If the coordinator passes content without source URLs and document names, the synthesis agent literally cannot produce citations.

3. Proposing sequential subagent invocation for tasks that can run independently. 
Sequential invocation introduces **unnecessary latency**. Independent tasks should be spawned in parallel using multiple Task tool calls in a **single coordinator response**.

4. Confusing `fork_session` with `--resume`.  
fork_session branches: it **starts a new session from a copy of the original's history**. 
--resume appends: it **continues the same session**. 
In the SDK the fork flag is set beside resume, so the choice is append or branch, not two different commands. 
Fork to compare approaches, resume to carry on with the same work.