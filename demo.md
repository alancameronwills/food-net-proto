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
| Buyer: browse by delivery date, basket, placing orders, cancelling, menu planner | Working |
| Producer: order inbox (confirm, decline with a reason, mark picked, record delivery incl. short deliveries) | Working |
| Stock reducing when orders are placed or confirmed, live on every screen | Working |
| Buyer warned and offered alternatives when a producer cuts supply they have already ordered | Working |
| Reliability scores and "verified member" badges | Working |
| Speculative orders: buyers ask for something not yet listed; producers bid (or accept a price); three models | Working |
| Notifications (bell) and a network-wide activity feed | Working |
| Operator: Model Lab (8 switchable rules), orders & metrics overview, role links, reset | Working |
| Standing orders (forward-commitment model) | **Not built yet** |
| Delivery slots, area delivery days, hub courier runs | **Not built yet** (the Delivery switch is selectable but has no effect yet) |
| Guided scenario scripts, in-app feedback box, email notifications | **Not built yet** |

Say plainly what isn't there yet: *"Regular standing orders and the detail of delivery runs are the next pieces."*

## Before the session (15 minutes)

1. **Start the app** (on this machine): Docker Desktop running, then
   `npm run db:up`, `npm run seed`, `npm run dev`. Open http://localhost:5173.
   (Once deployed to AWS, use the deployed address instead; open it a few minutes early so it is warm.)
2. **Pick a session name** for this demo, e.g. `demo-july`. Everything is private to that name, so you can run
   different demos side by side and reset one without affecting another. Open:
   `http://localhost:5173/lab?s=demo-july&as=operator` (the operator view, your control panel).
3. **Reset to fresh data:** in the operator view press **Reset demo data**. This also clears all orders, requests and notifications.
4. **Line up your helpers** (optional but best): two or three colleagues, each playing one role, in their own browser.
   Copy their links from the operator view (**Role links for this session**) and send them privately. Suggested:
   - a buyer: **Corner Deli** (Newport); a second buyer, **Grand Hotel** (Mwnt), is useful for the "two people, one stock" moment
   - a producer: **Dyfed Dairy** (Cenarth), which has the most interesting stock
   - a second producer: **Brynberian Market Garden** (tomatoes, for the request demo)
   - you: operator, sharing your screen
5. **Check** that each helper's link opens straight into their role, and that changes by one helper appear on
   another's screen within a few seconds. Zoom tip: use a large browser window, and share a single browser window
   rather than the whole screen.
6. Tell everyone about the **bell** (their own notifications) and the **Network activity** button (what is happening
   anywhere in the session). On Zoom, the activity feed is how the audience follows actions on other people's screens.

If a role-player gets lost: **Switch role** (top right) returns to the picker. The **Cymraeg / English** button
switches language on any screen.

## The sequence

About 55 minutes plus discussion; a **30-minute version** is marked below (sections 2, 3 and 5 only). The order is
deliberate: start with the producer's world (supply is what makes the network useful), then the buyer's view and
ordering, then the delivery, then asking for things nobody lists yet, then the rules.

### 1. Set the scene (3 min), operator screen

- Show the role picker (open `/?s=demo-july`): buyers, producers, operator. *"Today you'll see the network from each
  side. These are made-up businesses in the Teifi Valley."*
- Point out the header: the **session**, who you are playing, and the **Model** banner. *"The banner shows which
  rules are switched on. I'll change those during the demo."*
- Show the language button. Switch to Welsh and back. (The Welsh is machine-translated, so mention it needs review.)

### 2. A producer publishes supply (7 min), as **Dyfed Dairy** *(30-minute version)*

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
5. Click **+ Add** on an empty future week, or **Add next 4 weeks**. *"A month ahead is exactly what a chef planning a
   menu wants to see."*
6. Open **My listings**: price, minimum order. Add a product the dairy doesn't sell yet (e.g. lamb) with a price.

Ask the producers: *Is weekly the right level of detail? Would you update this yourselves, or want someone to do it
for you? How far ahead can you honestly forecast?*

### 3. A buyer plans and orders (10 min), as **Corner Deli** *(30-minute version)*

1. **Menu planner tab.** *"This is a chef planning a month ahead."* Each row is a product, each column a week; green is
   in stock, amber is forecast, grey is only planned. Star a few **usual items** and tick **Only my usual items**.
2. **Click an amber (forecast) cell** a couple of weeks out. It jumps to Browse for a delivery date in that week.
   *"I can order something that isn't picked yet. The producer sees a commitment, I get certainty."*
