// Same rule set Obsidian's community-directory review runs (eslint-plugin-obsidianmd
// recommended = ESLint core + typescript-eslint type-checked + Obsidian rules).
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
	{ ignores: ['main.js', 'node_modules/', 'test-vault/', 'eslint.config.mjs', 'esbuild.config.mjs', 'version-bump.mjs', 'vitest.config.ts'] },
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: { allowDefaultProject: ['eslint.config.*'] },
			},
		},
		rules: {
			// "Story Web" is the product name, not a sentence.
			'obsidianmd/ui/sentence-case': ['warn', { brands: ['Story Web'] }],
		},
	},
]);
