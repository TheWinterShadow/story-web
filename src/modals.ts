import { App, Modal, Setting } from 'obsidian';
import type { ColorName } from './colors';
import { sanitizeGroupPath, type GroupPath } from './folders';

/**
 * Quick capture: title + one-line blurb, with an optional group. Enter in the
 * title jumps to the blurb, Enter in the blurb submits — so the fast path
 * (no group) is still exactly type, Enter, type, Enter. The group field is a
 * genuinely optional detour: reach it with Tab or a click, and it submits on
 * its own Enter too.
 */
export class CaptureModal extends Modal {
	private title = '';
	private blurb = '';
	private group = '';

	constructor(
		app: App,
		private readonly existingGroups: GroupPath[],
		private readonly onSubmit: (title: string, blurb: string, group: GroupPath) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('New plot point');
		this.contentEl.addClass('story-web-capture');

		let blurbInput: HTMLInputElement | null = null;
		let groupInput: HTMLInputElement | null = null;

		new Setting(this.contentEl).setName('Title').addText((text) => {
			text.setPlaceholder('The heist goes wrong').onChange((v) => (this.title = v));
			text.inputEl.addEventListener('keydown', (evt) => {
				if (evt.key === 'Enter' && !evt.isComposing) {
					evt.preventDefault();
					blurbInput?.focus();
				}
			});
			window.setTimeout(() => text.inputEl.focus(), 0);
		});

		new Setting(this.contentEl).setName('Blurb').addText((text) => {
			blurbInput = text.inputEl;
			text.setPlaceholder('One line shown on the graph (optional)').onChange((v) => (this.blurb = v));
			text.inputEl.addEventListener('keydown', (evt) => {
				if (evt.key === 'Enter' && !evt.isComposing) {
					evt.preventDefault();
					void this.submit();
				}
			});
		});

		new Setting(this.contentEl)
			.setName('Group')
			.setDesc('Optional — leave blank to skip. Puts the note in that folder; “/” nests, e.g. Act 1/heist.')
			.addText((text) => {
				groupInput = text.inputEl;
				text.setPlaceholder('None').onChange((v) => (this.group = v));
				text.inputEl.addEventListener('keydown', (evt) => {
					if (evt.key === 'Enter' && !evt.isComposing) {
						evt.preventDefault();
						void this.submit();
					}
				});
			});

		if (this.existingGroups.length > 0) {
			const list = this.contentEl.createDiv({ cls: 'story-web-suggestions' });
			for (const g of this.existingGroups) {
				list.createEl('button', { text: g }).addEventListener('click', () => {
					this.group = g;
					if (groupInput) groupInput.value = g;
				});
			}
		}

		new Setting(this.contentEl).addButton((btn) =>
			btn
				.setButtonText('Create')
				.setCta()
				.onClick(() => void this.submit()),
		);
	}

	private async submit(): Promise<void> {
		if (this.title.trim() === '') return;
		await this.onSubmit(this.title, this.blurb, sanitizeGroupPath(this.group));
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Single-line text prompt with optional one-tap suggestions (existing group
 * names). Buttons rather than a datalist because datalist is unreliable on iPadOS.
 */
export class TextPromptModal extends Modal {
	private value: string;

	constructor(
		app: App,
		private readonly opts: {
			title: string;
			label: string;
			initial?: string;
			suggestions?: string[];
			cta: string;
			onSubmit: (value: string) => Promise<void>;
		},
	) {
		super(app);
		this.value = opts.initial ?? '';
	}

	onOpen(): void {
		this.setTitle(this.opts.title);
		this.contentEl.addClass('story-web-prompt');

		new Setting(this.contentEl).setName(this.opts.label).addText((text) => {
			text.setValue(this.value).onChange((v) => (this.value = v));
			text.inputEl.addEventListener('keydown', (evt) => {
				if (evt.key === 'Enter' && !evt.isComposing) {
					evt.preventDefault();
					void this.submit(this.value);
				}
			});
			window.setTimeout(() => {
				text.inputEl.focus();
				text.inputEl.select();
			}, 0);
		});

		const suggestions = this.opts.suggestions ?? [];
		if (suggestions.length > 0) {
			const list = this.contentEl.createDiv({ cls: 'story-web-suggestions' });
			for (const s of suggestions) {
				list.createEl('button', { text: s }).addEventListener('click', () => void this.submit(s));
			}
		}

		new Setting(this.contentEl).addButton((btn) =>
			btn
				.setButtonText(this.opts.cta)
				.setCta()
				.onClick(() => void this.submit(this.value)),
		);
	}

	private async submit(value: string): Promise<void> {
		if (value.trim() === '') return;
		await this.opts.onSubmit(value.trim());
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * A grid of colour swatches plus an "Automatic" option. Swatches, not a text
 * field or a native `<input type=color>`: the eight choices are Obsidian's
 * own theme colours (colors.ts), the same ones a note's type is auto-coloured
 * from, so picking is a single tap and the result always matches the theme.
 */
export class ColorPickerModal extends Modal {
	constructor(
		app: App,
		private readonly opts: {
			colors: { name: ColorName; css: string }[];
			current: ColorName | null;
			onPick: (color: ColorName | null) => Promise<void>;
		},
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Set colour');
		const grid = this.contentEl.createDiv({ cls: 'story-web-swatches' });

		const auto = grid.createEl('button', {
			cls: ['story-web-swatch', 'story-web-swatch-auto', ...(this.opts.current === null ? ['is-selected'] : [])].join(' '),
			attr: { 'aria-label': 'Automatic — match the note’s type', type: 'button' },
		});
		auto.addEventListener('click', () => void this.pick(null));

		for (const { name, css } of this.opts.colors) {
			const btn = grid.createEl('button', {
				cls: ['story-web-swatch', ...(this.opts.current === name ? ['is-selected'] : [])].join(' '),
				attr: { 'aria-label': name, type: 'button' },
			});
			btn.setCssProps({ '--story-web-swatch-color': css });
			btn.addEventListener('click', () => void this.pick(name));
		}
	}

	private async pick(color: ColorName | null): Promise<void> {
		await this.opts.onPick(color);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
