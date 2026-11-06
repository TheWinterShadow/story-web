import { describe, expect, it } from 'vitest';
import { boxAtPoint, type Box } from '../src/hittest';

const box = (id: string, depth: number, x1: number, y1: number, x2: number, y2: number): Box => ({ id, depth, x1, y1, x2, y2 });

describe('boxAtPoint', () => {
	it('returns null when nothing contains the point', () => {
		expect(boxAtPoint([box('a', 0, 0, 0, 10, 10)], 50, 50)).toBeNull();
	});

	it('finds the containing box', () => {
		expect(boxAtPoint([box('a', 0, 0, 0, 10, 10)], 5, 5)).toBe('a');
	});

	it('treats the box edges as inclusive', () => {
		const b = box('a', 0, 0, 0, 10, 10);
		expect(boxAtPoint([b], 0, 0)).toBe('a');
		expect(boxAtPoint([b], 10, 10)).toBe('a');
	});

	it('prefers the deepest match — a nested box inside its parent wins', () => {
		const outer = box('parent', 0, 0, 0, 100, 100);
		const inner = box('child', 1, 20, 20, 50, 50);
		expect(boxAtPoint([outer, inner], 30, 30)).toBe('child'); // inside both
		expect(boxAtPoint([outer, inner], 80, 80)).toBe('parent'); // inside only the outer
	});

	it('works regardless of array order', () => {
		const outer = box('parent', 0, 0, 0, 100, 100);
		const inner = box('child', 1, 20, 20, 50, 50);
		expect(boxAtPoint([inner, outer], 30, 30)).toBe('child');
	});

	it('breaks an equal-depth tie by the smaller box (deterministic, not iteration order)', () => {
		const big = box('big', 0, 0, 0, 100, 100);
		const small = box('small', 0, 10, 10, 30, 30);
		expect(boxAtPoint([big, small], 20, 20)).toBe('small');
		expect(boxAtPoint([small, big], 20, 20)).toBe('small');
	});

	it('breaks an equal-depth, equal-area tie by the smaller id, both orders agree', () => {
		const a = box('a', 0, 0, 0, 10, 10);
		const b = box('b', 0, 0, 0, 10, 10);
		expect(boxAtPoint([a, b], 5, 5)).toBe('a');
		expect(boxAtPoint([b, a], 5, 5)).toBe('a');
	});

	it('handles an empty box list', () => {
		expect(boxAtPoint([], 0, 0)).toBeNull();
	});

	// Regression: a compound group left with no children (its only note mid-drag,
	// temporarily detached) can have a non-finite bounding box. NaN/Infinity
	// comparisons are always false, so a naive `x < x1 || x > x2` guard would
	// never exclude it, making the degenerate box match every point in the graph.
	it('ignores a degenerate (non-finite) box instead of matching everything', () => {
		const good = box('good', 0, 0, 0, 10, 10);
		const degenerate: Box = { id: 'bad', depth: 5, x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
		expect(boxAtPoint([degenerate], 1000, -1000)).toBeNull();
		expect(boxAtPoint([degenerate, good], 5, 5)).toBe('good');
		expect(boxAtPoint([degenerate, good], 500, 500)).toBeNull();
	});
});
