/**
 * Pure path arithmetic for the folder-as-group model: a note's group is the
 * chain of subfolders between the configured root and the note, nested to
 * any depth (Plots/Act 1/Heist/ → group "Act 1" containing group "Heist").
 *
 * No Obsidian imports, so the path math is unit-testable without a vault;
 * `store.ts` is the only place that turns these into real file operations.
 */

/** '/'-joined group path relative to the root ('' = directly in the root, i.e. ungrouped). Never has a leading/trailing '/'. */
export type GroupPath = string;

/**
 * The group path of a folder at `folderPath`, given the configured root at
 * `rootPath`. '' if the folder *is* the root (or isn't under it at all).
 */
export function relativeGroupPath(folderPath: string, rootPath: string): GroupPath {
	if (folderPath === rootPath) return '';
	const prefix = `${rootPath}/`;
	return folderPath.startsWith(prefix) ? folderPath.slice(prefix.length) : '';
}

/** Absolute vault path for a group path under the configured root. '' → the root folder itself. */
export function absoluteGroupPath(rootPath: string, group: GroupPath): string {
	return group === '' ? rootPath : `${rootPath}/${group}`;
}

/**
 * The parent of an *absolute* vault path (unlike `groupParentPath`, which
 * strips a leaf off a root-relative group path). '' if `path` is already
 * top-level, i.e. has no '/' — never a truncated version of `path` itself.
 */
export function parentFolderPath(path: string): string {
	const i = path.lastIndexOf('/');
	return i === -1 ? '' : path.slice(0, i);
}

/** The name shown on a group's box — just its own segment, not the full path. */
export function groupLabel(group: GroupPath): string {
	const i = group.lastIndexOf('/');
	return i === -1 ? group : group.slice(i + 1);
}

/** The group path one level up. '' for a top-level group (its parent is the root itself, which isn't a group). */
export function groupParentPath(group: GroupPath): GroupPath {
	const i = group.lastIndexOf('/');
	return i === -1 ? '' : group.slice(0, i);
}

/** Nesting depth: 0 for a top-level group, 1 for one level deep, and so on. */
export function groupDepth(group: GroupPath): number {
	return group === '' ? -1 : group.split('/').length - 1;
}

/** Every ancestor group path of `group`, from the top-level group down to (and including) `group` itself. '' → []. */
export function groupAncestry(group: GroupPath): GroupPath[] {
	if (group === '') return [];
	const segments = group.split('/');
	return segments.map((_, i) => segments.slice(0, i + 1).join('/'));
}

/** The group path after renaming only `group`'s own (leaf) segment to `newLeaf`. */
export function renamedGroupPath(group: GroupPath, newLeaf: string): GroupPath {
	const parent = groupParentPath(group);
	return parent === '' ? newLeaf : `${parent}/${newLeaf}`;
}

/** Characters a folder-name segment can't contain — same set note titles avoid (frontmatter.ts), minus '/' itself since that's the deliberate group-path separator here. */
const ILLEGAL_SEGMENT = /[\\:*?"<>|#^[\]]/g;

/**
 * Cleans free-typed text (the "move to group" prompt, capture's group field)
 * into a well-formed group path: trims each '/'-separated segment, strips
 * illegal characters, and drops empty or `.`/`..` segments. '' if nothing
 * usable remains, i.e. ungrouped.
 */
export function sanitizeGroupPath(raw: string): GroupPath {
	return raw
		.split('/')
		.map((segment) => segment.replace(ILLEGAL_SEGMENT, ' ').replace(/\s+/g, ' ').trim())
		.filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
		.join('/');
}

/**
 * Ordinal (never locale-dependent — see docs/DECISIONS.md) comparison that
 * sorts a group path before any of its own descendants, and '' (ungrouped)
 * last. Sorting a list of group paths with this yields tree pre-order, so
 * laying out columns in this order clusters nested groups together without
 * any extra tree-walking.
 */
export function compareGroupPaths(a: GroupPath, b: GroupPath): number {
	if (a === b) return 0;
	if (a === '') return 1;
	if (b === '') return -1;
	const as = a.split('/');
	const bs = b.split('/');
	const len = Math.min(as.length, bs.length);
	for (let i = 0; i < len; i++) {
		const sa = as[i] ?? '';
		const sb = bs[i] ?? '';
		if (sa !== sb) return sa < sb ? -1 : 1;
	}
	return as.length - bs.length;
}
