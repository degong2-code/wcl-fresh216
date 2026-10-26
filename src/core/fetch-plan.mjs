/**
 * Non-operational global fetch planner. Zero network, Sheets or credential access.
 * Group a SINGLE in-memory scope's pending exact rank slots by the same report/fight.
 * Returned groups are query candidates, NEVER DPS proofs or WCL cost estimates.
 */
const requireTrue = (condition, code) => { if (!condition) throw new Error(code); };
const nonempty = (s) => typeof s === "string" && s.length > 0 && s.length <= 256;
const positiveInt = (n) => Number.isSafeInteger(n) && n > 0;

function validateSlot(s) {
  requireTrue(s && typeof s === "object" && !Array.isArray(s), "SLOT_SHAPE");
  requireTrue(nonempty(s.scopeKey) && nonempty(s.jobKey), "SLOT_SCOPE");
  requireTrue(Number.isInteger(s.rank) && s.rank >= 1 && s.rank <= 100, "RANK_INVALID");
  requireTrue(/^[a-f0-9]{64}$/i.test(s.snapshotSha || ""), "SNAPSHOT_SHA_MISSING");
  requireTrue(["PENDING", "VERIFIED"].includes(s.status), "SLOT_STATUS");
  requireTrue(nonempty(s.className) && nonempty(s.specName), "SPEC_MISSING");
  requireTrue(Number.isFinite(s.totalDps) && s.totalDps > 0, "TOTAL_DPS_INVALID");
  requireTrue(nonempty(s.reportCode) && /^[\x21-\x7E]+$/.test(s.reportCode), "REPORT_CODE_INVALID");
  requireTrue(positiveInt(s.fightId) && positiveInt(s.encounterId), "FIGHT_MISSING");
  requireTrue(Number.isInteger(s.difficulty) && s.difficulty > 0, "DIFFICULTY_MISSING");
  requireTrue(s.reportRevision == null || positiveInt(s.reportRevision), "REVISION_INVALID");
}

/**
 * @param {object[]} slots - Each slot has explicit rank, job, immutable snapshot,
 *   same-fight candidate, class/spec, and VERIFIED or PENDING status.
 * @returns {{groups:object[], inputSlotCount:number, pendingSlotCount:number,
 *            verifiedSkipped:number, distinctFightRequests:number, reusedReferences:number}}
 */
export function planFightFetches(slots) {
  requireTrue(Array.isArray(slots), "INPUT_NOT_ARRAY");
  const seenSlots = new Set(), jobSnapshots = new Map(), groups = new Map();
  let pending = 0, verifiedSkipped = 0;

  for (const s of slots) {
    validateSlot(s);
    const slotKey = JSON.stringify([s.scopeKey, s.jobKey, s.rank]);
    requireTrue(!seenSlots.has(slotKey), "DUPLICATE_RANK_SLOT");
    seenSlots.add(slotKey);

    const jobScope = JSON.stringify([s.scopeKey, s.jobKey]);
    const previous = jobSnapshots.get(jobScope);
    requireTrue(!previous || previous === s.snapshotSha, "JOB_SNAPSHOT_DRIFT");
    jobSnapshots.set(jobScope, s.snapshotSha);

    if (s.status === "VERIFIED") {
      verifiedSkipped++;
      continue;
    }
    pending++;

    // Do not merge different fight IDs or report revisions (known G4.20 limitation).
    // If revision is unknown, reuse is only within this in-memory plan.
    const groupKey = JSON.stringify([
      s.scopeKey, s.reportCode, s.fightId, s.encounterId,
      s.difficulty, s.reportRevision ?? null
    ]);
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        scopeKey: s.scopeKey,
        reportCode: s.reportCode,
        fightId: s.fightId,
        encounterId: s.encounterId,
        difficulty: s.difficulty,
        reportRevision: s.reportRevision ?? null,
        durableReuseAllowed: s.reportRevision != null,
        slots: []
      });
    }
    // Provenance stays attached to each slot; a group is not an actor match.
    groups.get(groupKey).slots.push({
      jobKey: s.jobKey, rank: s.rank, snapshotSha: s.snapshotSha,
      totalDps: s.totalDps, className: s.className, specName: s.specName
    });
  }

  const result = [...groups.entries()]
    .sort((a, b) => b[1].slots.length - a[1].slots.length || a[0].localeCompare(b[0]))
    .map(([_, group]) => ({
      ...group,
      slots: group.slots.slice().sort((a, b) =>
        a.jobKey.localeCompare(b.jobKey) || a.rank - b.rank)
    }));
  return {
    groups: result,
    inputSlotCount: slots.length,
    pendingSlotCount: pending,
    verifiedSkipped,
    distinctFightRequests: result.length,
    reusedReferences: pending - result.length
  };
}
