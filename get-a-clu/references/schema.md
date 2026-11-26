# Codebase graph JSON, version 1.0

A codebase-graph file describes one codebase as a graph. Nodes are code elements, such as packages, files, classes and functions. Edges are relations between them, such as imports and calls. Optional tours walk a reader through the code.

- Machine-readable schema: [`schema/codebase-graph.schema.json`](../schema/codebase-graph.schema.json) (JSON Schema draft 2020-12).
- Example files: [`fixtures/small.json`](../fixtures/small.json) (every kind, with a tour) and [`fixtures/no-tour.json`](../fixtures/no-tour.json).
- All explanatory text comes from the file. The viewer does not generate prose, except for the connective sentences in an auto-generated tour (see [Tours](#tours)).

## Top level

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `version` | string | yes | Must be `"1.0"`. Any other value is a fatal error. |
| `codebase` | object | yes | Metadata, see below. |
| `nodes` | array of [Node](#node) | yes | At least one node. |
| `edges` | array of [Edge](#edge) | yes | Use `[]` when there are none. |
| `tours` | array of [Tour](#tour) | no | When absent or empty, the viewer generates one tour. |

### `codebase`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | Shown in the header and on the overview. |
| `description` | Markdown | no | Shown on the overview. |
| `entryPoints` | array of node ids | no | Listed on the overview. The auto-generated tour starts with them. |

## Node

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes | Unique across all nodes. Any string. Ids such as `pkg/file.ts#Class.method` are fine. |
| `kind` | enum | yes | `repository`, `package`, `directory`, `file`, `module`, `class`, `interface`, `function`, `method`, `variable` |
| `name` | string | yes | Short display name. |
| `parent` | node id | no | The containing node. **This is the only source of containment.** Omit it for top-level nodes. |
| `summary` | Markdown | no | One or two sentences. Used first in tour narratives. |
| `description` | Markdown | no | Longer explanation. |
| `path` | string | no | File or directory path. Fuzzy search matches it. |
| `startLine`, `endLine` | integer ≥ 1 | no | Shown as `path:start–end`. |
| `code` | string | no | Source snippet, syntax-highlighted in the detail panel. |
| `language` | string | no | A [highlight.js language name](https://github.com/highlightjs/highlight.js/blob/main/SUPPORTED_LANGUAGES.md), such as `typescript`, `python` or `go`. Unknown names are shown as plain text. |
| `metrics` | object of numbers | no | Free-form, for example `loc` or `complexity`. `loc` drives the default node size and the "top modules" ranking. Every metric key appears in the "Size" menu. |
| `tags` | array of strings | no | Free-form. Used by the tag filter. |

There is no `contains` edge kind. Containment comes only from `parent`, so containment conflicts cannot happen. The viewer draws parent-to-child links itself, as faint grey "contains" lines.

## Edge

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | no | Unique across all edges when given. The viewer names unnamed edges `e<index>`. |
| `source`, `target` | node id | yes | The direction reads "source *kind* target", for example "A imports B". |
| `kind` | enum | yes | `imports`, `calls`, `inherits`, `implements`, `references` |
| `description` | Markdown | no | Shown under the edge in the detail panel. |
| `weight` | number | no | Kept in the model. The viewer does not use it yet. |

Parallel edges (same source, target and kind) are allowed.

## Tour

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes | Unique across tours. |
| `title` | string | yes | |
| `description` | Markdown | no | Shown in the overview's tour list. |
| `steps` | array | yes | At least one step, played in order. |
| `steps[].nodeId` | node id | yes | The node to select and focus. Collapsed ancestors are expanded. |
| `steps[].title` | string | no | Defaults to the node's name. |
| `steps[].narrative` | Markdown | yes | The text of the step. |

### Auto-generated tour

When the file has no valid tours, the viewer builds one:

1. Every `codebase.entryPoints` node, in order.
2. The top-level packages, directories and modules (those with no package, directory or module ancestor), ranked by total lines of code, then by descendant count. At most 5.
3. After each of those, its 3 most connected descendants, ranked by degree (incoming plus outgoing edges).

A step's narrative is the node's `summary` (or `description`), plus generated sentences such as "It is imported by 3 nodes."

## Markdown

All Markdown fields use CommonMark plus GitHub Flavored Markdown (tables, strikethrough, task lists). The file is untrusted input, so:

- Raw HTML is never rendered. HTML blocks and inline tags are dropped.
- `javascript:` and other unsafe URLs are removed. Links open in a new tab.
- Images are not loaded. Their alt text appears as `[image: alt]`, so the viewer makes no network requests.

## Validation

**Fatal errors** stop the load. The viewer shows the message and no graph:

| Problem | Fixture |
| --- | --- |
| The file is not valid JSON | `fixtures/invalid/fatal-not-json.json` |
| The top level is not an object | `fatal-not-object.json` |
| `version` is missing | `fatal-missing-version.json` |
| `version` is not `"1.0"` | `fatal-unsupported-version.json` |
| `codebase` or `codebase.name` is missing | `fatal-missing-codebase.json` |
| `nodes` is missing or not an array | `fatal-missing-nodes.json` |
| `nodes` is empty, or contains no valid node | `fatal-empty-nodes.json` |
| `edges` is missing or not an array | `fatal-missing-edges.json` |

**Warnings** skip or repair the offending item. The rest of the file loads, and the Warnings panel lists each warning with its item (id and/or array index) and the reason:

| Code | Meaning | What the viewer does |
| --- | --- | --- |
| `invalid-node` | No string `id`, `name` or `kind` | Skips the node |
| `unknown-node-kind` | `kind` is not in the list | Skips the node |
| `duplicate-node-id` | The id is already used | Keeps the first node and skips this one |
| `missing-parent` | `parent` is not a node id | Shows the node at the top level |
| `parent-cycle` | The `parent` chain loops, including a node that is its own parent | Drops `parent` on the node where the loop closes |
| `invalid-edge` | No string `source`, `target` or `kind` | Skips the edge |
| `unknown-edge-kind` | `kind` is not in the list (this includes `contains`) | Skips the edge |
| `dangling-edge` | `source` or `target` is not a node id | Skips the edge |
| `duplicate-edge-id` | The explicit id is already used | Skips the edge |
| `unknown-entry-point` | An entry point is not a node id | Drops the entry point |
| `invalid-tour` | A tour or step is missing a required field | Skips the tour or step |
| `duplicate-tour-id` | The tour id is already used | Skips the tour |
| `unknown-tour-node` | `steps[].nodeId` is not a node id | Skips the step |
| `empty-tour` | No valid steps remain | Skips the tour |

The JSON Schema can check structure, but it cannot check references. Two fixtures show the difference:

- `fixtures/invalid/warnings-structural.json` **fails** the schema (bad node, unknown kinds, edge without target, tour without title). The viewer loads the rest of it and shows warnings.
- `fixtures/invalid/warnings-referential.json` **passes** the schema, but it has duplicate ids, a missing parent, a parent cycle, a dangling edge and unknown tour nodes. Only the viewer catches these.

The viewer ignores unknown extra fields. The schema rejects them (`additionalProperties: false`), so typos show up when you validate.

## Annotated example

```jsonc
{
  "version": "1.0",                       // required, must be "1.0"
  "codebase": {
    "name": "tasklist",
    "description": "A small **task tracker**.",   // Markdown
    "entryPoints": ["api.startServer"]           // node ids
  },
  "nodes": [
    { "id": "repo", "kind": "repository", "name": "tasklist" },          // no parent: top level
    { "id": "core", "kind": "package", "name": "core", "parent": "repo",
      "path": "packages/core", "summary": "Domain model and storage." },
    { "id": "core/src/store.ts", "kind": "file", "name": "store.ts", "parent": "core",
      "path": "packages/core/src/store.ts", "metrics": { "loc": 120 } },
    { "id": "core.TaskStore", "kind": "class", "name": "TaskStore", "parent": "core/src/store.ts",
      "path": "packages/core/src/store.ts", "startLine": 32, "endLine": 110,
      "language": "typescript",
      "code": "export class TaskStore { /* ... */ }",
      "metrics": { "loc": 79, "complexity": 9 },
      "tags": ["public-api", "hot-path"],
      "summary": "The **central class**.",
      "description": "Validates input on `add`." },
    { "id": "api.startServer", "kind": "function", "name": "startServer", "parent": "repo" }
  ],
  "edges": [
    { "source": "api.startServer", "target": "core.TaskStore", "kind": "references",
      "description": "Creates the store." }      // id is optional
  ],
  "tours": [
    { "id": "intro", "title": "Start here",
      "steps": [
        { "nodeId": "api.startServer", "narrative": "Execution starts here." },
        { "nodeId": "core.TaskStore", "title": "The store", "narrative": "Everything goes through **TaskStore**." }
      ] }
  ]
}
```

(The real file must be plain JSON, without comments.)
