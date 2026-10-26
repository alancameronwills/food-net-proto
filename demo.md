# Demo guide: Bwyd Lleol Bro Teifi prototype

How to run a demo of the prototype for prospective **producers** and **buyers** (restaurants, hotels, caterers, shops).
It is written for a Zoom session where a few people role-play, but works in a room too.

> **What this prototype is for:** starting a conversation. Nothing is real: the organisations are fictional, no money
> moves, and the operating rules can be switched live so members can say which they prefer. Say this at the start.

## What works today

| Area | Status |
|---|---|
| Role picker, shareable role links, English/Welsh | Working |
| Producer: weekly stock & forecast editor, confidence levels, listings, prices, volume prices | Working |
| Buyer: local suppliers list with drive-distance rules and prices | Working |
| Operator: Model Lab (8 switchable rules), role links, reset | Working |
| Buyer: browse by delivery date, cart, placing orders, stock reducing on order | **Not built yet** (Phase 3–4) |
| Speculative orders and bids | **Not built yet** (Phase 5) |
| Delivery slots, hub view, guided scenarios, feedback box | **Not built yet** (Phase 6–7) |

Until ordering exists, tell the audience plainly: *"Ordering is the next piece. Today I'm showing you what producers
publish, what buyers will see, and the rules we want your opinion on."* Steps marked **(later)** below are for when
those features are built; skip them until then.

## Before the session (15 minutes)

1. **Start the app** (on this machine): Docker Desktop running, then
   `npm run db:up`, `npm run seed`, `npm run dev`. Open http://localhost:5173.
   (Once deployed to AWS, use the deployed address instead; open it a few minutes early so it is warm.)
2. **Pick a session name** for this demo, e.g. `demo-july`. Everything is private to that name, so you can run
   different demos side by side and reset one without affecting another. Open:
   `http://localhost:5173/lab?s=demo-july&as=operator` (the operator view, your control panel).
3. **Reset to fresh data:** in the operator view press **Reset demo data**.
4. **Line up your helpers** (optional but best): two or three colleagues, each playing one role, in their own browser.
   Copy their links from the operator view (**Role links for this session**) and send them privately. Suggested:
   - a buyer: **Grand Hotel** (Mwnt) or **Harbour Bistro** (Fishguard)
   - a producer: **Dyfed Dairy** (Cenarth), which has the most interesting stock
   - you: operator, sharing your screen
5. **Check** that each helper's link opens straight into their role, and that stock changes by one helper appear on
   another's screen within a few seconds. Zoom tip: use a large browser window, and share a single browser window
   rather than the whole screen.
6. Know where the reset and language buttons are (below).

If a role-player gets lost: **Switch role** (top right) returns to the picker. The **Cymraeg / English** button
switches language on any screen.

## The sequence

Total about 35 minutes plus discussion. The order is deliberate: start with the producer's world (supply is what
makes the network useful), then the buyer's view of it, then the rules.

### 1. Set the scene (3 min), operator screen

- Show the role picker (open `/?s=demo-july`): buyers, producers, operator. *"Today you'll see the network from each
  side. These are made-up businesses in the Teifi Valley."*
- Point out the header: the **session**, who you are playing, and the **Model** banner. *"The banner shows which
  rules are switched on. I'll change those during the demo."*
- Show the language button. Switch to Welsh and back. (The Welsh is machine-translated, so mention it needs review.)

### 2. A producer publishes supply (8 min), as **Dyfed Dairy**

Best for producers; buyers should watch this too, because it is where their information comes from.

1. Open the **Stock & forecast** tab. *"Each product has a row of weeks. This is the key idea: you tell the network
   what you have **now** and what you **expect later**."*
2. Explain the three **confidence** levels using the colours:
   - **In stock** (green): ready to supply.
   - **Forecast** (amber): expected, e.g. from cows or a harvest estimate. Buyers can order a share of it.
   - **Provisional** (grey): a plan only. Buyers can see it but not order it yet.
3. **Change a number live.** On whole milk, this week, type a new quantity and press Enter. Point at
   **"Buyers can order: N"** updating. *"That's what buyers will be able to order."*
4. **Change the confidence** of a week from Forecast to In stock; watch the orderable number jump. Change it back.
5. Click **+ Add** on an empty future week. *"A month ahead is exactly what a chef planning a menu wants to see."*
   Try **Add next 4 weeks** on another product.
6. Open **My listings**: price, minimum order. Add a product the dairy doesn't sell yet (e.g. lamb) with a price.
   Keep the producer's screen visible. You'll show it from the buyer's side next.

Ask the producers: *Is weekly the right level of detail? Would you update this yourselves, or want someone to do it
for you? How far ahead can you honestly forecast?*

### 3. A buyer sees local supply (6 min), as **Grand Hotel** (or Harbour Bistro)

