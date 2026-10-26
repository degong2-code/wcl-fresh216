/**
 * Offline exact boss-DPS witness validator.
 * Port of the old wcl35Roster_ / wcl35Recover_ invariants, not a LIVE API client.
 * The report ranking data shape is not frozen by WCL; real parity remains unproved.
 */
const num = (v) => {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  if (typeof v === 'string' && !v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const same = (a,b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const actorRef = (r) => {
  const rawId = r?.id;
  const id = (typeof rawId === 'number' || typeof rawId === 'string') ? Number(rawId) : NaN;
  if (Number.isSafeInteger(id) && id > 0) return 'id:' + id;
  const name = String(r?.name ?? '').trim().toLowerCase();
  return name && name !== 'anonymous' ? 'name:' + name : null;
};
const witnessRoster = (ranking, slot) => {
  if (!Array.isArray(ranking?.data)) return null;
  const fights = ranking.data.filter(f => Number(f?.fightID) === slot.fightId);
  if (fights.length !== 1) return null;
  const f = fights[0];
  if (Number(f?.encounter?.id) !== slot.encounterId ||
      Number(f?.difficulty) !== slot.difficulty) return null;
  const characters = f?.roles?.dps?.characters;
  return Array.isArray(characters) ? characters : null;
};

/**
 * Exact same-fight proof only, never a score interpolation.
 * @param {object} slot raw top-100 ranking slot (amount, class/spec, fight)
 * @param {object} report {overall:{data:[...]},boss:{data:[...]}}
 * @returns {null|{bossDps:number,actorRef:string,proofType:string}}
 */
export function resolveExactBossDps(slot, report) {
  if (!slot || !report || !Number.isInteger(slot.fightId) ||
      !Number.isInteger(slot.encounterId) || !Number.isInteger(slot.difficulty) ||
      slot.fightId <= 0 || slot.encounterId <= 0 || slot.difficulty <= 0)
    return null;
  const total = num(slot.totalDps);
  if (!(total > 0)) return null;
  const all = witnessRoster(report.overall, slot);
  const boss = witnessRoster(report.boss, slot);
  if (!all || !boss) return null;
  const candidates = all.filter(a => {
    const aDps = num(a?.amount);
    return aDps !== null && Math.abs(aDps - total) <= 0.005;
  });
  if (candidates.length !== 1) return null;
  const candidate = candidates[0];
  if (!same(candidate.class, slot.className) || !same(candidate.spec,slot.specName)) return null;
  const knownName = String(slot.name || '').trim().toLowerCase();
  if (knownName && knownName !== 'anonymous' && !same(knownName,candidate.name)) return null;

  const ref = actorRef(candidate);
  if (!ref || all.filter(a => actorRef(a) === ref).length !== 1) return null;
  const matchingBoss = boss.filter(b => actorRef(b) === ref);
  if (matchingBoss.length !== 1) return null;
  if (!same(matchingBoss[0].class,slot.className) ||
      !same(matchingBoss[0].spec,slot.specName)) return null;
  const bossDps = num(matchingBoss[0].amount);
  if (bossDps === null || bossDps < 0 || bossDps > total) return null;
  return { bossDps, actorRef:ref, proofType:'EXACT_SAME_FIGHT_ACTOR' };
}
