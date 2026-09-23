import { App, normalizePath, PluginSettingTab, Setting, type SettingDefinitionItem } from 'obsidian';
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

/** Shared copy for the declarative definitions and the pre-1.13 fallback. */
const TEXT = {
	folder: {
		name: 'Folder',
		desc: 'Notes in this folder (and its subfolders) appear on the graph. Positions, groups and manual connections are written to their frontmatter. Cannot be the vault root.',
	},
	defaultType: {
		name: 'Default type',
		desc: 'Written as `type:` on notes created with quick capture. Leave blank for none. Examples: fiction, campaign.',
	},
	cardLines: {
		name: 'Lines per card',
		desc: 'How much of each blurb the graph shows. Longer blurbs end in “…”. Set to 1 for compact one-line cards.',
	},
	openAfterCapture: {
		name: 'Open note after capture',
		desc: 'Off keeps capture fast: the note is created and shows up on the graph without leaving what you were doing.',
	},
} as const;

type SettingKey = keyof StoryWebSettings;

export class StoryWebSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: StoryWebPlugin,
	) {
		super(app, plugin);
	}

	/** Obsidian 1.13+: rendered declaratively and indexed by settings search. */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				...TEXT.folder,
				// Folder picker; excludes the vault root by default (see folderPath()).
				control: { type: 'folder', key: 'folder', placeholder: DEFAULT_SETTINGS.folder },
			},
			{ ...TEXT.defaultType, control: { type: 'text', key: 'defaultType' } },
			{ ...TEXT.cardLines, control: { type: 'slider', key: 'cardLines', min: 1, max: 6, step: 1 } },
			{ ...TEXT.openAfterCapture, control: { type: 'toggle', key: 'openAfterCapture' } },
		];
	}

	getControlValue(key: string): unknown {
		return this.plugin.settings[key as SettingKey];
	}

	/** Routes every change through saveSettings(), which also restyles/refreshes open graphs. */
	async setControlValue(key: string, value: unknown): Promise<void> {
		await this.applySetting(key as SettingKey, value);
	}

	private async applySetting(key: SettingKey, value: unknown): Promise<void> {
		const settings = this.plugin.settings;
		switch (key) {
			case 'folder':
				settings.folder = typeof value === 'string' ? value : '';
				break;
			case 'defaultType':
				settings.defaultType = typeof value === 'string' ? value.trim() : '';
				break;
			case 'cardLines':
				settings.cardLines = Math.min(6, Math.max(1, Math.round(Number(value) || DEFAULT_SETTINGS.cardLines)));
				break;
			case 'openAfterCapture':
				settings.openAfterCapture = value === true;
				break;
		}
		await this.plugin.saveSettings();
	}

	/** Fallback for Obsidian < 1.13 (manifest minAppVersion is 1.7.2); not called on 1.13+. */
	display(): void {
		const { containerEl } = this;
		const settings = this.plugin.settings;
		containerEl.empty();

		new Setting(containerEl)
			.setName(TEXT.folder.name)
			.setDesc(TEXT.folder.desc)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.folder)
					.setValue(settings.folder)
					.onChange((v) => this.applySetting('folder', v)),
			);

		new Setting(containerEl)
			.setName(TEXT.defaultType.name)
			.setDesc(TEXT.defaultType.desc)
			.addText((text) => text.setValue(settings.defaultType).onChange((v) => this.applySetting('defaultType', v)));

		new Setting(containerEl)
			.setName(TEXT.cardLines.name)
			.setDesc(TEXT.cardLines.desc)
			.addSlider((slider) =>
				slider
					.setLimits(1, 6, 1)
					.setValue(settings.cardLines)
					.onChange((v) => this.applySetting('cardLines', v)),
			);

		new Setting(containerEl)
			.setName(TEXT.openAfterCapture.name)
			.setDesc(TEXT.openAfterCapture.desc)
			.addToggle((toggle) =>
				toggle.setValue(settings.openAfterCapture).onChange((v) => this.applySetting('openAfterCapture', v)),
			);
	}
}
