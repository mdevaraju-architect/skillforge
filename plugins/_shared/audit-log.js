/**
 * Shared audit logging module for MCP plugins.
 *
 * Every plugin tool invocation must call auditLog() before executing.
 * Logs are written to ~/.sf/plugin-audit.jsonl (overridable via SF_PLUGIN_AUDIT_LOG).
 *
 * Audit logs may contain record data and should be treated as confidential.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const LOG_PATH = process.env.SF_PLUGIN_AUDIT_LOG ||
  path.join(os.homedir(), '.sf', 'plugin-audit.jsonl');

const SESSION_ID = crypto.randomBytes(8).toString('hex');

function ensureLogDir() {
  const dir = path.dirname(LOG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

/**
 * @param {object} entry
 * @param {string} entry.plugin - Plugin name (e.g. 'soql-runner')
 * @param {string} entry.tool - Tool name (e.g. 'runQuery')
 * @param {string} entry.operation - The query or operation (truncated at 4096 chars)
 * @param {'allowed'|'blocked'|'dry-run'} entry.outcome
 * @param {number} [entry.rowCount] - Row count for query results
 * @param {string} [entry.error] - Error message if blocked or failed
 */
function auditLog(entry) {
  ensureLogDir();

  const record = {
    ts: new Date().toISOString(),
    session: SESSION_ID,
    plugin: entry.plugin,
    tool: entry.tool,
    operation: (entry.operation || '').substring(0, 4096),
    outcome: entry.outcome,
    ...(entry.rowCount !== undefined && { rowCount: entry.rowCount }),
    ...(entry.error && { error: entry.error }),
  };

  try {
    fs.appendFileSync(LOG_PATH, JSON.stringify(record) + '\n', { mode: 0o600 });
  } catch (err) {
    process.stderr.write(`[audit-log] Failed to write audit log: ${err.message}\n`);
  }
}

module.exports = { auditLog, SESSION_ID };
