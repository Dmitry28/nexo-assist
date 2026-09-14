/**
 * NOTE: Ensures all dependencies in package.json use caret (^) version ranges.
 * Pinned versions prevent minor/patch updates which can lead to stale dependencies.
 * Skips local file links (file:), workspace references (workspace:), and allowlisted packages.
 *
 * Usage:
 *   node check-package-versions.js          # check only (exits with 1 if violations found)
 *   node check-package-versions.js --fix    # auto-fix by adding ^ to pinned versions
 */
const fs = require('fs');
const path = require('path');

const EXEMPT_PREFIXES = ['file:', 'workspace:', 'npm:'];
const SECTIONS = ['dependencies', 'devDependencies'];

// NOTE: Packages intentionally pinned due to known breaking changes in newer versions
const PINNED_ALLOWLIST = new Set([
  // typescript: `~6.0.3` encodes typescript-eslint's `<6.1.0` peer ceiling (ts-jest caps at
  // `<7`), so 6.0.x is the only release the toolchain accepts. The tilde still takes 6.0.x
  // patches; a caret would let `npm update` walk into 6.1 and silently degrade linting.
  // Back to a caret once both declare support (see PRODUCT_PLAN.md, tech backlog).
  'typescript',
]);

const shouldFix = process.argv.includes('--fix');
const pkgPath = path.resolve(__dirname, '..', '..', 'package.json');
const pkg = require(pkgPath);

const violations = [];

for (const section of SECTIONS) {
  if (!pkg[section]) continue;

  for (const [name, version] of Object.entries(pkg[section])) {
    if (EXEMPT_PREFIXES.some((prefix) => version.startsWith(prefix))) continue;
    if (PINNED_ALLOWLIST.has(name)) continue;
    if (!version.startsWith('^')) {
      violations.push({ section, name, version });
    }
  }
}

if (violations.length === 0) {
  process.exit(0);
}

if (shouldFix) {
  let content = fs.readFileSync(pkgPath, 'utf8');

  for (const { name, version } of violations) {
    content = content.replace(`"${name}": "${version}"`, `"${name}": "^${version}"`);
  }

  fs.writeFileSync(pkgPath, content);
  console.info(`✅ Fixed ${violations.length} package(s) — added ^ to version ranges.`);
  process.exit(0);
}

console.error(`\n❌ ${violations.length} package(s) missing caret (^) version range:\n`);

for (const { section, name, version } of violations) {
  console.error(`  ${section} → ${name}: "${version}" → should be "^${version}"`);
}

console.error(
  '\nRun with --fix to auto-fix, or add to PINNED_ALLOWLIST if intentionally pinned.\n',
);
process.exit(1);
