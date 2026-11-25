# Brief: describe one group of a codebase graph

You are filling in one part of a codebase-graph file for **clu**, an explorer that shows code as a graph. A scanner has already built the base graph: nodes for dirs, files and top-level classes/interfaces/functions, imports and inheritance edges, and **candidate** `calls` edges for direct calls it could resolve. Your job is the part that needs reading: true summaries, reviewing and completing the `calls` edges, and fixes for what the scanner got wrong. Write it all as **one patch file**. Do not edit the base graph.

The orchestrator gives you: the project path, the base graph path (`base.json`), the scripts path, your group's `--under` prefix or prefixes, the patch file path and a short project brief.

## Steps

1. Get your listing and the global name table:
   ```sh
   node <scripts>/index.mjs <base.json> --under <prefix> [--under <prefix2>] --names
   ```
   Every id you write must come from this output, or be a node you add yourself in the same patch. Each line shows the node's current `calls`: those are the scanner's candidates for you to review.
2. Read every file in your group in full. They are listed with their symbols and line ranges.
3. Write the patch (format below), then check that it parses: `node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" <patch>`.
4. Reply with: the number of summaries, calls edges added and removed, nodes added and removed, and anything odd you noticed. Keep it under 15 lines.

## Patch format

```json
{
  "update": {
    "src/model/tour.ts": { "summary": "Builds guided tours: authored ones are used as is, otherwise one is generated from entry points and the largest packages.", "tags": ["core"] },
    "src/model/tour.ts#generateTour": { "summary": "Generates a tour from entry points, then the top 5 packages by loc, then each one's 3 most connected children.", "description": "Optional longer Markdown." }
  },
  "add": [
    { "id": "src/x.ts#missed", "kind": "function", "name": "missed", "parent": "src/x.ts", "path": "src/x.ts",
      "startLine": 10, "endLine": 24, "language": "typescript", "code": "export function missed(a: string): number",
      "metrics": { "loc": 15 }, "summary": "..." }
  ],
  "remove": ["src/y.ts#notReallyAFunction"],
  "removeEdges": [ { "source": "src/a.ts#run", "target": "src/b.ts#run", "kind": "calls" } ],
  "edges": [
    { "source": "src/model/tour.ts#generateTour", "target": "src/model/tour.ts#narrativeFor", "kind": "calls", "description": "Writes each step's text." }
  ]
}
```

## What to write

**Summaries.** Write one for every file, class, interface and function in your group, and for every directory and package whose path is under your prefix, including the prefix directory itself.

- 1–2 sentences on what it does and, when it is not obvious, why it matters.
- Be concrete: name the inputs, outputs and side effects. *Good:* "Parses `--nodes/--edges/--seed` flags and writes a seeded random graph to `--out`." *Bad:* "This file contains the generator logic."
- Add a `description` (a short Markdown paragraph or list) only for the central classes and functions. In a class description, name its key methods.
- Use backticks for identifiers. Never use raw HTML.

**Tags.** These are optional and short. Use `test` for test files and test helpers, `entry` for program entry points, `cli`, `ui`, `api`, `db`, `config` or similar where they help filtering. Keep the vocabulary small and consistent.

**`calls` edges.** Start from the candidates in your listing. As you read each file:

- **Remove** a candidate that is wrong (the name resolves to a different function, or it is not a call) with `removeEdges`: `{ "source": "...", "target": "...", "kind": "calls" }`.
- **Add** the calls the scanner cannot see. These are mostly member calls (`obj.method()`, `this.x.y()`, `ptr->f()`) whose target class has a node, plus calls through aliases or re-exports.
- A component rendering another (`<Badge />` in JSX/TSX) counts as `calls`. The scanner already proposes these.
- Do not write a script to extract calls: the candidates already cover the direct calls, and what is left needs reading.

An edge belongs when code in your group calls a function, or constructs or calls into a class, that has a node anywhere in the graph (check `--names`).

- `source`: the innermost node that holds the call site. That is the function or class containing it, or the file for top-level code.
- `target`: the called function's node, or the class node when a method or constructor of that class is called (methods are not nodes).
- Resolve the target through the file's imports, namespace or same-file definitions. When a name maps to several ids, pick the one the file really imports. If you cannot tell, skip it.
- Skip calls into libraries and the standard library, and calls you only infer. One edge per (source, target) pair. Add a short `description` when the reason is not obvious.
- Use `references` (not `calls`) for an important non-call use, such as passing a type to a generic or registering a handler. Use these sparingly.

**Fixes.**

- **Missed symbols.** If a top-level class, interface or function is missing, `add` it:
  - `id` is `<file>#<Name>`, with `parent` and `path` both the file
  - correct `startLine`/`endLine`
  - `code` is **the signature only**
  - `metrics.loc` and `language`
- **False positives.** If a "function" is not one, `remove` it. Examples: a macro call, a constructor initializer, a variable.
- **Wrong line ranges.** If a line range is wrong, `update` its `startLine`/`endLine`.
- **Wrong kinds.** Set the right kind with `update` (for example an interface that came out as a class). Kinds are `class`, `interface`, `function`, `method`, `variable` and `module`.
- **What to leave alone.** Do not add methods or nested functions as nodes. One exception: C# or Java `Main` or a similar sole entry point may be added as a `method` under its class.

Nothing you write may contradict the source. If you are unsure about a behaviour, describe less rather than guess.
