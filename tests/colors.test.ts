import { describe, expect, it } from 'vitest';
import { COLOR_NAMES, isColorName } from '../src/colors';

describe('isColorName', () => {
	it('accepts every name in COLOR_NAMES', () => {
		for (const name of COLOR_NAMES) expect(isColorName(name)).toBe(true);
	});

	it('rejects anything else, including a near-miss or different casing', () => {
		for (const bad of ['Blue', 'BLUE', 'teal', '', 'blue ', ' blue']) expect(isColorName(bad)).toBe(false);
	});

	it('has eight distinct names (matches the eight Obsidian theme colours)', () => {
		expect(new Set(COLOR_NAMES).size).toBe(8);
	});
});
