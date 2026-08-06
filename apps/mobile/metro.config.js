// Default Expo Metro config. (The old /server blocklist is gone — server now
// lives in a sibling app under apps/, outside this project root.)
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
