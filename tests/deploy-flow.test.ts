import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Runs the real deploy script against a stand-in for the AWS CLI (tests/fixtures/fake-aws.mjs) that records every call,
 * and a small local web server playing the deployed site. Nothing here can reach AWS.
 */
const root = resolve(__dirname, '..');
const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const fake = join(root, 'tests', 'fixtures', 'fake-aws.mjs');

let dir: string;
let server: Server | undefined;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deploy-flow-')); });
afterEach(() => { server?.close(); server = undefined; rmSync(dir, { recursive: true, force: true }); });

/** A pretend deployed site. `broken` names the checks that should fail. */
function startSite(broken: string[] = []): Promise<string> {
  return new Promise((ok) => {
    server = createServer((req, res) => {
      const json = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      const url = req.url ?? '';
      if (url === '/' || url === '/home') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html><div id="root"></div></html>'); }
      if (url === '/api/health') return broken.includes('health') ? json(502, { message: 'Bad gateway' }) : json(200, { ok: true });
      if (url === '/api/personas') return broken.includes('database') ? json(500, { error: 'Internal error' }) : json(200, [{ id: 'a' }, { id: 'b' }, { id: 'operator' }]);
      if (url === '/api/me') return broken.includes('errors') ? (res.writeHead(200, { 'content-type': 'text/html' }), res.end('<html><div id="root"></div></html>')) : json(404, { error: 'Unknown persona' });
      json(404, { error: 'no' });
    }).listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${(server!.address() as { port: number }).port}`));
  });
}

type Run = { code: number | null; out: string; calls: string[][] };
function run(args: string[], env: Record<string, string> = {}, siteUrl = 'http://127.0.0.1:1'): Promise<Run> {
  const log = join(dir, 'calls.log');
  writeFileSync(log, ''); // each run's calls are recorded afresh; the pretend AWS keeps its state (stack, buckets) between runs
  return new Promise((done) => {
    const p = spawn(process.execPath, [tsx, 'scripts/deploy.ts', ...args], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env, BWYD_AWS_BIN: process.execPath, BWYD_AWS_ARGS_PREFIX: JSON.stringify([fake]),
        FAKE_AWS_LOG: log, FAKE_AWS_STATE: join(dir, 'state.json'), FAKE_SITE_URL: siteUrl,
        BWYD_REUSE_BUILD: '1', BWYD_SMOKE_TRIES: '2', BWYD_SMOKE_DELAY_MS: '10', ...env,
      },
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => done({
      code, out: out.replace(/\x1b\[[0-9;]*m/g, ''),
      calls: readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[]),
    }));
  });
}

const name = (c: string[]) => `${c[0]} ${c[1]}`;
/** Anything that would create, change or delete something in AWS. */
const MUTATING = ['cloudformation deploy', 'cloudformation delete-stack', 's3 cp', 's3 sync', 's3 rm', 's3 rb', 's3api create-bucket', 's3api put-public-access-block', 's3api put-bucket-lifecycle-configuration', 'cloudfront create-invalidation'];
const mutations = (r: Run) => r.calls.map(name).filter((n) => MUTATING.includes(n));
const BASE = ['--region', 'eu-west-2', '--stage', 'test'];

describe('deploy: looking before leaping', () => {
  it('a dry run builds and checks but changes nothing', async () => {
    const r = await run(['deploy', '--dry-run', '--skip-checks', ...BASE]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Account 111122223333');
    expect(r.out).toContain('Template is valid');
    expect(r.out).toMatch(/This creates 14 resources/); // the optional budget and keep-warm pieces are left out
    expect(r.out).toContain('Dry run finished');
    expect(mutations(r)).toEqual([]);
    expect(r.calls.map(name)).toEqual(['sts get-caller-identity', 'cloudformation validate-template', 'cloudformation describe-stacks']);
  }, 60_000);

  it('names the optional pieces when they are asked for', async () => {
    const r = await run(['deploy', '--dry-run', '--skip-checks', '--budget-email', 'a@b.co', '--warm-schedule', 'rate(5 minutes)', ...BASE]);
    expect(r.out).toMatch(/This creates 17 resources/);
    expect(r.out).toContain('A budget alert goes to a@b.co');
  }, 60_000);

  it('without --yes and without a keyboard it stops at the question, having changed nothing', async () => {
    const r = await run(['deploy', '--skip-checks', ...BASE]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('no keyboard to ask');
    expect(mutations(r)).toEqual([]);
  }, 60_000);

  it('stops at once when the AWS CLI is missing, with a message a person can act on', async () => {
    const r = await run(['status', ...BASE], { BWYD_AWS_BIN: 'definitely-not-installed-aws' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('AWS CLI');
    expect(r.out).toContain('not installed');
  }, 30_000);

  it('refuses a bad stage name before touching anything', async () => {
    const r = await run(['deploy', '--stage', 'Bad Name!', '--region', 'eu-west-2']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('--stage');
    expect(r.calls).toEqual([]);
  }, 30_000);
});

describe('deploy: the real thing, against the stand-in', () => {
  it('uploads the API, makes the stack, then publishes the site with the page last, and checks it', async () => {
    const url = await startSite();
    const r = await run(['deploy', '--yes', '--skip-checks', '--budget-email', 'me@example.com', ...BASE], {}, url);
    expect(r.code).toBe(0);
    const names = r.calls.map(name);
    const at = (n: string, from = 0) => { const i = names.indexOf(n, from); expect(i, `expected a call to ${n}`).toBeGreaterThanOrEqual(0); return i; };

    // The package bucket is made safely, then the package goes up
    const bucket = at('s3api create-bucket');
    expect(r.calls[bucket]).toEqual(expect.arrayContaining(['bwyd-lleol-artifacts-111122223333-eu-west-2', 'LocationConstraint=eu-west-2']));
    expect(names).toContain('s3api put-public-access-block');
    expect(names).toContain('s3api put-bucket-lifecycle-configuration');
    const upload = names.findIndex((n, i) => n === 's3 cp' && String(r.calls[i][3]).includes('/lambda/'));
    expect(upload).toBeGreaterThan(bucket);

    // The stack is deployed with the right parameters, after the package is up
    const deploy = at('cloudformation deploy');
    expect(deploy).toBeGreaterThan(upload);
    const d = r.calls[deploy];
    expect(d).toEqual(expect.arrayContaining(['--stack-name', 'bwyd-lleol-test', 'CAPABILITY_IAM', '--no-fail-on-empty-changeset']));
    const params = d.slice(d.indexOf('--parameter-overrides') + 1).filter((x) => /^[A-Z][A-Za-z]+=/.test(x));
    expect(params).toEqual(expect.arrayContaining(['Stage=test', 'BudgetEmail=me@example.com', 'MemorySize=1024', 'WarmSchedule=']));
    expect(params.find((p) => p.startsWith('CodeKey='))).toMatch(/^CodeKey=lambda\/[0-9a-f]{16}\.zip$/);
    expect(params.find((p) => p.startsWith('CodeBucket='))).toBe('CodeBucket=bwyd-lleol-artifacts-111122223333-eu-west-2');

    // The site goes up after the stack, hashed files first and index.html last, then the old copy is flushed
    const syncs = names.map((n, i) => (n === 's3 sync' ? i : -1)).filter((i) => i >= 0);
    expect(syncs).toHaveLength(2);
    expect(syncs[0]).toBeGreaterThan(deploy);
    expect(r.calls[syncs[0]]).toEqual(expect.arrayContaining(['s3://fake-site-bucket/assets', 'public, max-age=31536000, immutable', '--delete']));
    expect(r.calls[syncs[1]]).toEqual(expect.arrayContaining(['index.html', 'assets/*', 'no-cache']));
    const page = names.findIndex((n, i) => n === 's3 cp' && String(r.calls[i][3]).endsWith('/index.html'));
    expect(page).toBeGreaterThan(syncs[1]);
    const invalidate = at('cloudfront create-invalidation');
    expect(invalidate).toBeGreaterThan(page);
    expect(r.calls[invalidate]).toEqual(expect.arrayContaining(['EDIST123', '/*']));

    // And it tells the person where to go and what to do next
    for (const check of ['the home page', 'an app route', 'the API answers', 'the API reaches the database and seeds a session', 'API errors stay API errors']) expect(r.out).toContain(`✔ ${check}`);
    expect(r.out).toContain(`Open        ${url}`);
    expect(r.out).toContain(`${url}/lab?s=demo&as=operator`);
    expect(r.out).toContain('warmup --stage test');
  }, 90_000);

  it('does not upload an unchanged API a second time', async () => {
    const url = await startSite();
    await run(['deploy', '--yes', '--skip-checks', ...BASE], {}, url);
    const again = await run(['deploy', '--yes', '--skip-checks', ...BASE], {}, url);
    expect(again.code).toBe(0);
    expect(again.out).toContain('Already there');
    expect(again.out).toMatch(/This updates \d+ resources/);
    expect(again.calls.filter((c) => name(c) === 's3 cp' && String(c[3]).includes('/lambda/'))).toEqual([]); // no second upload of the package
    expect(again.calls.map(name)).not.toContain('s3api create-bucket');
  }, 120_000);
});

describe('deploy: when things go wrong', () => {
  it('reports the reason AWS gave if the stack fails, and does not publish the site', async () => {
    const r = await run(['deploy', '--yes', '--skip-checks', ...BASE], { FAKE_AWS_FAIL: 'deploy' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('What went wrong');
    expect(r.out).toContain('Distribution: Fake: your account is not allowed to use CloudFront');
    expect(r.calls.map(name)).not.toContain('s3 sync');
    expect(r.calls.map(name)).not.toContain('cloudfront create-invalidation');
  }, 60_000);

  it.each([
    ['health', 'the API answers'],
    ['database', 'the API reaches the database'],
    ['errors', 'API errors stay API errors'],
  ])('fails the deploy, naming the check, if %s is broken after publishing', async (broken, check) => {
    const url = await startSite([broken]);
    const r = await run(['deploy', '--yes', '--skip-checks', ...BASE], {}, url);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`Check failed: ${check}`);
    expect(r.out).not.toContain('✔ Deployed');
  }, 60_000);
});

describe('warmup, status and destroy', () => {
  it('warms a deployed stage and reports how quick it was', async () => {
    const url = await startSite();
    await run(['deploy', '--yes', '--skip-checks', ...BASE], {}, url);
    const r = await run(['warmup', '--concurrency', '4', '--rounds', '2', ...BASE], {}, url);
    expect(r.code).toBe(0);
    expect(r.out).toContain('4 requests at a time, 2 rounds');
    expect(r.out).toMatch(/Round 1: 4\/4 ok/);
    expect(r.out).toMatch(/Round 2: 4\/4 ok, fastest \d+ ms, median \d+ ms/);
  }, 120_000);

  it('says so, rather than guessing, when nothing is deployed', async () => {
    const w = await run(['warmup', ...BASE]);
    expect(w.code).toBe(1);
    expect(w.out).toContain('Nothing is deployed for stage "test"');
    const s = await run(['status', ...BASE]);
    expect(s.code).toBe(0);
    expect(s.out).toContain('Nothing is deployed for stage "test"');
    expect(mutations(w).concat(mutations(s))).toEqual([]);
  }, 60_000);

  it('shows status of a deployed stage', async () => {
    const url = await startSite();
    await run(['deploy', '--yes', '--skip-checks', ...BASE], {}, url);
    const r = await run(['status', ...BASE], {}, url);
    expect(r.out).toContain(`Address   ${url}`);
    expect(r.out).toContain('nodejs22.x, arm64, 1024 MB');
    expect(r.out).toContain('about 42 items');
  }, 120_000);

  it('will not destroy without being told to, and does nothing when there is nothing to destroy', async () => {
    const nothing = await run(['destroy', '--yes', ...BASE]);
    expect(nothing.code).toBe(0);
    expect(nothing.out).toContain('nothing to remove');
    expect(mutations(nothing)).toEqual([]);

    const url = await startSite();
    await run(['deploy', '--yes', '--skip-checks', ...BASE], {}, url);
    const refused = await run(['destroy', ...BASE], {}, url); // no --yes, no keyboard
    expect(refused.code).toBe(1);
    expect(refused.out).toContain('no keyboard to ask');
    expect(refused.out).toContain('the table with all its demo data');
    expect(mutations(refused)).toEqual([]);
  }, 120_000);

  it('empties the website bucket before deleting the stack, and removes the package bucket only if asked', async () => {
    const url = await startSite();
    await run(['deploy', '--yes', '--skip-checks', ...BASE], {}, url);
    const r = await run(['destroy', '--yes', ...BASE], {}, url);
    expect(r.code).toBe(0);
    const names = r.calls.map(name);
    expect(names.indexOf('s3 rm')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('cloudformation delete-stack')).toBeGreaterThan(names.indexOf('s3 rm'));
    expect(names.indexOf('cloudformation wait')).toBeGreaterThan(names.indexOf('cloudformation delete-stack'));
    expect(r.calls[names.indexOf('s3 rm')]).toEqual(expect.arrayContaining(['s3://fake-site-bucket', '--recursive']));
    expect(names).not.toContain('s3 rb');

    await run(['deploy', '--yes', '--skip-checks', ...BASE], {}, url);
    const all = await run(['destroy', '--yes', '--delete-artifacts', ...BASE], {}, url);
    expect(all.calls.map(name)).toContain('s3 rb');
    expect(all.calls.find((c) => name(c) === 's3 rb')).toEqual(expect.arrayContaining(['s3://bwyd-lleol-artifacts-111122223333-eu-west-2', '--force']));
  }, 180_000);
});
