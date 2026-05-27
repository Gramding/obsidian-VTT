// Minimal stub of the `obsidian` runtime so main.ts can be imported in tests.
// Only the surface that main.ts references at module-evaluation time is needed;
// these classes are never instantiated by the pure logic under test.

export class App {}
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class WorkspaceLeaf {}
export class ItemView {}
export class TFile {}
export class Notice {}
export class Modal {}
export class FuzzySuggestModal {}
export function setIcon(): void {}