3. **Browse tab.** Point at the **delivery date**, the drive distance and **reliability score** next to each producer,
   and the **availability** badge. Switch to an unavailable product and read why (*"Not delivered on this day"*,
   *"Needs more notice"*). Cheese is delivered on Wednesdays only, so on a Thursday it shows as not deliverable.
4. **Add items from two producers** (e.g. milk from Dyfed Dairy and lamb from Teifi Butchers) to the basket. Point at
   the total and the line *"2 separate invoices, 2 separate deliveries"*.
5. **Place the order.** The buyer gets an order reference for each producer, and each producer's **bell** lights up.
6. **Switch to Dyfed Dairy's screen**: the **Orders** tab shows a new order needing an answer. Press **Confirm**.
   Now go to **Stock & forecast**: that week shows *"N reserved"* and *"Buyers can order"* has dropped.
   *"Advertised stock reduces automatically when the order is confirmed."*
7. **Back to the buyer**: **My orders** now shows **Confirmed** and *"Stock reserved"*. Ask the second buyer to
   try to order the last few units: their basket line turns red (*"Sold out"* / *"Only N available"*) without reloading.
8. Show **Decline** (with a reason) and a buyer **Cancel**: the stock comes back.

Ask the buyers: *Is a distance limit per product sensible? Is a delivery date per basket right, or would you want
different days per item? What would you want to filter or sort by that isn't here?*

### 4. Delivery, and when things go wrong (8 min)

1. As Dyfed Dairy, on a confirmed order press **Mark picked**; the buyer's order moves to **Picked**.
2. Press **Mark delivered**. Change one quantity to **less than ordered** and record it. The order becomes
   **Delivered short**: the buyer sees the crossed-out quantity and the lower total. *"The buyer pays for what arrived."*
   (For the demo, deliveries can be recorded at any time.)
3. Show the producer's **reliability score** on the buyer's Browse screen, and how it moved. Do a couple of poor
   deliveries and watch it fall. *"This is how trust is built without anyone writing a review."*
4. **Supply cut:** with two buyers holding orders for a forecast week, as the producer change that week to
   **Provisional**. The producer is warned (*"2 order(s) no longer fit"*); each buyer sees a flag on the order with
   **alternatives from other producers**, **Keep this order** or **Cancel order**. Change the week back and the flags clear.

Ask both sides: *Who should carry the cost of a short delivery? How much notice should a producer give before cutting a forecast?*

### 5. Ask for something not yet available (10 min) *(30-minute version)*

This is the feature the network is built around: buyers can plan, and producers can respond to demand.

1. As **Corner Deli**, open **Ask for something**. Request **40 kg of Heritage tomatoes** in three weeks, with a price you'd
   pay (say £6.50/kg) and a note (*"For the tasting menu"*). *"I'm asking for something nobody has listed for that date."*
2. Point at the form's hint if the product is already on sale: *"If it's available now, it tells me, and links to Browse."*
3. Switch to **Brynberian Market Garden** (and **Preseli Hill Farm** if you have a helper): the **Demand board** tab
   shows the request, and their bell has a notification. Each **bids** a price and quantity with a message. Point out
   that bids are **sealed**: a producer sees only how many bids there are, not what others offered.
4. Back as the buyer: the bids appear with **drive distance, reliability and note**. Compare, then **Accept bid**.
   *"Accepting creates a confirmed order, and the producer's supply for that week grows by exactly what they promised."*
   Preseli Hill Farm has never sold tomatoes: its **My listings** now has them.
5. Accept a smaller bid first, then a second: two producers can **fill one request together**. The other bids show
   *"Not chosen"* once it is full, and those producers are told.
6. Show **Withdraw request** and its effect on producers' boards.

Then, in **Model Lab**, change **Speculative orders** and repeat step 1 each time:

| Model | What changes | Ask |
|---|---|---|
| **Open RFQ** | Producers bid, the buyer chooses | Is a price-comparison between local producers what you want? |
| **First to accept** | The buyer must name a price; no bidding; the first producer to press *Accept at £X for all N* wins, the others are told it has gone | Is speed or price more important? Would you trust a price set by one side? |
| **Pooled demand** | Several buyers asking for the same thing in the same week are merged; one producer bid is shared across them, and each buyer accepts for themselves | Would you want to club together with other buyers? |

### 6. Change the other rules live (8 min), as the **operator**

Open **Model Lab**, keep a buyer's and a producer's screen visible (split the Zoom view, or have the helpers narrate),
change one switch at a time, and ask for reactions.

