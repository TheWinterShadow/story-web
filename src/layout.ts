/**
 * Initial layout for notes that have never been positioned.
 *
 * Deliberately simple and deterministic instead of force-directed: this is a
 * manual-arrangement tool, so the first layout is only a starting point. It
 * must never overlap nodes, and it must give the same result on every device
 * (so two devices opening the graph for the first time don't write
 * conflicting positions). Cytoscape's built-in `cose` does neither reliably
 * with compound (group) nodes.
 *
 * Nested groups (folder inside folder) aren't laid out as boxes-within-boxes
 * here — Cytoscape's compound nodes auto-size around their children, so
 * positioning only the leaf note cards is enough. What this does provide is
 * *locality*: blocks are ordered by `compareGroupPaths`, which is exactly
 * tree pre-order, so a folder's notes and its subfolders' notes always end
 * up in adjacent columns.
 */
import { compareGroupPaths, type GroupPath } from './folders';
import type { Position } from './model';

export interface LayoutItem {
	id: string;
	width: number;
	height: number;
}

export interface LayoutBlock {
	/** The full group path this block's notes sit directly inside ('' = ungrouped/root-level). */
	groupPath: GroupPath;
	items: LayoutItem[];
}

export const LAYOUT = {
	/** Vertical space between stacked cards. */
	rowGap: 28,
	columnGap: 80,
	/** Wrap a block into another column after this many rows. */
	maxRows: 12,
} as const;

/**
 * One column per block (folder pre-order, ungrouped last — see module docs).
 * Long blocks wrap into extra columns. Positions are node centres; columns
 * start at x = 0, y = 0 (top-left corner of the first card).
 */
export function columnLayout(blocks: LayoutBlock[]): Map<string, Position> {
	const out = new Map<string, Position>();
	const ordered = [...blocks].filter((b) => b.items.length > 0).sort((a, b) => compareGroupPaths(a.groupPath, b.groupPath));

	let x = 0;
	for (const block of ordered) {
		// Sort so the result doesn't depend on the order the vault lists files in.
		const items = [...block.items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
		for (let start = 0; start < items.length; start += LAYOUT.maxRows) {
			const column = items.slice(start, start + LAYOUT.maxRows);
			const width = Math.max(...column.map((i) => i.width));
			let y = 0;
			for (const item of column) {
				out.set(item.id, { x: x + item.width / 2, y: y + item.height / 2 }); // left-aligned
				y += item.height + LAYOUT.rowGap;
			}
			x += width + LAYOUT.columnGap;
		}
	}
	return out;
}
