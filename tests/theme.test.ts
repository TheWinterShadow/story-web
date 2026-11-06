import { describe, expect, it } from 'vitest';
import { assignTypeSlots, sanitizeFontStack, TYPE_PALETTE_SIZE } from '../src/theme';

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

describe('sanitizeFontStack', () => {
	// Regression: Cytoscape's font-family parser rejects an invalid stack
	// outright. For a note card (a function-mapped label, unlike a group's
	// plain `data(label)`), that left the card's label unset entirely —
	// blank cards, no text — rather than just losing the custom font. This
	// is the exact `--font-interface` value observed causing it, console-logged
	// by Cytoscape as 'The style property `font-family: ...` is invalid'.
	it('drops literal "??" placeholder entries, keeping every real font name', () => {
		const broken =
			'\'??\', \'??\', \'??\', ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", ' +
			'"Google Sans Flex", Roboto, "Inter Variable", "Inter", "Apple Color Emoji", "Segoe UI Emoji", ' +
			'"Segoe UI Symbol", sans-serif';
		const result = sanitizeFontStack(broken);
		expect(result).not.toContain('??');
		expect(result.split(',').map((s) => s.trim())).toEqual([
			'ui-sans-serif',
			'-apple-system',
			'BlinkMacSystemFont',
			'system-ui',
			'"Segoe UI"',
			'"Google Sans Flex"',
			'Roboto',
			'"Inter Variable"',
			'"Inter"',
			'"Apple Color Emoji"',
			'"Segoe UI Emoji"',
			'"Segoe UI Symbol"',
			'sans-serif',
		]);
	});

	it('passes through an ordinary stack unchanged in content', () => {
		expect(sanitizeFontStack('Arial, sans-serif').split(',').map((s) => s.trim())).toEqual(['Arial', 'sans-serif']);
	});

	it('keeps a vendor-prefixed keyword that starts with a hyphen', () => {
		expect(sanitizeFontStack('-apple-system')).toBe('-apple-system');
	});

	it('keeps a quoted name containing spaces', () => {
		expect(sanitizeFontStack('"Segoe UI"')).toBe('"Segoe UI"');
	});

	it('falls back to a safe stack when nothing survives', () => {
		expect(sanitizeFontStack("'??', '??'")).toContain('sans-serif');
		expect(sanitizeFontStack('')).toContain('sans-serif');
	});

	it('rejects an entry with a stray quote or other unexpected punctuation', () => {
		expect(sanitizeFontStack('Ari"al, sans-serif').split(',').map((s) => s.trim())).toEqual(['sans-serif']);
	});
});
