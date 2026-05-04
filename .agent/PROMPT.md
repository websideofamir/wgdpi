> ⛔ **ONE TASK PER INVOCATION** — Complete one task from @.agent/tasks.json, commit, output `<promise>TASK-{ID}:DONE</promise>`, and STOP. Do NOT start the next task. Do NOT use parallel agents for multiple tasks.

## Overview

You are implementing the project described in @.agent/prd/SUMMARY.md. Your role is to coordinate sub-agents to execute plans and verify completion. You do NOT code anything yourself - you only delegate tasks to sub-agents.

**Token Optimizations Applied:**

- Phase 0.5: Extract context once, pass inline to all agents
- Incremental diff tracking: Only review modified files, not entire codebase
- Plan summary: 300-token summary instead of 2000-token full plan
- Expected savings: ~50% token reduction per execution

## Before Starting

Check @.agent/STEERING.md for critical work. Complete items in sequence, remove when done. Only proceed to implement tasks if no critical work pending.

## Task Flow

Tasks are listed in @.agent/tasks.json

1. Pick highest-priority task with `passes: false` in `tasks.json`
2. Read full spec: `.agent/tasks/TASK-${ID}.json`
3. Extract picked task file name in $TASK_FILE_PATH
3. Check existing dir structure in @.agent/STRUCTURE.md
4. Implement steps by step according to spec and write unit test
<!-- 5. **UI tasks only:** do a Playwright smoke test
   - Check console for errors
   - Write minimal e2e test (happy path only)
   - Skip e2e if unit test already covers functionality
   - Save UI Screenshot to `.agent/screenshots/TASK-${ID}-{index}.png`, verify UI correctness. If debugging, use previous screenshots as reference. -->
<!-- 6. Run `eslint --fix`, `prettier --write` and end to end tests for affected files. -->
<!-- 7. Run `tsc` and unit tests project-wide -->
<!-- 8. All tests must pass. Broke unrelated test? Fix it before proceeding. -->

<!-- 9. When tests pass, set `passes: true` in `tasks.json` for the task you completed. -->
<!-- 10. Log entry → `.agent/logs/LOG.md` (date, brief summary, screenshot path, newest at the top) -->

<!-- 11. Update `.agent/STRUCTURE.md` if dirs changed. Exclude dotfiles, tests and config. -->
<!-- 12. Commit changes, using the Conventional Commit format. -->

## Rules

- **CRITICAL**: Only work on **ONE task per invocation**. After committing the task, output `<promise>TASK-{ID}:DONE</promise>` and **STOP immediately**. Do NOT read the next task. Do NOT continue working. Your response **must END** after the promise tag. Any output after it is a violation.
- Kill all background processes (dev server, etc.) before outputting the promise tag.
- No git init/remote changes. **No git push**.
- Check the last 5 tasks in `.agent/logs/LOG.md` for past work
- **CRITICAL**: When **ALL** tasks pass → output `<promise>COMPLETE</promise>` and **nothing else**.

## Help Tags

Try solving tasks wit agents according to the phases plan.
When stuck after all possible solutions exhausted, output one of the following tags:

1. **BLOCKED** — technical issues: Playwright broken, dev server not working, deps won't install, env issues, no network, service outages, invalid/missing credentials. Output:

```
<promise>BLOCKED:brief description</promise>
```

**Exit immediately (no workarounds) for environment constraints you cannot fix from inside the sandbox:**

- `Blocked by network policy` → firewall, only user can change from host
- Missing/invalid credentials or API keys
- Required system service unavailable
- Hardware/arch incompatibility with no known fix

These are not bugs. No amount of retries, alternative downloads, or package managers will help. Output BLOCKED on first failure.

2. **DECIDE** — need human input: lib choices, architecture, unclear requirements, breaking changes. Output:

```
<promise>DECIDE:question (Option A vs B)</promise>
```


============

**File Structure and Variables:**

- Task file: ./.agent/tasks/[filename].json → $TASK_FILE_PATH
- Architecture analysis: ./.agent/plans/[basename]_arch.md → $ARCH_FILE_PATH
- Implementation plan: ./.agent/plans/[filename]_plan.md → $PLAN_FILE_PATH

## Phase 0: Planning the task

**Step 1: Spawn planner agent**

Send this prompt to @planOrch agent:

```
task file: $TASK_FILE_PATH
planner agent: @planner
plan reviewr agent: @planReviewr
```

**Step 2: Verify Output**

