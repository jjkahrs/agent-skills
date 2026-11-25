#!/usr/bin/env node
// Mechanical first pass over a project: directories, files, top-level classes/functions,
// imports and inheritance, written as a valid clu codebase-graph (version 1.0) skeleton.
// Usage: node scan.mjs <projectDir> [--out skeleton.json] [--exclude <path-prefix>]...
// No dependencies. Symbol extraction is heuristic (regex + brace/indent matching).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const LANG = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', cs: 'csharp',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', h: 'cpp', ipp: 'cpp', inl: 'cpp', c: 'c',
  go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift', rb: 'ruby', php: 'php', lua: 'lua',
  sql: 'sql', sh: 'bash', bash: 'bash', ps1: 'powershell', gd: 'gdscript', dart: 'dart', scala: 'scala',
};
// Language families that get symbol extraction. Everything else gets file nodes only.
const FAMILY = { typescript: 'ts', javascript: 'ts', csharp: 'cs', cpp: 'cpp', c: 'cpp', python: 'py' };
const IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'bin', 'obj', 'target', 'vendor', 'vendors', 'third_party', 'thirdparty',
  '.git', '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache', '.tox', 'coverage', '.next', '.nuxt',
  'Library', 'Temp', 'Logs', '.godot', '.import', '.vs', '.idea', 'site-packages',
]);
const SKIP_FILE = /(\.min\.js|\.bundle\.js|\.g\.cs|\.designer\.cs|\.generated\.\w+)$/i;
const MANIFESTS = ['package.json', 'pyproject.toml', 'setup.py', 'setup.cfg', 'Cargo.toml', 'go.mod', 'CMakeLists.txt',
  'pom.xml', 'build.gradle', 'composer.json', 'Gemfile', 'project.godot', '__init__.py', 'vcpkg.json'];
const MAX_BYTES = 1_000_000;

// ---------- args ----------
const argv = process.argv.slice(2);
const excludes = [];
let outFile = null;
let rootArg = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--out') outFile = argv[++i];
  else if (argv[i] === '--exclude') excludes.push(argv[++i].replace(/\\/g, '/').replace(/^\.\//, ''));
  else rootArg = argv[i];
}
if (!rootArg) {
  console.error('usage: node scan.mjs <projectDir> [--out skeleton.json] [--exclude <path-prefix>]...');
  process.exit(2);
}
const ROOT = path.resolve(rootArg);
if (!fs.existsSync(ROOT) || !fs.statSync(ROOT).isDirectory()) {
  console.error(`not a directory: ${ROOT}`);
  process.exit(2);
}
const NAME = path.basename(ROOT);
outFile = path.resolve(outFile ?? path.join(ROOT, `${NAME}.clu.json`));

// ---------- file list ----------
function listFiles() {
  try {
    const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'],
    });
    return { files: out.split('\0').filter(Boolean), source: 'git' };
  } catch {
    const files = [];
    const walk = (rel) => {
      for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { if (!IGNORE_DIRS.has(e.name) && !e.name.startsWith('.')) walk(r); }
        else if (e.isFile()) files.push(r);
      }
    };
    walk('');
    return { files, source: 'walk' };
  }
}
const extOf = (p) => (p.match(/\.([^./]+)$/)?.[1] ?? '').toLowerCase();
const listed = listFiles();
const outRel = path.relative(ROOT, outFile).replace(/\\/g, '/');
const files = listed.files
  .map((f) => f.replace(/\\/g, '/'))
  .filter((f) => LANG[extOf(f)] && !SKIP_FILE.test(f) && f !== outRel)
  .filter((f) => !f.split('/').slice(0, -1).some((seg) => IGNORE_DIRS.has(seg)))
  .filter((f) => !excludes.some((x) => f === x || f.startsWith(x.endsWith('/') ? x : `${x}/`)))
  .filter((f) => { try { return fs.statSync(path.join(ROOT, f)).size <= MAX_BYTES; } catch { return false; } })
  .sort();
const fileSet = new Set(files);

