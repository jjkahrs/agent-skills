#!/usr/bin/env node
// Validates a clu codebase-graph file the way clu does, plus the JSON Schema's structural rules.
// Usage: node validate.mjs <graph.json> [--max 50]
// Exit 0 only when there are no fatal errors, no schema errors and no clu warnings.
// Also prints coverage stats (missing summaries etc.) to show how complete the prose is.
import fs from 'node:fs';

const NODE_KINDS = ['repository', 'package', 'directory', 'file', 'module', 'class', 'interface', 'function', 'method', 'variable'];
const EDGE_KINDS = ['imports', 'calls', 'inherits', 'implements', 'references'];
const NODE_FIELDS = { id: 'str1', kind: 'str', name: 'str1', parent: 'str1', summary: 'str', description: 'str', path: 'str',
  startLine: 'int1', endLine: 'int1', code: 'str', language: 'str', metrics: 'metrics', tags: 'strs' };
const EDGE_FIELDS = { id: 'str1', source: 'str1', target: 'str1', kind: 'str', description: 'str', weight: 'num' };

const file = process.argv[2];
const maxIdx = process.argv.indexOf('--max');
const MAX = maxIdx > 0 ? Number(process.argv[maxIdx + 1]) : 50;
if (!file) { console.error('usage: node validate.mjs <graph.json> [--max 50]'); process.exit(2); }

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const nonEmpty = (v) => isStr(v) && v.length > 0;
const checkType = (t, v) => ({
  str: isStr(v), str1: nonEmpty(v), int1: Number.isInteger(v) && v >= 1, num: typeof v === 'number' && Number.isFinite(v),
  metrics: isObj(v) && Object.values(v).every((x) => typeof x === 'number' && Number.isFinite(x)),
  strs: Array.isArray(v) && v.every(isStr),
}[t]);

const fatal = [];
const schema = []; // structural problems the JSON Schema rejects (clu itself may still load the file)
const warnings = []; // clu's load warnings: these items are skipped or repaired by the viewer

let data;
try { data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) { fatal.push(`not valid JSON: ${e.message}`); }
if (!fatal.length) {
  if (!isObj(data)) fatal.push('top level must be a JSON object');
  else {
    if (data.version === undefined) fatal.push('missing "version"');
    else if (data.version !== '1.0') fatal.push(`unsupported version ${JSON.stringify(data.version)} (must be "1.0")`);
    if (!isObj(data.codebase) || !nonEmpty(data.codebase.name)) fatal.push('missing object "codebase" with a non-empty "name"');
    if (!Array.isArray(data.nodes)) fatal.push('missing array "nodes"');
    else if (!data.nodes.length) fatal.push('"nodes" is empty');
    if (!Array.isArray(data.edges)) fatal.push('missing array "edges" (use [])');
    if (data.tours !== undefined && !Array.isArray(data.tours)) fatal.push('"tours" must be an array');
  }
}

