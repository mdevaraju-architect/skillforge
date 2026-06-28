#!/usr/bin/env node
/**
 * Validates that every skill directory has the required files.
 * Called by validate-structure.yml CI workflow.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SKILLS_DIR = path.join(REPO_ROOT, 'skills');

const REQUIRED_FILES = [
  'SKILL.md',
  'skill-manifest.json',
  path.join('references', '01-architecture.md'),
  path.join('evals', 'evals.json'),
];

const REQUIRED_FRONTMATTER = ['name:', 'description:'];
const MIN_EVALS = 10;

let failed = false;

function check(condition, message) {
  if (!condition) {
    process.stderr.write(`❌  ${message}\n`);
    failed = true;
  } else {
    process.stdout.write(`✓  ${message}\n`);
  }
}

function getSkillDirs(base, depth = 0) {
  const dirs = [];
  if (!fs.existsSync(base)) return dirs;
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('_')) continue;
    const full = path.join(base, entry.name);
    // A skill dir is any dir that contains SKILL.md at any depth <= 3
    if (fs.existsSync(path.join(full, 'SKILL.md'))) {
      dirs.push(full);
    } else if (depth < 3) {
      dirs.push(...getSkillDirs(full, depth + 1));
    }
  }
  return dirs;
}

const skillDirs = getSkillDirs(SKILLS_DIR);

if (skillDirs.length === 0) {
  process.stderr.write('⚠️   No skill directories found under skills/\n');
  process.exit(0);
}

for (const skillDir of skillDirs) {
  const rel = path.relative(REPO_ROOT, skillDir);
  process.stdout.write(`\n── ${rel}\n`);

  for (const requiredFile of REQUIRED_FILES) {
    const fullPath = path.join(skillDir, requiredFile);
    check(fs.existsSync(fullPath), `${rel}/${requiredFile} exists`);
  }

  // Check SKILL.md frontmatter
  const skillMd = path.join(skillDir, 'SKILL.md');
  if (fs.existsSync(skillMd)) {
    const content = fs.readFileSync(skillMd, 'utf8');
    for (const field of REQUIRED_FRONTMATTER) {
      check(content.includes(field), `${rel}/SKILL.md has '${field}' frontmatter`);
    }
  }

  // Check eval count
  const evalsPath = path.join(skillDir, 'evals', 'evals.json');
  if (fs.existsSync(evalsPath)) {
    try {
      const evalsData = JSON.parse(fs.readFileSync(evalsPath, 'utf8'));
      const count = Array.isArray(evalsData.evals) ? evalsData.evals.length : 0;
      check(count >= MIN_EVALS, `${rel}/evals/evals.json has >= ${MIN_EVALS} evals (found ${count})`);

      // Check each eval has required fields
      for (const ev of (evalsData.evals || [])) {
        check(ev.id, `eval '${ev.id || '?'}' has id`);
        check(ev.prompt, `eval '${ev.id || '?'}' has prompt`);
        check(Array.isArray(ev.must_not_contain), `eval '${ev.id || '?'}' has must_not_contain array`);
      }
    } catch (e) {
      check(false, `${rel}/evals/evals.json is valid JSON: ${e.message}`);
    }
  }
}

process.exit(failed ? 1 : 0);
