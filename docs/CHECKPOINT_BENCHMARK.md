# Fresh216 — full-scope checkpoint I/O decision (2026-10-27)

**Decision: RETAIN existing single-file `JsonCheckpointStore`.**
No active journal/partial-write store, no dependency, no new operational
checkpoint format. Candidate source and tests were removed from the active
experiment branch after being measured; the exploration remains in Git history.

## Exact measurement scope

- One selected difficulty: **216 jobs × 100 slots = 21,600 ranked references**.
- Artificial overlap: 27 spec references per Fight, **800 invented Fights**.
  This is NOT a measurement of overlap in real WCL rank snapshots.
- One Fight has two durable transitions: `beginFetch` / `completeFetch`.
- At each stage (0 / 400 / 797 invented groups completed) the checkpoint
  was synthetically preseeded; three operations of each kind were measured
  on one GitHub Actions host; medians are displayed below.
- Completed proofs, identifiers, amounts and the point marker **are all
  synthetic**. No token, WCL request, Sheet write or real actor provenance.
- The journal comparison starts each stage from a preseeded base and does
  **NOT** model cold replay of 1,600 sequential journal events or compaction.
- This is a decision aid about data persistence overhead, NOT full collector
  wall time, REAL API points, target-host disk performance, or proof of a
  speedup.

### Paired CI-host result (begin + complete median, milliseconds)

| Progress | Uncached full JSON (original) | Full JSON with in-memory cache | Append-only journal candidate |
| --- | ---: | ---: | ---: |
| 0% | 283.32 | 253.21 | 367.09 |
| 50% | 560.10 | 488.88 | 661.91 |
| ~99.6% | 711.80 | 708.18 | 1045.12 |

Near-full checkpoint payload was approximately 13.23 MB. For a new
process, read/rebuild latencies at this stage were approximately
39.58 ms (original JSON), 213.16 ms (cached JSON candidate), and
223.20 ms (journal candidate). The cached variant's apparently faster
mid-run operations did **not** yield a meaningful end-stage win.

**Verified source:** GitHub Actions offline comparison
https://github.com/degong2-code/wcl-fresh216/actions/runs/40448902838
after correcting an unrelated benchmark string-escape error.
The immediately preceding initial full-JSON probe is
https://github.com/degong2-code/wcl-fresh216/actions/runs/40447796354.
Results can vary by runner load and storage conditions; three samples
per stage are insufficient for a deployment-performance guarantee.

## Decision rationale

1. **Journal candidate LOST** in all three measured progress states,
   largely because discovering record differences still serialized and
   cloned large in-memory state. Changing storage without addressing the
   transition API cost only added complexity.
2. **Cached full JSON showed negligible end-stage benefit** (712 vs
   708 ms for both transitions combined) and slower cold reads.
3. Neither new candidate had a convincing speed/complexity tradeoff.
   Revert the cache optimization and remove journal prototype from the
   active branch. Keep the original atomic rename, 0600 private files,
   exclusive lock, fail-closed recovery and full-state per-operation
   durability contract.
4. A full run may have **more or fewer than 800 unique Fights**, so
   multiplying these test latencies into a real run-time forecast would be
   misleading. We have not measured WCL wait time or report query cost in a
   real 216-job run.
5. Revisit checkpoint storage **only after actual selected-scope Fight
   overlap and full-run wall time** show that filesystem overhead, rather
   than WCL API point/rate waits, is the high-value bottleneck.
   If revisited, improve the state-diff/transition API first, rather than
   committing to another journal or database based on intuition.

## Reproduction

The intentionally small offline script remains available:

```bash
node tools/benchmark-checkpoint.mjs --samples=3
```

It creates only synthetic data in a temporary directory, verifies
readback, and removes the directory on exit. It is **not in recurring CI**;
running this benchmark after every source edit would spend CI minutes
without changing the actual collector decision.

**Next roadmap focus:** capture decision-grade real same-fight
`rankings()` vs `table()` equivalence and observed points
(only after explicit permission), then complete one lean single-owner
Node.js execution host plus verified Sheets read/write adapter.
