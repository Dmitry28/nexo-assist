/**
 * NOTE: Ensures every environment variable the code reads is documented in `.env.example` — the
 * one place a newcomer (or the owner, months later) learns what can be set and why. Owner's rule
 * (2026-10-20): «.env.example — туда не забывай добавлять все env».
 *
 * «Read» means `process.env.NAME` / `process.env['NAME']` in src/ and test/, plus every key the
 * env schema declares (src/config/env.validation.ts — read through ConfigModule, not process.env).
 * Documented means a line `NAME=` or `# NAME=` in `.env.example`.
 *
 * Usage:
 *   node check-env-example.js   # exits 1 and lists every variable missing from .env.example
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA = path.join(ROOT, 'src', 'config', 'env.validation.ts');
const EXAMPLE = path.join(ROOT, '.env.example');
// Set by the platform or the toolchain, never by us.
const EXTERNAL = new Set(['NODE_ENV']);

const sourceFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(ts|js)$/.test(entry.name) ? [full] : [];
  });

const read = new Map();
for (const file of ['src', 'test'].flatMap((dir) => sourceFiles(path.join(ROOT, dir)))) {
  const text = fs.readFileSync(file, 'utf8');
  for (const [, name] of text.matchAll(/process\.env(?:\.|\[['"])([A-Z][A-Z0-9_]+)/g)) {
    if (!read.has(name)) read.set(name, path.relative(ROOT, file));
  }
}
// The schema's keys: `  NAME?: type` / `  NAME: type = default` at class-body indentation.
for (const [, name] of fs.readFileSync(SCHEMA, 'utf8').matchAll(/^ {2}([A-Z][A-Z0-9_]+)[?!]?:/gm)) {
  if (!read.has(name)) read.set(name, path.relative(ROOT, SCHEMA));
}

const example = fs.readFileSync(EXAMPLE, 'utf8');
const missing = [...read]
  .filter(([name]) => !EXTERNAL.has(name))
  .filter(([name]) => !new RegExp(`^#?\\s*${name}=`, 'm').test(example));

if (missing.length > 0) {
  console.error('Environment variables read by the code but missing from .env.example:');
  for (const [name, file] of missing) console.error(`  ${name}  (${file})`);
  console.error('Add each with a comment on what it does — `# NAME=` when it is optional.');
  process.exit(1);
}
