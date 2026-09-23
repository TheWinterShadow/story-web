import { App, Modal, Setting } from 'obsidian';

/**
 * Quick capture: title + one-line blurb. Enter in the title jumps to the blurb,
 * Enter in the blurb submits — so the whole flow is type, Enter, type, Enter.
 */
export class CaptureModal extends Modal {
	private title = '';
	private blurb = '';

	constructor(
		app: App,
		private readonly onSubmit: (title: string, blurb: string) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('New plot point');
		this.contentEl.addClass('story-web-capture');

		let blurbInput: HTMLInputElement | null = null;

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

		new Setting(this.contentEl).addButton((btn) =>
			btn
				.setButtonText('Create')
				.setCta()
				.onClick(() => void this.submit()),
		);
	}

	private async submit(): Promise<void> {
		if (this.title.trim() === '') return;
		await this.onSubmit(this.title, this.blurb);
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
