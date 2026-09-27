/**
 * The only module that reads or writes the vault. Note content/position/links
 * go through `processFrontMatter`, so note bodies are never touched. Groups
 * are real folders, so group operations are real file moves and renames —
 * see docs/DECISIONS.md for why.
 */
import { App, normalizePath, stringifyYaml, TFile, TFolder, Vault } from 'obsidian';
import { addConnection, newNoteFrontmatter, removeConnection, sanitizeTitle, setPosition, type LinkResolver } from './frontmatter';
import {
	absoluteGroupPath,
	compareGroupPaths,
	groupParentPath,
	parentFolderPath,
	relativeGroupPath,
	renamedGroupPath,
	type GroupPath,
} from './folders';
import { parseLinkList } from './links';
import { FM, type NoteInfo, type Position } from './model';

/** How long a just-written position overrides what the metadata cache says (covers the write → re-index gap). */
const RECENT_WRITE_MS = 3000;
const POSITION_FLUSH_MS = 400;

export class NoteStore {
	private pendingPositions = new Map<string, Position>();
	private recentPositions = new Map<string, { pos: Position; until: number }>();
	private flushTimer: number | null = null;

	constructor(
		private readonly app: App,
		private readonly getFolder: () => string,
	) {}

	get folder(): string {
		return this.getFolder();
	}

	isInScope(path: string): boolean {
		return path.endsWith('.md') && path.startsWith(`${this.folder}/`);
	}

	files(): TFile[] {
		const root = this.app.vault.getAbstractFileByPath(this.folder);
		if (!(root instanceof TFolder)) return [];
		const out: TFile[] = [];
		Vault.recurseChildren(root, (f) => {
			if (f instanceof TFile && f.extension === 'md') out.push(f);
		});
		return out;
	}

	fileAt(path: string): TFile | null {
		const f = this.app.vault.getAbstractFileByPath(path);
		return f instanceof TFile ? f : null;
	}

