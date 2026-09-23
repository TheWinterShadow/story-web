/**
 * The only module that reads or writes the vault. Everything it writes goes
 * through `processFrontMatter`, so note bodies are never touched.
 */
import { App, normalizePath, stringifyYaml, TFile, TFolder, Vault } from 'obsidian';
import {
	addConnection,
	newNoteFrontmatter,
	removeConnection,
	sanitizeTitle,
	setGroup,
	setPosition,
	type LinkResolver,
} from './frontmatter';
import { parseLinkList } from './links';
import { FM, readString, type NoteInfo, type Position } from './model';

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

	async setGroup(paths: string[], group: string | null): Promise<void> {
		await Promise.all(
			paths.map(async (path) => {
				const file = this.fileAt(path);
				if (file) await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => setGroup(fm, group));
			}),
		);
	}

	/** Rewrites `group` on every in-scope note currently in `from`, including notes hidden by the type filter. */
	async renameGroup(from: string, to: string): Promise<number> {
		const members = this.files().filter(
			(f) => readString(this.app.metadataCache.getFileCache(f)?.frontmatter, FM.group) === from,
		);
		await this.setGroup(
			members.map((f) => f.path),
			to,
		);
		return members.length;
	}

	existingGroups(): string[] {
		const names = new Set<string>();
		for (const f of this.files()) {
			const g = readString(this.app.metadataCache.getFileCache(f)?.frontmatter, FM.group);
			if (g) names.add(g);
		}
		return [...names].sort();
	}

	async capture(title: string, blurb: string, type: string | null): Promise<TFile> {
		const base = sanitizeTitle(title);
		if (base === '') throw new Error('Title has no usable characters');
		await this.ensureFolder(this.folder);

		let path = normalizePath(`${this.folder}/${base}.md`);
		for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) {
			path = normalizePath(`${this.folder}/${base} ${n}.md`);
		}

		const fm = newNoteFrontmatter(blurb, type);
		const content = Object.keys(fm).length > 0 ? `---\n${stringifyYaml(fm)}---\n\n` : '';
		return this.app.vault.create(path, content);
	}

	private async ensureFolder(path: string): Promise<void> {
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFolder) return;
		if (existing) throw new Error(`"${path}" exists but is not a folder`);
		await this.app.vault.createFolder(path);
	}
}
