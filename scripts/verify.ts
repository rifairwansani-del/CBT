import { initDatabase, seedInitialData } from '../server/db.ts';
import { runFunctionalTestSuite, run1300ParticipantBenchmark } from '../server/testSuite.ts';

async function main() {
  initDatabase();
  seedInitialData();

  console.log('=== PENGUJIAN FUNGSIONAL SINARCBT ===');
  const func = await runFunctionalTestSuite();
  for (const r of func.results) {
    console.log(`[${r.passed ? 'PASS' : 'FAIL'}] ${r.name} (${r.durationMs} ms) - ${r.detail}`);
  }
  console.log(`Ringkasan Fungsional: ${func.passed}/${func.total} lulus.\n`);

  console.log('=== UJI BEBAN 1.300 PESERTA SERENTAK ===');
  const load = run1300ParticipantBenchmark();
  for (const s of load.stages) {
    console.log(
      `${s.stage}: ops=${s.operations}, durasi=${s.durationMs}ms, throughput=${s.opsPerSecond} ops/s, p95=${s.p95LatencyMs}ms, gagal=${s.failures}, hilang=${s.answerLossCount}`
    );
  }
  console.log(`RSS Memori Server: ${load.memoryRssMb} MB`);
  console.log(`Status Kelayakan: ${load.passedCriteria ? 'LULUS' : 'GAGAL'}`);

  if (func.failed > 0 || !load.passedCriteria) {
    process.exit(1);
  }
}

main();
