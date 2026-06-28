#!/usr/bin/env node
/**
 * Scans skill files for security anti-patterns:
 * - Hardcoded org IDs (00D...)
 * - Hardcoded user IDs (005...)
 * - Hardcoded session tokens or passwords
 * - SOQL injection patterns (string concatenation of user input)
 * - Credential-shaped strings (access_token, password, secret)
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');

const SCAN_DIRS = ['skills', 'plugins', 'agentforce-agents'];

const PATTERNS = [
  { name: 'Hardcoded org ID',     re: /\b00D[A-Za-z0-9]{12,15}\b/g },
  { name: 'Hardcoded user ID',    re: /\b005[A-Za-z0-9]{12,15}\b/g },
  { name: 'Hardcoded record ID',  re: /\b[a-zA-Z0-9]{15,18}\b(?=.*#.*hardcoded)/g },
  { name: 'access_token literal', re: /access_token\s*[:=]\s*["'][^"']{10,}/g },
  { name: 'password literal',     re: /password\s*[:=]\s*["'][^"']{4,}/gi },
  { name: 'client_secret literal',re: /client_secret\s*[:=]\s*["'][^"']{4,}/gi },
  { name: 'Bearer token',         re: /Bearer\s+[A-Za-z0-9._\-]{20,}/g },
  { name: 'SOQL string concat',   re: /['"`]\s*\+\s*\w+\s*\+\s*['"`].*(?:WHERE|FROM|SELECT)/gi },
];

const SKIP_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.pptx', '.zip'];

let findings = 0;

function scanFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (SKIP_EXTENSIONS.includes(ext)) return;

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return;
  }

  const rel = path.relative(REPO_ROOT, filePath);
  const lines = content.split('\n');

  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      process.stderr.write(`⚠️   ${name} — ${rel}:${lineNum}\n`);
      process.stderr.write(`     ${lines[lineNum - 1].trim().substring(0, 120)}\n`);
      findings++;
      re.lastIndex = match.index + 1;
    }
  }
}

function walkDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walkDir(full);
    } else {
      scanFile(full);
    }
  }
}

for (const scanDir of SCAN_DIRS) {
  walkDir(path.join(REPO_ROOT, scanDir));
}

if (findings > 0) {
  process.stderr.write(`\n${findings} potential security issue(s) found. Review before merging.\n`);
  process.exit(1);
} else {
  process.stdout.write('✓  Security scan passed — no patterns found.\n');
  process.exit(0);
}
