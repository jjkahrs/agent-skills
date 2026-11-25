---
name: get-a-clu
description: Explore a project directory and generate a codebase-graph JSON file (version 1.0) that loads in clu, the offline Codebase Graph Explorer, and conforms to its SCHEMA.md. The file holds nodes for packages, directories, files, classes and functions, imports/calls/inherits/implements/references edges, summaries, entry points and guided tours. Use this whenever the user runs /get-a-clu <dir>, or asks to "make a clu file", "graph this codebase for clu", "generate a codebase graph JSON", "map this repo so I can explore it", or wants a codebase visualized or toured in clu, even if they do not say "clu" but mention a codebase-graph JSON or SCHEMA.md. Works for any language. TypeScript, JavaScript, C#, C++ and Python also get class/function-level detail.
---

# get-a-clu

Turn a project directory into `<name>.clu.json`: a codebase graph that clu loads with zero warnings, that helps a newcomer understand the code, and whose every claim is true to the source.

The format is in `references/schema.md`. Read it once before you start. The JSON Schema is `references/codebase-graph.schema.json`.

## Inputs

- `$1`: the project directory (required). Resolve it to an absolute path.
- Output: `<projectDir>/<basename>.clu.json` unless the user names another path.
- Work files (skeleton, patches) go in a work directory outside the project: the session scratchpad when you have one, otherwise the OS temp dir. They never go in the project.

`SKILL` below means this skill's directory. Every script is plain Node (18+) with no dependencies.

## Division of labour

The scripts do the mechanical part deterministically, so ids, line numbers and imports are not guessed:

| Script | Does |
| --- | --- |
| `scripts/scan.mjs <dir> --out <skeleton.json> [--exclude <prefix>]...` | Builds the tree: dirs (a `package` when they hold a manifest), files with `loc` and `language`, top-level classes/interfaces/functions with line ranges and **signature-only** `code`. Adds `imports` edges (TS/JS relative imports, Python modules, C++ `#include`), C# `references` edges (type usage), and `inherits`/`implements`. Uses `git ls-files` when it can, so ignored and vendored files stay out. Also writes `<skeleton>.calls.json`: a patch of **candidate** `calls` edges for direct calls (`f()`, `new C()`, `C.static()`, `ns::f()`) that resolve through same-file definitions, imports or includes. Prints counts and work groups. |
| `scripts/index.mjs <graph> --under <prefix> [--names]` | A compact listing of a group's files and symbols, with each one's current `calls`, sized for a subagent. `--names` appends every symbol's `name<TAB>id`, which are the valid targets for edges. |
| `scripts/merge.mjs <graph> <patch>... --out <file>` | Applies patch files: summaries, new or removed nodes, edges, tours. It drops edges whose ids do not exist and lists them. The patch format is in the header comment. |
| `scripts/validate.mjs <graph>` | Checks the file the way clu does: fatal errors, every load warning and the schema's structural rules. Prints summary coverage. Exits 0 only when the file is fully clean. |

You and your subagents do what needs judgment: summaries, reviewing and completing `calls` edges, fixing scanner misses, entry points and tours. Do not write your own call extractor: review the candidates and add what they miss.

## Workflow

### 1. Scan

```sh
node SKILL/scripts/scan.mjs <dir> --out <work>/skeleton.json
node SKILL/scripts/merge.mjs <work>/skeleton.json <work>/skeleton.calls.json --out <work>/base.json
```

`base.json` (skeleton plus candidate calls) is the graph everyone works from in steps 3–5.

Read the printed summary. If a large share is noise, rescan with `--exclude` for each noise prefix. Noise means generated code, copied third-party sources, sample data or docs-site scripts that `.gitignore` did not catch. Keep tests: they are real code. You tag them `test` in step 3.

### 2. Understand the project

Read the README, the manifests (`package.json`, `pyproject.toml`, `*.csproj`, `CMakeLists.txt`…) and the obvious entry points: `main`, the CLI, the server bootstrap, the app root. From these, work out what the project is for, how it is organised and where execution starts. This understanding goes into `codebase.description`, `entryPoints` and the tours. It also lets you brief subagents in one paragraph.

### 3. Describe every node, and add calls

Each group gets one patch file (`<work>/patch-<group>.json`) with:

- a `summary` for every file, class, interface, function, directory and package in it
- `description` on the important ones
- `calls` edges
- fixes for anything the scanner got wrong

Follow `references/group-agent.md` exactly. It is written as a brief you can hand to a subagent unchanged.

