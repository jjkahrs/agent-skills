---
name: finish-it
description: Wrap up a work session — commit the work this session did, merge every branch this session created back into the branch it was created from, delete those branches, and stop every process this session started. Use when the user runs /finish-it, or says "finish it", "wrap it up", "merge and clean up", "we're done, land it", or similar end-of-task cleanup requests. Only touches things this session made; never pushes.
---

# Finish It

The user runs this manually after testing is done. Land the session's work and leave the machine clean. Run straight through — no confirmation prompts — but stop and report on anything unexpected.

**Scope rule: only touch what THIS session made.** Branches, commits, files, processes the user (or another session) made are not yours. When unsure whether something is yours, leave it and list it in the report. A missed cleanup is cheap; deleting someone's branch or killing their process is not.

**Never push.** No `git push`, ever, even if a remote exists.

## 1. Inventory (from this session's history)

Scan the conversation and build three lists:

- **Branches created** — every `git checkout -b`, `git switch -c`, `git branch <name>`, or worktree (`EnterWorktree`, `git worktree add -b`) you ran. Keep creation order.
- **Files changed** — every file you wrote, edited, created, or deleted (Edit/Write tools, shell redirects, generators you ran, build outputs you intentionally kept).
- **Processes started** — every `run_in_background` Bash/PowerShell task, every `Start-Process`, `&`, `nohup`, dev server, editor/service exe, watcher, or viewer you launched. Note task IDs and PIDs where known.

If the context was compacted and the history is thin, say so in the report; don't guess.

### Find each branch's parent
For each branch, the merge target is the branch it was created from. Confirm with git rather than memory:

```
git reflog show <branch> --format="%gs" | tail -1     # "branch: Created from main"
```

`checkout -b` usually records `Created from HEAD`. Then use the oldest matching checkout line: `git reflog --format="%gs" | grep "to <branch>$" | tail -1` → "checkout: moving from X to <branch>". Must agree with session memory; if git and memory disagree or neither is clear, don't merge that branch — report it.

## 2. Commit

For each branch you created that has uncommitted work of yours:

1. `git status --porcelain` — compare against your **files changed** list.
2. Stage by explicit path only: `git add -- <file> <file> ...`. Never `git add -A` / `git add .` / `git commit -a` — those sweep up the user's unrelated changes.
3. Files changed that you did NOT touch → leave them alone, unstaged, and list them in the report.
4. Commit message: match the style of `git log --oneline -10` in this repo. Summarize what the session did. End with any attribution lines the system/user instructions specify.
5. Hooks fail → fix the cause and make a new commit. Don't `--no-verify`.

Nothing of yours to commit → skip.

## 3. Stop processes

Do this **before** merging: on Windows, running exes lock files and break checkout/merge.

- Background tasks from this session → stop with TaskStop. Its success result is enough verification; no need to hunt the PID. If the task spawned a detached child (e.g. launched an exe that outlives the shell), handle that child by PID below.
- Known PIDs → kill the tree so children die too: `taskkill /PID <pid> /T /F` (Windows) or `kill <pid>` (POSIX).
- Verify each is gone (`Get-Process -Id <pid>` / `tasklist /FI "PID eq <pid>"` should find nothing).
- Never kill by name (`taskkill /IM node.exe`) — that hits the user's processes too. If you only know a name, find the PID whose command line / start time matches what you launched; no confident match → leave it, report it.

## 4. Merge

Merge in **reverse creation order** (a branch created from another of your branches merges into it first, so the chain folds back down to the original parent).

For each branch:

```
git checkout <parent>
git merge --no-ff --no-edit <branch>
```

Use `--no-ff` unless the repo's history clearly uses fast-forward/squash merges. `--no-edit` keeps git from opening an editor and hanging the shell. User's uncommitted changes that don't conflict carry across checkouts — that's fine, leave them.

- **Conflict** → `git merge --abort`, stop the whole run, report the conflicting files. Don't resolve automatically.
- **Checkout refused** because of the user's uncommitted changes → stop and report. Don't stash, reset, or discard their work.
- Branch has no commits beyond the parent → nothing to merge, still delete in step 5.

## 5. Delete branches

Only branches from your inventory, only after their merge succeeded:

```
git branch -d <branch>
```

`-d` (safe) only — it refuses unmerged branches, which is the guardrail. If it refuses, report it; don't escalate to `-D`. Worktrees you created: `git worktree remove <path>` (or ExitWorktree) before deleting their branch. Never touch remote branches.

End on the original parent branch.

## 6. Report

Short summary:

- **Committed:** `<hash> <subject>` made by this run (earlier session commits ride along in the merge; no need to list)
- **Merged:** `<branch> → <parent>` (merge hash)
- **Deleted:** branches / worktrees
- **Stopped:** processes (name, PID/task)
- **Left alone:** user's uncommitted files, processes or branches not clearly yours, anything skipped and why
- **Current branch** and `git status` one-liner
