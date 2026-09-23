import esbuild from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import process from 'node:process';

const prod = process.argv[2] === 'production';

// Dev builds are also copied into the bundled test vault so `npm run dev`
// hot-reloads there. Point STORY_WEB_VAULT_PLUGIN_DIR elsewhere to override —
// but keep dev builds away from a real vault until you trust them.
const devPluginDir = process.env.STORY_WEB_VAULT_PLUGIN_DIR ?? 'test-vault/.obsidian/plugins/story-web';

const copyToDevVault = {
	name: 'copy-to-dev-vault',
	setup(build) {
		build.onEnd((result) => {
			if (prod || result.errors.length > 0) return;
			mkdirSync(devPluginDir, { recursive: true });
			for (const f of ['main.js', 'manifest.json', 'styles.css']) copyFileSync(f, `${devPluginDir}/${f}`);
			// Picked up by the "Hot Reload" community plugin, if installed in the vault.
			if (!existsSync(`${devPluginDir}/.hotreload`)) writeFileSync(`${devPluginDir}/.hotreload`, '');
			console.log(`[story-web] built → ${devPluginDir}`);
		});
	},
};

const context = await esbuild.context({
	entryPoints: ['src/main.ts'],
	bundle: true,
	external: [
		'obsidian',
		'electron',
		'@codemirror/*',
		'@lezer/*',
		...builtinModules,
		...builtinModules.map((m) => `node:${m}`),
	],
	format: 'cjs',
	target: 'es2020',
	platform: 'browser',
	logLevel: 'info',
	sourcemap: prod ? false : 'inline',
	treeShaking: true,
	minify: prod,
	outfile: 'main.js',
	plugins: [copyToDevVault],
});

if (prod) {
	await context.rebuild();
	await context.dispose();
} else {
	await context.watch();
}