// ---------- text cleaning: blank comments and string literals, keep offsets and newlines ----------
function cleanC(src, fam) {
  const out = src.split('');
  const n = src.length;
  const blank = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' '; };
  const isW = (c) => c !== undefined && /\w/.test(c);
  const skipQuote = (j) => { const q = src[j++]; while (j < n && src[j] !== q && src[j] !== '\n') { if (src[j] === '\\') j++; j++; } return j + 1; };
  // template literal with nested ${ ... } expressions (which may hold strings and templates)
  const skipTpl = (j) => {
    j++;
    while (j < n) {
      const ch = src[j];
      if (ch === '\\') { j += 2; continue; }
      if (ch === '`') return j + 1;
      if (ch === '$' && src[j + 1] === '{') {
        j += 2;
        for (let d = 1; j < n && d > 0;) {
          const e = src[j];
          if (e === '`') { j = skipTpl(j); continue; }
          if (e === '"' || e === "'") { j = skipQuote(j); continue; }
          if (e === '{') d++; else if (e === '}') d--;
          j++;
        }
        continue;
      }
      j++;
    }
    return n;
  };
  let i = 0;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { let j = src.indexOf('\n', i); if (j < 0) j = n; blank(i, j); i = j; continue; }
    if (c === '/' && d === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; blank(i, j); i = j; continue; }
    if (fam === 'cpp' && c === 'R' && d === '"' && !isW(src[i - 1])) {
      const m = /^R"([^()\\\s]{0,16})\(/.exec(src.slice(i, i + 20));
      if (m) { const e = src.indexOf(`)${m[1]}"`, i); const j = e < 0 ? n : e + m[1].length + 2; blank(i, j); i = j; continue; }
    }
    if (fam === 'cs' && c === '"' && d === '"' && src[i + 2] === '"') { // raw string literal
      let q = i; while (src[q] === '"') q++;
      const fence = src.slice(i, q);
      const e = src.indexOf(fence, q); const j = e < 0 ? n : e + fence.length; blank(i, j); i = j; continue;
    }
    if (fam === 'cs' && c === '"' && (src[i - 1] === '@' || (src[i - 1] === '$' && src[i - 2] === '@'))) { // verbatim
      let j = i + 1;
      while (j < n) { if (src[j] === '"') { if (src[j + 1] === '"') { j += 2; continue; } break; } j++; }
      blank(i, j + 1); i = j + 1; continue;
    }
    if (c === "'" && fam === 'cpp' && /[0-9a-fA-F]/.test(src[i - 1] ?? '') && /[0-9a-fA-F]/.test(d ?? '')) { i++; continue; } // 1'000
    if (c === '`' && fam === 'ts') { const j = skipTpl(i); blank(i, j); i = j; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j++;
        else if (src[j] === '\n' && c !== '`') break; // unterminated (e.g. an apostrophe in JSX text): stop at the line end
        j++;
      }
      blank(i, j + 1); i = j + 1; continue;
    }
    i++;
  }
  return out.join('');
}
function cleanPy(src) {
  const out = src.split('');
  const n = src.length;
  const blank = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '#') { let j = src.indexOf('\n', i); if (j < 0) j = n; blank(i, j); i = j; continue; }
    if (c === '"' || c === "'") {
      const triple = src.startsWith(c.repeat(3), i);
      if (triple) { const e = src.indexOf(c.repeat(3), i + 3); const j = e < 0 ? n : e + 3; blank(i, j); i = j; continue; }
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      blank(i, j + 1); i = j + 1; continue;
    }
    i++;
  }
  return out.join('');
}

// ---------- helpers over cleaned text ----------
function lineStartsOf(text) { const s = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\n') s.push(i + 1); return s; }
function lineOf(starts, idx) { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= idx) lo = m; else hi = m - 1; } return lo; }
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const capSig = (s) => (s.length > 400 ? `${s.slice(0, 397)}...` : s);

// For each line: true when every enclosing brace block is a namespace (so a declaration there is top level).
function nsState(cl) {
  const state = [];
  const stack = [];
  let stmt = 0;
  let lineOpen = true;
  for (let i = 0; i <= cl.length; i++) {
    if (lineOpen) { state.push(stack.every((s) => s === 'ns')); lineOpen = false; }
    const ch = cl[i];
    if (ch === '\n') lineOpen = true;
    else if (ch === '{') {
      const pre = cl.slice(Math.max(stmt, i - 300), i);
      const ns = /\bnamespace\b[\w\s.:]*$/.test(pre) || /\bdeclare\s+(module|global)\b[\s\w.]*$/.test(pre) || /\bextern\s*$/.test(pre);
      stack.push(ns ? 'ns' : 'blk'); stmt = i + 1;
    } else if (ch === '}') { stack.pop(); stmt = i + 1; } else if (ch === ';') stmt = i + 1;
  }
  return state;
}

