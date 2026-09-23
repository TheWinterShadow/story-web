/**
 * Pure graph model: turns per-note facts into nodes, edges and groups.
 *
 * The Obsidian-facing layer (see `source.ts`) resolves links and reads
 * frontmatter; everything here is plain data so it can be unit tested.
 */

export const FM = {
	blurb: 'blurb',
	type: 'type',
	group: 'group',
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
}

export interface GraphNode {
	id: string;
	path: string;
	label: string;
	type: string | null;
	group: string | null;
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

export interface GraphModel {
	nodes: GraphNode[];
	edges: GraphEdge[];
	groups: string[];
	/** Every distinct `type` value in the full note set (ignores the filter) — drives the filter dropdown. */
	types: string[];
	/** True if any note has no `type` (lets the UI offer an "Untyped" filter). */
	hasUntyped: boolean;
}

/** `null` = show everything; `''` = only untyped notes; otherwise an exact `type` value. */
export type TypeFilter = string | null;

export const nodeId = (path: string): string => `n:${path}`;
export const groupId = (name: string): string => `g:${name}`;
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
			group: readString(fm, FM.group),
			position: readPosition(fm),
		});
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

	const groups = [...new Set(nodes.map((n) => n.group).filter((g): g is string => g !== null))].sort();

	return {
		nodes,
		edges: [...edges.values()],
		groups,
		types: [...types].sort(),
		hasUntyped,
	};
}