1. Open the buyer's **Local suppliers near you** list. *"This is everyone nearby who sells what you want, with drive
   distance and price."* Point at the **Drive distance** and **Local limit** columns.
2. Show **the thing you just added**: the producer's new lamb listing is already in the buyer's list, without
   reloading. *"No phone calls. If a producer updates, you see it."*
3. Point out what is missing: *"Notice some milk isn't here. Milk is only 'local' within 20 km, because it needs
   frequent delivery. Cheese can come from 100 km."* Read the note under the table about hidden offers.
4. Back to the producer's screen: change a price and watch it change on the buyer's screen.

Ask the buyers: *Is a distance limit per product sensible? Is 20 km right for milk? What would you want to filter or
sort by that isn't here?*

### 4. Change the rules live (8 min), as the **operator**

This is the most valuable part for design feedback. Open **Model Lab**, keep the buyer's or producer's screen
visible (split the Zoom view, or have the helper narrate), change one switch at a time, and ask for reactions.

Suggested order (each one is visible now):

| Switch | What to do | What the audience sees | Ask |
|---|---|---|---|
| **Local range** | Per-product distance, then **Warn only**, then **Flat radius** (drag the slider) | Hidden items appear greyed with a warning, or the whole list changes with one radius | Should "local" be strict or advisory? |
| **Ordering forecast stock** | In stock only, then Fully orderable, then Up to a % (drag the % slider) | Producer's *"Buyers can order"* numbers change on forecast weeks | How much would you trust a forecast? |
| **Pricing** | Choose **Volume tiers**; as the producer, edit a listing and add a price break | The producer's edit form gains volume prices | Do bigger orders deserve a better price? |

The other switches (**Market structure**, **Operator role**, **Delivery**, **Stock reduction**, **Speculative orders**,
**Trust display**) are selectable and each has a one-line explanation. Read the explanations aloud and note which
options people like, but tell the audience their effect appears once ordering and delivery are built.

Between changes, say: *"None of this is final. You're helping decide how this works."*

### 5. Ordering and speculative orders **(later)**

Once Phases 3–5 are built, add these steps after step 3, then re-run step 4 to show how the same rules change
ordering:

- **Plan next week's menu:** the buyer picks a delivery date next week, sees in-stock and forecast items, orders.
  *Watch the producer's stock drop on their screen.*
- **Order something not yet available:** the hotel asks for a quantity of something in three weeks; two producers
  bid; the hotel accepts.
- **A short delivery:** the producer cuts a forecast and the affected buyer is told.

### 6. Close (5 min)

- Recap in a sentence per audience: *producers publish what they have and expect; buyers see it, plan around it and
  order; the operator tunes the rules.*
- Ask the closing questions below and write down the answers against the **current model settings** (take a
  screenshot of the Model Lab before you finish).
- Say what happens next, and how people can take part.

## Questions to put to the audience

**Producers**
- What do you sell, how often, and how far ahead can you say how much you'll have?
- Would you manage stock yourself in an app like this? On phone or computer?
- Who delivers today, and how far do you go? Would you share delivery runs with others?
- What would make you trust the orders enough to reduce your own stock for them?

**Buyers**
- How far ahead do you plan menus, and would you commit to orders that early?
- What's your main reason for not buying local today: price, availability, reliability, paperwork?
- Would you prefer one invoice and one delivery (a food hub) or separate dealings with each producer?
- What would you do if a producer let you down on a delivery?

## Resetting and running a second demo

- **Reset demo data** (operator view): restores the starting stock, listings and rules for that session.
- **New session:** change the `s=` name in the link (e.g. `demo-july-2`). It starts fresh with no setup.
- A mistake mid-demo: reset, or switch to a fresh session and carry on.

## If something goes wrong

| Symptom | Fix |
|---|---|
| Page shows "Something went wrong" or a blank list | Check the terminal running `npm run dev`; make sure Docker Desktop is running and `npm run db:up` has been run |
| Everything vanished after restarting Docker | The local database lives in memory. Run `npm run seed` |
| A helper's screen doesn't update | It refreshes every few seconds. Wait, or reload the page; their role link still works |
| Someone is in the wrong role | **Switch role** (top right), or send them the correct link |
| Wrong language | **Cymraeg / English** button |
| The numbers differ from this guide | The guide's examples come from the current sample data in `data/organisations.json`; if you have edited it, check which businesses and distances apply |

## Editing the fictional businesses

Names, towns, locations and what each producer sells are in `data/organisations.json` (see `data/README.md`). After
editing: `npm run check:data`, then `npm run reset` and press **Reset demo data**.

## Presenter's notes

- Keep it concrete: stay on named businesses ("Dyfed Dairy", "Grand Hotel") rather than "a producer".
- Let the audience drive the model switches: *"Which would you like to see?"*
- Don't promise features. Describe what's built, and say "next" for what isn't.
- Record decisions and objections, not just approval. The point of the session is learning what is wrong.
