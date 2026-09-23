/**
 * Visual design for the graph: resolves the active Obsidian theme into
 * concrete colours and builds the Cytoscape stylesheet from them.
 *
 * Design intent: the notes are the content, everything else recedes.
 * - Nodes are quiet cards; a thin coloured stripe on the left encodes `type`.
 * - Groups are soft tinted regions with a small caps label, not boxes.
 * - Manual connections are solid, body links dashed and fainter.
 * - Interaction states (hover, selection, connect source) use the theme accent.
 */
import type { NodeSingular, StylesheetJson } from 'cytoscape';
import { wrapLabel, type WrappedLabel } from './wrap';

/** Number of type colours; matches the palette `readTheme` resolves. */
export const TYPE_PALETTE_SIZE = 8;

export const NODE = {
	fontSize: 13,
	maxTextWidth: 220,
	/** Line height as a multiple of the font size. */
	lineHeight: 1.35,
	padding: 10,
	radius: 8,
	stripe: 4,
	/** Extra left room on typed cards so text clears the stripe. */
	stripeGap: 8,
} as const;

export interface Theme {
	text: string;
	muted: string;
	faint: string;
	card: string;
	groupFill: string;
	border: string;
	borderHover: string;
	accent: string;
	/** Colours cycled through for `type` stripes. */
	palette: string[];
	font: string;
}

const PALETTE_VARS: [string, string][] = [
	['--color-blue', '#086ddd'],
	['--color-orange', '#ec7500'],
	['--color-green', '#08b94e'],
	['--color-purple', '#7852ee'],
	['--color-red', '#e93147'],
	['--color-cyan', '#00bfbc'],
	['--color-pink', '#d53984'],
	['--color-yellow', '#e0ac00'],
];

/**
 * Resolve theme variables to colours Cytoscape can parse. Themes may define
 * variables with `hsl(var(...))` or `color-mix()`; computing them on a probe
 * element and normalising through a canvas yields plain hex/rgba. Anything
 * unparseable falls back to a neutral default.
 */
export function readTheme(el: HTMLElement): Theme {
	const probe = el.createDiv({ cls: 'story-web-probe' });
	const ctx = document.createElement('canvas').getContext('2d');
	const resolve = (cssVar: string, fallback: string): string => {
		probe.setCssProps({ '--story-web-probe-color': `var(${cssVar}, ${fallback})` });
		const computed = getComputedStyle(probe).color;
		if (!ctx || !computed) return fallback;
		ctx.fillStyle = fallback;
		ctx.fillStyle = computed;
		// Strip spaces: gradient stop lists are space-separated, so `rgba(1, 2, 3, 0.5)` would split.
		const normalised = String(ctx.fillStyle).replace(/\s+/g, '');
		return /^(#|rgba?\()/.test(normalised) ? normalised : fallback;
	};
	const theme: Theme = {
		text: resolve('--text-normal', '#222222'),
		muted: resolve('--text-muted', '#5c5c5c'),
		faint: resolve('--text-faint', '#ababab'),
		card: resolve('--background-primary', '#ffffff'),
		groupFill: resolve('--background-secondary', '#f6f6f6'),
		border: resolve('--background-modifier-border', '#e0e0e0'),
		borderHover: resolve('--background-modifier-border-hover', '#d4d4d4'),
		accent: resolve('--interactive-accent', '#8a5cf5'),
		palette: PALETTE_VARS.map(([v, fallback]) => resolve(v, fallback)),
		font: getComputedStyle(el).getPropertyValue('--font-interface').trim() || 'sans-serif',
	};
	probe.remove();
	return theme;
}

/** FNV-1a: a type's preferred palette slot, independent of which other types exist. */
function preferredSlot(type: string, paletteSize: number): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < type.length; i++) {
		h ^= type.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0) % paletteSize;
}

/**
 * Assign each type a palette slot. Each type starts at its hashed slot and
 * steps to the next free one on collision (types processed alphabetically),
 * so colours are distinct while there are fewer types than colours, stay put
 * as unrelated types come and go, and come out identical on every device.
 */