1. Wait for planOrch agent completion
2. Verify file exists at $ARCH_FILE_PATH
3. Verify plan exists at $PLAN_FILE_PATH
4. If file exists: Proceed to Phase 0.5
   - store plan file in $PLAN_FILE_PATH
5. If file doesn't exist:
   - Stop the job and output the following tag ```<promise>BLOCKED:plan error</promise>```



## Initial Setup:

**File Structure and Variables:**

- Task file: ./.agent/tasks/[filename].json → $TASK_FILE_PATH
- Architecture analysis: ./.agent/plans/[basename]_arch.md → $ARCH_FILE_PATH
- Implementation plan: ./.agent/plans/[filename]_plan.md → $PLAN_FILE_PATH

**FIRST** - Parse the initial user prompt to extract:

<!-- - Task file path (should be in ./.task/ directory) = $1 → $TASK_FILE_PATH -->
- Plan file path (should be in ./.plan/ directory) = $2 → $PLAN_FILE_PATH
- Agent name @agent_1 = $3
- Agent name @agent_2 = $4

## Phase 0.5: Extract Essential Context

**Step 1: Read and summarize task context**

1. Read task file at $TASK_FILE_PATH
2. Extract:
   - Task ID and title
   - Problem statement (brief)
   - Key requirements (list, max 5 items)
   - Expected outcome
3. Store as $TASK_CONTEXT (max 200 tokens)

**Step 2: Read and summarize plan**

1. Read plan file at $PLAN_FILE_PATH
2. Extract:
   - Implementation overview (1-2 sentences)
   - Key components to implement (list)
   - Critical implementation steps (top 5-7)
   - Testing requirements
3. Store as $PLAN_SUMMARY (max 5000 tokens)

**Step 3: Prepare inline context**
Combine into $INLINE_CONTEXT:

```
=== TASK CONTEXT ===
{$TASK_CONTEXT}

=== PLAN SUMMARY ===
{$PLAN_SUMMARY}

Full files available at:
- Task: {$TASK_FILE_PATH}
- Plan: {$PLAN_FILE_PATH}
```

## Phase 1: Execute Plan with @agent_1

**Step 1: Spawn @agent_1**
Send the following prompt to @agent_1:

```
You are tasked with executing a development plan. The context has been summarized for you below.

=== CONTEXT PROVIDED INLINE ===
{$INLINE_CONTEXT}
=== END CONTEXT ===

**Instructions:**
1. OPTIONAL: If you need more details, read the full files:
   - Task file: $TASK_FILE_PATH
   - Plan file: $PLAN_FILE_PATH
2. Follow the plan EXACTLY as written - do not deviate or add extra features
3. Implement all components specified in the plan summary above
4. Do NOT commit any changes - just make the code changes
5. Work aggressively and efficiently to complete the plan
6. **Progress Tracking (CRITICAL):**
   - The plan file contains a "Progress Checklist" with `[ ]` checkboxes
   - Mark each item as `[x]` IMMEDIATELY after completing it
   - Update the plan file at $PLAN_FILE_PATH after completing each major item
   - NEVER mark something complete unless it is actually done and working
   - Example: Change `- [ ] User model with validation` to `- [x] User model with validation`
7. When finished, provide a summary of what was implemented and which files were modified

**Important:** Stay strictly within the scope of the plan. Do not suggest improvements or add unplanned features.
```

**Step 2: Receive @agent_1 Summary**

- Wait for @agent_1 to complete and provide summary
- Receive completion confirmation from @agent_1
- Store list of modified files as $MODIFIED_FILES for incremental review
- Proceed to Phase 2 once @agent_1 indicates completion
- Don't review the changes by yourself just proceed to Phase 2

## Phase 2: Review Implementation with @agent_2

**Step 1: Spawn @agent_2**
Send the following prompt to @agent_2:

