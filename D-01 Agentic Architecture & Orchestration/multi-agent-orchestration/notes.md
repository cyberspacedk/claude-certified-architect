# Multi-Agent Orchestration 

Multi-agent orchestration is how you get several Claude agents working together on one complex task.

The exam isn't loose about the shape this takes. 
It tests one pattern: hub-and-spoke, with a coordinator at the centre.

## Hub-and-Spoke Architecture 

The architecture has two roles:

1. **Coordinator agent**: sits at the centre. 
    - Receives the initial task   
    - decomposes it  
    - decides which subagents to invoke  
    - passes context to them  
    - aggregates their results  
    - handles errors  
    - handles routes information between them  

2. **Subagents**: the spokes. 
    - each one handles a specialised task (web search, document analysis, synthesis, report generation)  
    - they receive instructions from the coordinator and return results to it  

The cardinal rule: **ALL communication flows through the coordinator**.

**Subagents never communicate directly with each other**. 
**Never. Not for efficiency, not for convenience, not for any reason**. 
**Every piece of information that moves between subagents passes through the coordinator**.

This strict **hub-and-spoke** model is what the exam tests. 
In current Claude Code a sub-agent can itself spawn sub-agents (nested parent-child delegation), so the "never, for any reason" absolute is an exam simplification rather than a hard product limit. 
On the exam, **treat direct subagent-to-subagent communication as the wrong answer**.

## This centralisation provides three things the exam cares about:

1. **Observability** — you can log and monitor every message in one place.  
2. **Consistent error handling** — the coordinator applies uniform error recovery policies.  
3. **Controlled information flow** — the coordinator decides what context each subagent receives.  

## KEY CONCEPT

All inter-subagent communication flows through the coordinator. 
Subagents never communicate directly with each other. 
This is the foundational architectural constraint of hub-and-spoke orchestration.

## The Critical Isolation Principle 

This is the single most misunderstood idea in multi-agent systems, and **the exam leans on that confusion hard**.

### Subagents do NOT automatically inherit the coordinator's conversation history.
When the coordinator spawns a subagent, that **subagent starts with only what the coordinator explicitly includes in its prompt**. 

It has no access to:

- The **coordinator's system prompt** (unless explicitly included)  
- **Previous messages in the coordinator's conversation**  
- **Results from other subagents (unless the coordinator passes them)**
- Any **"shared memory" or global state**

### Subagents do NOT share memory between invocations. 
If the coordinator calls the web search subagent twice, the second invocation has no knowledge of the first. 
**Every invocation is independent**.

So the coordinator has to be deliberate about context. 
Every piece of information a subagent needs goes in its prompt, explicitly. 
If the synthesis agent needs web search results, the coordinator passes those results — the synthesis agent can't "look them up" from a shared store. There's no shared store.

## Coordinator Responsibilities

The coordinator has **four** key responsibilities that the exam tests:  

1. **Dynamic subagent selection**. 
The coordinator analyses query requirements and dynamically selects which subagents to invoke. 
It does NOT always route through the full pipeline. 
A simple factual question might only need the web search subagent, not the full research-analysis-synthesis chain. 
Routing every query through every subagent wastes time and resources.

2. **Research scope partitioning**. 
When delegating to multiple subagents, the coordinator partitions the research scope to minimise duplication. 
It assigns distinct subtopics or source types to each agent. 
For example, one agent searches academic papers while another searches news articles — they do not both search the same sources.

3. **Iterative refinement loops**. 
The coordinator evaluates synthesis output for gaps. 
If the synthesis is incomplete, it re-delegates to search and analysis subagents with targeted queries. 
It re-invokes synthesis until coverage is sufficient. 
This is not a single-shot process — it is an iterative cycle.

4. **Centralised communication routing**. 
All subagent communication routes through the coordinator for observability, consistent error handling, and controlled information flow.


## The Narrow Decomposition Failure  

This is a specific exam pattern you must recognise. 
The exam guide's sample set includes a question where a coordinator decomposes "impact of AI on creative industries" into only visual arts subtopics, missing music, writing, and film entirely.

The root cause is the coordinator's task decomposition, not any downstream agent. 
The web search agent searched thoroughly for what it was assigned. 
The synthesis agent synthesised everything it received. 
But the coordinator only assigned visual arts topics, so music, writing, and film were never researched.

The exam expects you to **trace failures to their origin**. 
When a multi-agent system produces a report that misses entire categories, **do not blame the subagents — check the coordinator's decomposition**.

This pattern applies broadly: **if the output is incomplete in scope (not depth), the coordinator's decomposition is almost always the root cause.**

## Practical Example: Research System Coverage Gap

A multi-agent research system is tasked with "renewable energy technologies." 
The coordinator **decomposes this into "solar panel efficiency" and "wind turbine design"**
Each subagent produces thorough, well-sourced research on its assigned topic.

The final report is comprehensive on **solar** and **wind** but says nothing about **geothermal, tidal, biomass, or nuclear fusion**. 
The coverage gap is not because the search was poor or the synthesis was weak — **it is because the coordinator never assigned those subtopics**.

The fix is not better search queries, not a more capable synthesis agent, and not more subagents. 
**The fix is better coordinator decomposition** that covers the full breadth of the topic.


## Exam Traps

1. When a multi-agent system produces incomplete or incorrect output, **the exam expects you to trace the failure to its origin**. 
Do not blame the subagent that produced the output — check whether the coordinator gave it the right input.

2. Blaming downstream subagents for coverage gaps when the coordinator's task decomposition was too narrow.
Subagents **research what they are assigned**. If the coordinator only assigns solar and wind as subtopics for renewable energy, no subagent can cover geothermal or tidal. 
**Trace failures to their origin — the coordinator's decomposition**.

3. Assuming subagents share memory or inherit the coordinator's conversation history
Subagents have completely **isolated context**. 
They **do not automatically inherit anything** from the coordinator. 
Every piece of information **must be explicitly passed in the subagent's prompt**.

4. Proposing direct inter-subagent communication as an efficiency improvement
**Direct communication breaks** observability, consistent error handling, and controlled information flow. 
**All communication must flow through the coordinator**, regardless of perceived efficiency gains.

5. Adding more subagents to fix a decomposition problem
If the coordinator decomposes a topic too narrowly, **adding more subagents does not help** — they will receive equally narrow assignments. 
The fix is **improving the coordinator's decomposition** logic.