import { Notice, Plugin, type WorkspaceLeaf } from 'obsidian';
import { CaptureModal } from './modals';
import { DEFAULT_SETTINGS, folderPath, StoryWebSettingTab, type StoryWebSettings } from './settings';
import { NoteStore } from './store';
import { StoryWebView, VIEW_TYPE_STORY_WEB } from './view';

export default class StoryWebPlugin extends Plugin {
	settings: StoryWebSettings = { ...DEFAULT_SETTINGS };
	store!: NoteStore;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.store = new NoteStore(this.app, () => folderPath(this.settings));

		this.registerView(VIEW_TYPE_STORY_WEB, (leaf) => new StoryWebView(leaf, this));

		this.addRibbonIcon('network', 'Open Story Web graph', () => void this.activateView());
		this.addRibbonIcon('lightbulb', 'New plot point', () => this.openCapture());

		this.addCommand({
			id: 'open-graph',
			name: 'Open graph',
			callback: () => void this.activateView(),
		});

		// No default hotkey (Obsidian guidelines) — bind one under Settings → Hotkeys.
		this.addCommand({
			id: 'new-plot-point',
			name: 'New plot point',
			callback: () => this.openCapture(),
		});

		this.addSettingTab(new StoryWebSettingTab(this.app, this));
	}

	onunload(): void {
		// Best effort: Obsidian doesn't await unload, but the writes are already queued.
		void this.store.flushPositions();
	}

	openCapture(): void {
		new CaptureModal(this.app, async (title, blurb) => {
			try {
				const file = await this.store.capture(title, blurb, this.settings.defaultType || null);
				if (this.settings.openAfterCapture) await this.app.workspace.getLeaf('tab').openFile(file);
				else new Notice(`Created ${file.basename}`);
			} catch (err) {
				console.error('[story-web] capture failed', err);
				new Notice(`Could not create note: ${err instanceof Error ? err.message : String(err)}`);
				throw err; // keep the modal open so the text isn't lost
			}
		}).open();
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_STORY_WEB)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getLeaf('tab');
			await leaf.setViewState({ type: VIEW_TYPE_STORY_WEB, active: true });
		}
		await workspace.revealLeaf(leaf);
	}

	async loadSettings(): Promise<void> {
		this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<StoryWebSettings> | null) };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_STORY_WEB)) {
			if (leaf.view instanceof StoryWebView) {
				leaf.view.restyle();
				leaf.view.requestRefresh();
			}
		}
	}
}