// From the start of line L, find where the declaration ends.
// Returns { end (line idx), sigEnd (char idx), body: bool, arrowEnd? } or null.
function findEnd(cl, starts, L, { ts = false, arrow = false } = {}) {
  let depth = 0;
  let sawArrow = -1;
  const n = cl.length;
  for (let i = starts[L]; i < n; i++) {
    const ch = cl[i];
    if (ch === '(' || ch === '[') { depth++; continue; }
    if (ch === ')' || ch === ']') { depth--; continue; }
    if (depth > 0) { if (ch === '{') depth++; else if (ch === '}') depth--; continue; }
    if (ch === '=' && cl[i + 1] === '>') { if (sawArrow < 0) sawArrow = i + 2; continue; }
    if (ch === ';') return { end: lineOf(starts, i), sigEnd: sawArrow > 0 ? sawArrow : i, body: false };
    if (ch === '}') return null; // left the enclosing block: give up
    if (ch === '{') {
      let p = i - 1; while (p >= 0 && /\s/.test(cl[p])) p--;
      const typePos = ts && (cl[p] === ':' || cl[p] === '<' || cl[p] === '|' || cl[p] === '&' || cl[p] === ',');
      let d = 0, j = i;
      for (; j < n; j++) { if (cl[j] === '{') d++; else if (cl[j] === '}' && --d === 0) break; }
      if (typePos) { i = j; continue; }
      return { end: lineOf(starts, Math.min(j, n - 1)), sigEnd: i, body: true };
    }
    if (arrow && ch === '\n' && sawArrow > 0) {
      // expression-bodied arrow without a semicolon: ends before the next line that starts at column 0
      let k = i + 1;
      while (k < n) { const e = cl.indexOf('\n', k); if (cl.slice(k, e < 0 ? n : e).trim()) break; k = e < 0 ? n : e + 1; }
      if (k >= n || (/\S/.test(cl[k]) && !/[.)\]}?:+\-*/|&,=]/.test(cl[k]))) return { end: lineOf(starts, i), sigEnd: sawArrow, body: false };
    }
  }
  return null;
}

// ---------- per-language extraction ----------
const KW_NOT_FN = new Set(['if', 'for', 'while', 'switch', 'return', 'else', 'case', 'do', 'catch', 'sizeof', 'using', 'typedef',
  'static_assert', 'decltype', 'alignas', 'new', 'delete', 'throw', 'defined', 'namespace', 'template', 'operator']);

