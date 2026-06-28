#!/usr/bin/env node
'use strict';

const { add } = require('../lib/add');
const { list } = require('../lib/list');
const { remove } = require('../lib/remove');

const [,, command, ...rest] = process.argv;

const USAGE = `
SkillForge Skills CLI

Usage:
  skills add <repo> --skill <skill-name> [--agent <agent>] [-y]
  skills list [--agent <agent>]
  skills remove <skill-name> [--agent <agent>]

Commands:
  add      Install a skill from a GitHub repo into your agent config
  list     Show installed skills
  remove   Remove a skill from your agent config

Options:
  --skill <name>   Skill name to install (use '*' for all skills in the repo)
  --agent <name>   Target agent: claude-code (default), cursor, continue
  -y, --yes        Skip confirmation prompts

Examples:
  npx @skillforge/skills add mdevaraju-architect/skillforge --skill industries-fsc-claims-process --agent claude-code -y
  npx @skillforge/skills list
  npx @skillforge/skills remove industries-fsc-claims-process
`.trim();

if (!command || command === '--help' || command === '-h') {
  console.log(USAGE);
  process.exit(0);
}

(async () => {
  try {
    if (command === 'add') {
      await add(rest);
    } else if (command === 'list') {
      await list(rest);
    } else if (command === 'remove') {
      await remove(rest);
    } else {
      console.error(`Unknown command: ${command}\n`);
      console.log(USAGE);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
})();
