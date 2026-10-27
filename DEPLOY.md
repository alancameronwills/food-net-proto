# Putting the prototype on AWS

One command builds the system and puts it on the internet at a CloudFront address, with the API on Lambda and the data
in DynamoDB. Everything is pay-per-use, so a copy that nobody is using costs pennies a month.

    npm run aws -- deploy --dry-run                       # look, change nothing
    npm run aws -- deploy --budget-email you@example.com  # do it (asks first)
    npm run aws -- warmup                                 # shortly before a demo
    npm run aws -- status                                 # what is deployed
    npm run aws -- destroy                                # remove it all, data included

`npm run aws -- help` lists every option. Developing locally is unchanged (see README.md); AWS is only for sharing
the prototype, for example for a Zoom session where members open it on their own devices.

## Before the first time

1. **The AWS CLI**, signed in to the account you want to use: `aws sts get-caller-identity` should show it.
   The region comes from your CLI setting (`aws configure get region`); override with `--region`, and use `--profile`
   if you keep several.
2. **Permission to create the pieces.** The user running this needs to be able to create and delete: CloudFormation
   stacks, IAM roles (the API's own role), Lambda functions, API Gateway, DynamoDB tables, CloudFront distributions,
   functions and origin access controls, S3 buckets, CloudWatch log groups, and (only if you ask for them) EventBridge
   rules and Budgets. An administrator or "PowerUser plus IAM" user has all of this.
3. **Node 22 and Docker** as for local work. The deploy runs the type check and the unit and integration tests first;
   the integration tests are skipped, with a note, if the local test database (`npm run db:up`) is not running.

## What a deploy does

1. Type check and tests (skip with `--skip-checks`), then builds the web app and the API.
   The API is bundled into one 600 KB file (193 KB zipped), which keeps start-up quick.
2. Has AWS check the template (read-only), then **lists what it will create and asks for a yes**.
3. Uploads the API package to a small bucket it creates for the purpose (old packages expire after 30 days).
4. Creates or updates the stack. **The first time takes 5 to 10 minutes, nearly all of it CloudFront.** Later updates
   take a minute or two.
5. Publishes the web app (the hashed files first, `index.html` last, so nobody sees a half-published site) and tells
   CloudFront to forget the old copy.
6. Checks it from the outside: the page, an app route, the API, the database (by seeding a session called
   `deploy-check`), and that API errors stay API errors. It retries for a minute because a new address takes a moment to settle.
7. Prints the address and the operator link.

If anything fails, nothing is left half-way that a re-run will not fix: CloudFormation rolls a failed stack back,
and the script prints the reason AWS gave.

## What it creates (17 resources)

| | |
|---|---|
| **DynamoDB table** `bwyd-lleol-<stage>` | On-demand: no charge when idle. Holds every session. |
| **Lambda function** `bwyd-lleol-<stage>-api` | Node 22 on arm64, 1 GB. Runs the same code as `npm run dev`. Its role can use only this table. |
| **API Gateway HTTP API** | Sends every request to the function. **Throttled at 150 requests a second** (about 50 people at once, each open screen making about two a second), which also caps the worst-case bill. |
| **S3 bucket** (private) | The web app. Readable only through CloudFront. |
| **CloudFront** | One address for everything: the web app, and `/api/*` going to the API (never cached). A small function serves the app for routes like `/lab`. Cheapest price class. |
| Log group | 14 days of API logs. |
| *Optional* budget alert | `--budget-email you@example.com` warns at 80% of `--budget-usd` (default $10) a month, and when the forecast passes 100%. |
| *Optional* keep-warm schedule | `--warm-schedule "rate(5 minutes)"` keeps the API ready all the time, for a small standing cost. Not needed if you run `warmup` before a session. |

### Stages

`--stage` names a separate copy: its own table, API, bucket and address. Use `demo` for the real thing and, say,
`trial` for experiments. They do not share anything.

## Using it

- **Address:** printed at the end, and by `status`. It looks like `https://d1234abcd.cloudfront.net`.
- **Operator link:** `<address>/lab?s=<session>&as=operator`. Pick any session name; everything is private to it.
  Role links for the helpers are on the Model Lab page, as before.
- **Before a demo:** `npm run aws -- warmup` a few minutes ahead. A request that arrives while none is ready makes
  Lambda start a fresh copy (about a second); `warmup` makes that happen in advance, `--concurrency` copies at once.
  Set `--concurrency` to roughly how many people will arrive together. Copies stay ready through a few minutes of quiet,
  so run it again if there is a long gap.
- **Updating:** change the code, run `deploy` again. The data stays; the sessions people left are still there.
  Older sessions upgrade themselves in place when next used.
- **Taking it away:** `npm run aws -- destroy` (you type the stage name to confirm). It deletes the table, so
  **demo data and feedback are lost**: download feedback as CSV from the Feedback tab first. Add `--delete-artifacts`
  to remove the package bucket too.

## Costs

Rough, for the default setup after any free allowances:

- **Nobody using it:** pennies a month (S3 storage, the tiny package bucket). No Lambda, API or CloudFront charges, and
  DynamoDB on-demand charges nothing for an idle table.
- **A busy session:** each open screen asks for fresh data every few seconds. Twenty people for an hour is roughly
  150,000 API requests: well under a dollar in total across API Gateway, Lambda, DynamoDB and CloudFront.
- **Worst case:** the throttle limits it to 150 requests a second, so even a runaway loop costs a few dollars an hour.
  Set `--budget-email` so you hear about it anyway.

## Things to know

- **There is no sign-in.** Anyone with the address can use it, and the operator view can reset a session. That suits a
  prototype shared with invited members; it is not for the open internet. If the address gets out, `destroy` and
  redeploy gives a new one. A password or IP restriction on CloudFront is the next step if you need one.
- **The address is CloudFront's own** (`*.cloudfront.net`). A custom domain needs a certificate and a DNS record; not included.
- **New AWS accounts may have a low Lambda concurrency limit** (as low as 10 running at once). Check
  Service Quotas > Lambda > "Concurrent executions". Ten is plenty for a dozen people; for 50, ask AWS to raise it.
- **Region:** it deploys to your CLI's region (`eu-west-2`, London, here). Everything for one stage is in that region;
  only CloudFront is global.
- **Data does not expire.** Demo sessions stay in the table until `destroy`. They are tiny.

## What has and has not been tested

Checked without creating anything in AWS:

- AWS itself accepts the template (`validate`).
- The packaged API is run by itself in a fresh Node, as Lambda loads it, using the exact request shape API Gateway
  sends, against the test database: health, sessions, a request with a body and custom headers, errors, a whole order, and
  the keep-warm event.
- The permissions in the template are compared with every database call the code makes, so a future change that needs
  a new permission fails the tests instead of failing in the cloud.
- The template is checked for what matters: pay-per-use data, private bucket, the API never cached, no blanket "not found
  becomes the home page" (which would turn real API errors into the app page), nothing set to be kept after `destroy`.
- `deploy --dry-run` runs the whole build and the checks, and stops before changing AWS.

**Not yet tried:** an actual deploy. The first one may hit something only AWS can tell us, such as a permission your user
lacks. The script prints the reason AWS gives, and a failed first stack deletes itself on rollback; re-running after
fixing the cause is safe. The smoke checks at the end will tell you at once whether the deployed system works.
