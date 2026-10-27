import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { buildLambda } from './build-lambda';
import { HELP, artifactBucketName, codeKey, formatBytes, parseArgs, parameterOverrides, stackName, type Options } from './lib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = 'infra/template.yaml';
const say = (m = '') => console.log(m);
const step = (m: string) => console.log(`\n▶ ${m}`);

// ---- running things ------------------------------------------------------------------------------------

class AwsError extends Error {}

/** Run the AWS CLI. Returns what it printed; throws with AWS's own message if it fails. */
function aws(o: Options, args: string[], opts: { json?: boolean; show?: boolean; okIf?: RegExp } = {}): any {
  const full = [...args, ...(o.region ? ['--region', o.region] : []), ...(o.profile ? ['--profile', o.profile] : []),
    ...(opts.json ? ['--output', 'json'] : [])];
  // BWYD_AWS_BIN / BWYD_AWS_ARGS_PREFIX let the tests substitute a stand-in for the AWS CLI; normally this is just `aws`
  const bin = process.env.BWYD_AWS_BIN ?? 'aws';
  const prefix: string[] = JSON.parse(process.env.BWYD_AWS_ARGS_PREFIX ?? '[]');
  const r = spawnSync(bin, [...prefix, ...full], { cwd: root, encoding: 'utf8', stdio: opts.show ? ['ignore', 'inherit', 'pipe'] : 'pipe', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new AwsError(r.error.message.includes('ENOENT') ? 'The AWS CLI (the "aws" command) is not installed or not on the PATH. See https://aws.amazon.com/cli/' : r.error.message);
  if (r.status !== 0) {
    const text = `${r.stderr ?? ''}${r.stdout ?? ''}`.trim();
    if (opts.okIf && opts.okIf.test(text)) return undefined;
    throw new AwsError(`aws ${args.slice(0, 2).join(' ')} failed:\n${text}`);
  }
  if (!opts.json) return r.stdout;
  return r.stdout.trim() ? JSON.parse(r.stdout) : undefined;
}

function npm(script: string) {
  const r = spawnSync('npm', ['run', script], { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0) throw new Error(`"npm run ${script}" failed, so nothing was deployed.`);
}

async function confirm(o: Options, question: string, expect = 'y'): Promise<void> {
  if (o.yes) return;
  if (!process.stdin.isTTY) throw new Error('This asks for confirmation, but there is no keyboard to ask. Re-run with --yes if you mean it.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} `)).trim().toLowerCase();
  rl.close();
  if (answer !== expect.toLowerCase()) throw new Error('Cancelled. Nothing was changed.');
}

// ---- who and where ---------------------------------------------------------------------------------------

type Identity = { account: string; arn: string; region: string };

function identify(o: Options): Identity {
  const who = aws(o, ['sts', 'get-caller-identity'], { json: true });
  const region = o.region ?? String(aws(o, ['configure', 'get', 'region']) ?? '').trim();
  if (!region) throw new Error('No AWS region. Pass --region (for example --region eu-west-2) or set one with "aws configure".');
  o.region = region;
  return { account: who.Account, arn: who.Arn, region };
}

function stackOutputs(o: Options): Record<string, string> | undefined {
  const r = aws(o, ['cloudformation', 'describe-stacks', '--stack-name', stackName(o.stage)], { json: true, okIf: /does not exist/ });
  const stack = r?.Stacks?.[0];
  if (!stack) return undefined;
  return Object.fromEntries((stack.Outputs ?? []).map((x: { OutputKey: string; OutputValue: string }) => [x.OutputKey, x.OutputValue]));
}

/** The resources this deploy will have, leaving out the optional ones (budget alert, keep-warm schedule) that were not asked for. */
/** What the API throttle is set to, read from the template so the message cannot drift from the truth. */
export function throttleDefault(): number {
  const doc = YAML.parse(readFileSync(join(root, TEMPLATE), 'utf8')) as { Parameters: { ThrottleRate: { Default: number } } };
  return doc.Parameters.ThrottleRate.Default;
}

export function plannedResources(o: Pick<Options, 'budgetEmail' | 'warmSchedule'>): [string, string][] {
  const doc = YAML.parse(readFileSync(join(root, TEMPLATE), 'utf8')) as { Resources: Record<string, { Type: string; Condition?: string }> };
  const wanted: Record<string, boolean> = { HasBudgetEmail: !!o.budgetEmail, HasWarmSchedule: !!o.warmSchedule };
  return Object.entries(doc.Resources)
    .filter(([, r]) => !r.Condition || wanted[r.Condition])
    .map(([id, r]) => [id, r.Type]);
}

function validateTemplate(o: Options) {
  aws(o, ['cloudformation', 'validate-template', '--template-body', `file://${TEMPLATE}`], { json: true });
}

// ---- deploy ------------------------------------------------------------------------------------------------

async function deploy(o: Options) {
  const id = identify(o);
  const stack = stackName(o.stage);
  say(`Account ${id.account} (${id.arn})\nRegion  ${id.region}\nStack   ${stack}${o.dryRun ? '   [dry run: nothing in AWS will be changed]' : ''}`);

  if (!o.skipChecks) {
    step('Checking the code (type check and tests; the browser tests are not part of this)');
    npm('typecheck');
    npm('test');
  } else say('\n(skipping checks)');

  step('Building the web app');
  // BWYD_REUSE_BUILD lets the tests of this script skip the (already tested) web build
  if (process.env.BWYD_REUSE_BUILD && existsSync(join(root, 'dist', 'web', 'index.html'))) say('  (reusing the existing build)');
  else npm('build');
  if (!existsSync(join(root, 'dist', 'web', 'index.html'))) throw new Error('The web build produced no dist/web/index.html.');

  step('Building the API package');
  const pkg = await buildLambda();
  say(`  ${formatBytes(pkg.bundleBytes)} bundled, ${formatBytes(pkg.zipBytes)} zipped (${pkg.hash})`);

  step('Asking AWS to check the template (read-only)');
  validateTemplate(o);
  say('  Template is valid.');

  const existing = stackOutputs(o);
  const resources = plannedResources(o);
  say(`\nThis ${existing ? 'updates' : 'creates'} ${resources.length} resources:`);
  for (const [rid, type] of resources) say(`  ${type.padEnd(40)} ${rid}`);
  say('\nWhat it costs: nothing while idle except pennies for storage. DynamoDB, Lambda and API Gateway charge per request; CloudFront and S3 per use.');
  say(`An API throttle (${throttleDefault()} requests a second, enough for about 50 people at once) stops a runaway bill.${o.budgetEmail ? ` A budget alert goes to ${o.budgetEmail} at 80% of $${o.budgetUsd} a month.` : ' No budget alert (add --budget-email you@example.com).'}`);
  say('There is no sign-in: anyone with the address can use it, and the operator view can reset a session.');

  if (o.dryRun) {
    say('\nDry run finished. Nothing was uploaded or changed. Run again without --dry-run to deploy.');
    return;
  }
  await confirm(o, `\nDeploy "${o.stage}" to account ${id.account} in ${id.region}? [y/N]`);

  step('Uploading the API package');
  const bucket = artifactBucketName(id.account, id.region);
  ensureArtifactBucket(o, bucket, id.region);
  const key = codeKey(pkg.hash);
  const have = aws(o, ['s3api', 'head-object', '--bucket', bucket, '--key', key], { json: true, okIf: /Not Found|404/ });
  if (have) say('  Already there (the API has not changed).');
  else aws(o, ['s3', 'cp', pkg.zipPath, `s3://${bucket}/${key}`, '--only-show-errors']);

  step(`${existing ? 'Updating' : 'Creating'} the stack (the first time takes several minutes, mostly CloudFront)`);
  try {
    aws(o, ['cloudformation', 'deploy', '--stack-name', stack, '--template-file', TEMPLATE, '--capabilities', 'CAPABILITY_IAM',
      '--no-fail-on-empty-changeset', '--tags', 'project=bwyd-lleol', `stage=${o.stage}`,
      '--parameter-overrides', ...parameterOverrides(o, bucket, key)], { show: true });
  } catch (e) {
    say(failedEvents(o, stack));
    throw e;
  }
  const out = stackOutputs(o);
  if (!out) throw new Error('The stack deployed but has no outputs.');

  step('Publishing the web app');
  publishSite(o, out.SiteBucketName, out.DistributionId);

  step('Checking it works from the outside');
  await smokeTest(out.SiteUrl);

  say(`\n✔ Deployed.\n\n  Open        ${out.SiteUrl}\n  Operator    ${out.SiteUrl}/lab?s=demo&as=operator\n  Before a demo   npm run aws -- warmup --stage ${o.stage}\n  Remove it       npm run aws -- destroy --stage ${o.stage}`);
}

function ensureArtifactBucket(o: Options, bucket: string, region: string) {
  const exists = aws(o, ['s3api', 'head-bucket', '--bucket', bucket], { okIf: /Not Found|404|NoSuchBucket/ });
  if (exists !== undefined) return;
  say(`  Creating the package bucket ${bucket}`);
  aws(o, ['s3api', 'create-bucket', '--bucket', bucket, ...(region === 'us-east-1' ? [] : ['--create-bucket-configuration', `LocationConstraint=${region}`])]);
  aws(o, ['s3api', 'put-public-access-block', '--bucket', bucket, '--public-access-block-configuration', 'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true']);
  // Old packages are only useful for a short while
  aws(o, ['s3api', 'put-bucket-lifecycle-configuration', '--bucket', bucket, '--lifecycle-configuration',
    JSON.stringify({ Rules: [{ ID: 'expire-old-packages', Status: 'Enabled', Filter: { Prefix: 'lambda/' }, Expiration: { Days: 30 } }] })]);
}

function failedEvents(o: Options, stack: string): string {
  try {
    const r = aws(o, ['cloudformation', 'describe-stack-events', '--stack-name', stack, '--max-items', '40'], { json: true });
    const bad = (r?.StackEvents ?? []).filter((e: { ResourceStatus?: string }) => /FAILED/.test(e.ResourceStatus ?? ''));
    return bad.length ? `\nWhat went wrong:\n${bad.map((e: { LogicalResourceId: string; ResourceStatusReason?: string }) => `  ${e.LogicalResourceId}: ${e.ResourceStatusReason}`).join('\n')}\n` : '';
  } catch { return ''; }
}

/** Upload the built app: files with hashed names first, the page that points at them last, so nobody sees a half-published site. */
function publishSite(o: Options, bucket: string, distributionId: string) {
  const dist = join(root, 'dist', 'web');
  const to = `s3://${bucket}`;
  aws(o, ['s3', 'sync', join(dist, 'assets'), `${to}/assets`, '--delete', '--cache-control', 'public, max-age=31536000, immutable', '--only-show-errors']);
  aws(o, ['s3', 'sync', dist, `${to}/`, '--delete', '--exclude', 'index.html', '--exclude', 'assets/*', '--cache-control', 'no-cache', '--only-show-errors']);
  aws(o, ['s3', 'cp', join(dist, 'index.html'), `${to}/index.html`, '--cache-control', 'no-cache', '--content-type', 'text/html; charset=utf-8', '--only-show-errors']);
  aws(o, ['cloudfront', 'create-invalidation', '--distribution-id', distributionId, '--paths', '/*'], { json: true });
  say('  Published, and CloudFront told to forget the old copy.');
}

// ---- checks from the outside ----------------------------------------------------------------------------

async function get(url: string, headers: Record<string, string> = {}) {
  const t = performance.now();
  const res = await fetch(url, { headers });
  return { status: res.status, type: res.headers.get('content-type') ?? '', text: await res.text(), ms: Math.round(performance.now() - t) };
}

async function smokeTest(site: string) {
  const checks: [string, () => Promise<string | undefined>][] = [
    ['the home page', async () => { const r = await get(`${site}/`); return r.status === 200 && r.text.includes('id="root"') ? undefined : `status ${r.status}`; }],
    ['an app route (/home) serves the app', async () => { const r = await get(`${site}/home`); return r.status === 200 && r.text.includes('id="root"') ? undefined : `status ${r.status}`; }],
    ['the API answers', async () => { const r = await get(`${site}/api/health`); return r.status === 200 && r.text.includes('"ok":true') ? undefined : `status ${r.status}: ${r.text.slice(0, 80)}`; }],
    ['the API reaches the database and seeds a session', async () => {
      const r = await get(`${site}/api/personas`, { 'x-session': 'deploy-check' });
      return r.status === 200 && r.type.includes('json') && JSON.parse(r.text).length >= 3 ? undefined : `status ${r.status}: ${r.text.slice(0, 120)}`;
    }],
    ['API errors stay API errors (not the app page)', async () => {
      const r = await get(`${site}/api/me`, { 'x-session': 'deploy-check', 'x-persona': 'nobody' });
      return r.status === 404 && r.type.includes('json') ? undefined : `status ${r.status} ${r.type}`;
    }],
  ];
  for (const [name, run] of checks) {
    let problem: string | undefined = 'not tried';
    const tries = Number(process.env.BWYD_SMOKE_TRIES ?? 12);
    const delay = Number(process.env.BWYD_SMOKE_DELAY_MS ?? 5000);
    for (let attempt = 0; attempt < tries && problem; attempt++) { // a new CloudFront address takes a little while to settle
      try { problem = await run(); } catch (e) { problem = (e as Error).message; }
      if (problem && attempt < tries - 1) await new Promise((r) => setTimeout(r, delay));
    }
    if (problem) throw new Error(`Check failed: ${name}: ${problem}`);
    say(`  ✔ ${name}`);
  }
}

// ---- other commands -------------------------------------------------------------------------------------

function status(o: Options) {
  const id = identify(o);
  const out = stackOutputs(o);
  if (!out) { say(`No stack "${stackName(o.stage)}" in account ${id.account} (${id.region}). Nothing is deployed for stage "${o.stage}".`); return; }
  const fn = aws(o, ['lambda', 'get-function-configuration', '--function-name', out.FunctionName], { json: true });
  const table = aws(o, ['dynamodb', 'describe-table', '--table-name', out.TableName], { json: true }).Table;
  say(`Stage ${o.stage} in account ${id.account} (${id.region})\n  Address   ${out.SiteUrl}\n  API       ${fn.Runtime}, ${fn.Architectures?.join(',')}, ${fn.MemorySize} MB, updated ${fn.LastModified}\n  Table     ${out.TableName}: about ${table.ItemCount} items, ${formatBytes(table.TableSizeBytes)}, ${table.BillingModeSummary?.BillingMode ?? 'on-demand'}`);
}

async function warmup(o: Options) {
  identify(o);
  const out = stackOutputs(o);
  if (!out) throw new Error(`Nothing is deployed for stage "${o.stage}". Deploy first.`);
  say(`Waking ${out.SiteUrl} with ${o.concurrency} requests at a time, ${o.rounds} rounds (a request at the same moment gets its own copy of the API, so this prepares for about ${o.concurrency} people arriving together).\n`);
  for (let round = 1; round <= o.rounds; round++) {
    // One request per worker, so "concurrency" is exactly how many copies of the API are woken at once
    const results = await Promise.all(Array.from({ length: o.concurrency }, async (_, i) => {
      const r = await get(`${out.SiteUrl}/api/personas`, { 'x-session': 'warmup' });
      return { ok: r.status === 200, ms: r.ms, i, why: r.status === 200 ? '' : `HTTP ${r.status} ${r.text.slice(0, 80).replace(/\s+/g, ' ')}` };
    }));
    const ms = results.map((r) => r.ms).sort((a, b) => a - b);
    say(`  Round ${round}: ${results.filter((r) => r.ok).length}/${results.length} ok, fastest ${ms[0]} ms, median ${ms[Math.floor(ms.length / 2)]} ms, slowest ${ms[ms.length - 1]} ms`);
    if (results.some((r) => !r.ok)) {
      const reasons = [...new Set(results.filter((r) => !r.ok).map((r) => r.why))];
      throw new Error(`Some requests failed:\n  ${reasons.join('\n  ')}\n(429 or 5xx here usually means the account's Lambda concurrency limit is lower than ${o.concurrency}; check it with: aws lambda get-account-settings. Try a smaller --concurrency.)`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  say('\nWarm. The copies stay ready for a few minutes of quiet; run this again shortly before the session if there is a long gap.');
}

async function destroy(o: Options) {
  const id = identify(o);
  const stack = stackName(o.stage);
  const out = stackOutputs(o);
  if (!out) { say(`No stack "${stack}" in account ${id.account} (${id.region}); nothing to remove.`); return; }
  say(`This deletes EVERYTHING for stage "${o.stage}" in account ${id.account} (${id.region}): the website, the API, and the table with all its demo data and feedback.`);
  await confirm(o, `Type the stage name (${o.stage}) to confirm:`, o.stage);
  step('Emptying the website bucket');
  aws(o, ['s3', 'rm', `s3://${out.SiteBucketName}`, '--recursive', '--only-show-errors']);
  step('Deleting the stack (CloudFront takes a few minutes)');
  aws(o, ['cloudformation', 'delete-stack', '--stack-name', stack]);
  aws(o, ['cloudformation', 'wait', 'stack-delete-complete', '--stack-name', stack]);
  if (o.deleteArtifacts) {
    step('Removing the package bucket');
    aws(o, ['s3', 'rb', `s3://${artifactBucketName(id.account, id.region)}`, '--force'], { okIf: /NoSuchBucket/ });
  }
  say('\n✔ Removed.');
}

// ---- main ----------------------------------------------------------------------------------------------

async function main() {
  const o = parseArgs(process.argv.slice(2));
  switch (o.command) {
    case 'help': say(HELP); break;
    case 'validate': { identify(o); validateTemplate(o); say('Template is valid.'); break; }
    case 'deploy': await deploy(o); break;
    case 'status': status(o); break;
    case 'warmup': await warmup(o); break;
    case 'destroy': await destroy(o); break;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`\n✖ ${e instanceof Error ? e.message : e}`); process.exit(1); });
}
