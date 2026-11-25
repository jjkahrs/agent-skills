#!/usr/bin/env node
// Self-check for scan/merge/validate on a tiny multi-language project. Run: node selftest.mjs
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'get-a-clu-'));
const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };

w('web/package.json', '{}');
w('web/src/base.ts', 'export interface Shape { area(): number }\nexport abstract class Base implements Shape {\n  area() { return 0; }\n}\n');
w('web/src/app.ts', [
  "import { Base } from './base';",
  "const t = `a ${1 ? `b ${'}'}` : ''} c`;",
  'export class Circle extends Base {',
  '  area() { return 3; }',
  '}',
  'export const double = (x: number): { v: number } => ({ v: x * 2 });',
  'export function main(): void {',
  '  new Circle().area();',
  '}',
  '',
].join('\n'));
w('py/pkg/__init__.py', '');
w('py/pkg/models.py', 'class Animal:\n    """Doc with\nclass Fake: inside"""\n    def speak(self):\n        return 1\n\n\nclass Dog(Animal):\n    pass\n');
w('py/pkg/run.py', 'from .models import Dog\n\n\n@decorator\ndef go(n=(1, 2)):\n    return Dog()\n\n\n@pytest.mark.skipif(\n    True,\n    reason="x",\n)\n@other\ndef later():\n    pass\n\n\nfrom . import models as m\n\n\ndef pet():\n    return m.Animal()\n');
w('web/src/view.tsx', 'export function Badge() { return <b />; }\nexport function View(): JSX.Element {\n  const xs: Array<Badge> = [];\n  return <div><Badge /></div>;\n}\n');
w('cs/Game.csproj', '<Project/>');
w('cs/Entity.cs', 'namespace Game {\n  public abstract class Entity { }\n  public interface IMove { void Move(); }\n}\n');
w('cs/Player.cs', 'using System;\nnamespace Game {\n  public sealed class Player : Entity, IMove {\n    public void Move() { var s = @"{"; }\n  }\n  public record Pos(int X, int Y);\n}\n');
w('cs/Check.cs', 'namespace Game {\n  public class Check {\n    sealed class Player { }\n    void Run() { new Player(); }\n  }\n}\n');
w('cpp/geo.h', '#pragma once\nnamespace geo {\nstruct Vec { float x; };\nclass Body : public Vec {\n public:\n  void step();\n};\nint add(int a, int b);\n}\n');
w('cpp/geo.cpp', '#include "geo.h"\nnamespace geo {\nvoid Body::step() { }\nint add(int a, int b)\n{\n  return a + b; // }\n}\n}\n');
w('node_modules/x/index.js', 'function ignored() {}');

const out = path.join(dir, 'out.json');
execFileSync('node', [path.join(here, 'scan.mjs'), dir, '--out', out], { stdio: 'pipe' });
const g = JSON.parse(fs.readFileSync(out, 'utf8'));
const node = (id) => g.nodes.find((n) => n.id === id);
const lines = (id) => { const n = node(id); assert.ok(n, `missing node ${id}`); return [n.startLine, n.endLine]; };
const edge = (s, t, k) => assert.ok(g.edges.some((e) => e.source === s && e.target === t && e.kind === k), `missing edge ${s} -${k}-> ${t}`);

