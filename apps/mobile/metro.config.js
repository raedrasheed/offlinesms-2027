// Metro configuration for the OfflineSMS mobile app (Expo).
//
// Caps the number of transform workers to keep the release-bundle memory
// footprint bounded — the default spawns one worker per CPU core, and on
// memory-constrained machines that can exhaust RAM during `assembleRelease`
// (Metro worker "Fatal process out of memory: Zone"). A single worker has the
// smallest peak footprint; raise maxWorkers if your build machine has plenty of
// RAM and you want faster bundling.

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.maxWorkers = 1;

module.exports = config;
