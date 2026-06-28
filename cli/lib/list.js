'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_FILES = ['CLAUDE.md', '.cursorrules'];

function parseArgs(args) {
  const opts = { agent: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--agent') opts.agent = args[++i];
  }
  return opts;
}

function extractRefs(content) {
  const refs = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('@https://') || trimmed.startsWith('@/')) {
      refs.push(trimmed);
    }
  }
  return refs;
}

function parseSkillName(ref) {
  // @https://raw.githubusercontent.com/owner/repo/main/skills/.../SKILL.md
  const parts = ref.split('/');
  const skillIdx = parts.indexOf('skills');
  if (skillIdx === -1) return ref;
  // e.g. skills/industries/fsc/claims-process/SKILL.md -> industries-fsc-claims-process
  const pathParts = parts.slice(skillIdx + 1);
  pathParts.pop(); // remove SKILL.md
  return pathParts.join('-');
}

async function list(args) {
  const opts = parseArgs(args);
  const filesToCheck = opts.agent ? [opts.agent === 'claude-code' ? 'CLAUDE.md' : '.cursorrules'] : CONFIG_FILES;

  let found = false;
  for (const file of filesToCheck) {
    const filePath = path.resolve(file);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    const refs = extractRefs(content);
    if (refs.length === 0) continue;

    found = true;
    console.log(`\nInstalled skills in ${file}:`);
    refs.forEach((ref, i) => {
      const name = parseSkillName(ref);
      console.log(`  ${i + 1}. ${name}`);
      console.log(`     ${ref}`);
    });
  }

  if (!found) {
    console.log('\nNo SkillForge skills installed in this project.');
    console.log('Run: npx @skillforge/skills add mdevaraju-architect/skillforge --skill <name> --agent claude-code -y\n');
  } else {
    console.log('');
  }
}

module.exports = { list };
