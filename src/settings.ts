import { App, normalizePath, PluginSettingTab, Setting } from 'obsidian';
import type StoryWebPlugin from './main';

export interface StoryWebSettings {
	/** Vault folder (recursive) whose notes become graph nodes. Never empty — see `folderPath()`. */
	folder: string;
	/** `type` written on quick-captured notes. Blank = no type. */
	defaultType: string;
	/** Open the new note after quick capture instead of staying where you are. */
	openAfterCapture: boolean;
	/** Maximum lines of blurb shown on each card (1 = compact one-liners). */
	cardLines: number;
}

export const DEFAULT_SETTINGS: StoryWebSettings = {
	folder: 'Plots',
	defaultType: '',
	openAfterCapture: false,
	cardLines: 3,
};

/**
 * Normalised folder path. Falls back to the default rather than the vault
 * root: the plugin writes `x`/`y` into every note it lays out, and doing that
 * to an entire vault by accident would be destructive.
 */
export function folderPath(settings: StoryWebSettings): string {
	const path = normalizePath(settings.folder.trim());
	return path === '' || path === '/' ? DEFAULT_SETTINGS.folder : path;
}

export class StoryWebSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: StoryWebPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Folder')
			.setDesc(
				'Notes in this folder (and its subfolders) appear on the graph. Positions, groups and manual connections are written to their frontmatter. Cannot be the vault root.',
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.folder)
					.setValue(this.plugin.settings.folder)
					.onChange(async (value) => {
						this.plugin.settings.folder = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Default type')
			.setDesc('Written as `type:` on notes created with quick capture. Leave blank for none. Examples: fiction, campaign.')
			.addText((text) =>
				text.setValue(this.plugin.settings.defaultType).onChange(async (value) => {
					this.plugin.settings.defaultType = value.trim();
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Lines per card')
			.setDesc('How much of each blurb the graph shows. Longer blurbs end in “…”. Set to 1 for compact one-line cards.')
			.addSlider((slider) =>
				slider
					.setLimits(1, 6, 1)
					.setValue(this.plugin.settings.cardLines)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.cardLines = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Open note after capture')
			.setDesc('Off keeps capture fast: the note is created and shows up on the graph without leaving what you were doing.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.openAfterCapture).onChange(async (value) => {
					this.plugin.settings.openAfterCapture = value;
					await this.plugin.saveSettings();
				}),
			);
	}
}
