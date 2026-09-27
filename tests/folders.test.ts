import { describe, expect, it } from 'vitest';
import {
	absoluteGroupPath,
	compareGroupPaths,
	groupAncestry,
	groupDepth,
	groupLabel,
	groupParentPath,
	parentFolderPath,
	relativeGroupPath,
	renamedGroupPath,
	sanitizeGroupPath,
} from '../src/folders';

describe('relativeGroupPath', () => {
	it('is "" for the root folder itself', () => {
		expect(relativeGroupPath('Plots', 'Plots')).toBe('');
	});

	it('strips the root prefix', () => {
		expect(relativeGroupPath('Plots/Act 1', 'Plots')).toBe('Act 1');
		expect(relativeGroupPath('Plots/Act 1/Heist', 'Plots')).toBe('Act 1/Heist');
	});

	it('is "" for a folder outside the root (should never happen, but must not throw or leak a path)', () => {
		expect(relativeGroupPath('Elsewhere', 'Plots')).toBe('');
	});
});

describe('absoluteGroupPath', () => {
	it('round-trips with relativeGroupPath', () => {
		for (const group of ['', 'Act 1', 'Act 1/Heist']) {
			expect(relativeGroupPath(absoluteGroupPath('Plots', group), 'Plots')).toBe(group);
		}
	});

	it('"" maps to the root folder itself', () => {
		expect(absoluteGroupPath('Plots', '')).toBe('Plots');
	});
});

describe('parentFolderPath', () => {
	// Regression test: an earlier version computed this with `path.slice(0, path.lastIndexOf('/'))`
	// directly. For a top-level path, lastIndexOf('/') is -1, and slice(0, -1) silently
	// drops the last character instead of returning '' — "Plots" became "Plot", and
	// ensureFolder's recursion then created a chain of garbage folders ("P", "Pl", "Plo",
	// "Plot") in the vault before finally creating "Plots" too.
	it('is "" for a top-level path — never a truncated version of the path itself', () => {
		expect(parentFolderPath('Plots')).toBe('');
	});

	it('strips exactly the last segment for a nested path', () => {
		expect(parentFolderPath('Plots/Act 1')).toBe('Plots');
		expect(parentFolderPath('Plots/Act 1/Heist')).toBe('Plots/Act 1');
	});

	it('recursing on its own output always terminates at "" and never loops', () => {
		let path = 'Plots/Act 1/Heist/Detail';
		const seen = new Set<string>();
		for (let i = 0; path !== '' && i < 10; i++) {
			expect(seen.has(path)).toBe(false); // would only repeat if stuck
			seen.add(path);
			path = parentFolderPath(path);
		}
		expect(path).toBe('');
	});
});

describe('groupLabel / groupParentPath / groupDepth', () => {
	it.each([
		['Act 1', 'Act 1', '', 0],
		['Act 1/Heist', 'Heist', 'Act 1', 1],
		['Act 1/Heist/Detail', 'Detail', 'Act 1/Heist', 2],
	])('%s → label %j, parent %j, depth %d', (path, label, parent, depth) => {
		expect(groupLabel(path)).toBe(label);
		expect(groupParentPath(path)).toBe(parent);
		expect(groupDepth(path)).toBe(depth);
	});

	it('depth of "" (ungrouped) is -1 — it is never a group node', () => {
		expect(groupDepth('')).toBe(-1);
	});
});

describe('groupAncestry', () => {
	it('lists every prefix from the top down, including the path itself', () => {
		expect(groupAncestry('Act 1/Heist/Detail')).toEqual(['Act 1', 'Act 1/Heist', 'Act 1/Heist/Detail']);
	});

	it('is [] for "" (ungrouped)', () => {
		expect(groupAncestry('')).toEqual([]);
	});

	it('is a single entry for a top-level group', () => {
		expect(groupAncestry('Act 1')).toEqual(['Act 1']);
	});
});

describe('renamedGroupPath', () => {
	it('replaces only the leaf segment', () => {
		expect(renamedGroupPath('Act 1/Heist', 'Chase')).toBe('Act 1/Chase');
	});

	it('works on a top-level group', () => {
		expect(renamedGroupPath('Act 1', 'Act One')).toBe('Act One');
	});
});

describe('compareGroupPaths', () => {
	it('sorts a group before its own descendants (tree pre-order)', () => {
		const paths = ['Saltmarsh', 'Act 1/Heist', 'Act 1', 'Act 1/Heist/Detail'];
		expect([...paths].sort(compareGroupPaths)).toEqual(['Act 1', 'Act 1/Heist', 'Act 1/Heist/Detail', 'Saltmarsh']);
	});

	it('sorts "" (ungrouped) last, even among many groups', () => {
		expect([...['B', '', 'A'].sort(compareGroupPaths)]).toEqual(['A', 'B', '']);
	});

	it('is ordinal, not locale-aware — case and accents sort by code unit so every device agrees', () => {
		// A locale-aware compare (e.g. `localeCompare`) can order these differently
		// depending on OS/ICU locale; ordinal comparison is the same everywhere.
		expect(compareGroupPaths('a', 'B')).toBeGreaterThan(0); // lowercase 'a' > uppercase 'B' in UTF-16
		expect(compareGroupPaths('B', 'a')).toBeLessThan(0);
	});

	it('is a total order usable directly with Array.sort (never returns a non-finite or NaN result)', () => {
		for (const a of ['', 'A', 'A/B']) {
			for (const b of ['', 'A', 'A/B']) {
				expect(Number.isFinite(compareGroupPaths(a, b))).toBe(true);
			}
		}
	});
});

describe('sanitizeGroupPath', () => {
	it.each([
		['Act 1', 'Act 1'],
		['Act 1/Heist', 'Act 1/Heist'],
		[' Act 1 / Heist ', 'Act 1/Heist'],
		['/Act 1/', 'Act 1'],
		['Act 1//Heist', 'Act 1/Heist'],
		['Act 1 / . / Heist', 'Act 1/Heist'],
		['What/why: a "test"?', 'What/why a test'],
		['', ''],
		['   ', ''],
		['///', ''],
	])('%j → %j', (input, expected) => {
		expect(sanitizeGroupPath(input)).toBe(expected);
	});
});
