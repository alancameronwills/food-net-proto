# Bwyd Lleol Bro Teifi: local food network prototype

A web prototype for bringing together buyers (restaurants, hotels, caterers, shops) and producers (farms, fishers,
bakers, butchers, dairies, packers) of local food in the Teifi Valley. It is built to be **demonstrated and discussed**:
the organisations are fictional, no money moves, and the operating rules can be switched live so prospective members
can help design the real thing.

See **[demo.md](demo.md)** for how to run a demo, and **[data/README.md](data/README.md)** for editing the fictional
businesses.

## What it does

- **Producers** publish what they have now and expect later (weekly stock with *in stock / forecast / provisional*
  confidence), manage listings and prices, answer orders, record picking and delivery, and bid on buyers' requests.
- **Buyers** browse the whole catalogue and choose the day they need things: what can be delivered in time, within each
  product's shelf life (set by the producer), is flagged, and the rest shows the nearest days that work. They plan menus
  weeks ahead, build a basket where every item has its own delivery day and its own note for the producer, watch stock
  fall as others order, and ask for things nobody has listed yet.
- **The operator** switches the operating model live (market structure, food hub or platform, delivery, when stock is
  reserved, how forecasts can be ordered, speculative-order style, pricing, "local" range, trust display), runs guided
  scenarios, sees every order, request and delivery run, and reads the feedback people leave.
- English and Welsh throughout (the Welsh is machine-translated and needs review).

## Run it on this machine

Needs Node 22+ and Docker (for DynamoDB Local).

    npm install
    npm run db:up        # DynamoDB Local in Docker (in memory: data is lost when the container stops)
    npm run seed         # load the starting data
    npm run dev          # API on :3001, web on http://localhost:5173

Then open `http://localhost:5173/lab?s=<session>&as=operator` (any session name; each is a separate, private dataset).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API (Hono, same code as the Lambda handler) and web (Vite) with hot reload |
| `npm test` | Unit and integration tests (Vitest; integration tests need `npm run db:up`) |
| `npm run test:e2e` | Browser tests (Playwright, desktop and tablet); needs `npm run db:up`; add `:ui` for the interactive runner |
| `npm run typecheck` | TypeScript check |
| `npm run check:data` | Validate `data/organisations.json` |
| `npm run reset` | Reload the starting data into the `default` session |
| `npm run build` | Build the web app into `dist/web` |
| `npm run aws -- help` | Put it on AWS, warm it up, check it, take it away (see DEPLOY.md) |

## How it is put together

    data/                 editable fictional businesses (organisations.json) and delivery areas (areas.json)
    src/shared/           rules shared by browser and server: models, orders, delivery, reliability, scenarios
    src/server/           Hono API; DynamoDB single-table store; stock reservation, orders, requests, events
    src/web/              React + Tailwind single-page app; role screens in pages/
    infra/                CloudFormation template for AWS
    scripts/              deploy, warm-up and destroy commands for AWS (see DEPLOY.md)
    tests/                Vitest unit and DynamoDB Local integration tests
    e2e/                  Playwright scenarios, including several people at once in separate browser contexts

- **Sessions:** every request carries a session id (`?s=`) and a role (`?as=`). A session is an isolated dataset, so
  several demos can run at once and reset independently. There are no passwords in demo mode.
- **Models are data, not forks:** each switch is an option in `src/shared/models.ts`; screens and server rules read
  capabilities from the active configuration, so everything adapts the moment the operator changes a switch.
- **Stock is never overwritten:** orders reserve quantity with conditional, transactional writes, so concurrent buyers
  cannot oversell (this is tested with simultaneous orders). Supply changes by producers cannot drop below what is reserved.
- **Live updates:** screens poll every few seconds (cheap on Lambda and robust on any network).

## Status

Built: producer stock and listings, buyer browse/basket/planner, order lifecycle with fulfilment and short deliveries,
reliability and trust display, supply-cut warnings with alternatives, notifications and activity feed, speculative
orders (open RFQ, first to accept, pooled demand), three delivery models with run sheets, guided scenarios, feedback
box, model presets, operator overview.

Not built yet:

- **Standing orders** (the forward-commitment market model).
- **Email notifications** (in-app only).
- **Anything beyond the prototype:** sign-in, a custom domain, email notifications.

Deploying to AWS (Lambda, DynamoDB on-demand, S3 + CloudFront, near-zero idle cost) is scripted: see **[DEPLOY.md](DEPLOY.md)**.
The script and template are written and checked, but no deployment has been made yet.
