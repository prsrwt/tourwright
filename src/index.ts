// Public API for an app's tourwright.config.ts and, later, its stages file.
export { defineConfig, type UserConfig } from './config/config.ts';
export type { Script, Scene, Beat, Camera } from './schema/script.ts';
export type { Settings, EaseName } from './schema/settings.ts';
