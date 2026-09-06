/**
 * NOTE: Ensures every actionable marker carries a priority — `TODO [H|M|L]: what`
 * (docs/llm/rules/code-style.md § Comments). Without the priority nobody can tell an
 * idle thought from a release blocker, so the marker stops being actionable.
 *
 * Added because prose alone did not hold: a single review pass found six markers written
 * without a priority, or with it trailing at the end of the sentence, across .ts, .sh and
 * .yml — which is why this checks source files git knows about, tracked or not, rather than
 * only the ones ESLint sees.
 *
 * Deliberate limits:
 *  - Markdown is excluded: the rule docs quote the marker words when describing the
 *    convention, and that prose is not a marker.
 *  - A marker counts only where it OPENS a comment (`// X`, `# X`, `* X`, optionally `@`-
 *    prefixed, any letter case). Prose naming the words mid-sentence is then not a false
 *    positive — which is why this file needs no self-exemption. Two consequences to know:
 *    a marker further inside a comment (`// see also X: …`) is not seen, and a marker inside
 *    a string still counts if a non-word character precedes the opener (`echo "run # X later"`).
 *    The authoring constraint here: never open a comment line with a bare marker word.
 *
 * Usage:
 *   node check-todo-format.js   # exits 1 and lists every malformed marker
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CHECKED_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs', '.py', '.sh', '.yml', '.yaml']);
// Extensionless files that are still source: the container recipe, and the hooks below.
const CHECKED_FILENAMES = new Set(['Dockerfile']);
const CHECKED_DIRECTORIES = ['.husky/'];

// Spelled as case classes rather than with the `i` flag on purpose: the word may be written
// in any case, but the priority suffix must not — `[h]` is a typo, not a well-formed marker.
const MARKER_WORD = '(?:[Tt][Oo][Dd][Oo]|[Ff][Ii][Xx][Mm][Ee])';
// Well-formed: the priority follows the word immediately — `TODO [H]`, `FIXME [L]:`.
// Anything else opening a comment is a violation, whatever punctuation follows or precedes the
// opener — writing `X:` for the marker word: `X:`, `@x`, `X(owner):`, `X - y`, a bare `X`, one
// glued to code as in `foo();//X`, or a priority left trailing at the end of the sentence.
const MARKER = new RegExp(
  `(?:^|[^\\w])(?:\\/\\/+|\\/\\*+|\\*+|#+)\\s*@?${MARKER_WORD}\\b(?!\\s*\\[[HML]\\])`,
);

const repoRoot = path.resolve(__dirname, '..', '..');

// Tracked files plus not-yet-added ones, so a manual `npm run lint` also sees a file that is
// written but not staged yet, as ESLint in the same command already does via its globs.
// No hook runs this on commit; CI is the enforcing gate.
let files;
try {
  files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .split('\0')
    .filter(Boolean);
} catch {
  // No git checkout (release tarball, docker build context, shallow CI job) — the whole
  // lint step must not die over a check that simply has nothing to enumerate.
  console.info('check-todo-format: not a git checkout — skipping.');
  process.exit(0);
}

const violations = [];

for (const file of files) {
  const isChecked =
    CHECKED_EXTENSIONS.has(path.extname(file)) ||
    CHECKED_FILENAMES.has(path.basename(file)) ||
    CHECKED_DIRECTORIES.some((dir) => file.startsWith(dir));
  if (!isChecked) continue;

  const absolute = path.join(repoRoot, file);
  // A tracked path can be absent from the working tree (deleted, not yet committed).
  if (!fs.existsSync(absolute)) continue;

  fs.readFileSync(absolute, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (MARKER.test(line)) violations.push({ file, line: index + 1, text: line.trim() });
    });
}

if (violations.length === 0) {
  process.exit(0);
}

console.error(`\n❌ ${violations.length} marker(s) missing a [H|M|L] priority:\n`);

for (const { file, line, text } of violations) {
  console.error(`  ${file}:${line}  ${text}`);
}

console.error('\nUse `TODO [H|M|L]: what needs to be done` — priority first, before the colon.\n');
process.exit(1);
