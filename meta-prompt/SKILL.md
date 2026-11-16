---
name: meta-prompt
description: Interview the user about a task until scope, features, and boundaries are fully understood, then produce a complete prompt to hand to an agent. Use when user runs /meta-prompt <starting point>, or asks to "write a prompt for an agent", "spec this out for an agent", or "interview me and make a prompt".
argument-hint: <starting point: idea, feature, bug, file path>
---

# Meta-Prompt

Turn a rough starting point into a precise agent prompt by interviewing the user.

Starting point: $ARGUMENTS
(If empty, ask the user for one first.)

## 1. Ground (read-only)
- Read project CLAUDE.md files and any files/dirs the starting point names or implies.
- Skim for existing code, frameworks, conventions the agent must reuse or obey.
- Never edit anything during this step. Respect any "do not read" rules in CLAUDE.md.
- Use what you learned to ask sharper questions (propose concrete options, cite real paths).

## 2. Interview
Use AskUserQuestion, up to 4 questions per round. Give concrete options; put your recommendation first marked "(Recommended)". User can pick "Other" for free text.

Cover, in rough order, skipping what's already answered:
1. Goal — what outcome, why, who/what benefits
2. Scope — features/behaviors that must exist
3. Out of scope — what the agent must NOT do or touch
4. Constraints — tech, frameworks, files, patterns, performance, style
5. Edge cases & failure behavior
6. Acceptance criteria — observable, testable checks
7. Verification — how the agent proves it works (tests, screenshots, commands)
8. Deliverables — files, docs, reports expected

Rules:
- After each round, update a running list of known facts and open gaps. Base the next round on the gaps.
- Follow up on vague answers ("fast", "nice", "like X") until they are concrete.
- Never invent requirements. If unsure, ask.
- Don't ask what the codebase already answers — state it and let the user correct.

## 3. Confirm
When no open gaps remain, show a concise summary (goal, scope, out of scope, constraints, acceptance criteria). Ask via AskUserQuestion: "Is this summary accurate?" — Yes / Needs changes. If changes, return to step 2 for those points. Loop until Yes.

## 4. Output
Write the prompt with this structure. It is for an agent with NO access to this conversation — self-contained, specific, real paths.

```
# Task: <title>

## Context
<background, why, relevant existing code/paths>

## Goal
<one-paragraph outcome>

## Scope
- <must-do items>

## Out of scope
- <must-not-do items>

## Constraints & conventions
- <tech stack, frameworks, project rules, patterns to reuse>

## Acceptance criteria
- [ ] <testable check>

## Verification
<exact steps/commands to prove each criterion>

## Open assumptions / questions
- <anything unresolved; agent must ask the user rather than guess>
```

Then:
1. Print it in chat in a fenced markdown block.
2. Save to `./prompts/<kebab-slug>.md` (create `prompts/` if missing; if the file exists, append `-2`, `-3`, ...). Report the path.
