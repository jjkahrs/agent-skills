---
name: make-it
description: Implement a prompt written by /meta-prompt by handing it to subagents — one subagent per phase, run in order, with stall checks, a gate between phases, and the full test suite only at the end. Use when the user runs /make-it <prompt file(s)>, or asks to "implement/build/execute this prompt", "make prompts/<x>.md", or "run the phases in prompts/...".
argument-hint: <prompt file, list, or glob (e.g. prompts/maps-phase-*.md)>
---

# Make It

You are the **orchestrator**. You don't write the feature code yourself; subagents do. Your job: split the work, launch it, keep it moving, verify it, report.

Input: $ARGUMENTS
(If empty, list `./prompts/*.md` newest first and ask which one.)

## 1. Load and split
- Resolve the input to files. A glob or list = several files; sort them naturally (`phase-2` before `phase-10`). **Each file is one phase.**
- Single file: find phases in it. Common shapes:
  - `### Phase N: ...` headings (usually under Scope)
  - a numbered list under a `## Process` / `## Workflow` / `## Phases` section, where each item is a phase
  - `## Phase N` headings
  No phases found → the whole prompt is one phase.
- Read project `CLAUDE.md` files. Their rules (branching, no push, screenshots, forbidden dirs, window placement) bind you and every subagent.
- Tell the user in a few lines: the phases you found (number + title), the branch, and that you're starting. Don't wait for approval — the prompt was already approved during /meta-prompt.

## 2. Branch
- Use the branch the prompt names. Otherwise use `<prompt-slug>`. Create it from the current branch if it's missing (from `main` if the prompt says so). If the working tree is dirty, stop and tell the user; don't stash or discard their work.
- Never push.

## 3. Rules that override the prompt
Prompts are written for an agent that can talk to the user. Subagents can't, and the user asked for this run to be autonomous. So these rules win over the prompt text:
- **Questions → best judgement.** Wherever the prompt says "stop and ask the user", "wait for approval", or "present an outline first", the subagent picks the most reasonable option that fits the prompt and the codebase, records it as an assumption, and keeps going. The exceptions are irreversible or outward-facing actions (deleting user data, pushing, publishing). Those are skipped and reported, not guessed.
- **No full test suite until all phases are done.** Each phase runs the build plus the tests for what it touched (by name or regex). It doesn't run the full suite, even if the prompt says so for that phase. You run the full suite once, in step 5. Why: full runs are slow, and later phases change the code anyway.
- Everything else in the prompt stands: scope, out of scope, constraints, commits per phase, screenshots, docs.

## 4. Run each phase (sequentially)
Phases build on each other, so run one at a time. For each phase, spawn one **background** subagent (`Agent`, `subagent_type: general-purpose`, `name: phase-<N>`) with this brief:

```
You are implementing phase <N> of <total> of the task below, on git branch <branch> in <repo path>.
Earlier phases are already committed; their reports are below.

## Rules (these override anything in the task text)
- You cannot ask the user anything. Where the task says to stop/ask/wait for approval,
  choose the most reasonable option, note it under "Assumptions", and continue.
  Skip (and report) anything irreversible or outward-facing: pushing, deleting user data, publishing.
- Do only phase <N>. Don't start later phases.
- Build, then run only the tests relevant to this phase (new + directly affected).
  Do NOT run the full test suite; the orchestrator does that after the last phase.
- Follow the repo's CLAUDE.md files. Never push.
- When the phase's tests pass, commit (message describes the phase; follow the task's
  commit rules and attribution line). If you can't get green, don't commit; report why.

## Final report (your last message)
- Status: DONE | BLOCKED (why)
- Commit hash
- Files changed
- Tests run: exact commands + pass/fail (paste output for failures)
- Screenshots: paths, plus what you saw in each
- Assumptions / deviations from the task

## Full task
<entire prompt text — every file for multi-file runs, so shared design sections carry over>

## Your phase
<this phase's section verbatim>

## Previous phase reports
<reports from phases 1..N-1, or "none">
```

### Stall checks while it runs
Right after you spawn the subagent, start a timer: `Bash` with `run_in_background: true`, command `sleep 600`. When it fires (and the phase isn't finished):
1. `ListAgents` → is `phase-<N>` still busy?
2. Progress signal: `git -C <repo> status --short | wc -l`, `git log -1 --format=%h`, and the newest file mtime under the source dirs. Compare with the last check.
3. No change since the last check → `SendMessage` to `phase-<N>`: "Status check from orchestrator: what are you doing right now, and are you blocked? If you're blocked on a decision, use your best judgement and continue."
4. Still no progress on the next check → `TaskStop` it. Spawn a replacement with the same brief plus "A previous attempt stalled; its uncommitted work is in the tree — inspect it, keep what's good, and finish."
5. Re-arm the timer. Keep the user posted in one line per check ("phase 2: busy, 14 files changed").

Running builds and tests can go quiet for a long time, so one quiet check isn't a stall. It takes two in a row.

A subagent's report can arrive twice: once as a message and again as an idle notice. Gate it the first time and ignore the repeat. A timer that fires after its phase has finished is stale, so ignore that too.

### Gate after each phase
When the subagent's report arrives:
- Read the report. BLOCKED → decide: retry with a fix brief, or, if it's a real decision the prompt can't settle, stop and ask the user.
- Verify: a commit exists for the phase, the build succeeds, and the phase's tests pass (rerun the commands from the report). Look at its screenshots (Read the PNGs) and skim `git show --stat`.
- If a check fails, `SendMessage` the same subagent with the failure output and have it fix the problem. Rerun the gate. Give it 2 tries, then spawn a fresh fix agent. If that also fails, stop and report to the user.
- If it passes, keep the report for the next phase's brief and move on.

## 5. Final verification (after the last phase)
- Run the **full** test suite, as the prompt or README describes it. If something fails, spawn a fix subagent with the output (it may run targeted tests, then you rerun the full suite). Stop after 2 rounds and report whatever is still failing.
- Walk every acceptance criterion: mark it met, with evidence (a test name, a command output, a screenshot path), or not met, with the reason.
- Look at before/after screenshots if the prompt or CLAUDE.md asks for them.

## 6. Report to the user
- Branch, plus one line per phase: commit hash, status.
- Acceptance criteria checklist with evidence.
- Full suite result (pass/fail counts; output for failures, never hidden).
- Screenshot paths.
- **All assumptions the subagents made**, grouped by phase. The user wants to review these, since nobody asked them.
- Anything skipped, stalled, retried, or left undone.
