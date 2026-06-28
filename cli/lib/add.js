'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const AGENTS = {
  'claude-code': {
    configFile: 'CLAUDE.md',
    sectionHeader: '## Agent Skills',
    description: 'Claude Code (CLAUDE.md)',
  },
  cursor: {
    configFile: '.cursorrules',
    sectionHeader: '# Agent Skills',
    description: 'Cursor (.cursorrules)',
  },
  continue: {
    configFile: '.continuerc.json',
    sectionHeader: null,
    description: 'Continue (.continuerc.json)',
  },
};

function parseArgs(args) {
  const opts = { repo: null, skills: [], agent: 'claude-code', yes: false };
  let i = 0;
  if (args[0] && !args[0].startsWith('-')) {
    opts.repo = args[0];
    i = 1;
  }
  while (i < args.length) {
    const a = args[i];
    if (a === '--skill' || a === '--skills') {
      opts.skills.push(args[++i]);
    } else if (a === '--agent') {
      opts.agent = args[++i];
    } else if (a === '-y' || a === '--yes') {
      opts.yes = true;
    }
    i++;
  }
  return opts;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'skillforge-cli/1.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        try { resolve(JSON.parse(body)); } catch { reject(new Error(`Invalid JSON from ${url}`)); }
      });
    }).on('error', reject);
  });
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'skillforge-cli/1.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchText(res.headers.location).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        resolve(body);
      });
    }).on('error', reject);
  });
}

async function resolveSkills(repo, skillPattern) {
  // Use GitHub API to fetch package.json — avoids raw CDN caching
  const apiUrl = `https://api.github.com/repos/${repo}/contents/package.json`;
  let pkg;
  try {
    const meta = await fetchJson(apiUrl);
    const content = Buffer.from(meta.content, 'base64').toString('utf8');
    pkg = JSON.parse(content);
  } catch {
    // Fallback to raw URL
    try {
      pkg = await fetchJson(`https://raw.githubusercontent.com/${repo}/main/package.json`);
    } catch {
      throw new Error(`Could not fetch package.json from ${repo}. Is this a valid SkillForge repo?`);
    }
  }

  const allSkills = pkg.skills || [];
  if (allSkills.length === 0) {
    throw new Error(`No skills found in ${repo}/package.json`);
  }

  if (skillPattern === '*') return allSkills;

  const match = allSkills.find(s => s.name === skillPattern);
  if (!match) {
    const names = allSkills.map(s => s.name).join(', ');
    throw new Error(`Skill '${skillPattern}' not found in ${repo}. Available: ${names}`);
  }
  return [match];
}

function buildSkillRef(repo, skillPath) {
  return `@https://raw.githubusercontent.com/${repo}/main/${skillPath}`;
}

function readConfig(configPath) {
  if (!fs.existsSync(configPath)) return '';
  return fs.readFileSync(configPath, 'utf8');
}

function writeClaudeConfig(configPath, sectionHeader, newRefs) {
  let content = readConfig(configPath);
  const lines = content.split('\n');

  // Find or create the section
  let sectionIdx = lines.findIndex(l => l.trim() === sectionHeader);
  if (sectionIdx === -1) {
    // Append section at end
    if (content && !content.endsWith('\n')) content += '\n';
    content += `\n${sectionHeader}\n\n`;
    lines.splice(lines.length, 0, '', sectionHeader, '');
    sectionIdx = lines.length - 2;
  }

  // Find existing @ refs under the section
  const added = [];
  for (const ref of newRefs) {
    const refLine = ref;
    // Check if already present anywhere in the file
    if (lines.some(l => l.trim() === refLine)) {
      added.push({ ref, alreadyPresent: true });
      continue;
    }
    // Insert after section header (and any blank line after it)
    let insertAt = sectionIdx + 1;
    while (insertAt < lines.length && lines[insertAt].trim() === '') insertAt++;
    lines.splice(insertAt, 0, refLine);
    sectionIdx = lines.findIndex(l => l.trim() === sectionHeader); // recalc after splice
    added.push({ ref, alreadyPresent: false });
  }

  fs.writeFileSync(configPath, lines.join('\n'));
  return added;
}

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${question} [y/N] `, ans => {
      rl.close();
      resolve(ans.toLowerCase() === 'y' || ans.toLowerCase() === 'yes');
    });
  });
}

async function add(args) {
  const opts = parseArgs(args);

  if (!opts.repo) {
    throw new Error('Missing repo argument.\n\nUsage: skills add <owner/repo> --skill <name> [--agent <agent>] [-y]');
  }
  if (opts.skills.length === 0) {
    throw new Error('Missing --skill argument. Use --skill <name> or --skill \'*\' for all skills.');
  }

  const agentConfig = AGENTS[opts.agent];
  if (!agentConfig) {
    throw new Error(`Unknown agent '${opts.agent}'. Supported: ${Object.keys(AGENTS).join(', ')}`);
  }

  console.log(`\nResolving skills from ${opts.repo}...`);

  // Resolve all skill patterns
  const resolvedSkills = [];
  for (const pattern of opts.skills) {
    const skills = await resolveSkills(opts.repo, pattern);
    resolvedSkills.push(...skills);
  }

  const refs = resolvedSkills.map(s => buildSkillRef(opts.repo, s.path));

  console.log(`\nSkills to install:`);
  resolvedSkills.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.name}  [${s['approval-tier']}]`);
    console.log(`     ${refs[i]}`);
  });
  console.log(`\nTarget: ${agentConfig.description}`);
  console.log(`Config: ${path.resolve(agentConfig.configFile)}`);

  if (!opts.yes) {
    const ok = await confirm('\nProceed?');
    if (!ok) {
      console.log('Aborted.');
      return;
    }
  }

  const results = writeClaudeConfig(
    path.resolve(agentConfig.configFile),
    agentConfig.sectionHeader,
    refs
  );

  console.log('');
  for (const r of results) {
    if (r.alreadyPresent) {
      console.log(`  ✓  Already installed: ${r.ref.split('/').pop()}`);
    } else {
      console.log(`  ✓  Installed: ${r.ref.split('/').pop()}`);
    }
  }

  console.log(`\nDone. Skills are active in Claude Code for this project.`);
  console.log(`Open Claude Code and ask: "What are the required fields for a Claim FNOL in FSC?"\n`);
}

module.exports = { add };
