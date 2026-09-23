import { describe, expect, it } from 'vitest';
import {
	addConnection,
	newNoteFrontmatter,
	removeConnection,
	sanitizeTitle,
	setGroup,
	setPosition,
	type LinkResolver,
} from '../src/frontmatter';

/** Resolves bare names inside the `P/` folder, like Obsidian's shortest-path links. */
const resolve: LinkResolver = (linkpath) => {
	const known = ['P/A.md', 'P/B.md', 'P/C.md'];
	return known.find((p) => p === linkpath || p === `P/${linkpath}.md` || p === `${linkpath}.md`) ?? null;
};

describe('setPosition', () => {
	it('rounds to whole pixels to keep diffs quiet', () => {
		const fm: Record<string, unknown> = { blurb: 'x' };
		setPosition(fm, { x: 10.6, y: -3.2 });
		expect(fm).toEqual({ blurb: 'x', x: 11, y: -3 });
	});
});

describe('addConnection', () => {
	it('creates the list when absent', () => {
		const fm: Record<string, unknown> = {};
		expect(addConnection(fm, 'B', 'P/B.md', resolve)).toBe(true);
		expect(fm.connects_to).toEqual(['[[B]]']);
	});

	it('appends and preserves existing entries verbatim', () => {
		const fm: Record<string, unknown> = { connects_to: ['[[A|the start]]'] };
		addConnection(fm, 'B', 'P/B.md', resolve);
		expect(fm.connects_to).toEqual(['[[A|the start]]', '[[B]]']);
	});

	it('is a no-op when an entry already resolves to the target, however it is written', () => {
		const fm: Record<string, unknown> = { connects_to: ['[[P/B.md|Bee]]'] };
		expect(addConnection(fm, 'B', 'P/B.md', resolve)).toBe(false);
		expect(fm.connects_to).toEqual(['[[P/B.md|Bee]]']);
	});

	it('upgrades a scalar value to a list', () => {
		const fm: Record<string, unknown> = { connects_to: '[[A]]' };
		addConnection(fm, 'B', 'P/B.md', resolve);
		expect(fm.connects_to).toEqual(['[[A]]', '[[B]]']);
	});
});

describe('removeConnection', () => {
	it('removes every entry resolving to the target, including nested-array YAML shapes', () => {
		const fm: Record<string, unknown> = { connects_to: ['[[A]]', ['B'], '[[B#Scene]]', '[[C]]'] };
		expect(removeConnection(fm, 'P/B.md', resolve)).toBe(2);
		expect(fm.connects_to).toEqual(['[[A]]', '[[C]]']);
	});

	it('deletes the key when the list empties', () => {
		const fm: Record<string, unknown> = { connects_to: ['[[B]]'], blurb: 'keep me' };
		removeConnection(fm, 'P/B.md', resolve);
		expect(fm).toEqual({ blurb: 'keep me' });
	});

	it('leaves frontmatter untouched when nothing matches', () => {
		const fm: Record<string, unknown> = { connects_to: ['[[A]]', '[[Missing]]'] };
		expect(removeConnection(fm, 'P/B.md', resolve)).toBe(0);
		expect(fm.connects_to).toEqual(['[[A]]', '[[Missing]]']);
	});
});

describe('setGroup', () => {
	it('sets a trimmed name', () => {
		const fm: Record<string, unknown> = {};
		setGroup(fm, '  Act 1 ');
		expect(fm.group).toBe('Act 1');
	});

	it.each([[null], [''], ['   ']])('clears the key for %j', (value) => {
		const fm: Record<string, unknown> = { group: 'Act 1', blurb: 'b' };
		setGroup(fm, value);
		expect(fm).toEqual({ blurb: 'b' });
	});
});

describe('newNoteFrontmatter', () => {
	it('includes only non-empty fields', () => {
		expect(newNoteFrontmatter(' A twist ', 'fiction')).toEqual({ blurb: 'A twist', type: 'fiction' });
		expect(newNoteFrontmatter('', null)).toEqual({});
		expect(newNoteFrontmatter('b', '  ')).toEqual({ blurb: 'b' });
	});
});

describe('sanitizeTitle', () => {
	it.each([
		['The heist', 'The heist'],
		['What/why: a "test"?', 'What why a test'],
		['[[Linky]] #tag ^block | pipe', 'Linky tag block pipe'],
		['...hidden', 'hidden'],
		['  spaced   out  ', 'spaced out'],
		['///', ''],
	])('%j → %j', (input, expected) => {
		expect(sanitizeTitle(input)).toBe(expected);
	});
});