| Switch | What to do | What the audience sees | Ask |
|---|---|---|---|
| **Stock reduction** | *On confirmation* → *On placement* → *Soft hold* | Place an order each time: with *On placement* it is accepted instantly and stock drops at once; with *Soft hold* stock is held but the producer can still decline | When should a producer's stock be committed? Do producers want to approve every order? |
| **Operator role** | *Pure platform* → *Food hub* | Basket and orders say *"One invoice from the network"* and *"One consolidated delivery"* | Would you pay one invoice and receive one delivery? |
| **Ordering forecast stock** | *In stock only*, *Fully orderable*, *Up to a %* (drag the slider) | Forecast weeks become unavailable, fully available, or capped, on both buyer and producer screens | How much would you trust a forecast? |
| **Local range** | *Per-product distance*, *Warn only*, *Flat radius* (drag the slider) | Far-away offers hide, appear with a warning, or the whole list changes with one radius | Should "local" be strict or advisory? |
| **Pricing** | *Volume tiers*; as the producer add a price break to a listing | Buyers see *"50+ at £0.80"* and the basket price drops when the quantity passes the break | Do bigger orders deserve a better price? |
| **Trust display** | *Reliability score*, *Verified badges*, *Hidden* | The chip beside every producer changes | Do you want to see scores, or just know someone is vetted? |

**Market structure** *(forward commitment)* and **Delivery** are selectable and each has a one-line explanation. Read
the explanations aloud and note which options people like, but tell the audience their effect appears once those
features are built.

Also show the **Orders & metrics** tab: every order and request in the session, local spend and fill rate.

Between changes, say: *"None of this is final. You're helping decide how this works."*

### 7. Close (5 min)

- Recap in a sentence per audience: *producers publish what they have and expect; buyers see it, plan around it, order
  and ask for what is missing; the operator tunes the rules.*
- Ask the closing questions below and write down the answers against the **current model settings** (take a
  screenshot of the Model Lab before you finish).
- Say what happens next, and how people can take part.

## Questions to put to the audience

**Producers**
- What do you sell, how often, and how far ahead can you say how much you'll have?
- Would you manage stock yourself in an app like this? On phone or computer?
- Would you accept every order automatically, or want to approve each one?
- Would you bid for a buyer's request? Do you want to see what rivals offered?
- Who delivers today, and how far do you go? Would you share delivery runs with others?

**Buyers**
- How far ahead do you plan menus, and would you commit to orders that early?
- What's your main reason for not buying local today: price, availability, reliability, paperwork?
- Would you ask producers for things they don't list yet? Would you name your price?
- Would you prefer one invoice and one delivery (a food hub) or separate dealings with each producer?
- What would you do if a producer let you down on a delivery?

## Resetting and running a second demo

- **Reset demo data** (operator view): restores the starting stock, listings and rules, and clears all orders, requests and notifications.
- **New session:** change the `s=` name in the link (e.g. `demo-july-2`). It starts fresh with no setup.
- A mistake mid-demo: reset, or switch to a fresh session and carry on.
- A buyer's basket is remembered in their browser. After a reset, remove old lines or use **Remove**.

## If something goes wrong

| Symptom | Fix |
|---|---|
| Page shows "Something went wrong" or a blank list | Check the terminal running `npm run dev`; make sure Docker Desktop is running and `npm run db:up` has been run |
| Everything vanished after restarting Docker | The local database lives in memory. Run `npm run seed` |
| A helper's screen doesn't update | It refreshes every few seconds. Wait, or reload the page; their role link still works |
| Someone is in the wrong role | **Switch role** (top right), or send them the correct link |
| Wrong language | **Cymraeg / English** button |
| A product says "Not delivered on this day" | Each category has delivery days (cheese Wednesday; most others Tue/Thu/Fri/Sat). Change the delivery date |
| A request is refused ("not delivered on that day", "notice") | The same delivery-day and notice rules apply; pick another date |
| Bidding is missing | You are on *First to accept*: producers accept the buyer's price instead of bidding |
| "Reset" did not clear a buyer's basket | The basket is kept in that browser; remove the lines or clear it |
| The numbers differ from this guide | The examples come from the current sample data in `data/organisations.json`; if you have edited it, check which businesses and distances apply |

## Editing the fictional businesses

Names, towns, locations, what each producer sells, and their past delivery record are in `data/organisations.json`
(see `data/README.md`). After editing: `npm run check:data`, then `npm run reset` and press **Reset demo data**.

## Presenter's notes

- Keep it concrete: stay on named businesses ("Dyfed Dairy", "Corner Deli") rather than "a producer".
- Let the audience drive the model switches: *"Which would you like to see?"*
- Don't promise features. Describe what's built, and say "next" for what isn't.
- Record decisions and objections, not just approval. The point of the session is learning what is wrong.
