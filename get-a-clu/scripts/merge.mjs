#!/usr/bin/env node
// Applies patch files to a graph and writes the result.
// Usage: node merge.mjs <graph.json> <patch.json>... --out <result.json>
//
// Patch format (every key optional):
// {
//   "codebase":    { "description": "...", "entryPoints": ["id", ...] },  // shallow-merged into codebase
//   "update":      { "<nodeId>": { "summary": "...", "tags": ["..."], ... } }, // fields set on existing nodes;
//                                                                            // tags are unioned; null deletes a field
//   "add":         [ { "id": "...", "kind": "...", "name": "...", "parent": "...", ... } ], // new nodes
//   "remove":      [ "<nodeId>" ],          // removes the node, its descendants and every edge touching them
//   "edges":       [ { "source": "...", "target": "...", "kind": "calls", "description": "..." } ],
//   "removeEdges": [ { "source": "...", "target": "...", "kind": "..." } ],
//   "tours":       [ { "id": "...", "title": "...", "steps": [ { "nodeId": "...", "narrative": "..." } ] } ]
// }
// Edges are deduplicated by source|target|kind (a later description fills an empty one).
// Edges whose endpoints do not exist are dropped and listed, so a bad id never reaches the output.
import fs from 'node:fs';

const args = process.argv.slice(2);
const oi = args.indexOf('--out');
if (oi < 0 || args.length < 3) { console.error('usage: node merge.mjs <graph.json> <patch.json>... --out <result.json>'); process.exit(2); }
const outFile = args[oi + 1];
const [base, ...patches] = args.filter((_, i) => i !== oi && i !== oi + 1);
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
const g = read(base);
const byId = new Map(g.nodes.map((n) => [n.id, n]));
const key = (e) => `${e.source}|${e.target}|${e.kind}`;
const edges = new Map(g.edges.map((e) => [key(e), e]));
const tours = new Map((g.tours ?? []).map((t) => [t.id, t]));
const report = { updated: 0, added: 0, removed: 0, edgesAdded: 0, edgesRemoved: 0, tours: 0, unknownUpdate: [], dupAdd: [], dropped: [] };

for (const pf of patches) {
  let p;
  try { p = read(pf); } catch (e) { console.error(`skipping ${pf}: ${e.message}`); process.exitCode = 1; continue; }
  if (p.codebase) Object.assign(g.codebase, p.codebase);
  for (const n of p.add ?? []) {
    if (byId.has(n.id)) { report.dupAdd.push(`${n.id} (${pf})`); Object.assign(byId.get(n.id), n); continue; }
    byId.set(n.id, n); report.added++;
  }
  for (const [id, fields] of Object.entries(p.update ?? {})) {
    const n = byId.get(id);
    if (!n) { report.unknownUpdate.push(`${id} (${pf})`); continue; }
    for (const [k, v] of Object.entries(fields)) {
      if (v === null) delete n[k];
      else if (k === 'tags') n.tags = [...new Set([...(n.tags ?? []), ...v])];
      else n[k] = v;
    }
    report.updated++;
  }
  for (const id of p.remove ?? []) {
    if (!byId.has(id)) continue;
    const doomed = new Set([id]);
    for (let grew = true; grew;) { grew = false; for (const n of byId.values()) if (!doomed.has(n.id) && doomed.has(n.parent)) { doomed.add(n.id); grew = true; } }
    for (const d of doomed) { byId.delete(d); report.removed++; }
    for (const [k, e] of edges) if (doomed.has(e.source) || doomed.has(e.target)) edges.delete(k);
  }
  for (const e of p.removeEdges ?? []) if (edges.delete(key(e))) report.edgesRemoved++;
  for (const e of p.edges ?? []) {
    const k = key(e);
    const prev = edges.get(k);
    if (prev) { if (!prev.description && e.description) prev.description = e.description; continue; }
    edges.set(k, e); report.edgesAdded++;
  }
  for (const t of p.tours ?? []) { tours.set(t.id, t); report.tours++; }
}

// Drop what would become clu warnings because an id does not exist.
for (const [k, e] of edges) {
  const miss = [e.source, e.target].filter((x) => !byId.has(x));
  if (miss.length) { edges.delete(k); report.dropped.push(`edge ${e.source} -${e.kind}-> ${e.target} (missing ${miss.join(', ')})`); }
}
for (const n of byId.values()) if (n.parent && !byId.has(n.parent)) report.dropped.push(`node ${n.id}: parent ${n.parent} does not exist (left as is)`);
if (Array.isArray(g.codebase.entryPoints)) {
  const keep = g.codebase.entryPoints.filter((id) => byId.has(id));
  for (const id of g.codebase.entryPoints) if (!byId.has(id)) report.dropped.push(`entry point ${id}`);
  g.codebase.entryPoints = keep;
}
for (const t of tours.values()) {
  const before = t.steps?.length ?? 0;
  t.steps = (t.steps ?? []).filter((s) => byId.has(s.nodeId));
  if (t.steps.length < before) report.dropped.push(`tour ${t.id}: ${before - t.steps.length} step(s) with unknown nodeId`);
  if (!t.steps.length) { tours.delete(t.id); report.dropped.push(`tour ${t.id}: no valid steps left, removed`); }
}

g.nodes = [...byId.values()];
g.edges = [...edges.values()];
if (tours.size) g.tours = [...tours.values()]; else delete g.tours;
fs.writeFileSync(outFile, JSON.stringify(g, null, 2));

console.log(`wrote ${outFile}: ${g.nodes.length} nodes, ${g.edges.length} edges, ${tours.size} tours`);
console.log(`updated ${report.updated}, added ${report.added}, removed ${report.removed} nodes; +${report.edgesAdded}/-${report.edgesRemoved} edges; ${report.tours} tour(s) from patches`);
for (const [label, list] of [['update for unknown node id', report.unknownUpdate], ['add of an existing id (merged into it)', report.dupAdd], ['dropped', report.dropped]]) {
  if (!list.length) continue;
  console.log(`${label} (${list.length}):`);
  for (const x of list.slice(0, 40)) console.log(`  ${x}`);
  if (list.length > 40) console.log(`  ... ${list.length - 40} more`);
}
