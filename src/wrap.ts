/**
 * Word-wrap a label into at most `maxLines` lines no wider than `maxWidth`.
 *
 * Done here rather than with Cytoscape's `text-wrap: wrap` because the node's
 * size has to be known up front (Cytoscape's label-based sizing is broken, see
 * theme.ts), and because Cytoscape can wrap but can't cap the line count.
 *
 * Pure: `measure` is injected so this can be unit tested without a canvas.
 */
export interface WrappedLabel {
	lines: string[];
	/** Width of the widest line. */
	width: number;
}

const ELLIPSIS = '…';

export function wrapLabel(
	text: string,
	maxWidth: number,
	maxLines: number,
	measure: (s: string) => number,
): WrappedLabel {
	const limit = Math.max(1, Math.floor(maxLines));
	const lines: string[] = [];
	let truncated = false;

	// Respect explicit line breaks (e.g. a YAML block-scalar blurb).
	const paragraphs = text.split(/\r?\n/).map((p) => p.replace(/\s+/g, ' ').trim());

	outer: for (const paragraph of paragraphs) {
		if (paragraph === '') continue;
		let line = '';
		for (const word of paragraph.split(' ')) {
			for (const piece of breakWord(word, maxWidth, measure)) {
				const candidate = line === '' ? piece : `${line} ${piece}`;
				if (measure(candidate) <= maxWidth) {
					line = candidate;
					continue;
				}
				lines.push(line);
				if (lines.length === limit) {
					truncated = true;
					break outer;
				}
				line = piece;
			}
		}
		lines.push(line);
		if (lines.length === limit) {
			truncated = paragraphs.slice(paragraphs.indexOf(paragraph) + 1).some((p) => p !== '');
			break;
		}
	}

	if (truncated) lines[lines.length - 1] = withEllipsis(lines[lines.length - 1] ?? '', maxWidth, measure);
	if (lines.length === 0) lines.push('');
	return { lines, width: Math.max(...lines.map(measure)) };
}

/** Split a single word that is wider than the line into character chunks that fit. */
function breakWord(word: string, maxWidth: number, measure: (s: string) => number): string[] {
	if (measure(word) <= maxWidth) return [word];
	const pieces: string[] = [];
	let chunk = '';
	for (const ch of word) {
		if (chunk !== '' && measure(chunk + ch) > maxWidth) {
			pieces.push(chunk);
			chunk = '';
		}
		chunk += ch;
	}
	if (chunk !== '') pieces.push(chunk);
	return pieces;
}

function withEllipsis(line: string, maxWidth: number, measure: (s: string) => number): string {
	let base = line.trimEnd();
	while (base.length > 0 && measure(base + ELLIPSIS) > maxWidth) base = base.slice(0, -1).trimEnd();
	return base + ELLIPSIS;
}
