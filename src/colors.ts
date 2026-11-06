/**
 * The eight named colours a note can be coded with — Obsidian's own theme
 * colour tokens (`--color-*`), not free-form hex. That keeps a manually
 * picked colour and an automatically assigned type colour (theme.ts) drawn
 * from the exact same palette, so both always match the active theme and
 * neither needs its own picker UI beyond a swatch grid.
 *
 * Order matters: it's also the order `assignTypeSlots` (theme.ts) indexes
 * into by number, so notes already carrying a numeric `typeSlot` keep
 * pointing at the same colour if this list is ever extended (only append).
 */
export const COLOR_NAMES = ['blue', 'orange', 'green', 'purple', 'red', 'cyan', 'pink', 'yellow'] as const;

export type ColorName = (typeof COLOR_NAMES)[number];

export function isColorName(value: string): value is ColorName {
	return (COLOR_NAMES as readonly string[]).includes(value);
}
