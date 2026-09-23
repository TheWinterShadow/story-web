/**
 * Helpers for reading the `connects_to` frontmatter list.
 *
 * Pure functions only — no `obsidian` import — so they can be unit tested.
 */

/**
 * Extract the linkpath from a single link-ish value.
 *
 * Accepts `[[Note]]`, `[[Note|Alias]]`, `[[Note#Heading]]`, `[[folder/Note.md]]`,
 * and bare `Note`. Returns null for empty / non-string input.
 */
export function toLinkpath(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	let text = value.trim();
	const wiki = /^!?\[\[([^\]]*)\]\]$/.exec(text);
	if (wiki) text = wiki[1] ?? '';
	// Strip alias, then heading / block reference.
	text = text.split('|')[0] ?? '';
	text = text.split('#')[0] ?? '';
	text = text.trim();
	return text.length > 0 ? text : null;
}

/**
 * Normalise the raw YAML value of `connects_to` into a list of linkpaths.
 *
 * Handles a single string, a list of strings, and the nested-array shape YAML
 * produces when a user writes an unquoted `- [[Note]]` (parsed as `[["Note"]]`).
 */
export function parseLinkList(value: unknown): string[] {
	if (value === null || value === undefined) return [];
	const items = Array.isArray(value) ? value : [value];
	const out: string[] = [];
	for (const item of items) {
		if (Array.isArray(item)) {
			// Unquoted `[[Note]]` in YAML → [["Note"]]
			const flat: unknown[] = item.flat(Infinity);
			if (flat.length === 1) {
				const path = toLinkpath(flat[0]);
				if (path) out.push(path);
			}
			continue;
		}
		const path = toLinkpath(item);
		if (path) out.push(path);
	}
	return out;
}

/** Format a linktext as a wikilink string suitable for frontmatter. */
export function toWikilink(linktext: string): string {
	return `[[${linktext}]]`;
}
