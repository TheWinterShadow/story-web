/**
 * Initial layout for notes that have never been positioned.
 *
 * Deliberately simple and deterministic instead of force-directed: this is a
 * manual-arrangement tool, so the first layout is only a starting point. It
 * must never overlap nodes, and it must give the same result on every device
 * (so two devices opening the graph for the first time don't write
 * conflicting positions). Cytoscape's built-in `cose` does neither reliably
 * with compound (group) nodes.
 */
import type { Position } from './model';

export interface LayoutItem {
	id: string;
	width: number;
	height: number;
}

export interface LayoutBlock {
	/** Group name, or null for ungrouped notes. */
	group: string | null;
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
 * One column per group (alphabetical), ungrouped notes last. Long blocks wrap
 * into extra columns. Positions are node centres; columns start at x = 0, y = 0
 * (top-left corner of the first card).
 */
export function columnLayout(blocks: LayoutBlock[]): Map<string, Position> {
	const out = new Map<string, Position>();
	const ordered = [...blocks]
		.filter((b) => b.items.length > 0)
		.sort((a, b) => (a.group === null ? 1 : b.group === null ? -1 : a.group.localeCompare(b.group)));

	let x = 0;
	for (const block of ordered) {
		// Sort so the result doesn't depend on the order the vault lists files in.
		const items = [...block.items].sort((a, b) => a.id.localeCompare(b.id));
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