assert.equal(node('web').kind, 'package');
assert.equal(node('cs').kind, 'package');
assert.ok(!g.nodes.some((n) => n.id.startsWith('node_modules')), 'node_modules must be ignored');
// TypeScript
assert.equal(node('web/src/base.ts#Shape').kind, 'interface');
assert.deepEqual(lines('web/src/app.ts#Circle'), [3, 5]);
assert.deepEqual(lines('web/src/app.ts#double'), [6, 6]);
assert.deepEqual(lines('web/src/app.ts#main'), [7, 9]);
assert.equal(node('web/src/app.ts#main').code, 'export function main(): void');
edge('web/src/app.ts', 'web/src/base.ts', 'imports');
edge('web/src/app.ts#Circle', 'web/src/base.ts#Base', 'inherits');
edge('web/src/base.ts#Base', 'web/src/base.ts#Shape', 'implements');
// Python
assert.deepEqual(lines('py/pkg/models.py#Animal'), [1, 5]);
assert.ok(!node('py/pkg/models.py#Fake'), 'class inside a docstring is not a symbol');
assert.deepEqual(lines('py/pkg/run.py#go'), [4, 6]);
assert.equal(node('py/pkg/run.py#go').code, 'def go(n=(1, 2))');
assert.deepEqual(lines('py/pkg/run.py#later'), [9, 15]);
edge('py/pkg/run.py', 'py/pkg/models.py', 'imports');
edge('py/pkg/models.py#Dog', 'py/pkg/models.py#Animal', 'inherits');
// C#
assert.deepEqual(lines('cs/Player.cs#Player'), [3, 5]);
assert.deepEqual(node('cs/Player.cs#Pos').tags, ['record']);
edge('cs/Player.cs#Player', 'cs/Entity.cs#Entity', 'inherits');
edge('cs/Player.cs#Player', 'cs/Entity.cs#IMove', 'implements');
edge('cs/Player.cs', 'cs/Entity.cs#Entity', 'references');
assert.ok(!g.edges.some((e) => e.source === 'cs/Check.cs' && e.target === 'cs/Player.cs#Player'), 'a nested type shadows a same-named type');
// C++
assert.deepEqual(lines('cpp/geo.h#Body'), [4, 7]);
assert.ok(!node('cpp/geo.h#add'), 'a prototype is not a definition');
assert.ok(!g.nodes.some((n) => n.name === 'step'), 'out-of-line methods are skipped');
assert.deepEqual(lines('cpp/geo.cpp#add'), [4, 7]);
edge('cpp/geo.cpp', 'cpp/geo.h', 'imports');
edge('cpp/geo.h#Body', 'cpp/geo.h#Vec', 'inherits');

// candidate calls patch
const cands = JSON.parse(fs.readFileSync(path.join(dir, 'out.calls.json'), 'utf8')).edges.map((e) => `${e.source}->${e.target}`);
assert.ok(cands.includes('web/src/app.ts#main->web/src/app.ts#Circle'), 'new Circle() is a call to the class');
assert.ok(cands.includes('py/pkg/run.py#go->py/pkg/models.py#Dog'), 'Dog() through an import');
assert.ok(cands.includes('py/pkg/run.py#pet->py/pkg/models.py#Animal'), 'module alias call m.Animal()');
assert.ok(cands.includes('web/src/view.tsx#View->web/src/view.tsx#Badge'), 'JSX <Badge /> render');
assert.equal(cands.filter((c) => c === 'web/src/view.tsx#View->web/src/view.tsx#Badge').length, 1);
assert.ok(!cands.some((c) => c.includes('#area')),'declarations and member calls are not candidates');
assert.ok(!cands.some((c) => c.startsWith('cpp/geo.h')), 'header prototypes are not calls');

const v = (f) => { try { execFileSync('node', [path.join(here, 'validate.mjs'), f], { stdio: 'pipe' }); return 0; } catch (e) { return e.status; } };
assert.equal(v(out), 0, 'skeleton must validate');

// merge: summaries, a calls edge, a bad edge that must be dropped, a tour
const patch = path.join(dir, 'patch.json');
fs.writeFileSync(patch, JSON.stringify({
  codebase: { description: 'Test.', entryPoints: ['web/src/app.ts#main', 'nope'] },
  update: { 'web/src/app.ts#main': { summary: 'Entry.', tags: ['entry'] } },
  edges: [{ source: 'web/src/app.ts#main', target: 'web/src/app.ts#Circle', kind: 'calls' },
    { source: 'web/src/app.ts#main', target: 'does-not-exist', kind: 'calls' }],
  tours: [{ id: 't', title: 'T', steps: [{ nodeId: 'web/src/app.ts#main', narrative: 'Start.' }, { nodeId: 'ghost', narrative: 'x' }] }],
}));
const merged = path.join(dir, 'merged.json');
execFileSync('node', [path.join(here, 'merge.mjs'), out, patch, '--out', merged], { stdio: 'pipe' });
const m = JSON.parse(fs.readFileSync(merged, 'utf8'));
assert.equal(m.nodes.find((n) => n.id === 'web/src/app.ts#main').summary, 'Entry.');
assert.deepEqual(m.codebase.entryPoints, ['web/src/app.ts#main']);
assert.equal(m.edges.filter((e) => e.kind === 'calls').length, 1);
assert.equal(m.tours[0].steps.length, 1);
assert.equal(v(merged), 0, 'merged graph must validate');

// validate catches clu warnings and schema errors
const bad = path.join(dir, 'bad.json');
fs.writeFileSync(bad, JSON.stringify({ version: '1.0', codebase: { name: 'x' }, nodes: [{ id: 'a', kind: 'file', name: 'a', extra: 1 }], edges: [{ source: 'a', target: 'b', kind: 'calls' }] }));
assert.equal(v(bad), 1);

fs.rmSync(dir, { recursive: true, force: true });
console.log('selftest OK');
