#!/usr/bin/env node
'use strict';

const { add } = require('../lib/add');
const { list } = require('../lib/list');
const { remove } = require('../lib/remove');

const [,, command, ...rest] = process.argv;

const USAGE = `
SkillForge Skills CLI
Works with Claude Code, Cursor, Windsurf, GitHub Copilot, Cline, and Continue.

Usage:
  skills add <repo> --skill <skill-name> --agent <agent> [-y]
  skills list [--agent <agent>]
  skills remove <skill-name> [--agent <agent>]

Commands:
  add      Install a skill into your AI coding agent config
  list     Show installed skills
  remove   Remove a skill from your agent config

Options:
  --skill <name>   Skill name to install (use '*' for all skills in the repo)
  --agent <name>   Target agent (default: claude-code)
                   Supported: claude-code, cursor, windsurf, copilot, cline, continue
  -y, --yes        Skip confirmation prompts

How it works:
  claude-code  Writes an @url reference into CLAUDE.md (loaded on demand)
  cursor       Embeds skill content into .cursor/rules/skillforge.mdc
  windsurf     Embeds skill content into .windsurfrules
  copilot      Embeds skill content into .github/copilot-instructions.md
  cline        Embeds skill content into .clinerules
  continue     Embeds skill content into .continuerc.md

Examples:
  npx @skillforge/skills add mdevaraju-architect/skillforge --skill industries-fsc-claims-process --agent claude-code -y
  npx @skillforge/skills add mdevaraju-architect/skillforge --skill industries-fsc-claims-process --agent cursor -y
  npx @skillforge/skills add mdevaraju-architect/skillforge --skill industries-fsc-claims-process --agent windsurf -y
  npx @skillforge/skills list
  npx @skillforge/skills remove industries-fsc-claims-process --agent cursor
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
