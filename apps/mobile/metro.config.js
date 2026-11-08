const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const workspacePackages = path.join(workspaceRoot, 'packages');

const config = getDefaultConfig(projectRoot);

/**
 * Watch the workspace packages, so editing @tca/contracts reloads the app.
 *
 * Deliberately not the whole workspace root: that contains the API's live
 * PGlite data directory, which is written to constantly while a call is in
 * progress, and every write would trigger a reload mid-conversation.
 */
config.watchFolders = [workspacePackages];

/**
 * Lets Metro resolve the workspace packages' own imports.
 *
 * @tca/contracts is authored for Node ESM, so its internal imports carry a
 * `.js` extension that points at a `.ts` file — `export * from './ticket.js'`
 * where the file is `ticket.ts`. Node and vitest resolve that; Metro does not,
 * and fails the bundle with `Unable to resolve "./ticket.js"`. jest needs the
 * same fix and has it as a moduleNameMapper in jest.config.js.
 *
 * The original specifier is tried FIRST and the extension dropped only after
 * that has failed, which is what makes this safe to apply everywhere rather
 * than scoping it to our own packages by path: nothing that resolves today
 * changes, and a real `./foo.js` is never silently redirected to a `./foo/`
 * directory. Scoping by path was the first attempt and did not fire — most
 * likely a Windows drive-letter case mismatch in originModulePath.
 */
const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;

  try {
    return resolve(context, moduleName, platform);
  } catch (error) {
    if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
      return resolve(context, moduleName.slice(0, -'.js'.length), platform);
    }
    throw error;
  }
};

// Printed once at startup, so "my config is not being loaded" is never a
// guess. Remove when the bundle is green.
console.log('[metro.config] loaded; watching', workspacePackages);

module.exports = config;
