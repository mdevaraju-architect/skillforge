/**
 * Shared Salesforce authentication module for MCP plugins.
 *
 * Reads credentials from environment variables only.
 * Never accepts credentials as function arguments — this prevents
 * credential injection from agent-supplied values.
 */

const { execSync } = require('child_process');

/**
 * Returns a validated connection config from environment variables.
 * Throws if credentials are missing or the connection cannot be verified.
 */
function getConnectionConfig() {
  const authUrl = process.env.SF_AUTH_URL;
  const clientId = process.env.SF_CLIENT_ID;
  const privateKeyPath = process.env.SF_PRIVATE_KEY_PATH;
  const instanceUrl = process.env.SF_INSTANCE_URL;
  const username = process.env.SF_USERNAME;

  if (authUrl) {
    return { mode: 'sfdx-auth-url', authUrl };
  }

  if (clientId && privateKeyPath && instanceUrl && username) {
    return { mode: 'jwt', clientId, privateKeyPath, instanceUrl, username };
  }

  throw new Error(
    'Missing Salesforce credentials. Set SF_AUTH_URL or ' +
    '(SF_CLIENT_ID + SF_PRIVATE_KEY_PATH + SF_INSTANCE_URL + SF_USERNAME) ' +
    'in environment variables.'
  );
}

/**
 * Resolves the target org alias from the connection config.
 * Returns the org alias string for use with sf CLI commands.
 */
function resolveOrgAlias(config) {
  if (config.mode === 'sfdx-auth-url') {
    const alias = process.env.SF_ORG_ALIAS || 'plugin-session';
    try {
      execSync(
        `sf org login sfdx-url --sfdx-url-file /dev/stdin --alias "${alias}"`,
        { input: config.authUrl, stdio: ['pipe', 'pipe', 'pipe'] }
      );
    } catch (err) {
      throw new Error(`Failed to authenticate with SFDX auth URL: ${err.message}`);
    }
    return alias;
  }

  if (config.mode === 'jwt') {
    const alias = process.env.SF_ORG_ALIAS || 'plugin-jwt-session';
    try {
      execSync(
        `sf org login jwt ` +
        `--client-id "${config.clientId}" ` +
        `--jwt-key-file "${config.privateKeyPath}" ` +
        `--username "${config.username}" ` +
        `--instance-url "${config.instanceUrl}" ` +
        `--alias "${alias}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] }
      );
    } catch (err) {
      throw new Error(`Failed to authenticate with JWT: ${err.message}`);
    }
    return alias;
  }

  throw new Error(`Unknown auth mode: ${config.mode}`);
}

/**
 * Returns the authenticated org alias, ready for use with sf CLI commands.
 * Caches within the process lifetime.
 */
let _cachedAlias = null;
function getAuthenticatedAlias() {
  if (_cachedAlias) return _cachedAlias;
  const config = getConnectionConfig();
  _cachedAlias = resolveOrgAlias(config);
  return _cachedAlias;
}

module.exports = { getAuthenticatedAlias, getConnectionConfig };
