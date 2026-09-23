import { describe, expect, it } from 'vitest';
import { wrapLabel } from '../src/wrap';

// Monospace fake: every character is 10px wide.
const measure = (s: string): number => s.length * 10;

describe('wrapLabel', () => {
	it('keeps short text on one line', () => {
		expect(wrapLabel('The heist', 100, 3, measure)).toEqual({ lines: ['The heist'], width: 90 });
	});

	it('wraps at word boundaries', () => {
		expect(wrapLabel('aaa bbb ccc ddd', 70, 3, measure).lines).toEqual(['aaa bbb', 'ccc ddd']);
	});

	it('caps the line count and ends with an ellipsis that still fits', () => {
		const { lines } = wrapLabel('aaa bbb ccc ddd eee fff', 70, 2, measure);
		expect(lines).toEqual(['aaa bbb', 'ccc dd…']);
		expect(lines.every((l) => measure(l) <= 70)).toBe(true);
	});

	it('maxLines 1 behaves like a one-line ellipsis', () => {
		expect(wrapLabel('aaa bbb ccc', 70, 1, measure).lines).toEqual(['aaa bb…']);
	});

	it('honours explicit newlines', () => {
		expect(wrapLabel('one\ntwo', 200, 3, measure).lines).toEqual(['one', 'two']);
	});

	it('marks truncation when later paragraphs are cut', () => {
		expect(wrapLabel('one\ntwo\nthree', 200, 2, measure).lines).toEqual(['one', 'two…']);
	});

	it('does not add an ellipsis when the text fits exactly', () => {
		expect(wrapLabel('one\ntwo\n\n', 200, 2, measure).lines).toEqual(['one', 'two']);
	});

	it('hard-breaks words wider than a line', () => {
		expect(wrapLabel('abcdefghij', 40, 5, measure).lines).toEqual(['abcd', 'efgh', 'ij']);
	});

	it('reports the widest line', () => {
		expect(wrapLabel('aaaaa bb', 50, 3, measure).width).toBe(50);
	});

	it('handles empty text', () => {
		expect(wrapLabel('   ', 50, 3, measure)).toEqual({ lines: [''], width: 0 });
	});
});
