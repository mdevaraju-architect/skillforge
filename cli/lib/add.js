'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Claude Code supports @url file references — skill content loaded on demand.
// All other agents require the skill content embedded directly in their config file.
const AGENTS = {
  'claude-code': {
    configFile: 'CLAUDE.md',
    sectionHeader: '## Agent Skills',
    description: 'Claude Code (CLAUDE.md)',
    embed: false,
  },
  cursor: {
    configFile: '.cursor/rules/skillforge.mdc',
    sectionHeader: '# Agent Skills (SkillForge)',
    description: 'Cursor (.cursor/rules/skillforge.mdc)',
    embed: true,
  },
  windsurf: {
    configFile: '.windsurfrules',
    sectionHeader: '# Agent Skills (SkillForge)',
    description: 'Windsurf (.windsurfrules)',
    embed: true,
  },
  copilot: {
    configFile: '.github/copilot-instructions.md',
    sectionHeader: '## Agent Skills (SkillForge)',
    description: 'GitHub Copilot (.github/copilot-instructions.md)',
    embed: true,
  },
  cline: {
    configFile: '.clinerules',
    sectionHeader: '# Agent Skills (SkillForge)',
    description: 'Cline / Roo (.clinerules)',
    embed: true,
  },
  continue: {
    configFile: '.continuerc.md',
    sectionHeader: '## Agent Skills (SkillForge)',
    description: 'Continue (.continuerc.md)',
    embed: true,
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

function rawUrl(repo, skillPath) {
  return `https://raw.githubusercontent.com/${repo}/main/${skillPath}`;
}

function refLine(repo, skillPath) {
  return `@${rawUrl(repo, skillPath)}`;
}

function readConfig(configPath) {
  if (!fs.existsSync(configPath)) return '';
  return fs.readFileSync(configPath, 'utf8');
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// For Claude Code — write @url reference line
function writeRefConfig(configPath, sectionHeader, newRefs) {
  let content = readConfig(configPath);
  const lines = content.split('\n');

  let sectionIdx = lines.findIndex(l => l.trim() === sectionHeader);
  if (sectionIdx === -1) {
    if (content && !content.endsWith('\n')) content += '\n';
    lines.splice(lines.length, 0, '', sectionHeader, '');
    sectionIdx = lines.length - 2;
  }

  const added = [];
  for (const ref of newRefs) {
    if (lines.some(l => l.trim() === ref)) {
      added.push({ ref, alreadyPresent: true });
      continue;
    }
    let insertAt = sectionIdx + 1;
    while (insertAt < lines.length && lines[insertAt].trim() === '') insertAt++;
    lines.splice(insertAt, 0, ref);
    sectionIdx = lines.findIndex(l => l.trim() === sectionHeader);
    added.push({ ref, alreadyPresent: false });
  }

  ensureDir(configPath);
  fs.writeFileSync(configPath, lines.join('\n'));
  return added;
}

// For all other agents — embed skill content directly
function writeEmbedConfig(configPath, sectionHeader, skillName, content) {
  const existing = readConfig(configPath);
  const startMarker = `<!-- skillforge:${skillName}:start -->`;
  const endMarker = `<!-- skillforge:${skillName}:end -->`;

  const block = `${startMarker}\n${content.trim()}\n${endMarker}`;

  let updated;
  if (existing.includes(startMarker)) {
    // Replace existing block
    const re = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`, 'g');
    updated = existing.replace(re, block);
    ensureDir(configPath);
    fs.writeFileSync(configPath, updated);
    return { alreadyPresent: false, replaced: true };
  }

  // Append under section header or at end
  const lines = existing.split('\n');
  let sectionIdx = lines.findIndex(l => l.trim() === sectionHeader);
  if (sectionIdx === -1) {
    const append = (existing && !existing.endsWith('\n') ? '\n' : '') + `\n${sectionHeader}\n\n${block}\n`;
    ensureDir(configPath);
    fs.writeFileSync(configPath, existing + append);
  } else {
    let insertAt = sectionIdx + 1;
    while (insertAt < lines.length && lines[insertAt].trim() === '') insertAt++;
    lines.splice(insertAt, 0, block);
    ensureDir(configPath);
    fs.writeFileSync(configPath, lines.join('\n'));
  }
  return { alreadyPresent: false, replaced: false };
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
    const supported = Object.keys(AGENTS).join(', ');
    throw new Error(`Unknown agent '${opts.agent}'. Supported: ${supported}`);
  }

  console.log(`\nResolving skills from ${opts.repo}...`);

  const resolvedSkills = [];
  for (const pattern of opts.skills) {
    const skills = await resolveSkills(opts.repo, pattern);
    resolvedSkills.push(...skills);
  }

  console.log(`\nSkills to install:`);
  resolvedSkills.forEach((s, i) => {
    const action = agentConfig.embed ? 'embed content into' : 'add @reference to';
    console.log(`  ${i + 1}. ${s.name}  [${s['approval-tier']}]  → ${action} ${agentConfig.configFile}`);
  });
  console.log(`\nTarget: ${agentConfig.description}`);
  console.log(`Config: ${path.resolve(agentConfig.configFile)}`);

  if (!opts.yes) {
    const ok = await confirm('\nProceed?');
    if (!ok) { console.log('Aborted.'); return; }
  }

  if (!agentConfig.embed) {
    // Claude Code — write @url references
    const refs = resolvedSkills.map(s => refLine(opts.repo, s.path));
    const results = writeRefConfig(path.resolve(agentConfig.configFile), agentConfig.sectionHeader, refs);
    console.log('');
    for (const r of results) {
      console.log(r.alreadyPresent
        ? `  ✓  Already installed: ${r.ref.split('/').slice(-2).join('/')}`
        : `  ✓  Installed: ${r.ref.split('/').slice(-2).join('/')}`);
    }
  } else {
    // All other agents — fetch and embed content
    console.log('');
    for (const skill of resolvedSkills) {
      process.stdout.write(`  →  Fetching ${skill.name}...`);
      const content = await fetchText(rawUrl(opts.repo, skill.path));
      const result = writeEmbedConfig(
        path.resolve(agentConfig.configFile),
        agentConfig.sectionHeader,
        skill.name,
        content
      );
      console.log(result.replaced ? ` updated` : ` ✓  installed`);
    }
  }

  console.log(`\nDone. Open your AI coding agent and ask:`);
  console.log(`  "What are the required fields for a Claim FNOL in Salesforce FSC?"\n`);
}

module.exports = { add };
