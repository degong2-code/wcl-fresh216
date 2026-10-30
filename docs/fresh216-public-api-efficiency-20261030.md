# WCL public Actions execution + real API cost pilot — 2026-10-30

## Outcome and privacy boundary

- **Public Actions works**, while `degong2-code/ai-project-lab` remains **PRIVATE** and unchanged by these experiments. Public test branch: `work/public-runner-effexp-20261030`.
- [Hosted runner smoke #41064802204](https://github.com/degong2-code/wcl-fresh216/actions/runs/41064802204) PASS, no checkout, secret or WCL requests.
- [API pilot offline preflight #41065252065](https://github.com/degong2-code/wcl-fresh216/actions/runs/41065252065) PASS, no WCL requests.
- [Actual public-report pilot #41065573888](https://github.com/degong2-code/wcl-fresh216/actions/runs/41065573888) PASS, independently reaudited in [#41066002474](https://github.com/degong2-code/wcl-fresh216/actions/runs/41066002474).
- [Whole-report pilot #41066399637](https://github.com/degong2-code/wcl-fresh216/actions/runs/41066399637) SUCCESS, independently reaudited in [#41066747786](https://github.com/degong2-code/wcl-fresh216/actions/runs/41066747786).
- Publicly shared forum report `https://www.warcraftlogs.com/reports/wyCNP6db8FrxG7gk?fight=50`, **LFR fight** (difficulty 1), encounter 3129, 64 report fights total. Not from the user's private source. Public WCL client-credentials Secrets supplied through Actions environment only; no tokens or raw actor details committed. Saved only request hashes, response hashes, costs, aggregate shapes, safety receipt, and public report URL.
- **No private source A, B, C, archived raw checkpoint, or Google Sheets writes were used.** No public workflow was granted access to the private repository.

## Observed real API point costs (same one public fight)

| Official GraphQL method | WCL observed points | Outcome |
|---|---:|---|
| Report identity and fights metadata | 1 | 64 fights; fight 50 valid |
| `rankings(fightIDs:[50],playerMetric:dps)` + `rankings(...,bossdps)` | **4** | 17 DPS actor rows for each metric |
| `rankings(fightIDs:[50],playerMetric:bossdps)` only | **2** | 17 DPS actor rows |
| `table(dataType:DamageDone,fightIDs:[50],viewBy:Source)` only | **1** | Valid; top-level `data` object, but **not proven numerically equivalent to official BossDPS**, and not yet tested with NPC boss-target filtering |
| **First pilot total** | **8** | All four valid, no unknown-cost requests |
| Whole-report `rankings(dps)` + `rankings(bossdps)` with no fightIDs | **36** | Returned 9 ranked fight records/metric, 164 summed DPS actor records/metric, including fight 50 |
| **Total measured WCL spend** | **44** | 8+36; zero new WCL calls during independent audits |

**Important negative result:** Whole report requested in one GraphQL HTTP call still charged **36pt** for 9 fight ranking records, equal to **9 × 4pt** at the single fight's two-metric cost. This measured sample provides no API point saving from report-wide aggregation. HTTP call reduction is not the same as point reduction.

**Safety stop:** Second whole-report comparison against a scoped fight was **not run** because the initial unscoped query charged **36pt**, exceeding its expected 16pt per-query guard. Original workflow summary incorrectly printed `observedPoints:0` due to post-guard aggregation, but the immutable `0.done.json` response receipt shows **36pt**, independently verified in #41066747786. Source code was corrected for future runs without retrying the paid query. Do NOT claim that whole-report and scoped raw character DPS were proven byte-identical.

## What this proves — and does not

- Public GitHub Actions can run official WCL client-credential API cost probes even while private repository Actions are billing-blocked.
- Boss-only Report rankings costs half of two-metric rankings in this measured sample (2pt vs 4pt); may be advantageous only when the correct actor identity and TotalDPS witness are **already independently available**.
- DamageDone table was cheaper (1pt), but **its output is a table, not official `bossdps`**. Target/source filters, fight duration, pet aggregation, ranking conventions, and numeric parity require explicit exact-actor validation before replacing the current official metric.
- Report-wide rankings did not reduce point costs in this sample.
- **These are public LFR observations, NOT yet a cost/accuracy proof for current heroic A top100 source slots.** Public report probe had no A snapshot and consequently recovered 0 new user C proofs. Do not apply its 44pt to private project's C counts.
- No BossDPS ranking page 11 test was performed. That test requires private A coverage comparison; do not publish A slots, private report IDs or actor rosters in this public branch.

## Safe follow-up

Use this public repo only for publicly sourced cost/shape experiments and reviewed source code. Keep all privately sourced rank/actor witnesses and C validation inside `degong2-code/ai-project-lab` or on a trusted private local runner. To compare exact C/pt with public API test responses, use a carefully designed private read-only evaluation step; never copy raw private checkpoints into public Git objects or public Actions logs/artifacts. Next possible microprobe: demonstrate whether `table(DamageDone)` with exact boss-target filtering computes a value identical to official `rankings(bossdps)` across several public fights, before considering it for the 216-job production pipeline.
