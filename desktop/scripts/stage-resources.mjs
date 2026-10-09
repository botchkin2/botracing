// Stages what the installed tray app carries next to its exe, into
// desktop/src-tauri/resources/ (gitignored), which tauri.conf.json bundles:
//
//   resources/node/node.exe                       the Node that runs the uploader
//   resources/app/package.json                    {"type":"module"}
//   resources/app/tools/uploader/*.mjs            the watcher
//   resources/app/tools/sessions/*.mjs            sync and analysis
//   resources/app/tools/sessions/duckdb.exe       the DuckDB CLI (duck.mjs finds it here)
//   resources/app/src/analysis/*.ts               analysis shared with the app
//
// The app files are the import closure of the entry points, not whole
// folders: a file that is not reached is not shipped, a relative import that
// does not exist fails here (not on a user's PC), and so does anything the
// scan cannot follow: an `import(expr)` that is not a string, or a
// `new Worker(...)` that is not the file itself or a literal path.
//
// node.exe and duckdb.exe are checked against SHA-256 values pinned below.
// Both are fetched from their publishers when not already in the cache
// (resources/.cache), and a mismatch fails the build: a binary shipped to
// users unverified is a supply-chain hole (marshal, pit wall thread 2 #100).
// To change a pin, take the new value from the publisher (Node: SHASUMS256.txt
// beside the release; DuckDB: the digest GitHub shows for the release asset),
// not from the file you downloaded.
//
//   node desktop/scripts/stage-resources.mjs
//   node desktop/scripts/stage-resources.mjs --no-duckdb   (a build that cannot analyse)
//
// BOTRACING_NODE_EXE and DUCKDB may name local copies (node.exe / the zip or
// the exe); they are checked against the same pins. The variable is not
// called NODE on purpose: npm and npx set NODE to the node that is running
// them, which on a CI runner is whatever setup-node resolved (24.21.0 broke the
// first tray-v0.1.0 build), and the bundle must never depend on the runner.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {dirname, relative, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '../..');
export const outDir = resolve(here, '../src-tauri/resources');
const cacheDir = resolve(outDir, '.cache');

export const NODE = {
  version: 'v24.19.0',
  url: 'https://nodejs.org/dist/v24.19.0/win-x64/node.exe',
  // win-x64/node.exe in https://nodejs.org/dist/v24.19.0/SHASUMS256.txt
  sha256: '3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237',
};

export const DUCKDB = {
  version: 'v1.4.2',
  url: 'https://github.com/duckdb/duckdb/releases/download/v1.4.2/duckdb_cli-windows-amd64.zip',
  // The digest GitHub lists for duckdb_cli-windows-amd64.zip on release v1.4.2.
  sha256: '2a31d67cf54aec3494fb331147edddfee1cd7f3fadcb5b84056f9bc28cf76576',
};

// What the watcher starts: itself, and sync.mjs (which starts workers from
// itself). store.mjs is a dynamic import in sync.mjs.
// A package a shipped file may require although the installer has no
// node_modules: reached only in a mode the installed app never uses. Each entry
// says why; anything else that requires a package fails the build.
export const ADMIN_ONLY = new Map([
  [
    'tools/sessions/store.mjs',
    {
      spec: 'firebase-admin',
      why: 'connect(): Admin credentials, the PC uploader; the tray syncs with --remote and never calls it',
    },
  ],
]);

export const ENTRIES = [
  'tools/uploader/watch.mjs',
  'tools/sessions/sync.mjs',
  'tools/sessions/store.mjs',
];

/** Source with comments removed, so a word in prose is not read as an import. */
export function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[\s;{}])\/\/.*$/gm, '$1');
}

