/**
 * Conservative offline alternative to legacy wcl35Direct_ for future integration.
 * No WCL/Google access, no persistence, and NO name-only actor attribution.
 * The existing GAS wcl35Identity_ is deliberately not changed: the G4.13
 * report-fight candidate planner still needs names to find recoverable fights.
 *
 * Direct evidence: SAME report, fight, and positive actor ID in the SAME
 * ranking schema, with a one-to-one key in BOTH overall and boss snapshots.
 * Absent/ambiguous ID => null; let same-fight report roster prove it instead.
 * ID namespace parity in real WCL snapshots must be checked before deployment.
 */
const numeric = value => {
  if (value === null || value === undefined || value === '' ||
      typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const positiveId = value => {
  const n = numeric(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const fight = row => {
  if (!row || typeof row !== 'object') return null;
  const nested = row.report && typeof row.report === 'object' ? row.report : {};
  const code = nested.code || row.reportID || row.reportCode;
  const id = numeric(nested.fightID || nested.fightId || row.fightID || row.fightId);
  if (typeof code !== 'string' || !code || code.length > 128 ||
      !/^[\x21-\x7e]+$/.test(code) ||
      /^(anonymous|private|redacted|hidden|masked|unknown|null|none|unlisted)$/i.test(code) ||
      !Number.isSafeInteger(id) || id <= 0 || id > 1e9) return null;
  return {code,id};
};
const actor = row => {
  // Same field precedence as installed legacy source; reject invalid IDs.
  const raw = row?.characterID || row?.characterId || row?.actorID || row?.actorId;
  return positiveId(raw);
};
const key = row => {
  const f = fight(row),id = actor(row);
  return f && id ? JSON.stringify([f.code,f.id,id]) : null;
};

export function resolveConservativeDirect(overall,boss) {
  if (!Array.isArray(overall) || !Array.isArray(boss))
    throw Error('DIRECT_RANKING_SHAPE');
  const matched = Array(overall.length).fill(null);
  const calibrators = [];
  const left = new Map(),right = new Map();
  for (const row of overall) {
    const k=key(row);
    if (k) left.set(k,(left.get(k)||0)+1);
  }
  for (const row of boss) {
    const k=key(row);
    if (k) {
      const list=right.get(k)||[];
      list.push(row);right.set(k,list);
    }
  }
  for (let i=0;i<overall.length;i++) {
    const row=overall[i],k=key(row),candidate=k?right.get(k):null;
    if (!k || left.get(k)!==1 || !candidate || candidate.length!==1) continue;
    const d=numeric(row.amount),b=numeric(candidate[0].amount);
    if (d===null || d<=0 || b===null || b<0 || b>d+0.005) continue;
    const name=String(row.name||'').trim().toLowerCase();
    const other=String(candidate[0].name||'').trim().toLowerCase();
    if (name && name!=='anonymous' && other && other!=='anonymous' && name!==other) continue;
    matched[i]=b;
    calibrators.push({row,boss:b});
  }
  return {matched,calibrators};
}

/**
 * Minimal legacy-compatible guard: reject a direct shortcut when its key is
 * not unique on EITHER metric. Unique name-only matches are retained, so
 * this is NOT independent canonical actor proof. It only prevents the
 * demonstrated duplicate-name double-attribution failure.
 */
const legacyKey = row => {
  const f=fight(row);
  if(!f)return null;
  const id=actor(row);
  if(id)return JSON.stringify([f.code,f.id,'id',id]);
  const name=String(row.name||'').trim().toLowerCase();
  return name&&name!=='anonymous'?JSON.stringify([f.code,f.id,'name',name]):null;
};
export function resolveCollisionGuardedDirect(overall,boss){
  if(!Array.isArray(overall)||!Array.isArray(boss))throw Error('DIRECT_RANKING_SHAPE');
  const left=new Map(),right=new Map();
  for(const row of overall){
    const k=legacyKey(row);
    if(k)left.set(k,(left.get(k)||0)+1);
  }
  for(const row of boss){
    const k=legacyKey(row);
    if(k){const list=right.get(k)||[];list.push(row);right.set(k,list);}
  }
  const matched=Array(overall.length).fill(null),calibrators=[];
  for(let i=0;i<overall.length;i++){
    const row=overall[i],k=legacyKey(row),cand=k?right.get(k):null;
    if(!k||left.get(k)!==1||!cand||cand.length!==1)continue;
    const d=numeric(row.amount),b=numeric(cand[0].amount);
    if(d===null||d<=0||b===null||b<0||b>d+.005)continue;
    matched[i]=b;calibrators.push({row,boss:b});
  }
  return {matched,calibrators};
}
