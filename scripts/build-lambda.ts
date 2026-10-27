import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { zipSync } from 'fflate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export type LambdaBuild = { bundlePath: string; zipPath: string; bundleBytes: number; zipBytes: number; hash: string };

/**
 * Bundle the API (src/server/lambda.ts and everything it uses, including the AWS SDK and the data files) into one
 * file, and zip it for Lambda. The hash of the bundle names the package, so an unchanged API is not uploaded again.
 */
export async function buildLambda(outDir = join(root, 'dist', 'lambda')): Promise<LambdaBuild> {
  mkdirSync(outDir, { recursive: true });
  const bundlePath = join(outDir, 'index.mjs');
  const result = await build({
    entryPoints: [join(root, 'src', 'server', 'lambda.ts')],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    minify: true,
    legalComments: 'none',
    logLevel: 'warning',
    // Some bundled libraries still use require(); give them one
    banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
    metafile: true,
  });
  const out = result.metafile.outputs[Object.keys(result.metafile.outputs)[0]];
  const bytes = new Uint8Array(readFileSync(bundlePath));
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const zip = zipSync({ 'index.mjs': [bytes, { mtime: new Date('2020-01-01T00:00:00Z'), level: 9 }] });
  const zipPath = join(outDir, `${hash}.zip`);
  writeFileSync(zipPath, zip);
  return { bundlePath, zipPath, bundleBytes: out.bytes, zipBytes: zip.length, hash };
}

// `npm run build:lambda`
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildLambda().then((b) => console.log(`Built ${b.zipPath}\n  bundle ${(b.bundleBytes / 1024).toFixed(0)} KB, zip ${(b.zipBytes / 1024).toFixed(0)} KB, hash ${b.hash}`));
}
