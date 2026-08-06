// Default Expo Metro config, plus: exclude the in-repo /server package so Metro
// never watches or tries to bundle its node_modules (it's a separate Node app).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const serverDir = path.resolve(__dirname, 'server').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
config.resolver.blockList = [new RegExp(`^${serverDir}[/\\\\].*`)];

module.exports = config;
