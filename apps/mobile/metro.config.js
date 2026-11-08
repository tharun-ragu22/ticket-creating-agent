const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const workspacePackages = path.join(workspaceRoot, 'packages');

/**
 * node:crypto, which React Native does not have.
 *
 * Reached only because the @tca/contracts barrel re-exports
 * deriveIdempotencyKey. See shims/node-crypto.js for why a throwing stub is
 * the right answer here rather than a real polyfill.
 */
const nodeCryptoShim = path.join(projectRoot, 'shims', 'node-crypto.js');

const config = getDefaultConfig(projectRoot);

/**
 * Watch the workspace packages, so editing @tca/contracts reloads the app.
 *
 * Deliberately not the whole workspace root: that contains the API's live
 * PGlite data directory, which is written to constantly while a call is in
 * progress, and every write would trigger a reload mid-conversation.
 */
config.watchFolders = [workspacePackages];

const defaultResolveRequest = config.resolver.resolveRequest;

/**
 * Two fixes, both needed to bundle the shared model into the app.
 *
 * 1. Node's crypto, redirected to a stub. React Native has no Node standard
 *    library, so the import has to resolve to something.
 *
 * 2. @tca/contracts is authored for Node ESM, so its internal imports carry a
 *    `.js` extension pointing at a `.ts` file — `export * from './ticket.js'`
 *    where the file is `ticket.ts`. Node and vitest resolve that; Metro does
 *    not, and fails the bundle with `Unable to resolve "./ticket.js"`. jest
 *    needs the same fix and has it as a moduleNameMapper in jest.config.js.
 *
 *    The original specifier is tried FIRST and the extension dropped only once
 *    that has failed, which is what makes this safe to apply everywhere rather
 *    than scoping it to our own packages by path: nothing that resolves today
 *    changes, and a real `./foo.js` is never silently redirected to a `./foo/`
 *    directory. Scoping by path was the first attempt and never fired, most
 *    likely a Windows drive-letter case mismatch in originModulePath.
 */
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;

  if (moduleName === 'node:crypto' || moduleName === 'crypto') {
    return { type: 'sourceFile', filePath: nodeCryptoShim };
  }

  try {
    return resolve(context, moduleName, platform);
  } catch (error) {
    if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
      return resolve(context, moduleName.slice(0, -'.js'.length), platform);
    }
    throw error;
  }
};

module.exports = config;
