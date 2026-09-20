# Agent SDK Hooks

Agent SDK hooks inject deterministic behaviour into an otherwise probabilistic system. 
They sit right at the boundary between the model's decisions and the real world, intercepting tool calls and results to enforce business rules and normalise data.

## Two Types of Hooks

The Agent SDK provides hooks at two points in the tool execution lifecycle:

1. `PreToolUse` hooks **run before a tool executes**. 
They **intercept** the outgoing tool call and **can block it**, **modify** it, or **redirect** it to an alternative workflow. 
The tool never runs if the hook decides to block it.

2. `PostToolUse` hooks **run after a tool executes but before the model processes the result**.
They **intercept tool results** and transform them before the model sees them. 
The model receives clean, normalised data regardless of which tool produced it.

### What each hook returns

`PreToolUse` hook answers with a **permissionDecision** of:
- **allow**
- **deny** 
- **ask** 
- **defer**
- optional **updatedInput** that rewrites the tool's arguments before it runs. 

`PostToolUse` hook can set **updatedToolOutput** to replace what the model sees, for built-in and MCP tools alike. 
The older **updatedMCPToolOutput** covered MCP tools only and is deprecated. 

> One thing neither field changes: by the time `PostToolUse` **fires the tool has already run**, so blocking there stops the loop but does not undo the side effect.

## KEY CONCEPT 

`PreToolUse` hooks **enforce policy before execution**.
`PostToolUse` hooks **transform data after execution**.

## PreToolUse Hooks: Policy Enforcement

`PreToolUse` hooks are the implementation mechanism for the prerequisite gates described in 1.4. 

They intercept outgoing tool calls before execution and apply business rules:

**Use case**: Refund threshold enforcement. 
A hook intercepts all calls to `process_refund`. 
If the refund amount exceeds *$500*, the hook blocks the call and redirects to a human escalation workflow. 
The refund tool never executes — the hook prevents it before it can run.

**Use case**: Compliance prerequisite gates. 
A hook intercepts calls to `transfer_funds`. 
If the required anti-money laundering (AML) check has not been completed for this session, the hook blocks the call and returns an error message directing the agent to complete the AML check first.

**Use case**: Manager approval workflow. 
A hook intercepts calls to `approve_discount` for discounts above 20%. 
The hook pauses execution and routes the request to a manager approval queue. 
Only after manager approval does the tool execute.


## PostToolUse Hooks: Data Normalisation

Different MCP tools return data in different formats. 
A customer database might return Unix timestamps (1710489600). 
An order management system might return `ISO 8601` dates ("2024-03-15T12:00:00Z"). 
A status API might return numeric codes (`200`, `404`, `500`) while another returns strings ("active", "cancelled", "pending").

Without normalisation, the model has to interpret these mixed formats on every single iteration. 
That breeds inconsistency. 
It might parse a Unix timestamp correctly one time and misread it the next.

A `PostToolUse` hook solves this by **normalising all formats before the model processes** them:

- `Unix` timestamps → `ISO 8601` dates. 
- Numeric status codes → human-readable strings. 
- Currency values → consistent decimal format with currency code. 
- Date strings in various regional formats → a single standard format. 

> The model receives clean, consistent data every time, regardless of which tool or backend system produced it.

## The Decision Framework

This framework is the core mental model for the exam:

### Requirement: 

- **Must be followed 100% of the time** = `Hooks` = `Deterministic`  
- **Preferred but occasional deviation is acceptable** = `Prompts` = `Probabilistic`

If the business would **lose money** from a single failure → **use a hook**.  
If the business would **face legal risk** from a single failure → **use a hook**.  
If it is a **formatting** preference or **style** guideline → **prompt-based guidance** is fine.  

The exam consistently presents **prompt-based** solutions as distractors for scenarios requiring deterministic enforcement. 
The decision is not about whether prompts are "good enough" — it's about whether the consequence of a single failure justifies deterministic guarantees.

## Hooks vs Prompts: Side-by-Side Comparison

**Scenario**: International transfers must pass AML checks.
- **Prompt approach**: "Always complete AML verification before processing international transfers." Works 95% of the time. The 5% failure rate means some transfers skip AML checks — a regulatory violation.  
- **Hook approach**: A `PreToolUse` hook blocks `transfer_funds` until `aml_check` returns a pass. Works 100% of the time. No transfer can execute without AML verification.

**Scenario**: Responses should be formatted in markdown.
- **Prompt approach**: "Format all responses using markdown with headers and bullet points." Works most of the time. Occasional plain-text responses are not a business risk.   
- **Hook approach**: Unnecessary overhead. Formatting preferences do not require deterministic enforcement.

**Scenario**: Refunds above $500 require human approval.
- **Prompt approach**: "For refunds above $500, escalate to a human agent." Works most of the time. A single failure means a large refund processed without approval.  
- **Hook approach**: Intercept `process_refund`, check the amount, block if above $500 and route to human escalation. Works 100% of the time.

## PreCompact.  

`PreCompact`, which **runs immediately before** Claude Code **compacts the conversation**, whether the user typed `/compact` (matcher manual) or the context reached the auto-compact window (matcher auto). 

The hook receives:
- `the transcript path`  
- `the trigger`  
- `any custom instructions` the user passed to `/compact`

So it can archive the full transcript to a log before the summary discards detail. 
Exit `code 2`, or `"decision": "block"` in its JSON output, **blocks the compaction**. 

## PostCompact. 

`PostCompact` event **fires afterwards carrying the generated summary**. 

The pattern is the one you already know from tool hooks: a Pre event can inspect and block, a Post event can only observe what's already happened.

## Practical Example: Data Format Chaos

A customer support agent uses three MCP tools:

1. `get_customer` returns dates as `Unix` timestamps and status as `numeric codes`.  

2. `lookup_order` returns dates as `ISO 8601` strings and status as `English strings`.  

3. `check_shipping` returns dates as `"DD/MM/YYYY"` and status as `single-character codes` ("S" for shipped, "P" for pending). 

Without a `PostToolUse` hook, the model must interpret three different date formats and three different status representations on every iteration. 
Sometimes it correctly converts a Unix timestamp; sometimes it confuses the day/month order in "DD/MM/YYYY"; sometimes it misinterprets "P" as "processed" instead of "pending."

With a `PostToolUse` hook, all tool results are normalised before the model sees them:

All dates → `ISO 8601`("2024-03-15T12:00:00Z")
All status codes → human-readable strings ("shipped", "pending", "delivered")

> The model always receives consistent data, eliminating interpretation errors entirely.

## Exam Traps

1. Using `PostToolUse` hooks to block policy-violating actions
`PostToolUse` hooks run after tool execution. 
By the time the hook fires, the non-compliant action has already been processed. 
Use `PreToolUse` hooks (pre-execution) to block actions before they happen.

2. Enhanced prompt instructions as the solution for 100% compliance requirements
Prompts provide **probabilistic** compliance. 
If the business requires 100% enforcement (financial operations, regulatory compliance, security checks), **only hooks provide deterministic guarantees**.

3. Suggesting model-side data transformation instead of `PostToolUse` hooks for **normalisation**.  
Relying on the model to normalise heterogeneous data formats introduces inconsistency. 
`PostToolUse` hooks ensure clean, consistent data reaches the model every time, regardless of which tool produced it.

4. Confusing the direction of hooks — `PostToolUse` runs after execution, `PreToolUse` runs before
`PostToolUse` transforms results after a tool runs. 
`PreToolUse` blocks or modifies calls before a tool runs.
Using the wrong hook direction means either missing the opportunity to prevent an action or unnecessarily blocking completed work.