// `import type {...} from '...'` is erased by Node's type stripping. An inline
// `import {type A, b} from '...'` is not: the import itself stays.
const TYPE_ONLY = /\b(?:import|export)\s+type\b[^;'"]*?\bfrom\s*['"][^'"]+['"]/g;
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
// require('x') through createRequire, which an import scan would miss.
// The lookbehind keeps `createRequire(` itself from matching.
const REQUIRE = /(?<![\w$.])require\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
const REQUIRE_ANY = /(?<![\w$.])require\s*\(\s*([^)]*)\)/g;
const DYNAMIC_ANY = /\bimport\s*\(\s*([^)]*)\)/g;
const WORKER = /\bnew\s+Worker\s*\(([^;]*?)[,)]/g;

/** The specifiers a file loads at runtime, and anything the scan cannot follow. */
export function scan(source) {
  const text = withoutComments(source).replace(TYPE_ONLY, '');
  const imports = [
    ...[...text.matchAll(IMPORT)].map(match => match[1]),
    ...[...text.matchAll(REQUIRE)].map(match => match[2]),
  ];
  const unfollowable = [];
  for (const match of text.matchAll(REQUIRE_ANY)) {
    if (!/^\s*['"][^'"]*['"]\s*$/.test(match[1]))
      unfollowable.push(`require(${match[1].trim()})`);
  }
  for (const match of text.matchAll(DYNAMIC_ANY)) {
    if (!/^\s*['"][^'"]*['"]\s*$/.test(match[1]))
      unfollowable.push(`import(${match[1].trim()})`);
  }
  const workers = [];
  for (const match of text.matchAll(WORKER)) {
    const arg = match[1].trim();
    const literal = arg.match(/^['"]([^'"]+)['"]$/);
    if (literal) workers.push(literal[1]);
    // The file itself: `new Worker(new URL(import.meta.url))`.
    else if (!/import\.meta\.url/.test(arg))
      unfollowable.push(`new Worker(${arg})`);
  }
  return {imports, workers, unfollowable};
}

/**
 * Every repo file reached from the entries, as repo-relative paths with
 * forward slashes, plus what could not be followed. A relative import that
 * does not exist would crash the installed app, so it is listed as missing.
 */
export function closure(root = repoRoot, entries = ENTRIES) {
  const files = new Set();
  const bare = new Set();
  const missing = [];
  const unfollowable = [];
  const queue = entries.map(entry => resolve(root, entry));
  while (queue.length > 0) {
    const file = queue.pop();
    const rel = relative(root, file).split(sep).join('/');
    if (files.has(rel)) continue;
    if (!existsSync(file)) {
      missing.push(rel);
      continue;
    }
    files.add(rel);
    const found = scan(readFileSync(file, 'utf8'));
    for (const spec of [...found.imports, ...found.workers]) {
      if (spec.startsWith('.')) queue.push(resolve(dirname(file), spec));
      else if (!spec.startsWith('node:')) {
        if (ADMIN_ONLY.get(rel)?.spec === spec) continue;
        bare.add(spec);
      }
    }
    for (const what of found.unfollowable) unfollowable.push(`${rel}: ${what}`);
  }
  return {files: [...files].sort(), bare: [...bare].sort(), missing, unfollowable};
}

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** The file's bytes, if they hash to `expected`; otherwise an Error naming both. */
export function verified(path, expected, label) {
  const bytes = readFileSync(path);
  const actual = sha256(bytes);
  if (actual !== expected)
    throw new Error(
      `${label} (${path}) has SHA-256 ${actual}, expected the pinned ${expected}`,
    );
  return bytes;
}

async function download(url, to) {
  mkdirSync(dirname(to), {recursive: true});
  const response = await fetch(url, {redirect: 'follow'});
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  writeFileSync(to, Buffer.from(await response.arrayBuffer()));
}

/** Where node.exe comes from: a local copy if BOTRACING_NODE_EXE names one, else the cache. */
export function nodeSource(env) {
  const local = env.BOTRACING_NODE_EXE || null;
  return {local, path: local || resolve(cacheDir, `node-${NODE.version}.exe`)};
}

