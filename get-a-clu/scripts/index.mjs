#!/usr/bin/env node
// Compact listing of a graph, sized for an agent's context.
// Usage: node index.mjs <graph.json> [--under <path-prefix>]... [--names]
//   --under  list files and symbols whose path starts with the prefix (repeatable; default: everything)
//   --names  append "name<TAB>id" for every class/interface/function in the whole graph,
//            so calls/inherits edges can target real ids outside the listed group
import fs from 'node:fs';

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--under');
if (!file) { console.error('usage: node index.mjs <graph.json> [--under <path-prefix>]... [--names]'); process.exit(2); }
const unders = args.flatMap((a, i) => (args[i - 1] === '--under' ? [a.replace(/\\/g, '/').replace(/\/$/, '')] : []));
const g = JSON.parse(fs.readFileSync(file, 'utf8'));
const inGroup = (p) => !unders.length || unders.some((u) => p === u || p?.startsWith(`${u}/`));
const SYM = new Set(['class', 'interface', 'function', 'method', 'variable', 'module']);

const kids = new Map();
for (const n of g.nodes) if (SYM.has(n.kind)) { if (!kids.has(n.parent)) kids.set(n.parent, []); kids.get(n.parent).push(n); }
const out = (n, kind = 'imports') => g.edges.filter((e) => e.source === n.id && e.kind === kind).map((e) => e.target);
const callsOf = (n) => { const c = out(n, 'calls'); return c.length ? ` | calls: ${c.join(', ')}` : ''; };

console.log('# files and symbols: id | kind | lines | signature');
for (const f of g.nodes.filter((n) => n.kind === 'file' && inGroup(n.path))) {
  const imps = out(f);
  console.log(`${f.id} | file | ${f.metrics?.loc ?? '?'} loc${imps.length ? ` | imports: ${imps.join(', ')}` : ''}${callsOf(f)}`);
  const walk = (id, depth) => {
    for (const s of kids.get(id) ?? []) {
      console.log(`${'  '.repeat(depth)}${s.id} | ${s.kind}${s.tags?.length ? `(${s.tags.join(',')})` : ''} | ${s.startLine ?? '?'}-${s.endLine ?? '?'} | ${s.code ?? ''}${callsOf(s)}`);
      walk(s.id, depth + 1);
    }
  };
  walk(f.id, 1);
}
if (args.includes('--names')) {
  console.log('\n# every class/interface/function: name<TAB>id');
  for (const n of g.nodes) if (['class', 'interface', 'function', 'method'].includes(n.kind)) console.log(`${n.name}\t${n.id}`);
}
