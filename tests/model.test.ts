import { describe, expect, it } from 'vitest';
import { buildGraph, edgeId, nodeId, readPosition, type NoteInfo } from '../src/model';

const note = (
	path: string,
	fm?: Record<string, unknown>,
	opts: Partial<Pick<NoteInfo, 'bodyLinks' | 'manualLinks' | 'group'>> = {},
): NoteInfo => ({
	path,
	basename: path.replace(/^.*\//, '').replace(/\.md$/, ''),
	frontmatter: fm,
	bodyLinks: opts.bodyLinks ?? [],
	manualLinks: opts.manualLinks ?? [],
	group: opts.group ?? '',
});

describe('buildGraph', () => {
	it('labels nodes by blurb, falling back to the filename', () => {
		const g = buildGraph([note('P/A.md', { blurb: 'The heist' }), note('P/B.md'), note('P/C.md', { blurb: '   ' })]);
		expect(g.nodes.map((n) => n.label)).toEqual(['The heist', 'B', 'C']);
	});

	it('merges a manual and a body link between the same pair into one edge', () => {
		const g = buildGraph([
			note('P/A.md', {}, { manualLinks: ['P/B.md'], bodyLinks: ['P/B.md'] }),
			note('P/B.md'),
		]);
		expect(g.edges).toEqual([
			{ id: edgeId('P/A.md', 'P/B.md'), source: nodeId('P/A.md'), target: nodeId('P/B.md'), manual: true, linked: true },
		]);
	});

	it('keeps edges directional', () => {
		const g = buildGraph([note('P/A.md', {}, { manualLinks: ['P/B.md'] }), note('P/B.md', {}, { bodyLinks: ['P/A.md'] })]);
		expect(g.edges).toHaveLength(2);
	});

	it('drops self-links and links leaving the node set', () => {
		const g = buildGraph([note('P/A.md', {}, { manualLinks: ['P/A.md', 'Elsewhere/X.md'] })]);
		expect(g.edges).toEqual([]);
	});

	it("a note's group comes from where its file is, not from frontmatter", () => {
		const g = buildGraph([note('P/A.md', { group: 'Ignored, not read anymore' }, { group: 'Act 1' })]);
		expect(g.nodes[0]!.group).toBe('Act 1');
	});

	it('collects top-level groups from visible nodes', () => {
		const g = buildGraph([note('P/A.md', {}, { group: 'Act 1' }), note('P/B.md', {}, { group: 'Act 1' }), note('P/C.md', {}, { group: 'Act 2' })]);
		expect(g.groups.map((x) => x.path)).toEqual(['Act 1', 'Act 2']);
		expect(g.nodes.map((n) => n.group)).toEqual(['Act 1', 'Act 1', 'Act 2']);
	});

	it('synthesises every ancestor of a nested group, parent listed before child, even with no note directly in the ancestor', () => {
		const g = buildGraph([note('P/A.md', {}, { group: 'Act 1/Heist/Detail' })]);
		expect(g.groups.map((x) => x.path)).toEqual(['Act 1', 'Act 1/Heist', 'Act 1/Heist/Detail']);
		const [top, mid, leaf] = g.groups;
		expect(top).toMatchObject({ label: 'Act 1', parentId: null, depth: 0 });
		expect(mid).toMatchObject({ label: 'Heist', parentId: top!.id, depth: 1 });
		expect(leaf).toMatchObject({ label: 'Detail', parentId: mid!.id, depth: 2 });
	});

	it('never turns "" (ungrouped) into a group node', () => {
		const g = buildGraph([note('P/A.md'), note('P/B.md', {}, { group: '' })]);
		expect(g.groups).toEqual([]);
	});

	describe('type filter', () => {
		const notes = [
			note('P/A.md', { type: 'fiction' }, { group: 'G', manualLinks: ['P/B.md', 'P/C.md'] }),
			note('P/B.md', { type: 'dnd' }),
			note('P/C.md', { type: 'fiction' }),
			note('P/D.md'),
		];

		it('reports every type regardless of the filter', () => {
			const g = buildGraph(notes, 'dnd');
			expect(g.types).toEqual(['dnd', 'fiction']);
			expect(g.hasUntyped).toBe(true);
		});

		it('shows only matching nodes, edges between them, and groups that still contain one', () => {
			const g = buildGraph(notes, 'fiction');
			expect(g.nodes.map((n) => n.path)).toEqual(['P/A.md', 'P/C.md']);
			expect(g.edges.map((e) => e.target)).toEqual([nodeId('P/C.md')]);
			expect(g.groups.map((x) => x.path)).toEqual(['G']);
		});

		it('drops a group entirely once the filter hides its only note', () => {
			// "G" contains only A, which is fiction — filtering to dnd empties it.
			expect(buildGraph(notes, 'dnd').groups).toEqual([]);
		});

		it("'' selects untyped notes", () => {
			expect(buildGraph(notes, '').nodes.map((n) => n.path)).toEqual(['P/D.md']);
		});

		it('null shows everything', () => {
			expect(buildGraph(notes, null).nodes).toHaveLength(4);
		});
	});

	it('keeps an ancestor group alive via a deeply nested note even when its own direct note is filtered out', () => {
		const notes = [
			note('P/A.md', { type: 'dnd' }, { group: 'Act 1' }),
			note('P/B.md', { type: 'fiction' }, { group: 'Act 1/Heist' }),
		];
		const g = buildGraph(notes, 'fiction');
		expect(g.nodes.map((n) => n.path)).toEqual(['P/B.md']);
		expect(g.groups.map((x) => x.path)).toEqual(['Act 1', 'Act 1/Heist']);
	});
});

describe('readPosition', () => {
	it('reads numbers and numeric strings', () => {
		expect(readPosition({ x: 10, y: -5.5 })).toEqual({ x: 10, y: -5.5 });
		expect(readPosition({ x: '10', y: '20' })).toEqual({ x: 10, y: 20 });
	});

	it('treats missing, blank, null or partial coordinates as unpositioned', () => {
		expect(readPosition(undefined)).toBeNull();
		expect(readPosition({ x: 1 })).toBeNull();
		expect(readPosition({ x: null, y: null })).toBeNull();
		expect(readPosition({ x: '', y: '' })).toBeNull();
		expect(readPosition({ x: 'left', y: 3 })).toBeNull();
	});
});
