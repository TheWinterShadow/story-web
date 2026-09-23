import { describe, expect, it } from 'vitest';
import { buildGraph, edgeId, nodeId, readPosition, type NoteInfo } from '../src/model';

const note = (path: string, fm?: Record<string, unknown>, links: Partial<Pick<NoteInfo, 'bodyLinks' | 'manualLinks'>> = {}): NoteInfo => ({
	path,
	basename: path.replace(/^.*\//, '').replace(/\.md$/, ''),
	frontmatter: fm,
	bodyLinks: links.bodyLinks ?? [],
	manualLinks: links.manualLinks ?? [],
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

	it('collects groups from visible nodes', () => {
		const g = buildGraph([note('P/A.md', { group: 'Act 1' }), note('P/B.md', { group: 'Act 1' }), note('P/C.md', { group: 'Act 2' })]);
		expect(g.groups).toEqual(['Act 1', 'Act 2']);
		expect(g.nodes.map((n) => n.group)).toEqual(['Act 1', 'Act 1', 'Act 2']);
	});

	describe('type filter', () => {
		const notes = [
			note('P/A.md', { type: 'fiction', group: 'G' }, { manualLinks: ['P/B.md', 'P/C.md'] }),
			note('P/B.md', { type: 'dnd' }),
			note('P/C.md', { type: 'fiction' }),
			note('P/D.md'),
		];

		it('reports every type regardless of the filter', () => {
			const g = buildGraph(notes, 'dnd');
			expect(g.types).toEqual(['dnd', 'fiction']);
			expect(g.hasUntyped).toBe(true);
		});

		it('shows only matching nodes and edges between them', () => {
			const g = buildGraph(notes, 'fiction');
			expect(g.nodes.map((n) => n.path)).toEqual(['P/A.md', 'P/C.md']);
			expect(g.edges.map((e) => e.target)).toEqual([nodeId('P/C.md')]);
			expect(g.groups).toEqual(['G']);
		});

		it("'' selects untyped notes", () => {
			expect(buildGraph(notes, '').nodes.map((n) => n.path)).toEqual(['P/D.md']);
		});

		it('null shows everything', () => {
			expect(buildGraph(notes, null).nodes).toHaveLength(4);
		});
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
