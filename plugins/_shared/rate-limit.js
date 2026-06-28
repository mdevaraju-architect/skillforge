/**
 * Shared rate-limiting module for MCP plugins.
 *
 * Defaults: 30 calls/minute, 500 calls/hour.
 * Override with SF_PLUGIN_RATE_MINUTE and SF_PLUGIN_RATE_HOUR env vars.
 *
 * Uses a simple sliding window counter in memory (process-scoped).
 * For multi-process deployments, replace with a shared store.
 */

const LIMIT_MINUTE = parseInt(process.env.SF_PLUGIN_RATE_MINUTE || '30', 10);
const LIMIT_HOUR   = parseInt(process.env.SF_PLUGIN_RATE_HOUR   || '500', 10);

const calls = [];

function pruneOld() {
  const now = Date.now();
  const cutoffHour = now - 3600_000;
  while (calls.length > 0 && calls[0] < cutoffHour) {
    calls.shift();
  }
}

/**
 * Records a call and throws if any rate limit is exceeded.
 * Call this before executing any outbound Salesforce API request.
 */
function checkRateLimit(pluginName, toolName) {
  pruneOld();

  const now = Date.now();
  const oneMinuteAgo = now - 60_000;

  const callsLastMinute = calls.filter(t => t > oneMinuteAgo).length;
  if (callsLastMinute >= LIMIT_MINUTE) {
    throw new Error(
      `Rate limit exceeded: ${LIMIT_MINUTE} calls/minute for ${pluginName}.${toolName}. ` +
      `Wait ${Math.ceil((calls.find(t => t > oneMinuteAgo) + 60_000 - now) / 1000)}s.`
    );
  }

  if (calls.length >= LIMIT_HOUR) {
    throw new Error(
      `Rate limit exceeded: ${LIMIT_HOUR} calls/hour for ${pluginName}.${toolName}.`
    );
  }

  calls.push(now);
}

module.exports = { checkRateLimit };
