// Offline-only repository validation. No external requests or dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const fail = (message) => { console.error('FAIL: ' + message); process.exitCode = 1; };
const manifest = JSON.parse(fs.readFileSync('migration/source-manifest.json', 'utf8'));
const git = spawnSync('git', ['ls-files', '-z'], {encoding: 'utf8'});
if (git.status !== 0) fail('Unable to enumerate tracked files');
const files = (git.stdout || '').split('\0').filter(Boolean);
const forbidden = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)\.clasp(?:rc)?\.json$/i,
  /(^|\/)(credentials|token)\.json$/i,
  /(^|\/)(private|raw|proof|checkpoints)\//i,
  /\.(zip|sqlite|db|xlsx|xls|ods|csv)$/i,
  /\.checkpoint\.json$/i
];
for (const file of files) {
  if (forbidden.some(re => re.test(file))) fail('Forbidden tracked filename: ' + file);
  if (file.endsWith('.gs') || file.endsWith('.js') || file.endsWith('.mjs')) {
    try { new vm.Script(fs.readFileSync(file, 'utf8'), {filename:file}); }
    catch (e) {
      // ESM scripts are parsed separately by node --check; vm.Script expects classic scripts.
      if (file.endsWith('.mjs')) {
        const run = spawnSync('node', ['--check', file], {encoding:'utf8'});
        if (run.status !== 0) fail('Syntax error: ' + file);
      } else fail('Syntax error: ' + file);
    }
  }
}
// New architecture prototype is intentionally independent of legacy installed source.
for (const file of ['tests/fetch-plan.test.mjs', 'tests/resolve-proof.test.mjs', 'tests/masked-report-crosswalk.test.mjs', 'tests/fresh216-public-pilot-livewire.test.mjs', 'tests/fresh216-actor-proof-archive.test.mjs', 'tests/fresh216-archive-to-c.test.mjs', 'tests/fresh216-public-actor-proof-store.test.mjs', 'tests/legacy-proof-parity.test.mjs', 'tests/job-kpis.test.mjs', 'tests/evidence-join.test.mjs', 'tests/checkpoint.test.mjs', 'tests/wcl-rankings-envelope.test.mjs', 'tests/legacy-proof-audit.test.mjs', 'tests/approved-ranking-depth-trial.test.mjs', 'tests/approved-ranking-depth-date1000.test.mjs', 'tests/approved-ranking-depth-date1000-latest-partition.test.mjs', 'tests/approved-completion-depth-trial.test.mjs', 'tests/boss-page-recovery.test.mjs', 'tests/legacy-direct-match.test.mjs', 'tests/private-audit-cli.test.mjs', 'tests/uy-batch-plan.test.mjs', 'tests/full-scope-plan.test.mjs', 'tests/adaptive-depth-plan.test.mjs', 'tests/single-fight-runner.test.mjs', 'tests/report-wave-runner.test.mjs', 'tests/fresh216-wave-evidence.test.mjs', 'tests/fresh216-evidence-publisher.test.mjs', 'tests/rank-batch-runner.test.mjs', 'tests/adaptive-collector-runner.test.mjs', 'tests/g3-snapshot-adapter.test.mjs', 'tests/fresh-cohort-source.test.mjs', 'tests/fresh-boss-first-page.test.mjs', 'tests/fresh-dps-output-contract.test.mjs', 'tests/fresh-boss-wave-journal.test.mjs', 'tests/fresh-dps-pipeline.test.mjs', 'tests/fresh-c-recovery-economics.test.mjs', 'tests/fresh-c-uy-priority.test.mjs', 'tests/fresh-boss-depth300.test.mjs', 'tests/fresh-boss-depth500.test.mjs', 'tests/private-fresh-cohort-host.test.mjs', 'tests/private-github-source.test.mjs', 'tests/fresh-cohort-actions-pilot.test.mjs', 'tests/request-admission.test.mjs', 'tests/wcl-query-comparison.test.mjs', 'tests/private-two-query-probe.test.mjs', 'tests/private-two-query-cli.test.mjs', 'tests/actions-wcl-two-query-probe.test.mjs', 'tests/actions-workflow-policy.test.mjs', 'tests/fresh-two-query-probe.test.mjs', 'tests/fresh-actions-wcl-two-query-probe.test.mjs', 'tests/approved-wcl-relay.test.mjs', 'tests/fresh-actor-namespace-diagnostic.test.mjs', 'tests/fresh-one-query-identity.test.mjs', 'tests/fresh-typed-roster-crosswalk.test.mjs', 'tests/fresh-typed-roster-one-shot.test.mjs']) {
  if (!fs.existsSync(file)) { fail('Missing expected pure-core test: ' + file); continue; }
  const run = spawnSync('node', ['--test', file],
    {encoding:'utf8', timeout:30000, maxBuffer:1024*1024});
  if (run.status !== 0) {
    fail('Pure-core offline test failed: ' + file);
    process.stderr.write((run.stderr || '') + (run.stdout || '').slice(-4000));
  } else console.log('PASS pure-core offline suite: ' + file);
}


const privateXlsxTest = spawnSync('python3',['-m','unittest','-v',
  'tests/private_sheet_audit_test.py'],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
if(privateXlsxTest.status!==0){
  fail('Offline private spreadsheet extraction regression failed');
  process.stderr.write((privateXlsxTest.stderr||'').slice(-4000));
}else console.log('PASS private XLSX extraction (stdlib, synthetic workbook only)');

const sourceExportAudit = spawnSync('python3',['-m','unittest','-v',
  'tests/test_source_export_audit.py'],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
if(sourceExportAudit.status!==0){
  fail('Offline read-only installed source export fingerprint tests failed');
  process.stderr.write((sourceExportAudit.stderr||sourceExportAudit.stdout||'').slice(-4000));
}else console.log('PASS source export fingerprint verifier (stdlib, synthetic sources only)');

if (manifest.source_imported) {
  for (const file of manifest.expected_tests_when_imported) {
    if (!fs.existsSync(file)) { fail('Missing required imported test: ' + file); continue; }
    const run = spawnSync('node', [file], {encoding:'utf8', timeout:60000, maxBuffer: 1024*1024});
    if (run.status !== 0) {
      fail('Test failed: ' + file);
      process.stderr.write((run.stderr || run.stdout || '').slice(-2000));
    } else console.log('PASS imported offline test: ' + file);
  }
} else {
  if (files.some(file => file.endsWith('.gs') && !file.startsWith('candidates/'))) fail('Operational Apps Script source present while source_imported=false');
  console.log('BOOTSTRAP ONLY: real Apps Script source not imported; 75 historical tests were NOT run by this CI');
}
if (manifest.production_ready && !manifest.installed_source_verified) fail('Production release cannot be declared without installed source parity');
if (process.exitCode !== 1) console.log('PASS bootstrap repository hygiene (not a collector verification)');
