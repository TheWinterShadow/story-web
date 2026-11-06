/**
 * Pure point-in-box geometry for drag-to-regroup: which group's box (if any)
 * contains a dropped point. The live bounding boxes come from Cytoscape
 * (view.ts); this is just the arithmetic, so it's unit-testable without one.
 */
export interface Box {
	id: string;
	/** Nesting depth (0 = top-level) — ties the match to the most specific (deepest) box, since a nested group's box always sits inside its parent's. */
	depth: number;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

/**
 * The id of the box containing (x, y). Among boxes that match, the deepest
 * wins (so dropping inside a nested group's box targets that group, not its
 * parent); among equally deep matches (sibling boxes dragged into overlap),
 * the smallest-area one wins, then the lexicographically smallest id — fully
 * deterministic, never dependent on iteration order. null if nothing matches.
 */
export function boxAtPoint(boxes: Box[], x: number, y: number): string | null {
	let best: Box | null = null;
	let bestArea = Infinity;
	for (const b of boxes) {
		// A degenerate box (e.g. a compound group left with no children, mid-drag,
		// by the caller) has non-finite bounds. NaN/Infinity comparisons are all
		// false, so without this guard such a box would match every point.
		if (!Number.isFinite(b.x1) || !Number.isFinite(b.y1) || !Number.isFinite(b.x2) || !Number.isFinite(b.y2)) continue;
		if (x < b.x1 || x > b.x2 || y < b.y1 || y > b.y2) continue;
		const area = (b.x2 - b.x1) * (b.y2 - b.y1);
		const better =
			!best ||
			b.depth > best.depth ||
			(b.depth === best.depth && (area < bestArea || (area === bestArea && b.id < best.id)));
		if (better) {
			best = b;
			bestArea = area;
		}
	}
	return best ? best.id : null;
}
