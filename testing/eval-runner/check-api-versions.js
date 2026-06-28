#!/usr/bin/env node
/**
 * Validates skill-manifest.json files:
 * - Schema validation against governance/skill-manifest-schema.json
 * - API version format check
 * - Approval tier consistency
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SKILLS_DIR = path.join(REPO_ROOT, 'skills');
const SCHEMA_PATH = path.join(REPO_ROOT, 'governance', 'skill-manifest-schema.json');

let failed = false;

function check(condition, message) {
  if (!condition) {
    process.stderr.write(`❌  ${message}\n`);
    failed = true;
  } else {
    process.stdout.write(`✓  ${message}\n`);
  }
}

function getManifests(base) {
  const manifests = [];
  if (!fs.existsSync(base)) return manifests;
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith('_')) {
      manifests.push(...getManifests(path.join(base, entry.name)));
    } else if (entry.name === 'skill-manifest.json') {
      manifests.push(path.join(base, entry.name));
    }
  }
  return manifests;
}

const VALID_API_VERSION = /^\d+\.0$/;
const VALID_RELEASE = /^(Winter|Spring|Summer)\d{2}$/;
const VALID_TIERS = ['draft', 'reviewed', 'certified', 'deprecated'];

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const requiredFields = schema.required || [];

const manifests = getManifests(SKILLS_DIR);

if (manifests.length === 0) {
  process.stdout.write('⚠️   No skill-manifest.json files found.\n');
  process.exit(0);
}

for (const manifestPath of manifests) {
  const rel = path.relative(REPO_ROOT, manifestPath);
  process.stdout.write(`\n── ${rel}\n`);

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    check(false, `${rel} is valid JSON: ${e.message}`);
    continue;
  }

  for (const field of requiredFields) {
    check(manifest[field] !== undefined, `${rel} has required field '${field}'`);
  }

  if (manifest['api-version-min']) {
    check(
      VALID_API_VERSION.test(manifest['api-version-min']),
      `${rel} api-version-min is valid format (e.g. '60.0'): got '${manifest['api-version-min']}'`
    );
  }

  if (manifest['salesforce-release-min']) {
    check(
      VALID_RELEASE.test(manifest['salesforce-release-min']),
      `${rel} salesforce-release-min is valid format (e.g. 'Winter25'): got '${manifest['salesforce-release-min']}'`
    );
  }

  if (manifest['approval-tier']) {
    check(
      VALID_TIERS.includes(manifest['approval-tier']),
      `${rel} approval-tier is valid: '${manifest['approval-tier']}'`
    );
  }

  if (manifest.compliance) {
    check(
      Array.isArray(manifest.compliance['org-types']) && manifest.compliance['org-types'].length > 0,
      `${rel} compliance.org-types is a non-empty array`
    );
    check(
      ['none', 'internal', 'confidential', 'restricted'].includes(manifest.compliance['data-sensitivity']),
      `${rel} compliance.data-sensitivity is valid`
    );
  }
}

process.exit(failed ? 1 : 0);
