import { describe, expect, it } from 'vitest';
import { columnLayout, LAYOUT } from '../src/layout';

const items = (...ids: string[]) => ids.map((id) => ({ id, width: 100, height: 40 }));

describe('columnLayout', () => {
	it('gives each group its own column, alphabetically, with ungrouped notes last', () => {
		const pos = columnLayout([
			{ group: null, items: items('loose') },
			{ group: 'B', items: items('b1') },
			{ group: 'A', items: items('a1', 'a2') },
		]);
		expect(pos.get('a1')).toEqual({ x: 50, y: 20 });
		expect(pos.get('a2')).toEqual({ x: 50, y: 40 + LAYOUT.rowGap + 20 });
		expect(pos.get('b1')!.x).toBe(50 + 100 + LAYOUT.columnGap);
		expect(pos.get('loose')!.x).toBeGreaterThan(pos.get('b1')!.x);
	});

	it('is independent of input order', () => {
		const a = columnLayout([{ group: 'G', items: items('x', 'y', 'z') }]);
		const b = columnLayout([{ group: 'G', items: items('z', 'x', 'y') }]);
		expect([...b].sort()).toEqual([...a].sort());
	});

	it('wraps long blocks into extra columns and never overlaps', () => {
		const ids = Array.from({ length: LAYOUT.maxRows + 3 }, (_, i) => `n${String(i).padStart(2, '0')}`);
		const pos = columnLayout([{ group: null, items: items(...ids) }]);
		const xs = new Set([...pos.values()].map((p) => p.x));
		expect(xs.size).toBe(2);
		const keys = new Set([...pos.values()].map((p) => `${p.x},${p.y}`));
		expect(keys.size).toBe(ids.length);
	});

	it('stacks cards of different heights without overlap', () => {
		const pos = columnLayout([{ group: null, items: [{ id: 'a', width: 100, height: 80 }, { id: 'b', width: 100, height: 30 }] }]);
		expect(pos.get('a')!.y).toBe(40);
		expect(pos.get('b')!.y).toBe(80 + LAYOUT.rowGap + 15);
	});

	it('uses the widest node in a column for spacing', () => {
		const pos = columnLayout([
			{ group: 'A', items: [{ id: 'a', width: 40, height: 40 }, { id: 'b', width: 200, height: 40 }] },
			{ group: 'B', items: [{ id: 'c', width: 40, height: 40 }] },
		]);
		expect(pos.get('a')!.x).toBe(20); // left-aligned in its column
		expect(pos.get('b')!.x).toBe(100);
		expect(pos.get('c')!.x).toBe(200 + LAYOUT.columnGap + 20);
	});
});
