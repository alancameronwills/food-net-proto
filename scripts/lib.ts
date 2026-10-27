// Small, pure helpers for the AWS scripts, kept apart from the commands so they can be tested.

export type Options = {
  command: 'deploy' | 'warmup' | 'status' | 'destroy' | 'validate' | 'help';
  stage: string;
  region?: string;
  profile?: string;
  yes: boolean;
  dryRun: boolean;
  skipChecks: boolean;
  budgetEmail: string;
  budgetUsd: number;
  warmSchedule: string;
  memory: number;
  concurrency: number;
  rounds: number;
  deleteArtifacts: boolean;
};

const COMMANDS = ['deploy', 'warmup', 'status', 'destroy', 'validate', 'help'] as const;
export const STAGE_RE = /^[a-z0-9-]{1,20}$/;

/** Parse `deploy --stage demo --yes` style arguments. Throws a plain-English error for anything it does not understand. */
export function parseArgs(argv: string[]): Options {
  const o: Options = {
    command: 'help', stage: 'demo', yes: false, dryRun: false, skipChecks: false, budgetEmail: '', budgetUsd: 10,
    warmSchedule: '', memory: 1024, concurrency: 6, rounds: 3, deleteArtifacts: false,
  };
  const args = [...argv];
  const first = args[0] && !args[0].startsWith('-') ? args.shift()! : 'help';
  if (!(COMMANDS as readonly string[]).includes(first)) throw new Error(`Unknown command "${first}". Use one of: ${COMMANDS.join(', ')}.`);
  o.command = first as Options['command'];

  const value = (flag: string): string => {
    const v = args.shift();
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value.`);
    return v;
  };
  const number = (flag: string, min: number, max: number): number => {
    const n = Number(value(flag));
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${flag} must be a whole number from ${min} to ${max}.`);
    return n;
  };
  while (args.length) {
    const flag = args.shift()!;
    switch (flag) {
      case '--stage': o.stage = value(flag); break;
      case '--region': o.region = value(flag); break;
      case '--profile': o.profile = value(flag); break;
      case '--yes': case '-y': o.yes = true; break;
      case '--dry-run': o.dryRun = true; break;
      case '--skip-checks': o.skipChecks = true; break;
      case '--budget-email': o.budgetEmail = value(flag); break;
      case '--budget-usd': o.budgetUsd = number(flag, 1, 100000); break;
      case '--warm-schedule': o.warmSchedule = value(flag); break;
      case '--memory': o.memory = number(flag, 512, 2048); break;
      case '--concurrency': o.concurrency = number(flag, 1, 50); break;
      case '--rounds': o.rounds = number(flag, 1, 20); break;
      case '--delete-artifacts': o.deleteArtifacts = true; break;
      default: throw new Error(`Unknown option "${flag}".`);
    }
  }
  if (!STAGE_RE.test(o.stage)) throw new Error('--stage must be 1 to 20 characters: lowercase letters, digits and hyphens.');
  if (o.budgetEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.budgetEmail)) throw new Error('--budget-email does not look like an email address.');
  if (![512, 1024, 1536, 2048].includes(o.memory)) throw new Error('--memory must be 512, 1024, 1536 or 2048.');
  return o;
}

export const stackName = (stage: string) => `bwyd-lleol-${stage}`;
export const artifactBucketName = (account: string, region: string) => `bwyd-lleol-artifacts-${account}-${region}`;
export const codeKey = (hash: string) => `lambda/${hash}.zip`;

/** Hashed build files never change, so browsers may keep them; the page that points at them must always be fetched fresh. */
export function cacheControlFor(key: string): string {
  return key.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
}

export const contentTypeFor = (key: string): string | undefined => ({
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json',
  svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon', txt: 'text/plain; charset=utf-8', map: 'application/json',
} as Record<string, string>)[key.split('.').pop()!.toLowerCase()];

/** The parameters passed to CloudFormation, as `Key=Value` strings. */
export function parameterOverrides(o: Options, bucket: string, key: string): string[] {
  return [
    `Stage=${o.stage}`, `CodeBucket=${bucket}`, `CodeKey=${key}`, `MemorySize=${o.memory}`,
    `BudgetEmail=${o.budgetEmail}`, `BudgetUsd=${o.budgetUsd}`, `WarmSchedule=${o.warmSchedule}`,
  ];
}

export function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const HELP = `Bwyd Lleol Bro Teifi: deploy to AWS

  npm run aws -- <command> [options]

Commands
  deploy     Check, build, and deploy (or update) the system. Shows what it will do and asks first.
  validate   Check the CloudFormation template with AWS (read-only).
  status     Show the address, the table and the function of a deployed stage (read-only).
  warmup     Wake the API before a demo so the first people to arrive are not kept waiting.
  destroy    Delete everything for a stage, including its data.

Options
  --stage <name>          Which copy to work on (default demo). Each stage is a separate stack, table and website.
  --region <region>       AWS region (default: your AWS CLI setting).
  --profile <profile>     AWS CLI profile (default: your AWS CLI setting).
  --yes                   Do not ask for confirmation.
  --dry-run               deploy: do everything except change anything in AWS.
  --skip-checks           deploy: skip the type check and tests.
  --budget-email <email>  deploy: warn this address when the account's monthly spend nears the budget.
  --budget-usd <n>        deploy: the monthly budget in US dollars (default 10).
  --warm-schedule <expr>  deploy: keep the API warm on a schedule, e.g. "rate(5 minutes)". Costs a little, all the time.
  --memory <MB>           deploy: API memory 512, 1024, 1536 or 2048 (default 1024).
  --concurrency <n>       warmup: how many requests at once (default 6). Roughly how many people to prepare for.
  --rounds <n>            warmup: how many rounds of requests (default 3).
  --delete-artifacts      destroy: also remove the bucket of uploaded packages.
`;
