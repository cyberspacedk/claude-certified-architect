# Task Decomposition Strategies

Task decomposition is **how you break complex work into pieces** an agentic system can actually handle. 

The exam tests two patterns and expects you to pick the right one for the task in front of you.

Pick wrong and the work suffers in predictable ways. 
It also tests one specific failure mode — attention dilution — that shows up when decomposition is too shallow.

## Pattern 1: Fixed Sequential Pipelines (Prompt Chaining)

Fixed sequential pipelines **break work into predetermined steps that execute in order**.
**Each step takes the output of the previous step** as input.

**How it works**: The workflow is defined in advance. `Step 1` runs, its output feeds into `Step 2`, `Step 2`'s output feeds into `Step 3`, and so on. The **sequence does not change based on intermediate results.**

**Example** — Code review pipeline:  
1. For each file, run a local analysis pass (style, bugs, complexity).  
2. After all local passes, run a cross-file integration pass (data flow, API consistency, import chains).  
3. Compile results into a unified review report.  

**Best for**: Predictable, structured tasks where the steps are known in advance. 
- Code reviews  
- document processing  
- data extraction pipelines  
- compliance checks  
all fit this pattern.

**Advantages**: 
- Consistent and reliable.  
- The same input always follows the same path.  
- Easy to debug — you know exactly which step produced which output.  
- Easy to monitor — you can log the output of each step.  

**Limitations**: Cannot adapt to unexpected findings. 
If Step 2 discovers something that should change the approach for Step 3, the pipeline can't adjust.
The steps are fixed regardless of what turns up along the way.

## KEY CONCEPT 

Fixed sequential pipelines (prompt chaining) are **best for predictable, structured tasks**. 
They provide consistency and reliability but cannot adapt to unexpected findings during execution.

## Pattern 2: Dynamic Adaptive Decomposition

Dynamic adaptive decomposition **generates subtasks based on what is discovered at each step**.
The plan evolves as the agent learns more about the problem.

**How it works**: The agent starts with a high-level goal, performs initial investigation, and generates a plan based on what it finds. As it executes the plan, it discovers new information that may change the remaining steps. The agent adapts the plan accordingly.

**Example** — Adding tests to a legacy codebase:  
1. Map the codebase structure (directories, modules, dependencies).  
2. Identify high-impact areas (most-used modules, modules with the most bugs, untested critical paths).  
3. Create a prioritised test plan based on the mapping.  
4. Start writing tests. Discover that Module A depends on Module B, which has no tests.  
5. Reprioritise: test Module B first so Module A's tests can rely on it.  
6. Continue adapting as new dependencies and issues emerge.  

**Best for**: 
- open-ended investigation tasks where the full scope is not known at the start.  
- legacy system exploration. 
- security audits. 
- research projects. 
- debugging unfamiliar codebases  
all benefit from this pattern.

**Advantages**: 
- Adapts to the problem.  
- Can discover and respond to unexpected complexity.  
- Produces more thorough results for open-ended tasks because it does not force-fit a predetermined plan.

**Limitations**: Less predictable. Execution time varies depending on what is discovered. Harder to estimate completion time or resource usage. More difficult to debug when things go wrong.

## Selecting the Right Pattern

<img src="./task.png"/> 


## The Attention Dilution Problem 

Attention dilution is a specific failure mode that **occurs when an agent processes too many items in a single pass**. 
The result is inconsistent depth — the agent produces thorough analysis for some items and misses obvious issues in others.

**The telltale symptoms**:

- Detailed feedback for the first few files, increasingly shallow analysis for later files.  
- A pattern flagged as problematic in one file while identical code is approved in another file.  
- Obvious bugs missed in some files while minor style issues are caught in others.  

**Why it happens**: 
1. The model allocates attention across all items in the context.  
2. When there are too many items, attention per item decreases.  
3. Early items get disproportionate attention; later items get skimmed.  

**The fix:** `Multi-pass` architecture. 

## Multi-pass architecture

Split the work into two layers:

1. **Per-item local analysis passes**: analyse each file (or document, or module) individually in its own pass. Each pass has the full attention budget focused on a single item.

2. **Cross-item integration pass**: after all local passes complete, run a separate pass that looks across all items for cross-cutting concerns (data flow issues, inconsistent pattern usage, cross-file dependencies).

The `per-item` passes catch local issues consistently because each item gets dedicated attention. 
The `integration` pass catches `cross-item` issues because it focuses specifically on relationships between items rather than trying to do everything at once.

## Practical Example: The 14-File Code Review

A code review agent processes 14 files in a single pass. 

The results:  
- `Files 1-5`: detailed feedback with specific line references, bug identification, and improvement suggestions.  
- `Files 6-9`: moderate feedback with some issues identified but less thorough analysis.  
- `Files 10-14`: superficial feedback that misses obvious null pointer bugs and SQL injection vulnerabilities.  
- A `forEach` loop flagged as inefficient in `File 3`, while identical code in `File 11` receives no comment.

This is **attention dilution**. 

The fix is **not a better model**, a **larger context window**, or a **more detailed prompt**. 

The **fix is structural**: 

Split into 14 `per-file` analysis passes (each focused on one file) **plus** a `cross-file` integration pass (checking for data flow issues and pattern consistency across all files).

The `multi-pass` approach catches the null pointer bugs in Files 10-14 (because each file gets its own dedicated pass) and identifies the inconsistent forEach evaluation (because the integration pass specifically checks for cross-file pattern consistency).

## Exam Traps

1. Suggesting a more powerful model or larger context window as the fix for attention dilution.  
**Attention dilution is an architectural problem**, not a model capability problem. **Processing too many items in a single pass produces inconsistent** depth regardless of model power or context size. The fix is multi-pass architecture.

2. Proposing a `single-pass` review with better prompts as equivalent to `multi-pass` architecture. 
Better prompts improve average quality but do not solve the fundamental attention allocation problem. `Multi-pass` architecture **ensures each item receives dedicated attention**, which a `single-pass` approach **cannot guarantee**.

3. Applying fixed pipelines to open-ended investigation tasks. 
Open-ended tasks require adaptability. **Fixed pipelines cannot respond to unexpected findings**. **Dynamic adaptive decomposition** is the **correct pattern** when the full scope is unknown at the start.

4. Batching files into groups without adding a cross-file integration pass. 
Batching reduces attention dilution within each batch but misses cross-batch issues. Without a dedicated cross-file integration pass, data flow issues and pattern inconsistencies across batches go undetected.
