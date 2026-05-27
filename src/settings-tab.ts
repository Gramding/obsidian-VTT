import { PluginSettingTab, Setting, type App } from "obsidian";
import type { BoardSettings } from "./types";
import type VTTPlugin from "../main";

export class VTTSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: VTTPlugin) { super(app, plugin); }
  display() {
    const { containerEl, plugin } = this;
    // Use the active board's settings as defaults
    const activeBoard = plugin.vttSettings.boards[plugin.vttSettings.activeBoardIndex]
                     ?? plugin.vttSettings.boards[0];
    const { board } = activeBoard;
    containerEl.empty();
    containerEl.createEl("h2", { text: "VTT Board" });

    new Setting(containerEl).setName("Default grid type")
      .addDropdown(d => d
        .addOption("square",     "Square")
        .addOption("hex-flat",   "Hex (Flat-top)")
        .addOption("hex-pointy", "Hex (Pointy-top)")
        .setValue(board.gridType)
        .onChange(v => { board.gridType = v as BoardSettings["gridType"]; plugin.saveVTTSettings(); }));

    new Setting(containerEl)
      .setName("Cell size (px)")
      .setDesc("Size of one grid cell in world-space pixels. Background image is independent — use Align BG mode to match it.")
      .addSlider(s => s.setLimits(10, 200, 1).setValue(board.cellSize)
        .setDynamicTooltip()
        .onChange(v => { board.cellSize = v; plugin.saveVTTSettings(); }));

    new Setting(containerEl).setName("Columns")
      .addText(t => t.setValue(String(board.cols))
        .onChange(v => { const n = parseInt(v); if (n > 0) { board.cols = n; plugin.saveVTTSettings(); } }));

    new Setting(containerEl).setName("Rows")
      .addText(t => t.setValue(String(board.rows))
        .onChange(v => { const n = parseInt(v); if (n > 0) { board.rows = n; plugin.saveVTTSettings(); } }));

    new Setting(containerEl).setName("Grid color")
      .addColorPicker(c => c.setValue(board.gridColor)
        .onChange(v => { board.gridColor = v; plugin.saveVTTSettings(); }));

    new Setting(containerEl).setName("Grid opacity")
      .addSlider(s => s.setLimits(0, 1, 0.05).setValue(board.gridOpacity)
        .setDynamicTooltip()
        .onChange(v => { board.gridOpacity = v; plugin.saveVTTSettings(); }));

    new Setting(containerEl).setName("Open VTT Board")
      .addButton(b => b.setButtonText("Open").onClick(() => plugin.activateView()));
  }
}