/** node.exe at the pinned version: BOTRACING_NODE_EXE if given, else the cache, else nodejs.org. */
async function nodeExe(env) {
  const {local, path} = nodeSource(env);
  if (!local && !existsSync(path)) await download(NODE.url, path);
  verified(path, NODE.sha256, 'node.exe');
  return path;
}

/** duckdb.exe from the pinned zip: DUCKDB (zip) if given, else the cache, else GitHub. */
async function duckdbExe(env) {
  const zip = env.DUCKDB || resolve(cacheDir, `duckdb_cli-${DUCKDB.version}.zip`);
  if (!env.DUCKDB && !existsSync(zip)) await download(DUCKDB.url, zip);
  verified(zip, DUCKDB.sha256, 'the DuckDB zip');
  const unpacked = resolve(cacheDir, `duckdb-${DUCKDB.version}`);
  rmSync(unpacked, {recursive: true, force: true});
  mkdirSync(unpacked, {recursive: true});
  // Windows' own bsdtar reads zips; a GNU tar earlier on PATH (Git Bash) does not
  // understand C:\ paths.
  const tar = resolve(env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  const result = spawnSync(tar, ['-xf', zip, '-C', unpacked], {encoding: 'utf8'});
  if (result.status !== 0) throw new Error(`could not unpack ${zip}: ${result.stderr}`);
  const exe = resolve(unpacked, 'duckdb.exe');
  if (!existsSync(exe)) throw new Error(`${zip} has no duckdb.exe`);
  return exe;
}

export async function stage({noDuckdb = false, env = process.env} = {}) {
  const found = closure();
  if (found.missing.length > 0)
    throw new Error(`imports that do not exist: ${found.missing.join(', ')}`);
  if (found.bare.length > 0)
    throw new Error(
      `the uploader imports npm packages (${found.bare.join(', ')}); the installer has no node_modules`,
    );
  if (found.unfollowable.length > 0)
    throw new Error(
      `cannot follow, so cannot be sure they are shipped:\n  ${found.unfollowable.join('\n  ')}`,
    );

  const node = await nodeExe(env);
  const duckdb = noDuckdb ? null : await duckdbExe(env);

  // The cache is kept; everything else is rebuilt.
  for (const part of ['app', 'node']) {
    rmSync(resolve(outDir, part), {recursive: true, force: true});
  }
  const put = (from, to) => {
    const dest = resolve(outDir, to);
    mkdirSync(dirname(dest), {recursive: true});
    copyFileSync(from, dest);
  };
  for (const file of found.files) put(resolve(repoRoot, file), `app/${file}`);
  put(node, 'node/node.exe');
  if (duckdb) put(duckdb, 'app/tools/sessions/duckdb.exe');
  writeFileSync(
    resolve(outDir, 'app/package.json'),
    JSON.stringify({private: true, type: 'module'}),
  );

  const size = path => statSync(resolve(outDir, path)).size;
  return {
    files: found.files.length,
    nodeVersion: NODE.version,
    nodeBytes: size('node/node.exe'),
    duckdbVersion: duckdb ? DUCKDB.version : null,
    duckdbBytes: duckdb ? size('app/tools/sessions/duckdb.exe') : 0,
    duckdbExeSha256: duckdb ? sha256(readFileSync(duckdb)) : null,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const r = await stage({noDuckdb: process.argv.includes('--no-duckdb')});
  const mb = n => `${(n / 1048576).toFixed(1)} MB`;
  console.log(`staged ${r.files} app files into ${outDir}`);
  console.log(`  node ${r.nodeVersion} ${mb(r.nodeBytes)} (SHA-256 pinned)`);
  console.log(
    r.duckdbVersion
      ? `  duckdb ${r.duckdbVersion} ${mb(r.duckdbBytes)} (zip SHA-256 pinned; exe ${r.duckdbExeSha256})`
      : '  duckdb NOT included (--no-duckdb)',
  );
}