	private resolver(sourcePath: string): LinkResolver {
		return (linkpath) => this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)?.path ?? null;
	}

	collect(): NoteInfo[] {
		const { metadataCache } = this.app;
		const out: NoteInfo[] = [];
		for (const file of this.files()) {
			// No cache = not indexed yet (e.g. right after startup or a sync).
			// Skip it rather than treat it as "no position", which would re-layout
			// the note and overwrite its stored x/y. It appears on the next
			// `changed` event once indexed.
			const cache = metadataCache.getFileCache(file);
			if (!cache) continue;
			const resolve = this.resolver(file.path);
			const resolveAll = (linkpaths: string[]): string[] =>
				linkpaths.map(resolve).filter((p): p is string => p !== null);

			const frontmatter = cache.frontmatter ? { ...cache.frontmatter } : undefined;
			const recent = this.localPosition(file.path);
			if (recent && frontmatter) setPosition(frontmatter, recent);

			out.push({
				path: file.path,
				basename: file.basename,
				frontmatter: recent && !frontmatter ? { [FM.x]: recent.x, [FM.y]: recent.y } : frontmatter,
				bodyLinks: resolveAll((cache.links ?? []).map((l) => l.link.split('#')[0] ?? '').filter(Boolean)),
				manualLinks: resolveAll(parseLinkList(cache.frontmatter?.[FM.connects])),
				group: relativeGroupPath(file.parent?.path ?? this.folder, this.folder),
			});
		}
		return out;
	}

	/** A position we've written (or are about to) that the metadata cache may not reflect yet. */
	private localPosition(path: string): Position | null {
		const pending = this.pendingPositions.get(path);
		if (pending) return pending;
		const recent = this.recentPositions.get(path);
		if (!recent) return null;
		if (Date.now() > recent.until) {
			this.recentPositions.delete(path);
			return null;
		}
		return recent.pos;
	}

	// ---- writes ------------------------------------------------------------

	/** Queue a position write. Rapid drags of the same node collapse into one write. */
	queuePosition(path: string, pos: Position): void {
		this.pendingPositions.set(path, { x: Math.round(pos.x), y: Math.round(pos.y) });
		if (this.flushTimer !== null) window.clearTimeout(this.flushTimer);
		this.flushTimer = window.setTimeout(() => void this.flushPositions(), POSITION_FLUSH_MS);
	}

	async flushPositions(): Promise<void> {
		if (this.flushTimer !== null) window.clearTimeout(this.flushTimer);
		this.flushTimer = null;
		const batch = [...this.pendingPositions];
		this.pendingPositions.clear();
		await Promise.all(
			batch.map(async ([path, pos]) => {
				this.recentPositions.set(path, { pos, until: Date.now() + RECENT_WRITE_MS });
				const file = this.fileAt(path);
				if (!file) return;
				try {
					await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => setPosition(fm, pos));
				} catch (err) {
					console.error(`[story-web] failed to save position for ${path}`, err);
				}
			}),
		);
	}

	/** Returns false if the connection already existed. */
	async connect(sourcePath: string, targetPath: string): Promise<boolean> {
		const source = this.fileAt(sourcePath);
		const target = this.fileAt(targetPath);
		if (!source || !target) throw new Error('Note no longer exists');
		const linktext = this.app.metadataCache.fileToLinktext(target, source.path, true);
		let added = false;
		await this.app.fileManager.processFrontMatter(source, (fm: Record<string, unknown>) => {
			added = addConnection(fm, linktext, target.path, this.resolver(source.path));
		});
		return added;
	}

	/** Returns the number of `connects_to` entries removed. */
	async disconnect(sourcePath: string, targetPath: string): Promise<number> {
		const source = this.fileAt(sourcePath);
		if (!source) throw new Error('Note no longer exists');
		let removed = 0;
		await this.app.fileManager.processFrontMatter(source, (fm: Record<string, unknown>) => {
			removed = removeConnection(fm, targetPath, this.resolver(source.path));
		});
		return removed;
	}

	// ---- groups (real folders) ----------------------------------------------

	/** Every existing group (subfolder, any depth) under the configured folder, deepest-safe, sorted for suggestion lists. */
	existingGroups(): GroupPath[] {
		const root = this.app.vault.getAbstractFileByPath(this.folder);
		if (!(root instanceof TFolder)) return [];
		const out: GroupPath[] = [];
		Vault.recurseChildren(root, (f) => {
			if (f instanceof TFolder && f.path !== this.folder) out.push(relativeGroupPath(f.path, this.folder));
		});
		return out.sort(compareGroupPaths);
	}

	/** Moves a note's file into the folder for `group` ('' = the root folder itself), creating it if needed. A no-op if it's already there. */
	async moveNoteToGroup(notePath: string, group: GroupPath): Promise<TFile> {
		const file = this.fileAt(notePath);
		if (!file) throw new Error('Note no longer exists');
		const targetFolder = absoluteGroupPath(this.folder, group);
		let path = normalizePath(`${targetFolder}/${file.name}`);
		if (path === file.path) return file;
		await this.ensureFolder(targetFolder);
		for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) {
			path = normalizePath(`${targetFolder}/${file.basename} ${n}.md`);
		}
		await this.app.vault.rename(file, path);
		return file;
	}

	/** Renames just a group's own (leaf) folder segment — Plots/Act 1/Heist → Plots/Act 1/Chase for renameGroup("Act 1/Heist", "Chase"). Returns the new group path. */
	async renameGroup(group: GroupPath, newLeaf: string): Promise<GroupPath> {
		const leaf = sanitizeTitle(newLeaf);
		if (leaf === '') throw new Error('Group name has no usable characters');
		const folder = this.app.vault.getAbstractFileByPath(absoluteGroupPath(this.folder, group));
		if (!(folder instanceof TFolder)) throw new Error('Group no longer exists');
		const next = renamedGroupPath(group, leaf);
		const nextAbsolute = absoluteGroupPath(this.folder, next);
		if (nextAbsolute === folder.path) return group;
		if (this.app.vault.getAbstractFileByPath(nextAbsolute)) throw new Error(`"${next}" already exists`);
		await this.app.vault.rename(folder, nextAbsolute);
		return next;
	}

	/**
	 * Dissolves one grouping level: every direct child of the group's folder —
	 * both notes and subfolders (which keep their own nested structure) — moves
	 * up into the group's parent folder, then the now-empty folder is trashed.
	 */
	async ungroupFolder(group: GroupPath): Promise<void> {
		const folder = this.app.vault.getAbstractFileByPath(absoluteGroupPath(this.folder, group));
		if (!(folder instanceof TFolder)) throw new Error('Group no longer exists');
		const parentFolder = absoluteGroupPath(this.folder, groupParentPath(group));
		// Snapshot first: each rename below changes the live vault, but must not change which children we process.
		for (const child of [...folder.children]) {
			const ext = child instanceof TFile ? '.md' : '';
			const base = child instanceof TFile ? child.basename : child.name;
			let target = normalizePath(`${parentFolder}/${base}${ext}`);
			for (let n = 2; this.app.vault.getAbstractFileByPath(target); n++) {
				target = normalizePath(`${parentFolder}/${base} ${n}${ext}`);
			}
			await this.app.vault.rename(child, target);
		}
		await this.app.fileManager.trashFile(folder);
	}

	// ---- capture -------------------------------------------------------------

	async capture(title: string, blurb: string, type: string | null, group: GroupPath): Promise<TFile> {
		const base = sanitizeTitle(title);
		if (base === '') throw new Error('Title has no usable characters');
		const targetFolder = absoluteGroupPath(this.folder, group);
		await this.ensureFolder(targetFolder);

		let path = normalizePath(`${targetFolder}/${base}.md`);
		for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) {
			path = normalizePath(`${targetFolder}/${base} ${n}.md`);
		}

		const fm = newNoteFrontmatter(blurb, type);
		const content = Object.keys(fm).length > 0 ? `---\n${stringifyYaml(fm)}---\n\n` : '';
		return this.app.vault.create(path, content);
	}

	/** Creates every folder in `path` that doesn't exist yet (mkdir -p). */
	private async ensureFolder(path: string): Promise<void> {
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFolder) return;
		if (existing) throw new Error(`"${path}" exists but is not a folder`);
		const parent = parentFolderPath(path);
		if (parent !== '') await this.ensureFolder(parent);
		if (this.app.vault.getAbstractFileByPath(path) instanceof TFolder) return; // created by the recursive call above
		await this.app.vault.createFolder(path);
	}
}