- **Small project** (roughly ≤ 30 files or ≤ 5k loc): do the groups yourself, one after another, following that brief.
- **Larger project**: split the work using the scanner's work groups. Aim for about 15–40 files or about 8k loc per group. Merge tiny groups; split big ones by subdirectory. Launch **one subagent per group, all in the same turn**, so they run in parallel. Write each prompt from this template, filling in every `<...>`, and check that none is left before you launch:

  ```text
  Read <SKILL>/references/group-agent.md first and follow it exactly.
  Project: <absolute project dir>
  Base graph: <work>/base.json
  Scripts: <SKILL>/scripts
  Your group: --under <prefix> [--under <prefix2>]
  Write your patch to: <work>/patch-<group>.json
  Project brief: <one paragraph: what the project does, its parts, where execution starts>
  ```

  When they finish, check that every patch file exists and parses. Re-run any group whose patch is missing. Also skim each patch's edge count: hundreds of `calls` edges from a group that read only a few files suggests a regex dump, which the brief forbids.

### 4. Write the codebase patch yourself

`<work>/patch-codebase.json`:

- `codebase.description`: 1–3 short paragraphs of Markdown. Say what the project does, its main parts and how they fit together, and the tech stack. Name the parts with `` `code` `` style paths.
- `codebase.entryPoints`: the node ids where execution or reading starts. Use the most specific node, for example `src/main.ts#main`, not `src/main.ts`, when that symbol exists. Typically there are 1–6.
- `update` for the repository root and any directory without a summary yet.
- `tours`: at least one.
  - An **architecture tour** of 6–12 steps that follows how the system works: entry point, then the core flow, then the key abstractions, then the supporting parts.
  - Add a second tour (for example "How a request is handled", or "How X is generated") when the project has a central flow worth tracing.
  - Each step's `narrative` is 2–4 sentences. It says what this node does in the flow and how it connects to the previous and next steps.
  - Tours must point at nodes that exist. Prefer files and symbols over directories.

To write good tours, read the merged graph's `calls`/`imports` edges and the summaries the groups wrote. Build the tours from these, not from memory.

### 5. Merge and validate until clean

```sh
node SKILL/scripts/merge.mjs <work>/base.json <work>/patch-*.json --out <work>/merged.json
node SKILL/scripts/validate.mjs <work>/merged.json
```

Read merge's "dropped" list. Each dropped edge means a subagent used an id that does not exist. Fix the id from `index.mjs --names` in a follow-up patch rather than lose the edge.

Repeat until `validate.mjs` prints `OK` and summaries cover at least 95% of nodes. Each fix is a small extra patch added to the merge command. Never edit ids in `base.json` by hand: merge from patches, so the run can be repeated.

### 6. Spot-check against the source

Choose 6 symbols at random from different languages and groups. For each one, open the file at `startLine` and confirm three things:

- the declaration is there
- `endLine` is the end of its body
- the summary is true

Also check 3 `calls` edges in the same way. If something is wrong, fix it with a patch and re-validate. Mention anything systematic in the report.

### 7. Deliver

Copy `merged.json` to the output path. Report in a few lines:

- the output path
- node and edge counts by kind, and the number of tours
- the validation result
- the spot-check result
- known gaps, for example "Lua files are file-level only" or "C++ methods are not separate nodes"

Tell the user how to open it: start clu (`npm run dev` in the clu repo), then **Choose a file**, or drag the JSON onto the window.

## Rules that keep the file trustworthy

- **Signatures only in `code`.** The scanner already writes the declaration line(s). For nodes you add, write the signature, never the body.
- **Only real ids.** Every `parent`, edge endpoint, entry point and tour step must be an id from `base.json` or a node added in a patch. Ids are `path` for dirs and files, and `path#Name` for symbols (`path#Name@line` when a name repeats in one file). Never invent another scheme.
- **No guessed edges.** Keep or add a `calls` edge only when you read the call in the source and can name the target's id. The scanner's candidates are usually right (about 95%+ in testing) but not always, and they miss member calls such as `obj.method()`; reviewers remove wrong ones and add the missing ones. Calls into libraries or the standard library get no edge. When unsure, leave the edge out: a missing edge costs less than a false one.
- **Prose comes from the code.** A summary states what the code does, in plain words and from reading it, plus why it matters when that is not obvious. Do not write "This file contains…" or repeat the name back. Do not claim behaviour you did not see. Use Markdown, and backticks for identifiers. Never use raw HTML (clu drops it).
- **Detail level.** Use classes, interfaces and top-level functions. Methods are not separate nodes. Mention the important ones in the class `description` instead. An exception: a language with no free functions, where a static method is the real entry point (C# `Main`). That may be added as a `method` node.
- **Containment is `parent` only.** There is no `contains` edge kind.
