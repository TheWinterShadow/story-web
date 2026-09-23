/**
 * Frontmatter mutations, written as pure functions over the object that
 * `app.fileManager.processFrontMatter()` hands to its callback.
 *
 * Keeping them free of Obsidian imports makes the write-side logic testable
 * and guarantees the plugin never touches anything but these keys.
 */
import { parseLinkList, toWikilink } from './links';
import { FM, type Position } from './model';

type Frontmatter = Record<string, unknown>;

/** Resolves a linkpath (relative to the note being edited) to a vault path, or null if unresolved. */
export type LinkResolver = (linkpath: string) => string | null;

export function setPosition(fm: Frontmatter, pos: Position): void {
	fm[FM.x] = Math.round(pos.x);
	fm[FM.y] = Math.round(pos.y);
}

/** Returns the current `connects_to` entries as a flat list of raw values. */
function currentConnections(fm: Frontmatter): unknown[] {
	const raw = fm[FM.connects];
	if (raw === undefined || raw === null) return [];
	return Array.isArray(raw) ? raw : [raw];
}

/**
 * Append `[[linktext]]` to `connects_to` unless an existing entry already
 * resolves to `targetPath`. Returns true if the list changed.
 */
export function addConnection(fm: Frontmatter, linktext: string, targetPath: string, resolve: LinkResolver): boolean {
	const entries = currentConnections(fm);
	const exists = entries.some((entry) => parseLinkList([entry]).some((lp) => resolve(lp) === targetPath));
	if (exists) return false;
	fm[FM.connects] = [...entries, toWikilink(linktext)];
	return true;
}

/**
 * Remove every `connects_to` entry that resolves to `targetPath`. Deletes the
 * key entirely when the list becomes empty. Returns the number of entries removed.
 */
export function removeConnection(fm: Frontmatter, targetPath: string, resolve: LinkResolver): number {
	const entries = currentConnections(fm);
	const kept = entries.filter((entry) => !parseLinkList([entry]).some((lp) => resolve(lp) === targetPath));
	const removed = entries.length - kept.length;
	if (removed === 0) return 0;
	if (kept.length === 0) delete fm[FM.connects];
	else fm[FM.connects] = kept;
	return removed;
}

/** Set or clear (`null` / blank) the `group` key. */
export function setGroup(fm: Frontmatter, group: string | null): void {
	const name = group?.trim() ?? '';
	if (name === '') delete fm[FM.group];
	else fm[FM.group] = name;
}

/** Build the frontmatter object for a freshly captured note. Omits empty optional fields. */
export function newNoteFrontmatter(blurb: string, type: string | null): Frontmatter {
	const fm: Frontmatter = {};
	if (blurb.trim() !== '') fm[FM.blurb] = blurb.trim();
	if (type && type.trim() !== '') fm[FM.type] = type.trim();
	return fm;
}

/** Characters Obsidian (or common sync targets like iCloud/Windows) reject or misinterpret in filenames. */
const ILLEGAL_FILENAME = /[\\/:*?"<>|#^[\]]/g;

/** Turn a free-text title into a safe note basename. Returns '' if nothing usable is left. */
export function sanitizeTitle(title: string): string {
	return title
		.replace(ILLEGAL_FILENAME, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+/, '');
}
