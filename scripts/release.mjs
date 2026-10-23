import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const source = await readFile(new URL('CodexUsage.js', root), 'utf8');
const version = source.match(/^const VERSION = "(\d+\.\d+\.\d+)";/m)?.[1];
if (!version || !source.includes(`// version: ${version}\n`) || !source.includes('// CODEX_USAGE_WIDGET\n')) throw Error('Script identity/version mismatch');
if (source.includes('\r')) throw Error('Script must use LF line endings');
new Function(`return async function() {\n${source}\n};`);
const manifest = { id: 'codex-usage-widget', version, script: 'CodexUsage.js', sha256: createHash('sha256').update(source).digest('hex') };
const output = JSON.stringify(manifest, null, 2) + '\n';
const path = new URL('update.json', root);
if (process.argv.includes('--check')) {
  if (await readFile(path, 'utf8') !== output) throw Error('Run npm run release to update the manifest');
  console.log(`v${version} release manifest verified`);
} else {
  await writeFile(path, output);
  console.log(`v${version} update.json generated`);
}