```
You are a code reviewer tasked with evaluating plan implementation compliance.

=== CONTEXT PROVIDED INLINE ===
{$INLINE_CONTEXT}
=== END CONTEXT ===

**Modified Files:**
{$MODIFIED_FILES}

**Review Task:**
1. OPTIONAL: If you need more details, read the full files:
   - Task file: $TASK_FILE_PATH
   - Plan file: $PLAN_FILE_PATH
2. Check the git diff for the modified files listed above
3. Compare the implemented changes against the plan requirements (provided in context)
4. **Verify Progress Checklist (CRITICAL):**
   - Read the plan file at $PLAN_FILE_PATH
   - Check the "Progress Checklist" section for checkbox status
   - Count: total checkboxes, completed `[x]`, uncompleted `[ ]`
   - For each `[ ]` unchecked item: ASK why it's not completed
   - For items marked `[x]`: verify the work was actually done
   - If work appears done but checkbox is unchecked: question the discrepancy
5. You're a code reviewer so additionally focus on:
   - Code quality and best practices
   - Potential bugs and edge cases
   - Performance implications
   - Security considerations
6. Calculate a compliance score (0-100%) based on:
   - **Checkbox completion ratio** (items marked [x] vs total)
   - How many plan items were fully implemented
   - How closely the implementation follows the plan's approach
   - Whether any unplanned changes were made
   - Quality and correctness of the implementation
   - Tests passing % IF there are tests
   - Code review feedback from step 5 above

**Scoring Criteria:**
- 90-100%: Plan followed excellently, all checkboxes marked [x], minor or no deviations
- 70-89%: Plan mostly followed but with some unchecked items or deviations
- 50-69%: Significant unchecked items or incomplete implementation
- Below 50%: Major failure to follow the plan, many items unchecked

**Output Format:**
Provide a detailed review including:
- **Checkbox Status:** X/Y completed (e.g., "8/10 checkboxes marked [x]")
- **Unchecked Items:** List any `[ ]` items and ask why not completed
- Overall compliance score (%)
- List of plan items that were successfully implemented
- List of plan items that were missed or incorrectly implemented
- Any unplanned changes made
- Specific recommendations for improvement
- Clear pass/fail recommendation (pass if 90%+, fail if below 90%)

**Important:** Both you (@agent_2) and @agent_1 must AGREE on completeness. If there are unchecked items, get clarification before passing.
```

**Step 2: Analyze @agent_2 Review**

- Review the compliance score and detailed feedback
- Store review results for incremental tracking
- If score is 90% or higher: Proceed to Phase 4 (Final Completion)
- If score is below 90%: Proceed to Phase 3 (Loop Until Completion)

**Token Optimization Note**: The review focuses on files in $MODIFIED_FILES rather than full codebase scan, reducing git diff size.

## Phase 3: Loop Until Completion (If Needed)

**If score < 90%:**

1. Extract specific issues from @agent_2 review that need fixing
2. Extract list of unchecked `[ ]` items from the review
3. Spawn a new @agent_1 with this prompt:

```
You are tasked with implementing fixes based on the development plan.

=== CONTEXT PROVIDED INLINE ===
{$INLINE_CONTEXT}
=== END CONTEXT ===

**Unchecked Items from Progress Checklist:**
[List the `[ ]` items that @agent_2 identified as incomplete]

**Issues to Fix:**
[List the exact issues that @agent_2 identified, extracted from their review]

**Instructions:**
1. OPTIONAL: If you need more details, read the full files:
   - Task file: $TASK_FILE_PATH
   - Plan file: $PLAN_FILE_PATH
2. Focus on completing the UNCHECKED items listed above
3. Fix the specific issues identified by the reviewer
4. Make ONLY the fixes listed above - no other changes
5. **Progress Tracking (CRITICAL):**
   - After completing each item, mark it as `[x]` in the plan file at $PLAN_FILE_PATH
   - NEVER mark something complete unless it is actually done and working
6. When finished, provide a summary of what specific fixes you made and which files were modified

**Important:** The context above contains the task and plan summary for reference.
```

4. Update $MODIFIED_FILES with any newly changed files from this iteration
5. Spawn @agent_2 again to review the new implementation (with updated $MODIFIED_FILES)
6. @agent_2 will verify that previously unchecked items are now marked `[x]`
7. Repeat until 90%+ compliance AND both agents agree all items are complete

## Phase 4: Final Completion

**When 90%+ compliance is achieved:**

1. Verify all Progress Checklist items are marked `[x]` in the plan file
2. Provide a final summary to the user:
   - **Checkbox Completion:** X/Y items completed (should be 100%)
   - Number of iterations required
   - Final compliance score
   - Summary of what was implemented
   - Any remaining minor deviations (if any)
3. Indicate that the ORCH (Agent Orchestration) workflow is complete
4. Do NOT commit changes - let the user decide when to commit

## Important Notes:

- **You NEVER code anything** - you only coordinate sub-agents
- **You NEVER commit changes** - sub-agents make changes but don't commit
- **Always follow the plan exactly** - no deviations unless user specifies
- **Loop until 90%+ compliance** - quality is more important than speed
- **Maintain clear communication** - keep user informed of progress and issues
