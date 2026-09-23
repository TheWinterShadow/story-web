import cytoscape, {
	type Core,
	type EdgeSingular,
	type EventObject,
	type NodeCollection,
	type NodeSingular,
	type StylesheetJson,
} from 'cytoscape';
import { ItemView, Keymap, Menu, Notice, Scope, setIcon, setTooltip, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { columnLayout, LAYOUT, type LayoutBlock } from './layout';
import { TextPromptModal } from './modals';
import { assignTypeSlots, buildStylesheet, readTheme, TYPE_PALETTE_SIZE } from './theme';
import { buildGraph, groupId, type GraphModel, type Position, type TypeFilter } from './model';
import type { NoteStore } from './store';

export const VIEW_TYPE_STORY_WEB = 'story-web-graph';

const REFRESH_DEBOUNCE_MS = 250;
/** After a long-press opens a menu, swallow the tap that the same touch produces on release. */
const TAP_SUPPRESS_MS = 700;
const GRID_SPACING = 24;
const ZOOM_STEP = 1.25;
/** Room kept clear around the graph when fitting, so the floating controls don't cover notes. */
const FIT_PADDING = 64;
const ALL = '__all__';
const UNTYPED = '__untyped__';

interface StoryWebViewState extends Record<string, unknown> {
	filter?: TypeFilter;
}

export interface ViewHost {
	store: NoteStore;
	settings: { cardLines: number };
	openCapture(): void;
}

export class StoryWebView extends ItemView {
	private cy: Core | null = null;
	private filter: TypeFilter = null;

	private connectMode = false;
	private connectSource: NodeSingular | null = null;
	private connectBtn: HTMLButtonElement | null = null;

	private refreshTimer: number | null = null;
	private suppressTapUntil = 0;
	private lastPointerType = 'mouse';
	private hasFitted = false;

	private graphEl!: HTMLElement;
	private filterEl!: HTMLSelectElement;
	private hintEl!: HTMLElement;
	private emptyEl!: HTMLElement;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly host: ViewHost,
	) {
		super(leaf);
		this.navigation = false;
	}

	private get store(): NoteStore {
		return this.host.store;
	}

	getViewType(): string {
		return VIEW_TYPE_STORY_WEB;
	}

	getDisplayText(): string {
		return 'Story Web';
	}

	getIcon(): string {
		return 'network';
	}

	// ---- lifecycle ---------------------------------------------------------

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass('story-web-view');

		const toolbar = root.createDiv({ cls: 'story-web-toolbar' });
		const left = toolbar.createDiv({ cls: 'story-web-toolbar-left' });
		this.filterEl = left.createEl('select', { cls: 'dropdown story-web-filter', attr: { 'aria-label': 'Filter by type' } });
		this.filterEl.addEventListener('change', () => {
			const v = this.filterEl.value;
			this.filter = v === ALL ? null : v === UNTYPED ? '' : v;
			this.app.workspace.requestSaveLayout();
			this.hasFitted = false;
			this.refresh();
		});
		this.hintEl = left.createSpan({ cls: 'story-web-hint', attr: { role: 'status', 'aria-live': 'polite' } });

		// Primary actions, top right: labelled so they're self-explanatory (and
		// visible on iPad, where view-header actions collapse into a menu).
		const actions = toolbar.createDiv({ cls: 'story-web-actions' });
		controlButton(actions, {
			icon: 'plus',
			label: 'New',
			tooltip: 'New plot point',
			cls: 'mod-cta',
			onClick: () => this.host.openCapture(),
		});
		this.connectBtn = controlButton(actions, {
			icon: 'waypoints',
			label: 'Connect',
			tooltip: 'Connect notes: pick one, then the note it leads to',
			cls: 'story-web-connect',
			onClick: () => this.setConnectMode(!this.connectMode),
		});
		this.connectBtn.setAttribute('aria-pressed', 'false');

		this.graphEl = root.createDiv({ cls: 'story-web-graph' });
		this.graphEl.addEventListener('pointerdown', (evt) => (this.lastPointerType = evt.pointerType));

		// Map-style zoom controls, bottom right.
		const zoom = root.createDiv({ cls: 'story-web-zoom' });
		controlButton(zoom, { icon: 'plus', tooltip: 'Zoom in', onClick: () => this.zoomBy(ZOOM_STEP) });
		controlButton(zoom, { icon: 'minus', tooltip: 'Zoom out', onClick: () => this.zoomBy(1 / ZOOM_STEP) });
		zoom.createDiv({ cls: 'story-web-zoom-divider' });
		controlButton(zoom, { icon: 'scan', tooltip: 'Fit all notes', onClick: () => this.fitAll(true) });

		this.emptyEl = root.createDiv({ cls: 'story-web-empty' });

		this.scope = new Scope(this.app.scope);
		this.scope.register([], 'Escape', () => {
			if (!this.connectMode) return true;
			this.setConnectMode(false);
			return false;
		});
		for (const key of ['Delete', 'Backspace']) {
			this.scope.register([], key, () => {
				void this.deleteSelectedEdges();
				return false;
			});
		}

		this.initCytoscape();
		this.registerVaultEvents();
		// On startup the view can be restored before the vault is indexed.
		this.app.workspace.onLayoutReady(() => this.refresh());
	}

	async onClose(): Promise<void> {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		await this.store.flushPositions();
		this.cy?.destroy();
		this.cy = null;
	}

	onResize(): void {
		this.cy?.resize();
		if (!this.hasFitted) this.fitOnce();
	}

	getState(): Record<string, unknown> {
		return { ...super.getState(), filter: this.filter };
	}

	async setState(state: StoryWebViewState, result: ViewStateResult): Promise<void> {
		if (state && 'filter' in state) {
			this.filter = typeof state.filter === 'string' ? state.filter : null;
			this.refresh();
		}
		await super.setState(state, result);
	}

	// ---- data → graph ------------------------------------------------------

	private registerVaultEvents(): void {
		const { vault, metadataCache, workspace } = this.app;
		const touches = (path: string): boolean => this.store.isInScope(path);
		this.registerEvent(metadataCache.on('changed', (file) => touches(file.path) && this.requestRefresh()));
		// Body links to a note that didn't exist yet resolve after the target is created.
		this.registerEvent(metadataCache.on('resolved', () => this.requestRefresh()));
		this.registerEvent(vault.on('create', (file) => touches(file.path) && this.requestRefresh()));
		this.registerEvent(vault.on('delete', (file) => touches(file.path) && this.requestRefresh()));
		this.registerEvent(
			vault.on('rename', (file, oldPath) => (touches(file.path) || touches(oldPath)) && this.requestRefresh()),
		);
		this.registerEvent(workspace.on('css-change', () => this.restyle()));
	}

	private stylesheet(): StylesheetJson {
		return buildStylesheet(readTheme(this.contentEl), { maxLines: this.host.settings.cardLines });
	}

	/** Re-apply styles after a theme or display-setting change. */
	restyle(): void {
		this.cy?.style(this.stylesheet());
	}

	requestRefresh(): void {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			this.refresh();
		}, REFRESH_DEBOUNCE_MS);
	}

	refresh(): void {
		if (!this.cy) return;
		const model = buildGraph(this.store.collect(), this.filter);
		this.renderFilter(model);
		this.renderEmptyState(model);
		const unplaced = this.reconcile(model);
		this.place(unplaced);
		this.fitOnce();
	}

	/**
	 * Diff the model into the live graph instead of rebuilding it, so external
	 * edits (sync from another device, typing in a note) don't reset zoom/pan
	 * or yank a node out from under an in-progress drag.
	 *
	 * Returns ids of new nodes that have no stored position.
	 */
	private reconcile(model: GraphModel): string[] {
		const cy = this.cy!;
		const wanted = new Set<string>();
		const unplaced: string[] = [];
		// From every type in the folder, not just the filtered ones, so colours don't shift when filtering.
		const typeSlots = assignTypeSlots(model.types, TYPE_PALETTE_SIZE);

		cy.batch(() => {
			for (const name of model.groups) {
				const id = groupId(name);
				wanted.add(id);
				if (cy.getElementById(id).empty()) {
					cy.add({ group: 'nodes', data: { id, label: name, name, kind: 'group' }, classes: 'group' });
				}
			}

			for (const n of model.nodes) {
				wanted.add(n.id);
				const parent = n.group ? groupId(n.group) : null;
				let node = cy.getElementById(n.id) as NodeSingular;

				if (node.empty()) {
					cy.add({
						group: 'nodes',
						data: { id: n.id, label: n.label, path: n.path, kind: 'note', ...(n.type ? { typeSlot: typeSlots.get(n.type) } : {}), ...(parent ? { parent } : {}) },
						classes: 'note',
						...(n.position ? { position: { ...n.position } } : {}),
					});
					if (!n.position) unplaced.push(n.id);
					continue;
				}

				node.data('label', n.label);
				if (n.type) node.data('typeSlot', typeSlots.get(n.type));
				else node.removeData('typeSlot');
				const currentParent = node.isChild() ? node.parent().first().id() : null;
				if (currentParent !== parent) {
					node.move({ parent });
					node = cy.getElementById(n.id);
				}
				if (n.position && !node.grabbed() && distance(node.position(), n.position) > 0.5) {
					node.position({ ...n.position });
				}
			}

			for (const e of model.edges) {
				wanted.add(e.id);
				const classes = [e.manual ? 'manual' : 'linked-only'];
				const existing = cy.getElementById(e.id);
				if (existing.empty()) {
					cy.add({ group: 'edges', data: { id: e.id, source: e.source, target: e.target, manual: e.manual, linked: e.linked }, classes });
				} else {
					existing.data({ manual: e.manual, linked: e.linked });
					existing.classes(classes);
				}
			}

			// Remove stale edges, then notes, then groups: every surviving note has
			// already been moved into a surviving group, so stale groups are empty.
			cy.edges().filter((el) => !wanted.has(el.id())).remove();
			cy.nodes('.note').filter((el) => !wanted.has(el.id())).remove();
			cy.nodes('.group').filter((el) => !wanted.has(el.id())).remove();
		});

		if (this.connectSource?.removed()) this.clearConnectSource();
		return unplaced;
	}

	/** Give positionless nodes a spot, then persist it so the layout is stable from now on. */
	private place(unplacedIds: string[]): void {
		const cy = this.cy!;
		if (unplacedIds.length === 0) return;
		const notes = cy.nodes('.note');
		const ids = new Set(unplacedIds);
		const unplaced = cy.nodes().filter((n) => ids.has(n.id()));

		if (unplaced.length === notes.length) {
			// Nothing has a position yet (first open): lay everything out in columns.
			const blocks = new Map<string | null, LayoutBlock>();
			notes.forEach((n) => {
				const group = n.isChild() ? (n.parent().first().data('name') as string) : null;
				const block = blocks.get(group) ?? { group, items: [] };
				block.items.push({ id: n.id(), width: n.outerWidth(), height: n.outerHeight() });
				blocks.set(group, block);
			});
			const positions = columnLayout([...blocks.values()]);
			cy.batch(() => notes.forEach((n) => void n.position({ ...positions.get(n.id())! })));
			this.persist(notes);
			this.hasFitted = false;
			return;
		}

		// Otherwise drop new nodes where the user will see them: next to their
		// group if they have one, else in the middle of the current viewport.
		// Several new notes at the same anchor stack downwards by their real heights.
		const nextY = new Map<string, number>();
		unplaced.forEach((node) => {
			const anchor = this.anchorFor(node, unplaced);
			const key = `${anchor.x},${anchor.y}`;
			const top = nextY.get(key) ?? anchor.y;
			node.position({ x: anchor.x, y: top + node.outerHeight() / 2 });
			nextY.set(key, top + node.outerHeight() + LAYOUT.rowGap);
		});
		this.persist(unplaced);
	}

	private anchorFor(node: NodeSingular, exclude: NodeCollection): Position {
		const cy = this.cy!;
		const siblings = node.isChild() ? node.siblings('.note').difference(exclude) : cy.collection();
		if (siblings.nonempty()) {
			const bb = siblings.boundingBox({});
			return { x: bb.x1 + bb.w / 2, y: bb.y2 + LAYOUT.rowGap };
		}
		const ext = cy.extent();
		if (Number.isFinite(ext.x1) && ext.w > 0) return { x: ext.x1 + ext.w / 2, y: ext.y1 + ext.h / 2 };
		const bb = cy.nodes('.note').difference(exclude).boundingBox({});
		return { x: bb.x1, y: bb.y2 + 80 };
	}

	private persist(nodes: NodeCollection): void {
		nodes.forEach((n) => {
			const path = n.data('path') as string | undefined;
			if (path) this.store.queuePosition(path, n.position());
		});
	}

	private zoomBy(factor: number): void {
		const cy = this.cy;
		if (!cy) return;
		const level = Math.min(cy.maxZoom(), Math.max(cy.minZoom(), cy.zoom() * factor));
		const renderedPosition = { x: cy.width() / 2, y: cy.height() / 2 };
		if (prefersReducedMotion()) cy.zoom({ level, renderedPosition });
		else cy.animate({ zoom: { level, renderedPosition } }, { duration: 150, easing: 'ease-out' });
	}

	private fitAll(animate: boolean): void {
		const cy = this.cy;
		if (!cy || cy.nodes().empty()) return;
		if (animate && !prefersReducedMotion()) cy.animate({ fit: { eles: cy.elements(), padding: FIT_PADDING } }, { duration: 200, easing: 'ease-out' });
		else cy.fit(undefined, FIT_PADDING);
	}

	private fitOnce(): void {
		const cy = this.cy;
		if (!cy || this.hasFitted || cy.width() === 0 || cy.nodes().empty()) return;
		this.fitAll(false);
		this.hasFitted = true;
	}

	private renderFilter(model: GraphModel): void {
		const current = this.filter === null ? ALL : this.filter === '' ? UNTYPED : this.filter;
		const options: [string, string][] = [[ALL, 'All types']];
		const types = new Set(model.types);
		if (this.filter) types.add(this.filter);
		for (const t of [...types].sort()) options.push([t, t]);
		if (model.hasUntyped || this.filter === '') options.push([UNTYPED, 'Untyped']);

		this.filterEl.empty();
		for (const [value, label] of options) this.filterEl.createEl('option', { value, text: label });
		this.filterEl.value = current;
		// A single type is not worth a control.
		this.filterEl.toggle(options.length > 2 || this.filter !== null);
	}

	private renderEmptyState(model: GraphModel): void {
		this.emptyEl.empty();
		const empty = model.nodes.length === 0;
		this.emptyEl.toggle(empty);
		this.contentEl.toggleClass('is-empty', empty);
		if (!empty) return;
		setIcon(this.emptyEl.createDiv({ cls: 'story-web-empty-icon' }), 'network');
		this.emptyEl.createDiv({
			cls: 'story-web-empty-title',
			text: this.filter === null ? 'Nothing here yet' : 'No notes of this type',
		});
		this.emptyEl.createDiv({
			cls: 'story-web-empty-desc',
			text:
				this.filter === null
					? `Notes you add to “${this.store.folder}” appear here as cards.`
					: `No notes in “${this.store.folder}” have this type.`,
		});
		const btn = this.emptyEl.createEl('button', { text: 'New plot point', cls: 'mod-cta' });
		btn.addEventListener('click', () => this.host.openCapture());
	}

	// ---- cytoscape setup & interaction -------------------------------------

	private initCytoscape(): void {
		const cy = cytoscape({
			container: this.graphEl,
			style: this.stylesheet(),
			minZoom: 0.1,
			maxZoom: 3,
			boxSelectionEnabled: false,
			selectionType: 'single',
		});
		this.cy = cy;

		cy.on('tap', 'node.note', (e) => {
			if (Date.now() < this.suppressTapUntil) return;
			const node = e.target as NodeSingular;
			if (this.connectMode) void this.handleConnectTap(node);
			else void this.openNote(node.data('path') as string, e.originalEvent);
		});

		cy.on('tap', (e) => {
			if (e.target === cy && this.connectMode) this.clearConnectSource();
		});

		// Persist on release only — never mid-drag. Dragging a group box moves its members.
		cy.on('dragfree', 'node', (e) => {
			const node = e.target as NodeSingular;
			this.persist(node.isParent() ? node.descendants('.note') : cy.collection(node));
		});

		// Hover a note: emphasise it and its connections, fade the rest.
		cy.on('mouseover', 'node.note', (e) => {
			// Cards are clickable: show it. (Crosshair wins in connect mode, via CSS.)
			this.graphEl.addClass('is-over-note');
			if (this.lastPointerType !== 'mouse') return;
			const node = e.target as NodeSingular;
			const keep = node.closedNeighborhood();
			cy.batch(() => {
				node.addClass('hover');
				keep.edges().addClass('highlight');
				cy.elements('.note, edge').difference(keep).addClass('faded');
				cy.nodes('.group').difference(keep.parents()).addClass('faded');
			});
		});
		cy.on('mouseout', 'node.note', () => {
			this.graphEl.removeClass('is-over-note');
			cy.batch(() => cy.elements().removeClass('hover highlight faded'));
		});
		cy.on('mouseover', 'node.group', (e) => (e.target as NodeSingular).addClass('hover'));
		cy.on('mouseout', 'node.group', (e) => (e.target as NodeSingular).removeClass('hover'));
		cy.on('grab', 'node', () => cy.batch(() => cy.elements().removeClass('hover highlight faded')));

		// Keep the CSS dot grid locked to the graph as it pans and zooms.
		cy.on('viewport', () => this.syncGrid());
		this.syncGrid();

		cy.on('cxttap', 'node, edge', (e) => this.showMenu(e));
		// Long-press = context menu, but only for touch/pen; a mouse user holding
		// still before a drag shouldn't get a menu popping up.
		cy.on('taphold', 'node, edge', (e) => {
			if (this.lastPointerType === 'mouse') return;
			this.suppressTapUntil = Date.now() + TAP_SUPPRESS_MS;
			this.showMenu(e);
		});
	}

	private syncGrid(): void {
		const cy = this.cy;
		if (!cy) return;
		let size = GRID_SPACING * cy.zoom();
		while (size < GRID_SPACING / 2) size *= 2; // thin out dots when zoomed far out
		const pan = cy.pan();
		this.graphEl.setCssProps({
			'--story-web-grid-size': `${size}px`,
			'--story-web-grid-x': `${pan.x % size}px`,
			'--story-web-grid-y': `${pan.y % size}px`,
		});
	}

	private async openNote(path: string, evt?: Event): Promise<void> {
		const file = this.store.fileAt(path);
		if (!file) return;
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf;
		if (evt instanceof MouseEvent && Keymap.isModEvent(evt)) {
			leaf = workspace.getLeaf('tab');
		} else {
			// Reuse a note pane rather than replacing the graph with the note.
			const recent = workspace.getMostRecentLeaf();
			leaf =
				recent && recent !== this.leaf && recent.view.getViewType() === 'markdown'
					? recent
					: (workspace.getLeavesOfType('markdown')[0] ?? workspace.getLeaf('tab'));
		}
		await leaf.openFile(file);
		await workspace.revealLeaf(leaf);
	}

	// ---- connect mode ------------------------------------------------------

	private setConnectMode(on: boolean): void {
		this.connectMode = on;
		this.clearConnectSource();
		if (this.connectBtn) {
			this.connectBtn.toggleClass('is-active', on);
			this.connectBtn.setAttribute('aria-pressed', String(on));
			setButtonContent(this.connectBtn, on ? 'check' : 'waypoints', on ? 'Done' : 'Connect');
			setTooltip(this.connectBtn, on ? 'Finish connecting (Esc)' : 'Connect notes: pick one, then the note it leads to');
		}
		this.contentEl.toggleClass('is-connecting', on);
		this.cy?.autoungrabify(on); // no accidental drags while picking nodes
		this.updateHint();
	}

	private clearConnectSource(): void {
		this.connectSource?.removeClass('connect-source');
		this.connectSource = null;
		this.updateHint();
	}

	private updateHint(): void {
		if (!this.connectMode) this.hintEl.setText('');
		else if (!this.connectSource) this.hintEl.setText('Connect: pick a note to start from');
		else this.hintEl.setText('Now pick the note it leads to · tap empty space to cancel');
	}

	private startConnectFrom(node: NodeSingular): void {
		this.setConnectMode(true);
		this.connectSource = node;
		node.addClass('connect-source');
		this.updateHint();
	}

	private async handleConnectTap(node: NodeSingular): Promise<void> {
		const source = this.connectSource;
		if (!source) {
			this.startConnectFrom(node);
			return;
		}
		this.clearConnectSource();
		if (source.id() === node.id()) return;
		try {
			const added = await this.store.connect(source.data('path') as string, node.data('path') as string);
			if (!added) new Notice('Those notes are already connected.');
		} catch (err) {
			console.error('[story-web] connect failed', err);
			new Notice(`Could not connect: ${String(err)}`);
		}
	}

	private async removeEdge(edge: EdgeSingular): Promise<void> {
		if (!edge.data('manual')) return;
		const source = edge.source().data('path') as string;
		const target = edge.target().data('path') as string;
		try {
			await this.store.disconnect(source, target);
		} catch (err) {
			console.error('[story-web] disconnect failed', err);
			new Notice(`Could not remove connection: ${String(err)}`);
		}
	}

	private async deleteSelectedEdges(): Promise<void> {
		const edges = this.cy?.edges(':selected') ?? null;
		if (!edges || edges.empty()) return;
		if (edges.some((e) => !e.data('manual'))) {
			new Notice('That link is written in the note body. Edit the note to remove it.');
		}
		for (const edge of edges.toArray()) {
			if (edge.data('manual')) await this.removeEdge(edge);
		}
	}

	// ---- context menus -----------------------------------------------------

	private showMenu(e: EventObject): void {
		const target = e.target as NodeSingular | EdgeSingular;
		const menu = new Menu();

		if (target.isEdge()) this.fillEdgeMenu(menu, target);
		else if (target.hasClass('group')) this.fillGroupMenu(menu, target);
		else this.fillNoteMenu(menu, target);

		const rect = this.graphEl.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left + e.renderedPosition.x, y: rect.top + e.renderedPosition.y });
	}

	private fillNoteMenu(menu: Menu, node: NodeSingular): void {
		const path = node.data('path') as string;
		const group = node.isChild() ? (node.parent().first().data('name') as string) : null;

		menu.addItem((i) => i.setTitle('Open note').setIcon('file-text').onClick(() => void this.openNote(path)));
		menu.addItem((i) =>
			i
				.setTitle('Open in new tab')
				.setIcon('file-plus')
				.onClick(async () => {
					const file = this.store.fileAt(path);
					if (file) await this.app.workspace.getLeaf('tab').openFile(file);
				}),
		);
		menu.addSeparator();
		menu.addItem((i) => i.setTitle('Connect from here…').setIcon('link').onClick(() => this.startConnectFrom(node)));
		menu.addItem((i) =>
			i
				.setTitle(group ? 'Move to group…' : 'Add to group…')
				.setIcon('box-select')
				.onClick(() => this.promptGroup(path, group)),
		);
		if (group) {
			menu.addItem((i) =>
				i
					.setTitle(`Remove from “${group}”`)
					.setIcon('x')
					.onClick(() => void this.store.setGroup([path], null)),
			);
		}
	}

	private fillGroupMenu(menu: Menu, node: NodeSingular): void {
		const name = node.data('name') as string;
		menu.addItem((i) =>
			i
				.setTitle('Rename group…')
				.setIcon('pencil')
				.onClick(() => this.promptRenameGroup(name)),
		);
		menu.addItem((i) =>
			i
				.setTitle('Ungroup')
				.setIcon('ungroup')
				.onClick(async () => {
					// Every note in the folder with this group, not just the visible (filtered) ones.
					await this.store.renameGroup(name, '');
				}),
		);
	}

	private fillEdgeMenu(menu: Menu, edge: EdgeSingular): void {
		const sourcePath = edge.source().data('path') as string;
		if (edge.data('manual')) {
			menu.addItem((i) =>
				i
					.setTitle('Remove connection')
					.setIcon('trash')
					.setWarning(true)
					.onClick(() => void this.removeEdge(edge)),
			);
		}
		if (edge.data('linked')) {
			menu.addItem((i) =>
				i
					.setTitle(edge.data('manual') ? 'Also linked in note body' : 'Linked in note body — edit the note to remove')
					.setIcon('info')
					.setDisabled(true),
			);
		}
		menu.addItem((i) => i.setTitle('Open source note').setIcon('file-text').onClick(() => void this.openNote(sourcePath)));
	}

	private promptGroup(path: string, current: string | null): void {
		new TextPromptModal(this.app, {
			title: current ? 'Move to group' : 'Add to group',
			label: 'Group name',
			initial: current ?? '',
			suggestions: this.store.existingGroups().filter((g) => g !== current),
			cta: 'Save',
			onSubmit: (name) => this.store.setGroup([path], name),
		}).open();
	}

	private promptRenameGroup(name: string): void {
		new TextPromptModal(this.app, {
			title: 'Rename group',
			label: 'New name',
			initial: name,
			cta: 'Rename',
			onSubmit: async (to) => {
				if (to === name) return;
				const n = await this.store.renameGroup(name, to);
				new Notice(`Renamed group on ${n} note${n === 1 ? '' : 's'}.`);
			},
		}).open();
	}
}

function distance(a: Position, b: Position): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

function prefersReducedMotion(): boolean {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Fill a control button with an icon and an optional text label. */
function setButtonContent(btn: HTMLElement, icon: string, label?: string): void {
	btn.empty();
	setIcon(btn.createSpan({ cls: 'story-web-btn-icon' }), icon);
	if (label) btn.createSpan({ cls: 'story-web-btn-label', text: label });
}

/**
 * A floating-control button styled with Obsidian's own classes, so it follows
 * the active theme. `setTooltip` doubles as the accessible label for icon-only buttons.
 */
function controlButton(
	parent: HTMLElement,
	opts: { icon: string; label?: string; tooltip: string; cls?: string; onClick: () => void },
): HTMLButtonElement {
	const btn = parent.createEl('button', { cls: ['story-web-btn', opts.cls ?? 'clickable-icon'].join(' ') });
	setButtonContent(btn, opts.icon, opts.label);
	setTooltip(btn, opts.tooltip, { placement: opts.label ? 'bottom' : 'left' }); // also sets aria-label
	btn.addEventListener('click', (evt) => {
		evt.preventDefault();
		opts.onClick();
	});
	return btn;
}
