'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

function parseArgs(args) {
  const opts = { skill: null, agent: 'claude-code', yes: false };
  let i = 0;
  if (args[0] && !args[0].startsWith('-')) {
    opts.skill = args[0];
    i = 1;
  }
  while (i < args.length) {
    if (args[i] === '--agent') opts.agent = args[++i];
    else if (args[i] === '-y' || args[i] === '--yes') opts.yes = true;
    i++;
  }
  return opts;
}

const AGENT_CONFIGS = {
  'claude-code': 'CLAUDE.md',
  cursor: '.cursorrules',
};

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${question} [y/N] `, ans => {
      rl.close();
      resolve(ans.toLowerCase() === 'y' || ans.toLowerCase() === 'yes');
    });
  });
}

async function remove(args) {
  const opts = parseArgs(args);

  if (!opts.skill) {
    throw new Error('Missing skill name.\n\nUsage: skills remove <skill-name> [--agent <agent>] [-y]');
  }

  const configFile = AGENT_CONFIGS[opts.agent];
  if (!configFile) {
    throw new Error(`Unknown agent '${opts.agent}'. Supported: ${Object.keys(AGENT_CONFIGS).join(', ')}`);
  }

  const configPath = path.resolve(configFile);
  if (!fs.existsSync(configPath)) {
    console.log(`No ${configFile} found in this directory. Nothing to remove.`);
    return;
  }

  const content = fs.readFileSync(configPath, 'utf8');
  const lines = content.split('\n');

  // Find lines that reference this skill
  const matchingLines = lines.filter(l => l.includes(opts.skill) && (l.trim().startsWith('@https://') || l.trim().startsWith('@/')));

  if (matchingLines.length === 0) {
    console.log(`Skill '${opts.skill}' not found in ${configFile}.`);
    return;
  }

  console.log(`\nFound in ${configFile}:`);
  matchingLines.forEach(l => console.log(`  ${l.trim()}`));

  if (!opts.yes) {
    const ok = await confirm('\nRemove?');
    if (!ok) {
      console.log('Aborted.');
      return;
    }
  }

  const filtered = lines.filter(l => !matchingLines.includes(l));
  fs.writeFileSync(configPath, filtered.join('\n'));
  console.log(`\n  ✓  Removed '${opts.skill}' from ${configFile}\n`);
}

module.exports = { remove };
