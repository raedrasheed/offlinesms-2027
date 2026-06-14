// Metro configuration for the OfflineSMS mobile app (Expo).
//
// Caps the number of transform workers to keep the release-bundle memory
// footprint bounded — the default spawns one worker per CPU core, and on
// memory-constrained machines that can exhaust RAM during `assembleRelease`
// (Metro worker "Fatal process out of memory: Zone"). A single worker has the
// smallest peak footprint; raise maxWorkers if your build machine has plenty of
// RAM and you want faster bundling.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

config.maxWorkers = 1;

// This app is installed standalone (not an npm workspace), so its only
// out-of-tree dependency, @offlinesms/design-tokens, is symlinked from
// ../../packages/design-tokens. Metro will not read files outside the project
// root unless they are in watchFolders, so add the package explicitly.
// nodeModulesPaths stays the app's own node_modules — the app's Expo/React 19
// tree is fully self-contained and must not resolve into the monorepo root.
const designTokens = path.resolve(projectRoot, '../../packages/design-tokens');
config.watchFolders = [designTokens];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

// Expo SDK 53 / RN 0.79 enable Metro's package.json "exports" resolution by
// default. The Firebase JS SDK's subpath exports maps (e.g. "./auth") have no
// "react-native" condition, so Metro picks the browser/default build instead of
// the RN one — which leaves Firebase Auth's RN component unregistered and crashes
// the app at startup ("Component auth has not been registered yet" → "main" has
// not been registered). Revert to classic main/react-native field resolution
// (the SDK 51 behaviour) so Firebase loads its RN build.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
