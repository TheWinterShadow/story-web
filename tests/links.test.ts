import { describe, expect, it } from 'vitest';
import { parseLinkList, toLinkpath } from '../src/links';

describe('toLinkpath', () => {
	it.each([
		['[[Note]]', 'Note'],
		['[[Note|Alias]]', 'Note'],
		['[[Note#Heading]]', 'Note'],
		['[[Note#^block|Alias]]', 'Note'],
		['[[folder/Note.md]]', 'folder/Note.md'],
		['  Note  ', 'Note'],
		['![[Embed]]', 'Embed'],
	])('%s → %s', (input, expected) => {
		expect(toLinkpath(input)).toBe(expected);
	});

	it.each([[''], ['[[]]'], ['[[#Heading]]'], [42], [null], [undefined]])('rejects %j', (input) => {
		expect(toLinkpath(input)).toBeNull();
	});
});

describe('parseLinkList', () => {
	it('handles a list of quoted wikilinks', () => {
		expect(parseLinkList(['[[A]]', '[[B|b]]'])).toEqual(['A', 'B']);
	});

	it('handles a single string', () => {
		expect(parseLinkList('[[A]]')).toEqual(['A']);
	});

	it('handles unquoted YAML wikilinks, which parse as nested arrays', () => {
		// `connects_to:\n  - [[A]]` → [["A"]]
		expect(parseLinkList([['A'], ['B']])).toEqual(['A', 'B']);
	});

	it('ignores junk entries', () => {
		expect(parseLinkList(['[[A]]', 7, null, '', ['x', 'y']])).toEqual(['A']);
	});

	it('returns [] for missing values', () => {
		expect(parseLinkList(undefined)).toEqual([]);
		expect(parseLinkList(null)).toEqual([]);
	});
});
