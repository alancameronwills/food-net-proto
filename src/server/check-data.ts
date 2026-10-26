import { ORGS, LISTINGS } from './seed';

// Importing seed.ts validates data/organisations.json (it throws with a readable list of problems).
const n = (role: string) => ORGS.filter((o) => o.role === role).length;
console.log(`OK: ${n('buyer')} buyers, ${n('producer')} producers, 1 operator, ${LISTINGS.length} listings.`);