export function assignTypeSlots(types: string[], paletteSize: number): Map<string, number> {
	const out = new Map<string, number>();
	const used = new Set<number>();
	for (const type of [...new Set(types)].sort()) {
		let slot = preferredSlot(type, paletteSize);
		for (let tries = 0; used.has(slot) && tries < paletteSize; tries++) slot = (slot + 1) % paletteSize;
		used.add(slot);
		out.set(type, slot);
	}
	return out;
}

/** Returns a cached text-width function for a CSS font shorthand. */
export function textMeasurer(font: string): (text: string) => number {
	const ctx = document.createElement('canvas').getContext('2d');
	const cache = new Map<string, number>();
	return (text) => {
		let w = cache.get(text);
		if (w === undefined) {
			if (ctx) ctx.font = font;
			w = Math.ceil(ctx ? ctx.measureText(text).width : text.length * NODE.fontSize * 0.6);
			cache.set(text, w);
		}
		return w;
	};
}

export interface StyleOptions {
	/** Maximum lines of blurb per card; longer blurbs end in an ellipsis. */
	maxLines: number;
}

export function buildStylesheet(t: Theme, opts: StyleOptions): StylesheetJson {
	// Size nodes to their (ellipsised) label ourselves. Cytoscape's
	// `width: 'label'` is deprecated and caches a zero width for some nodes,
	// which silently hides them and their edges.
	const textWidth = textMeasurer(`500 ${NODE.fontSize}px ${t.font}`);
	const wrapCache = new Map<string, WrappedLabel>();
	const wrapped = (ele: NodeSingular): WrappedLabel => {
		const text = String(ele.data('label') ?? '');
		let w = wrapCache.get(text);
		if (!w) {
			w = wrapLabel(text, NODE.maxTextWidth, opts.maxLines, textWidth);
			wrapCache.set(text, w);
		}
		return w;
	};
	const isTyped = (ele: NodeSingular): boolean => ele.data('typeSlot') !== undefined;
	const labelWidth = (ele: NodeSingular): number =>
		Math.max(wrapped(ele).width, 1) + (isTyped(ele) ? NODE.stripeGap : 0);
	const labelHeight = (ele: NodeSingular): number =>
		Math.ceil(wrapped(ele).lines.length * NODE.fontSize * NODE.lineHeight);
	const typeColor = (ele: NodeSingular): string => t.palette[Number(ele.data('typeSlot'))] ?? t.accent;
	/** The stripe as a percentage of the card's full (padded) width. */
	const stripeStop = (ele: NodeSingular): string =>
		`${((NODE.stripe / (labelWidth(ele) + NODE.padding * 2)) * 100).toFixed(2)}%`;

	return [
		// Cytoscape's default grey press overlays look out of place in Obsidian.
		{
			selector: 'core',
			style: {
				'active-bg-color': t.accent,
				'active-bg-opacity': 0,
				'active-bg-size': 0,
				'selection-box-color': t.accent,
				'selection-box-border-color': t.accent,
				'selection-box-border-width': 1,
				'selection-box-opacity': 0.1,
				'outside-texture-bg-color': t.groupFill,
				'outside-texture-bg-opacity': 0,
			},
		},
		{ selector: 'node, edge', style: { 'overlay-opacity': 0, 'overlay-padding': 6 } },
		{
			selector: 'node.note',
			style: {
				shape: 'round-rectangle',
				'corner-radius': `${NODE.radius}`,
				// Pre-wrapped lines; the max width is padded so Cytoscape's own
				// measurement never re-wraps a line we already fitted.
				label: (ele: NodeSingular) => wrapped(ele).lines.join('\n'),
				'text-valign': 'center',
				'text-halign': 'center',
				'text-justification': 'left',
				'text-wrap': 'wrap',
				'text-max-width': `${NODE.maxTextWidth + 40}px`,
				'line-height': NODE.lineHeight,
				'font-size': NODE.fontSize,
				'font-weight': 500,
				'font-family': t.font,
				color: t.text,
				width: labelWidth,
				height: labelHeight,
				padding: `${NODE.padding}px`,
				'background-color': t.card,
				'border-width': 1,
				'border-color': t.border,
				'transition-property': 'opacity, border-color, underlay-opacity',
				'transition-duration': 120,
			},
		},
		{
			// Typed notes: a thin coloured stripe along the left edge.
			selector: 'node.note[typeSlot]',
			style: {
				'background-fill': 'linear-gradient',
				'background-gradient-direction': 'to-right',
				// Cytoscape parses these lists from space-separated strings; its typings only admit arrays.
				'background-gradient-stop-colors': ((ele: NodeSingular) =>
					[typeColor(ele), typeColor(ele), t.card, t.card].join(' ')) as unknown as string[],
				'background-gradient-stop-positions': ((ele: NodeSingular) =>
					['0%', stripeStop(ele), stripeStop(ele), '100%'].join(' ')) as unknown as string[],
				'text-margin-x': NODE.stripeGap / 2,
			},
		},
		{ selector: 'node.note.hover', style: { 'border-color': t.borderHover, 'underlay-color': t.text, 'underlay-opacity': 0.06, 'underlay-padding': 3, 'underlay-shape': 'round-rectangle' } },
		{
			selector: 'node.note:selected',
			style: { 'border-color': t.accent, 'outline-width': 2, 'outline-color': t.accent, 'outline-opacity': 0.35, 'outline-offset': 1 },
		},
		{
			selector: 'node.note.connect-source',
			style: {
				'border-color': t.accent,
				'border-width': 2,
				'underlay-color': t.accent,
				'underlay-opacity': 0.18,
				'underlay-padding': 6,
				'underlay-shape': 'round-rectangle',
			},
		},
		{
			selector: 'node.group',
			style: {
				shape: 'round-rectangle',
				'corner-radius': '14',
				label: 'data(label)',
				'text-transform': 'uppercase',
				'text-valign': 'top',
				'text-halign': 'center',
				'text-margin-y': -6,
				'font-size': 10.5,
				'font-weight': 600,
				'font-family': t.font,
				color: t.faint,
				padding: '20px',
				'background-color': t.groupFill,
				'background-opacity': 0.7,
				'border-width': 1,
				'border-color': t.border,
				'border-opacity': 0.6,
			},
		},
		{ selector: 'node.group.hover', style: { 'border-opacity': 1, color: t.muted } },
		{ selector: 'node.group:selected', style: { 'border-color': t.accent, 'border-opacity': 1, color: t.accent } },
		{
			selector: 'edge',
			style: {
				width: 1.25,
				'curve-style': 'bezier',
				'control-point-step-size': 36,
				'target-arrow-shape': 'triangle',
				'arrow-scale': 0.75,
				'source-distance-from-node': 2,
				'target-distance-from-node': 3,
				'line-color': t.muted,
				'target-arrow-color': t.muted,
				'line-opacity': 0.7,
				'transition-property': 'opacity, line-color, width',
				'transition-duration': 120,
			},
		},
		{
			selector: 'edge.linked-only',
			style: { 'line-style': 'dashed', 'line-dash-pattern': [4, 4], 'line-color': t.faint, 'target-arrow-color': t.faint },
		},
		{ selector: 'edge.highlight', style: { 'line-color': t.accent, 'target-arrow-color': t.accent, 'line-opacity': 1, width: 1.75 } },
		{ selector: 'edge:selected', style: { 'line-color': t.accent, 'target-arrow-color': t.accent, 'line-opacity': 1, width: 2.5 } },
		// Hovering a note fades everything it isn't connected to.
		{ selector: '.faded', style: { opacity: 0.3 } },
		{ selector: 'node.group.faded', style: { opacity: 0.6 } },
	];
}
