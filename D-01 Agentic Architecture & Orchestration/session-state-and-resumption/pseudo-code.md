1. Create a Claude Code session that analyses a 10-file codebase and name it with --name for later resumption

WHY:
Named sessions resumed with --resume enable continuation of work across breaks. 
The exam tests when resume is appropriate (no files changed) 
versus when it creates the stale context problem (files have been modified since the last session).

Use the --name (or -n) flag to set a session name when starting Claude Code, 
then resume it later with --resume and the same name. Ask it to analyse all files in the codebase directory.

```shell
claude -n code-review-session "Analyse all files in ./src and identify bugs, security issues, and code quality problems. Provide findings for each file."
```

2. Record the key findings from the initial analysis as a structured summary (file names, issues found, recommendations)

WHY:
This structured summary is the knowledge you will inject into the fresh session later. 
The exam tests whether you preserve prior findings without carrying stale tool results. 
A good summary captures conclusions without raw tool output.

Create a `JSON` or `markdown` summary with: file name, issues (description + severity), and recommendations for each file.
Do not include raw file contents — just the analysis conclusions.

```md
# Session Summary: code-review-session

## Findings
- **auth.ts**: SQL injection in login query (critical), missing input validation (high)
- **database.ts**: Connection pool not closed on error (medium), no retry logic (low)
- **api-routes.ts**: No rate limiting on public endpoints (high), inconsistent error responses (medium)
- **utils.ts**: No issues found
...

## Key Recommendations
1. Fix SQL injection in auth.ts immediately
2. Add connection cleanup in database.ts error handlers
3. Implement rate limiting middleware for api-routes.ts
```

3. Modify 3 files in the codebase to fix some of the identified issues

WHY: 
Modifying files after a session creates the conditions for stale context. 
The old file contents remain as tool results in the session history while the actual files now contain different code. 
This is the exact scenario that triggers the contradictory advice bug.

Make meaningful changes: fix the SQL injection in auth.ts, add connection cleanup in database.ts, and add rate limiting in api-routes.ts. 
Save all three files.

```shell
# Example fixes to apply:
# auth.ts: Replace string concatenation with parameterised query
# database.ts: Add try/finally with pool.release() in error path
# api-routes.ts: Add rate limiting middleware to public endpoints
```

4. Attempt to resume the session with `--resume` and observe any stale context issues (contradictory advice, references to old code)

WHY: 
This demonstrates the stale context problem. 
The resumed session contains old tool results showing the unfixed code. 
The agent may recommend fixing issues that are already fixed, or give contradictory advice by referencing both old and new file contents.

Resume with the same session name and ask: `What is the current state of auth.ts? Are there still security issues? Watch for references to the SQL injection you already fixed`.

```shell
claude --resume code-review-session "What is the current state of auth.ts? Are there still security issues that need fixing?"

# Watch for:
# - Recommending fixes you already applied
# - Referencing old code that no longer exists
# - Contradictory statements about the same file
```

5. Start a fresh session with the `structured summary injected` into the initial prompt, specifying the 3 changed files for targeted re-analysis.

WHY: 
Fresh start with `summary injection` is the correct approach when files have changed. 
The exam specifically tests this: no stale tool results, preserved knowledge from the prior session, and targeted re-analysis of only the changed files instead of wasteful full re-exploration.

Start a new session (no --resume) with the `summary` from step 2 injected into the prompt. 
Explicitly list the 3 modified files for targeted re-analysis.

```shell
claude "Previous analysis summary:\n [paste structured summary here] \n\nThe following 3 files have been modified since the last analysis: auth.ts, database.ts, api-routes.ts.\n\nPlease re-analyse ONLY these 3 files to verify the fixes and check for any new issues. The analysis of all other files remains valid."
```

6. Compare the quality and consistency of advice between the stale resume and the fresh start with targeted re-analysis

WHY: 
This comparison demonstrates why the exam favours fresh start with summary injection over naive resume after file changes. 
The fresh start produces consistent, accurate advice while the resume produces contradictions from stale context.

Document: 
(1) Did the resume session reference old code? 
(2) Did it recommend already-applied fixes?
(3) Did the fresh session correctly identify the current state? 
(4) Did targeted re-analysis avoid wasting time on unchanged files?

```shell
# Comparison Results
| Metric | --resume | Fresh + Summary |
|--------|----------|----------------|
| References old code | Yes - cited unfixed SQL injection | No - recognised parameterised query |
| Recommends applied fixes | Yes - suggested fixing auth.ts | No - confirmed fix was correct |
| Consistent advice | No - contradicted itself on auth.ts | Yes - all advice matched current code |
| Files analysed | All 10 (unnecessary) | Only 3 changed files (efficient) |
```