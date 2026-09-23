import { describe, expect, it } from 'vitest';
import { assignTypeSlots, TYPE_PALETTE_SIZE } from '../src/theme';

describe('assignTypeSlots', () => {
	it('gives distinct slots while there are fewer types than colours', () => {
		// 'fiction' and 'campaign' hash to the same slot; probing must separate them.
		const slots = assignTypeSlots(['fiction', 'dnd', 'campaign', 'worldbuilding'], TYPE_PALETTE_SIZE);
		expect(new Set(slots.values()).size).toBe(4);
	});

	it('does not depend on input order', () => {
		const a = assignTypeSlots(['fiction', 'dnd', 'campaign'], 8);
		const b = assignTypeSlots(['campaign', 'fiction', 'dnd'], 8);
		expect([...a].sort()).toEqual([...b].sort());
	});

	it('keeps a type on its slot when an unrelated type appears', () => {
		const before = assignTypeSlots(['fiction', 'dnd'], 8);
		const after = assignTypeSlots(['fiction', 'dnd', 'worldbuilding'], 8);
		expect(after.get('fiction')).toBe(before.get('fiction'));
		expect(after.get('dnd')).toBe(before.get('dnd'));
	});

	it('stays in range when types outnumber colours', () => {
		const types = Array.from({ length: 12 }, (_, i) => `t${i}`);
		for (const slot of assignTypeSlots(types, 8).values()) {
			expect(slot).toBeGreaterThanOrEqual(0);
			expect(slot).toBeLessThan(8);
		}
	});
});
