/**
 * Pure graph model: turns per-note facts into nodes, edges and groups.
 *
 * The Obsidian-facing layer (see `store.ts`) resolves links, reads
 * frontmatter and computes each note's folder; everything here is plain
 * data so it can be unit tested.
 */
import { compareGroupPaths, groupAncestry, groupDepth, groupLabel, groupParentPath, type GroupPath } from './folders';

export const FM = {
	blurb: 'blurb',
	type: 'type',
	connects: 'connects_to',
	x: 'x',
	y: 'y',
} as const;

export interface Position {
	x: number;
	y: number;
}

/** Everything the model needs to know about one note. Link targets are already resolved to vault paths. */
export interface NoteInfo {
	path: string;
	basename: string;
	frontmatter: Record<string, unknown> | undefined;
	/** Resolved paths from `[[wikilinks]]` in the note body. */
	bodyLinks: string[];
	/** Resolved paths from the `connects_to` frontmatter list. */
	manualLinks: string[];
	/** The note's group: its containing folder's path relative to the configured root. '' = directly in the root (ungrouped). */
	group: GroupPath;
}

export interface GraphNode {
	id: string;
	path: string;
	label: string;
	type: string | null;
	/** '' means ungrouped — never appears as a Cytoscape parent. */
	group: GroupPath;
	position: Position | null;
}

export interface GraphEdge {
	id: string;
	source: string;
	target: string;
	/** Present in the source note's `connects_to` — the plugin can remove it. */
	manual: boolean;
	/** Present as a `[[wikilink]]` in the source note's body — read-only for the plugin. */
	linked: boolean;
}

/** One folder-derived group, i.e. one compound box on the graph. Nested arbitrarily deep via `parentId`. */
export interface GroupNode {
	id: string;
	/** Its own path relative to the root, e.g. "Act 1/Heist". */
	path: GroupPath;
	/** Just its own segment ("Heist"), shown as the box label. */
	label: string;
	/** The enclosing group's id, or null for a top-level group. */
	parentId: string | null;
	/** 0 = top-level. */
	depth: number;
}

export interface GraphModel {
	nodes: GraphNode[];
	edges: GraphEdge[];
	/** Every group with at least one visible note somewhere in its subtree. Ordered parent-before-child, safe to insert in this order. */
	groups: GroupNode[];
	/** Every distinct `type` value in the full note set (ignores the filter) — drives the filter dropdown. */
	types: string[];
	/** True if any note has no `type` (lets the UI offer an "Untyped" filter). */
	hasUntyped: boolean;
}

/** `null` = show everything; `''` = only untyped notes; otherwise an exact `type` value. */
export type TypeFilter = string | null;

export const nodeId = (path: string): string => `n:${path}`;
export const groupId = (group: GroupPath): string => `g:${group}`;
export const edgeId = (source: string, target: string): string => `e:${source}->${target}`;

export function readString(fm: Record<string, unknown> | undefined, key: string): string | null {
	const value = fm?.[key];
	if (typeof value === 'number') return String(value);
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'string' && value.trim() !== '') {
		const n = Number(value);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

export function readPosition(fm: Record<string, unknown> | undefined): Position | null {
	const x = readNumber(fm?.[FM.x]);
	const y = readNumber(fm?.[FM.y]);
	return x === null || y === null ? null : { x, y };
}

export function buildGraph(notes: NoteInfo[], filter: TypeFilter = null): GraphModel {
	const types = new Set<string>();
	let hasUntyped = false;
	const nodes: GraphNode[] = [];
	const neededGroups = new Set<GroupPath>();

	for (const note of notes) {
		const fm = note.frontmatter;
		const type = readString(fm, FM.type);
		if (type === null) hasUntyped = true;
		else types.add(type);

		if (filter !== null && (type ?? '') !== filter) continue;

		nodes.push({
			id: nodeId(note.path),
			path: note.path,
			label: readString(fm, FM.blurb) ?? note.basename,
			type,
			group: note.group,
			position: readPosition(fm),
		});
		// Every ancestor of a visible note's group is itself needed, as a
		// container, even if no note sits directly inside it.
		for (const ancestor of groupAncestry(note.group)) neededGroups.add(ancestor);
	}

	const visible = new Set(nodes.map((n) => n.path));
	const edges = new Map<string, GraphEdge>();
	const addEdge = (source: string, target: string, kind: 'manual' | 'linked'): void => {
		if (source === target || !visible.has(target)) return;
		const id = edgeId(source, target);
		const edge = edges.get(id) ?? { id, source: nodeId(source), target: nodeId(target), manual: false, linked: false };
		edge[kind] = true;
		edges.set(id, edge);
	};

	for (const note of notes) {
		if (!visible.has(note.path)) continue;
		for (const target of note.manualLinks) addEdge(note.path, target, 'manual');
		for (const target of note.bodyLinks) addEdge(note.path, target, 'linked');
	}

	// Sorted (depth, path) so every parent is listed before its children —
	// callers can insert groups in this order without a second pass.
	const groups: GroupNode[] = [...neededGroups]
		.sort((a, b) => groupDepth(a) - groupDepth(b) || compareGroupPaths(a, b))
		.map((path) => {
			const parent = groupParentPath(path);
			return { id: groupId(path), path, label: groupLabel(path), parentId: parent === '' ? null : groupId(parent), depth: groupDepth(path) };
		});

	return {
		nodes,
		edges: [...edges.values()],
		groups,
		types: [...types].sort(),
		hasUntyped,
	};
}
