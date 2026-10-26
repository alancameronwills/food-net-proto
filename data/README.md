# Role-play organisations

`organisations.json` is the list of fictional buyers, producers and the operator shown in the role picker.
Edit it in any text editor, then run:

    npm run check:data      # validates the file and says exactly what is wrong
    npm run reset           # reloads it into the local demo session (restart the API if it is running)

Each entry:

| field | notes |
|---|---|
| `id` | unique; lowercase letters, digits, hyphens. Used in role links (`?as=<id>`) |
| `role` | `buyer`, `producer` or `operator` (exactly one operator) |
| `name`, `kind`, `town` | shown on cards. `kind` e.g. restaurant, hotel, retailer, caterer, farm, fisher, butcher, baker, dairy, packer |
| `lat`, `lon` | location; drive distances to everyone else are calculated from these (straight line x 1.35) |
| `blurb` | `{ "en": "...", "cy": "..." }`; `cy` is optional and falls back to English |
| `certifications` | producers only, optional, e.g. `["organic"]` |
| `offers` | producers only: `{ "product": "<product id>", "price": 1.50, "minOrder": 5 }` |

Product ids you can offer: milk-whole, milk-semi, cream-double, eggs-free, bread-sour, bara-brith, veg-leek,
veg-potato, veg-carrot, veg-tomato, veg-kale, meat-lamb, meat-beef, meat-sausage, fish-crab, fish-lobster,
fish-bass, fish-mackerel, cheese-cheddar, cheese-blue. (Products live in `src/server/seed.ts`.)

Personas appear in the app after the session is reset; the operator's "Reset demo data" button also reloads the file
(on a deployed copy, after redeploying).