function splitTop(s) { // split by commas not inside <> () []
  const parts = []; let d = 0, cur = '';
  for (const ch of s) {
    if ('<([{'.includes(ch)) d++; else if ('>)]}'.includes(ch)) d--;
    if (ch === ',' && d === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}
const baseName = (s) => s.replace(/<.*$/s, '').replace(/\(.*$/s, '').trim().split(/\.|::/).pop().trim();

// C++: a function definition starts a statement, so the previous code line must end one (or be a directive).
function atStatementStart(lines, L) {
  for (let k = L - 1; k >= 0; k--) {
    const p = lines[k].trim();
    if (!p) continue;
    return p.startsWith('#') || /[;{}>]$/.test(p) || /^template\b/.test(p) || /^\[\[.*\]\]$/.test(p);
  }
  return true;
}

function extractC(src, fam) {
  const cl = cleanC(src, fam);
  const starts = lineStartsOf(cl);
  const lines = cl.split('\n');
  const top = nsState(cl);
  const syms = [];
  const ts = fam === 'ts';
  for (let L = 0; L < lines.length; L++) {
    if (!top[L]) continue;
    const t = lines[L].trim();
    if (!t || t.startsWith('#') || t.startsWith('@')) continue;
    let m, kind, name, tags = [], arrow = false, keepSemicolon = false;
    if (ts) {
      if ((m = /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(t))) { kind = 'class'; name = m[1]; }
      else if ((m = /^(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/.exec(t))) { kind = 'interface'; name = m[1]; }
      else if ((m = /^(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/.exec(t))) { kind = 'class'; name = m[1]; tags = ['enum']; }
      else if ((m = /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(t))) { kind = 'function'; name = m[1]; }
      else if ((m = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*/.exec(t))) {
        const after = cl.slice(starts[L] + lines[L].indexOf(t) + m[0].length, starts[L] + lines[L].indexOf(t) + m[0].length + 800);
        if (/^(?:async\s+)?(?:function\b|(?:<[^>]*>\s*)?\([^;]*?\)\s*(?::[^;]+?)?=>|[A-Za-z_$][\w$]*\s*=>|(?:React\.)?(?:memo|forwardRef)\s*\()/.test(after)) {
          kind = 'function'; name = m[1]; arrow = true; keepSemicolon = true;
        }
      }
    } else if (fam === 'cs') {
      if ((m = /^(?:\[[^\]]*\]\s*)*(?:(?:public|private|protected|internal|static|sealed|abstract|partial|readonly|unsafe|new|file|ref)\s+)*(class|interface|struct|enum|record(?:\s+(?:class|struct))?)\s+([A-Za-z_]\w*)/.exec(t))) {
        name = m[2];
        kind = m[1] === 'interface' ? 'interface' : 'class';
        if (m[1] === 'struct') tags = ['struct'];
        else if (m[1] === 'enum') tags = ['enum'];
        else if (m[1].startsWith('record')) { tags = ['record']; keepSemicolon = true; }
      }
    } else { // cpp
      if ((m = /^(?:template\s*<.*>\s*)?(class|struct|union)\s+(?:[A-Z_][A-Z0-9_]*\s+)*([A-Za-z_]\w*)\s*(?:final\b)?\s*(?::(?!:)|\{|$)/.exec(t))) {
        kind = 'class'; name = m[2]; if (m[1] !== 'class') tags = [m[1]];
      } else if ((m = /^enum\s+(?:class\s+|struct\s+)?([A-Za-z_]\w*)/.exec(t))) { kind = 'class'; name = m[1]; tags = ['enum']; }
      else if (!/^(public|private|protected)\s*:/.test(t) && !/[=;]\s*$/.test(t) && /^[\w~]/.test(t) && atStatementStart(lines, L)) {
        const sigText = cl.slice(starts[L], starts[L] + 600).split(/[;{]/)[0];
        const fm = /^\s*(?:template\s*<[^]*?>\s*)?(?:[\w:<>,*&\s[\]]*?[\s*&])?(~?[A-Za-z_]\w*(?:::~?[A-Za-z_]\w*)*)\s*\(/.exec(sigText);
        if (fm && !fm[1].includes('::') && !KW_NOT_FN.has(fm[1]) && !/^[A-Z0-9_]+$/.test(fm[1]) && /\)[\s\w:&*<>,\->()]*$/.test(sigText)) {
          kind = 'function'; name = fm[1];
        }
      }
    }
    if (!kind) continue;
    const e = findEnd(cl, starts, L, { ts, arrow });
    if (!e) continue;
    if (!e.body && !keepSemicolon) continue; // forward declaration / prototype / overload signature
    const sig = capSig(squash(src.slice(starts[L], e.sigEnd)).replace(/\s*\{$/, ''));
    syms.push({ kind, name, startLine: L + 1, endLine: e.end + 1, sig, tags, heritage: heritageC(sig, fam, kind, name) });
    if (kind === 'class' || kind === 'interface' || kind === 'function') L = Math.max(L, e.end); // skip the body
  }
  return syms;
}

function heritageC(sig, fam, kind, name) {
  const out = [];
  let s = sig;
  if (fam === 'ts') {
    s = s.slice(s.indexOf(name) + name.length);
    const ext = /\bextends\s+(.+?)(?=\bimplements\b|$)/.exec(s);
    const imp = /\bimplements\s+(.+)$/.exec(s);
    if (ext) for (const b of splitTop(ext[1])) out.push({ kind: 'inherits', name: baseName(b) });
    if (imp) for (const b of splitTop(imp[1])) out.push({ kind: 'implements', name: baseName(b) });
  } else {
    s = s.slice(s.indexOf(name) + name.length);
    for (let k = 0; k < 5; k++) s = s.replace(/<[^<>]*>/g, '').replace(/\([^()]*\)/g, '');
    const m = /^[^:]*?(?:final\s*)?:(?!:)\s*(.+?)(?:\bwhere\b|$)/.exec(s);
    if (!m) return out;
    splitTop(m[1]).forEach((b, i) => {
      const n = baseName(b.replace(/\b(public|private|protected|virtual)\b/g, ''));
      if (!n) return;
      let k = 'inherits';
      if (fam === 'cs' && kind !== 'interface' && (/^I[A-Z]/.test(n) || i > 0 || /\bstruct\b/.test(sig))) k = 'implements';
      out.push({ kind: k, name: n });
    });
  }
  return out.filter((h) => h.name && /^[A-Za-z_$][\w$]*$/.test(h.name));
}

function extractPy(src) {
  const cl = cleanPy(src);
  const starts = lineStartsOf(cl);
  const lines = cl.split('\n');
  const syms = [];
  for (let L = 0; L < lines.length; L++) {
    const t = lines[L];
    const m = /^(?:async\s+)?def\s+([A-Za-z_]\w*)/.exec(t) ?? /^class\s+([A-Za-z_]\w*)/.exec(t);
    if (!m) continue;
    const kind = t.startsWith('class') ? 'class' : 'function';
    // start at the first decorator, including decorators whose arguments span several lines
    let s = L;
    for (let k = L - 1; k >= 0;) {
      if (/^@/.test(lines[k])) { s = k; k--; continue; }
      let j = k;
      while (j >= 0 && lines[j].trim() && /^[\s)\]}]/.test(lines[j])) j--;
      if (j < k && j >= 0 && /^@/.test(lines[j])) { s = j; k = j - 1; continue; }
      break;
    }
    let end = L, k = L + 1;
    for (; k < lines.length; k++) {
      if (!lines[k].trim()) continue;
      if (/^\S/.test(lines[k])) break;
      end = k;
    }
    let depth = 0, i = starts[L];
    for (; i < cl.length; i++) {
      const ch = cl[i];
      if ('([{'.includes(ch)) depth++; else if (')]}'.includes(ch)) depth--;
      else if (ch === ':' && depth === 0) break;
    }
    const sig = capSig(squash(src.slice(starts[L], i)));
    const heritage = [];
    if (kind === 'class') {
      const pm = /^class\s+\w+\s*\((.*)\)\s*$/s.exec(sig);
      if (pm) for (const b of splitTop(pm[1])) if (!b.includes('=')) { const n = baseName(b); if (/^[A-Za-z_]\w*$/.test(n) && n !== 'object') heritage.push({ kind: 'inherits', name: n }); }
    }
    syms.push({ kind, name: m[1], startLine: s + 1, endLine: end + 1, sig, tags: [], heritage });
    L = Math.max(L, end);
  }
  return syms;
}

// ---------- import extraction + resolution ----------
const TS_EXT = ['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.js', '.jsx', '.mjs', '.cjs'];
function resolveTs(from, spec) {
  if (!spec.startsWith('.')) return null; // bare specifiers are packages (path aliases are not resolved)
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  const stem = base.replace(/\.(m|c)?jsx?$/, '');
  const cands = [base, ...TS_EXT.map((e) => base + e), ...TS_EXT.map((e) => stem + e), ...TS_EXT.map((e) => `${base}/index${e}`)];
  return cands.find((c) => fileSet.has(c)) ?? null;
}
function importsTs(src) {
  const specs = new Set();
  for (const re of [/(?:^|[\s;])(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"\n]+)['"]/g, /(?:^|[\s;])import\s*['"]([^'"\n]+)['"]/g,
    /\b(?:require|import)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g]) for (const m of src.matchAll(re)) specs.add(m[1]);
  return [...specs];
}
const bySuffixCache = new Map();
function bySuffix(suffix, near) {
  const hits = files.filter((f) => f === suffix || f.endsWith(`/${suffix}`));
  if (hits.length <= 1) return hits[0] ?? null;
  const common = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };
  return hits.sort((a, b) => common(b, near) - common(a, near) || a.length - b.length)[0];
}
function resolveCpp(from, spec) {
  const rel = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  if (fileSet.has(rel)) return rel;
  const key = `${spec}|${path.posix.dirname(from)}`;
  if (!bySuffixCache.has(key)) bySuffixCache.set(key, bySuffix(spec, from));
  return bySuffixCache.get(key);
}
const pyAliases = new Map(); // file -> Map(name a module is bound to in that file -> module file)
function importsPy(src, from) {
  const out = [];
  const aliases = new Map();
  pyAliases.set(from, aliases);
  const dir = path.posix.dirname(from);
  const modFiles = (mod) => [`${mod}.py`, `${mod}/__init__.py`];
  const findMod = (mod, relative) => {
    for (const c of modFiles(mod)) {
      if (relative) { if (fileSet.has(c)) return c; } else { const hit = bySuffix(c, from); if (hit) return hit; }
    }
    return null;
  };
  const text = src.replace(/\(\s*([^)]*)\)/gs, (_, x) => x.replace(/\s+/g, ' '));
  for (const m of text.matchAll(/^[ \t]*from\s+(\.*)([\w.]*)\s+import\s+(.+)$/gm)) {
    const dots = m[1].length;
    let modPath = m[2].replace(/\./g, '/');
    let relative = false;
    if (dots) {
      let d = dir; for (let k = 1; k < dots; k++) d = path.posix.dirname(d);
      modPath = path.posix.normalize(path.posix.join(d === '.' ? '' : d, modPath)) .replace(/^\.\/?/, '');
      relative = true;
    }
    let any = false;
    for (const part of m[3].split(',')) {
      const [nm, , as] = part.trim().split(/\s+/);
      if (!/^\w+$/.test(nm ?? '')) continue;
      const sub = findMod(modPath ? `${modPath}/${nm}` : nm, relative);
      if (sub) { out.push(sub); any = true; aliases.set(as ?? nm, sub); }
    }
    if (!any && modPath) { const f = findMod(modPath, relative); if (f) out.push(f); }
  }
  for (const m of text.matchAll(/^[ \t]*import\s+([\w., \t]+)$/gm))
    for (const part of m[1].split(',')) {
      const [mod, , as] = part.trim().split(/\s+/);
      if (mod) { const f = findMod(mod.replace(/\./g, '/'), false); if (f) { out.push(f); aliases.set(as ?? mod.split('.').pop(), f); } }
    }
  return out;
}

// ---------- build ----------
const nodes = [];
const edges = [];
const edgeKeys = new Set();
const addEdge = (source, target, kind, description) => {
  if (!source || !target || source === target) return;
  const key = `${source}|${target}|${kind}`;
  if (edgeKeys.has(key)) return;
  edgeKeys.add(key);
  edges.push(description ? { source, target, kind, description } : { source, target, kind });
};

const ROOT_ID = '.';
nodes.push({ id: ROOT_ID, kind: 'repository', name: NAME, path: '.' });
const dirs = new Set();
for (const f of files) { let d = path.posix.dirname(f); while (d !== '.') { dirs.add(d); d = path.posix.dirname(d); } }
const isPkg = (d) => {
  try { return fs.readdirSync(path.join(ROOT, d)).some((e) => MANIFESTS.includes(e) || /\.csproj$/.test(e)); } catch { return false; }
};
for (const d of [...dirs].sort()) {
  const parent = path.posix.dirname(d);
  nodes.push({ id: d, kind: isPkg(d) ? 'package' : 'directory', name: path.posix.basename(d), parent: parent === '.' ? ROOT_ID : parent, path: d });
}

const symbolsByName = new Map(); // name -> [symbol ids]
const fileImports = new Map(); // file -> Set(files)
const pending = []; // heritage to resolve after all symbols are known
const csFiles = []; // { file, ns, usings, idents }
const csTypeNs = new Map(); // type symbol id -> namespace
const stats = { byLang: {}, symbolErrors: [] };
const fileData = []; // for the calls pass

for (const f of files) {
  const lang = LANG[extOf(f)];
  const fam = FAMILY[lang];
  let src;
  try { src = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
  if (src.includes('\0')) continue; // binary
  const loc = src.split('\n').filter((l) => l.trim()).length;
  const parent = path.posix.dirname(f) === '.' ? ROOT_ID : path.posix.dirname(f);
  nodes.push({ id: f, kind: 'file', name: path.posix.basename(f), parent, path: f, language: lang, metrics: { loc } });
  (stats.byLang[lang] ??= { files: 0, loc: 0, symbols: 0 }).files++;
  stats.byLang[lang].loc += loc;

  let syms = [];
  try {
    if (fam === 'py') syms = extractPy(src);
    else if (fam) syms = extractC(src, fam);
  } catch (err) { stats.symbolErrors.push(`${f}: ${err.message}`); }
  const used = new Set();
  for (const s of syms) {
    let id = `${f}#${s.name}`;
    if (used.has(id)) id = `${f}#${s.name}@${s.startLine}`;
    used.add(id);
    const node = { id, kind: s.kind, name: s.name, parent: f, path: f, startLine: s.startLine, endLine: s.endLine,
      language: lang, code: s.sig, metrics: { loc: s.endLine - s.startLine + 1 } };
    if (s.tags.length) node.tags = s.tags;
    nodes.push(node);
    stats.byLang[lang].symbols++;
    if (!symbolsByName.has(s.name)) symbolsByName.set(s.name, []);
    symbolsByName.get(s.name).push(id);
    for (const h of s.heritage) pending.push({ from: id, file: f, ...h });
  }

  const imps = new Set();
  if (fam === 'ts') for (const spec of importsTs(src)) { const t = resolveTs(f, spec); if (t) imps.add(t); }
  if (fam === 'py') for (const t of importsPy(src, f)) imps.add(t);
  if (fam === 'cpp') for (const m of src.matchAll(/^[ \t]*#[ \t]*include[ \t]*[<"]([^>"\n]+)[>"]/gm)) { const t = resolveCpp(f, m[1].trim()); if (t) imps.add(t); }
  if (fam === 'cs') {
    const cl = cleanC(src, 'cs');
    const ns = /^\s*namespace\s+([\w.]+)/m.exec(cl)?.[1] ?? '';
    const usings = [...src.matchAll(/^\s*(?:global\s+)?using\s+(?:static\s+)?([\w.]+)\s*;/gm)].map((m) => m[1]);
    // own types at any depth: a nested type shadows a same-named type elsewhere
    const own = new Set([...cl.matchAll(/\b(?:class|struct|interface|enum|record)\s+([A-Za-z_]\w*)/g)].map((m) => m[1]));
    csFiles.push({ file: f, ns, usings, own, idents: new Set(cl.match(/\b[A-Za-z_]\w*\b/g) ?? []) });
    for (const s of used) csTypeNs.set(s, ns);
  }
  fileImports.set(f, imps);
  for (const t of imps) addEdge(f, t, 'imports');
  if (fam) fileData.push({ f, fam, src, syms: syms.map((s, i) => ({ ...s, id: [...used][i] })) });
}

// C# has no file imports: a file references a type declared elsewhere when it names it and the namespace is visible.
for (const cf of csFiles) {
  for (const [typeId, tns] of csTypeNs) {
    if (typeId.startsWith(`${cf.file}#`)) continue;
    const name = typeId.slice(typeId.indexOf('#') + 1).replace(/@\d+$/, '');
    if (!cf.idents.has(name) || cf.own.has(name)) continue;
    const visible = !tns || tns === cf.ns || cf.ns.startsWith(`${tns}.`) || cf.usings.includes(tns);
    if (visible) addEdge(cf.file, typeId, 'references', `Uses \`${name}\`.`);
  }
}

// Inheritance: resolve a base name to one symbol, preferring the same file, then imported files, then a unique match.
for (const h of pending) {
  const cands = (symbolsByName.get(h.name) ?? []).filter((c) => c !== h.from);
  if (!cands.length) continue;
  const imps = fileImports.get(h.file) ?? new Set();
  const pick = cands.find((c) => c.startsWith(`${h.file}#`))
    ?? cands.find((c) => imps.has(c.slice(0, c.indexOf('#'))) || edgeKeys.has(`${h.file}|${c}|references`))
    ?? (cands.length === 1 ? cands[0] : null);
  if (pick && pick !== h.from) addEdge(h.from, pick, h.kind);
}

const graph = { version: '1.0', codebase: { name: NAME }, nodes, edges };
fs.writeFileSync(outFile, JSON.stringify(graph, null, 2));

// ---------- candidate calls edges (a patch for review, not part of the skeleton) ----------
// A call `name(` or `new Name(` inside a symbol's lines becomes source=that symbol (else the file),
// target=the function/class it resolves to through same-file definitions, imports, C# references or C++ includes.
// `Q.name(` / `Q::name(` targets class Q when Q is a known class (static or qualified call). Plain member calls
// (`obj.method()`) cannot be resolved without types and are left to the reviewer.
const CALL_PREFIX_OK = new Set(['return', 'await', 'new', 'yield', 'throw', 'else', 'case', 'in', 'of', 'not', 'and', 'or',
  'typeof', 'delete', 'do', 'co_await', 'co_return', 'co_yield', 'is', 'as', 'if', 'elif', 'assert', 'lambda']);
const CALL_SKIP = new Set([...KW_NOT_FN, 'function', 'catch', 'super', 'this', 'typeof', 'await', 'print', 'len', 'range',
  'isinstance', 'lambda', 'elif', 'not', 'and', 'or', 'in', 'assert', 'with', 'foreach', 'nameof', 'base', 'lock', 'def', 'class']);
const callable = (id) => { const k = nodeKind.get(id); return k === 'function' || k === 'class'; };
const nodeKind = new Map(nodes.map((n) => [n.id, n.kind]));
const fileOf = (id) => id.slice(0, id.indexOf('#'));
const calls = new Map();
for (const fd of fileData) {
  const { f, fam, src } = fd;
  const cl = fam === 'py' ? cleanPy(src) : cleanC(src, fam);
  const starts = lineStartsOf(cl);
  const regions = fd.syms.map((s) => ({ id: s.id, name: s.name, a: starts[s.startLine - 1], b: starts[s.endLine] ?? cl.length }));
  const reach = new Set([f, ...(fileImports.get(f) ?? [])]);
  // names bound to a whole module: Python `import x as y` / `from . import mod`, TS `import * as ns`
  const modAlias = fam === 'py' ? (pyAliases.get(f) ?? new Map()) : new Map();
  if (fam === 'ts') for (const m of src.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"\n]+)['"]/g)) { const t = resolveTs(f, m[2]); if (t) modAlias.set(m[1], t); }
  const inModule = (name, mod) => (symbolsByName.get(name) ?? []).find((c) => callable(c) && fileOf(c) === mod) ?? null;
  for (const e of edges) if (e.source === f && e.kind === 'references') reach.add(fileOf(e.target));
  if (fam === 'cpp') for (const t of [...reach]) for (const t2 of fileImports.get(t) ?? []) reach.add(t2); // one level of transitive includes
  const resolve = (name, wantClass) => {
    const cands = (symbolsByName.get(name) ?? []).filter((c) => callable(c) && (!wantClass || nodeKind.get(c) === 'class'));
    if (!cands.length) return null;
    // only same-file or reachable (imported/included/referenced) targets: a name match elsewhere is too often wrong
    return cands.find((c) => fileOf(c) === f) ?? cands.find((c) => reach.has(fileOf(c))) ?? null;
  };
  if (fam === 'cpp') { // out-of-line member definitions `Ret Class::method(...) {` belong to the class
    const lines = cl.split('\n');
    const top = nsState(cl);
    for (let L = 0; L < lines.length; L++) {
      if (!top[L] || !atStatementStart(lines, L)) continue;
      const m = /^\s*(?:template\s*<.*>\s*)?(?:[\w:<>,*&\s]*?[\s*&])?([A-Za-z_]\w*)::~?[A-Za-z_]\w*\s*\(/.exec(lines[L]);
      if (!m) continue;
      const cls = resolve(m[1], true);
      const e = cls && findEnd(cl, starts, L);
      if (e?.body) { regions.push({ id: cls, name: m[1], a: starts[L], b: starts[e.end + 1] ?? cl.length }); L = e.end; }
    }
  }
  const at = (i) => regions.find((r) => i >= r.a && i < r.b);
  if (/\.(tsx|jsx)$/.test(f)) // <Component ...> renders count as calls; a generic `Foo<Bar>` follows an identifier
    for (const m of cl.matchAll(/<([A-Z][\w$]*)(?=[\s/>])/g)) {
      let p = m.index - 1; while (p >= 0 && /\s/.test(cl[p])) p--;
      if (p >= 0 && /[\w$.)\]]/.test(cl[p])) continue;
      const t = resolve(m[1], false);
      const source = at(m.index)?.id ?? f;
      if (t && t !== source && !calls.has(`${source}|${t}`)) calls.set(`${source}|${t}`, { source, target: t, kind: 'calls' });
    }
  for (const m of cl.matchAll(/\b(new\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^<>;(){}]*>)?\s*\(/g)) {
    const name = m[2];
    if (CALL_SKIP.has(name)) continue;
    let p = m.index - 1; while (p >= 0 && /\s/.test(cl[p])) p--;
    let target = null;
    if (!m[1] && (cl[p] === '.' || (cl[p] === ':' && cl[p - 1] === ':') || (cl[p] === '>' && cl[p - 1] === '-'))) {
      if (cl[p] === '>') continue; // ptr->method(): unknown type
      const q = /([A-Za-z_$][\w$]*)\s*$/.exec(cl.slice(Math.max(0, p - 80), cl[p] === '.' ? p : p - 1))?.[1];
      if (q === 'std' || q === 'this_thread' || q === 'chrono') continue;
      target = q && cl[p] === '.' && modAlias.has(q) ? inModule(name, modAlias.get(q)) : null; // module.func()
      target ??= q && resolve(q, true); // Class.static() / Class::method()
      if (!target && cl[p] === ':') target = resolve(name, false); // ns::free_function(), only when reachable
      if (!target) continue;
    } else {
      if (!m[1]) { // a declaration `Type name(` or `def name(` is not a call
        const prev = /([A-Za-z_$][\w$]*)\s*$/.exec(cl.slice(Math.max(0, p - 40), p + 1))?.[1];
        if (prev && !CALL_PREFIX_OK.has(prev) && /[\w$]/.test(cl[p])) continue;
        if (fam !== 'py' && cl[p] === '>' && cl[p - 1] !== '-' && cl[p - 1] !== '=') continue; // generic return type: `std::optional<T> name(`
        if (fam === 'cpp' && /[*&]/.test(cl[p]) && /[\w>]\s*[*&]$/.test(cl.slice(Math.max(0, p - 3), p + 1))) continue;
        let d = 0, j = m.index + m[0].length - 1;
        for (; j < cl.length; j++) { if (cl[j] === '(') d++; else if (cl[j] === ')' && --d === 0) break; }
        const after = cl.slice(j + 1, j + 40).trimStart();
        if (after.startsWith('{') || (fam === 'ts' && /^:\s*[\w{[<(]/.test(after) && !/^:\s*[\w$]+\s*[,)]/.test(after)) || /^(const|noexcept|override|final)\b[^;]*\{/.test(after)) continue;
      }
      target = resolve(name, !!m[1]);
    }
    if (!target) continue;
    const r = at(m.index);
    const source = r?.id ?? f;
    if (source === target) continue;
    const key = `${source}|${target}`;
    if (!calls.has(key)) calls.set(key, { source, target, kind: 'calls' });
  }
}
const callsFile = outFile.replace(/(\.clu)?\.json$/, '') + '.calls.json';
fs.writeFileSync(callsFile, JSON.stringify({ edges: [...calls.values()] }, null, 2));

// ---------- summary for the caller ----------
const count = (arr, key) => arr.reduce((m, x) => ((m[x[key]] = (m[x[key]] ?? 0) + 1), m), {});
console.log(`wrote ${outFile}`);
console.log(`wrote ${callsFile}: ${calls.size} candidate calls edges (a patch to review before merging)`);
console.log(`file list from: ${listed.source}${excludes.length ? `, excluded: ${excludes.join(', ')}` : ''}`);
console.log(`nodes: ${nodes.length} ${JSON.stringify(count(nodes, 'kind'))}`);
console.log(`edges: ${edges.length} ${JSON.stringify(count(edges, 'kind'))}`);
console.log('languages:');
for (const [l, s] of Object.entries(stats.byLang).sort((a, b) => b[1].loc - a[1].loc))
  console.log(`  ${l.padEnd(12)} ${String(s.files).padStart(5)} files ${String(s.loc).padStart(7)} loc ${String(s.symbols).padStart(5)} symbols${FAMILY[l] ? '' : '  (file level only)'}`);
for (const e of stats.symbolErrors) console.log(`  symbol extraction failed: ${e}`);
console.log('work groups (top-level dirs, then their subdirs when large):');
const agg = new Map();
for (const n of nodes) {
  if (n.kind !== 'file') continue;
  const segs = n.id.split('/');
  for (const depth of [1, 2]) {
    if (segs.length <= depth) continue;
    const key = segs.slice(0, depth).join('/');
    const a = agg.get(key) ?? { files: 0, loc: 0 };
    a.files++; a.loc += n.metrics.loc; agg.set(key, a);
  }
}
const rootFiles = nodes.filter((n) => n.kind === 'file' && !n.id.includes('/'));
if (rootFiles.length) console.log(`  (root)  ${rootFiles.length} files`);
for (const [k, a] of [...agg].sort()) {
  const depth = k.split('/').length;
  if (depth === 2 && (agg.get(k.split('/')[0])?.files ?? 0) < 40) continue;
  console.log(`  ${'  '.repeat(depth - 1)}${k}/  ${a.files} files, ${a.loc} loc`);
}
