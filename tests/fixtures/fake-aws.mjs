// A stand-in for the AWS CLI, used only by tests/deploy-flow.test.ts. It records every call and answers like AWS would,
// keeping a little state (does the stack exist, has the bucket been made...) in a file. It never touches the network.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const logFile = process.env.FAKE_AWS_LOG;
const stateFile = process.env.FAKE_AWS_STATE;
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { objects: [] };
const save = () => writeFileSync(stateFile, JSON.stringify(state));
appendFileSync(logFile, JSON.stringify(argv) + '\n');

const [service, op] = argv;
const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };
const out = (v) => { console.log(typeof v === 'string' ? v : JSON.stringify(v)); process.exit(0); };
const fail = (message, code = 254) => { console.error(message); process.exit(code); };
const failing = (what) => (process.env.FAKE_AWS_FAIL ?? '').split(',').includes(what);

if (service === 'sts') out({ Account: '111122223333', UserId: 'AIDATEST', Arn: 'arn:aws:iam::111122223333:user/test' });
if (service === 'configure') out('eu-west-2');

if (service === 'cloudformation') {
  if (op === 'validate-template') out({ Parameters: [] });
  if (op === 'describe-stacks') {
    if (!state.stack) fail(`An error occurred (ValidationError) when calling the DescribeStacks operation: Stack with id ${flag('--stack-name')} does not exist`, 255);
    out({ Stacks: [{ StackName: flag('--stack-name'), Outputs: [
      { OutputKey: 'SiteUrl', OutputValue: state.siteUrl }, { OutputKey: 'SiteBucketName', OutputValue: 'fake-site-bucket' },
      { OutputKey: 'DistributionId', OutputValue: 'EDIST123' }, { OutputKey: 'FunctionName', OutputValue: 'bwyd-lleol-test-api' },
      { OutputKey: 'TableName', OutputValue: 'bwyd-lleol-test' }, { OutputKey: 'ApiEndpoint', OutputValue: 'https://x.execute-api.eu-west-2.amazonaws.com' },
    ] }] });
  }
  if (op === 'deploy') {
    if (failing('deploy')) fail('Failed to create/update the stack. Run the following command to fetch the list of events leading up to the failure', 255);
    state.stack = true; state.siteUrl = process.env.FAKE_SITE_URL; save(); out('Successfully created/updated stack');
  }
  if (op === 'describe-stack-events') out({ StackEvents: [{ LogicalResourceId: 'Distribution', ResourceStatus: 'CREATE_FAILED', ResourceStatusReason: 'Fake: your account is not allowed to use CloudFront' }] });
  if (op === 'delete-stack') { state.stack = false; save(); out(''); }
  if (op === 'wait') out('');
}

if (service === 's3api') {
  if (op === 'head-bucket') { if (!state.bucket) fail('An error occurred (404) when calling the HeadBucket operation: Not Found'); out(''); }
  if (op === 'create-bucket') { state.bucket = true; save(); out({}); }
  if (op === 'head-object') { if (!state.objects.includes(flag('--key'))) fail('An error occurred (404) when calling the HeadObject operation: Not Found'); out({ ContentLength: 1 }); }
  out({});
}

if (service === 's3') {
  if (op === 'cp' && String(argv[3]).includes('lambda/')) { state.objects.push(argv[3].split('/').slice(3).join('/')); save(); }
  out('');
}

if (service === 'cloudfront') out({ Invalidation: { Id: 'I123' } });
if (service === 'lambda') out({ Runtime: 'nodejs22.x', Architectures: ['arm64'], MemorySize: 1024, LastModified: '2026-10-27T10:00:00.000+0000' });
if (service === 'dynamodb') out({ Table: { ItemCount: 42, TableSizeBytes: 2048, BillingModeSummary: { BillingMode: 'PAY_PER_REQUEST' } } });

fail(`fake-aws: unexpected call ${argv.join(' ')}`, 99);