if (!fatal.length) {
  for (const k of Object.keys(data)) if (!['$schema', 'version', 'codebase', 'nodes', 'edges', 'tours'].includes(k)) schema.push(`top level: unknown field "${k}"`);
  for (const k of Object.keys(data.codebase)) if (!['name', 'description', 'entryPoints'].includes(k)) schema.push(`codebase: unknown field "${k}"`);
  if (data.codebase.description !== undefined && !isStr(data.codebase.description)) schema.push('codebase.description must be a string');
  if (data.codebase.entryPoints !== undefined && !(Array.isArray(data.codebase.entryPoints) && data.codebase.entryPoints.every(nonEmpty)))
    schema.push('codebase.entryPoints must be an array of non-empty strings');

  // nodes
  const byId = new Map();
  data.nodes.forEach((raw, i) => {
    const ref = isObj(raw) && nonEmpty(raw.id) ? `node "${raw.id}"` : `nodes[${i}]`;
    if (!isObj(raw)) { warnings.push(`invalid-node: ${ref} is not an object`); return; }
    for (const [k, v] of Object.entries(raw)) {
      if (!(k in NODE_FIELDS)) schema.push(`${ref}: unknown field "${k}"`);
      else if (!checkType(NODE_FIELDS[k], v)) schema.push(`${ref}: field "${k}" has the wrong type (${JSON.stringify(v)?.slice(0, 60)})`);
    }
    if (Number.isInteger(raw.startLine) && Number.isInteger(raw.endLine) && raw.endLine < raw.startLine) schema.push(`${ref}: endLine is before startLine`);
    if (!nonEmpty(raw.id) || !nonEmpty(raw.name) || !isStr(raw.kind)) { warnings.push(`invalid-node: ${ref} needs non-empty string id, name and kind`); return; }
    if (!NODE_KINDS.includes(raw.kind)) { warnings.push(`unknown-node-kind: ${ref} has kind "${raw.kind}"`); schema.push(`${ref}: kind "${raw.kind}" is not allowed`); return; }
    if (byId.has(raw.id)) { warnings.push(`duplicate-node-id: ${ref} (nodes[${i}]) repeats an earlier id`); return; }
    byId.set(raw.id, raw);
  });
  if (!byId.size) fatal.push('no valid node in "nodes"');

  // parents and cycles
  for (const n of byId.values()) if (nonEmpty(n.parent) && !byId.has(n.parent)) warnings.push(`missing-parent: node "${n.id}" has parent "${n.parent}", which is not a node id`);
  const state = new Map(); // 1 visiting, 2 done
  for (const start of byId.keys()) {
    const chain = [];
    let cur = start;
    while (cur && byId.has(cur) && !state.get(cur)) { state.set(cur, 1); chain.push(cur); cur = byId.get(cur).parent; }
    if (cur && state.get(cur) === 1) warnings.push(`parent-cycle: the parent chain through "${cur}" loops`);
    for (const c of chain) state.set(c, 2);
  }

  // edges
  const edgeIds = new Set();
  data.edges.forEach((raw, i) => {
    const ref = isObj(raw) && nonEmpty(raw.id) ? `edge "${raw.id}"` : `edges[${i}]`;
    if (!isObj(raw)) { warnings.push(`invalid-edge: ${ref} is not an object`); return; }
    for (const [k, v] of Object.entries(raw)) {
      if (!(k in EDGE_FIELDS)) schema.push(`${ref}: unknown field "${k}"`);
      else if (!checkType(EDGE_FIELDS[k], v)) schema.push(`${ref}: field "${k}" has the wrong type`);
    }
    if (!nonEmpty(raw.source) || !nonEmpty(raw.target) || !isStr(raw.kind)) { warnings.push(`invalid-edge: ${ref} needs string source, target and kind`); return; }
    if (!EDGE_KINDS.includes(raw.kind)) { warnings.push(`unknown-edge-kind: ${ref} has kind "${raw.kind}"`); schema.push(`${ref}: kind "${raw.kind}" is not allowed`); return; }
    const missing = [raw.source, raw.target].filter((x) => !byId.has(x));
    if (missing.length) { warnings.push(`dangling-edge: ${ref} ${raw.source} -${raw.kind}-> ${raw.target}: ${missing.map((m) => `"${m}"`).join(' and ')} not a node id`); return; }
    if (nonEmpty(raw.id)) { if (edgeIds.has(raw.id)) warnings.push(`duplicate-edge-id: ${ref}`); edgeIds.add(raw.id); }
  });

  // entry points
  (Array.isArray(data.codebase.entryPoints) ? data.codebase.entryPoints : []).forEach((id, i) => {
    if (!byId.has(id)) warnings.push(`unknown-entry-point: codebase.entryPoints[${i}] ${JSON.stringify(id)} is not a node id`);
  });

  // tours
  const tourIds = new Set();
  (data.tours ?? []).forEach((raw, i) => {
    const ref = isObj(raw) && nonEmpty(raw.id) ? `tour "${raw.id}"` : `tours[${i}]`;
    if (!isObj(raw) || !nonEmpty(raw.id) || !nonEmpty(raw.title) || !Array.isArray(raw.steps)) { warnings.push(`invalid-tour: ${ref} needs id, title and steps`); return; }
    for (const k of Object.keys(raw)) if (!['id', 'title', 'description', 'steps'].includes(k)) schema.push(`${ref}: unknown field "${k}"`);
    if (raw.description !== undefined && !isStr(raw.description)) schema.push(`${ref}: description must be a string`);
    if (tourIds.has(raw.id)) { warnings.push(`duplicate-tour-id: ${ref}`); return; }
    if (!raw.steps.length) schema.push(`${ref}: steps must have at least one step`);
    let valid = 0;
    raw.steps.forEach((s, j) => {
      const sref = `${ref} step ${j + 1}`;
      if (isObj(s)) for (const k of Object.keys(s)) if (!['nodeId', 'title', 'narrative'].includes(k)) schema.push(`${sref}: unknown field "${k}"`);
      if (isObj(s) && s.title !== undefined && !isStr(s.title)) schema.push(`${sref}: title must be a string`);
      if (!isObj(s) || !nonEmpty(s.nodeId) || !isStr(s.narrative)) { warnings.push(`invalid-tour: ${sref} needs nodeId and narrative`); return; }
      if (!byId.has(s.nodeId)) { warnings.push(`unknown-tour-node: ${sref} node "${s.nodeId}" does not exist`); return; }
      valid++;
    });
    if (!valid) { warnings.push(`empty-tour: ${ref} has no valid steps`); return; }
    tourIds.add(raw.id);
  });

  // coverage stats (informational)
  const nodes = [...byId.values()];
  const count = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
  const needProse = nodes.filter((n) => n.kind !== 'repository');
  const noSummary = needProse.filter((n) => !n.summary && !n.description);
  console.log(`nodes: ${nodes.length} ${JSON.stringify(count(nodes, (n) => n.kind))}`);
  console.log(`edges: ${data.edges.length} ${JSON.stringify(count(data.edges.filter(isObj), (e) => e.kind))}`);
  console.log(`tours: ${(data.tours ?? []).length}, entryPoints: ${(data.codebase.entryPoints ?? []).length}, codebase.description: ${data.codebase.description ? 'yes' : 'no'}`);
  console.log(`summaries: ${needProse.length - noSummary.length}/${needProse.length} nodes (repository root not counted)${noSummary.length ? ` (missing by kind: ${JSON.stringify(count(noSummary, (n) => n.kind))})` : ''}`);
}

const show = (title, list) => {
  if (!list.length) return;
  console.log(`\n${title} (${list.length}):`);
  for (const x of list.slice(0, MAX)) console.log(`  ${x}`);
  if (list.length > MAX) console.log(`  ... ${list.length - MAX} more (use --max)`);
};
show('FATAL', fatal);
show('SCHEMA ERRORS', schema);
show('CLU WARNINGS', warnings);
const ok = !fatal.length && !schema.length && !warnings.length;
console.log(ok ? '\nOK: valid, 0 schema errors, 0 clu warnings' : '\nFAILED');
process.exit(ok ? 0 : 1);
