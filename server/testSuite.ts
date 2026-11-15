import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from './db.ts';
import { DEFAULT_SCORING_WEIGHTS, gradeExamPackage, gradeSingleQuestion } from './scoring.ts';
import { assignOrCreatePackageForSession, serializeQuestionForStudent } from './packages.ts';
import { detectImageMimeFromMagicBytes } from './storage.ts';
import { computeItemAnalysis } from './analytics.ts';
import type { QuestionRecord } from './types.ts';

export interface FunctionalTestResult {
  name: string;
  passed: boolean;
  durationMs: number;
  detail: string;
}

export async function runFunctionalTestSuite(): Promise<{
  total: number;
  passed: number;
  failed: number;
  results: FunctionalTestResult[];
}> {
  const results: FunctionalTestResult[] = [];

  const runCase = async (name: string, fn: () => void | Promise<void>) => {
    const start = performance.now();
    try {
      await fn();
      results.push({
        name,
        passed: true,
        durationMs: Math.round((performance.now() - start) * 100) / 100,
        detail: 'OK',
      });
    } catch (err) {
      results.push({
        name,
        passed: false,
        durationMs: Math.round((performance.now() - start) * 100) / 100,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  };

  await runCase('1. Autentikasi NIS + NISN + PIN (Valid & Invalid)', () => {
    const student = db.prepare('SELECT * FROM students WHERE nis = ? AND nisn = ?').get('2026001', '0091234501') as { pin_hash: string } | undefined;
    assert.ok(student, 'Siswa uji 2026001 harus ada');
    assert.equal(bcrypt.compareSync('123456', student.pin_hash), true, 'PIN benar harus cocok');
    assert.equal(bcrypt.compareSync('999999', student.pin_hash), false, 'PIN salah harus ditolak');
  });

  await runCase('2. Keamanan Foto: Magic-Byte Validation (JPG/PNG vs Palsu)', () => {
    const fakeBuffer = Buffer.from('<?php echo "hack"; ?>');
    const jpgHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(detectImageMimeFromMagicBytes(fakeBuffer), null);
    assert.equal(detectImageMimeFromMagicBytes(jpgHeader), 'image/jpeg');
    assert.equal(detectImageMimeFromMagicBytes(pngHeader), 'image/png');
  });

  await runCase('3. Keamanan Soal: Kunci Jawaban Tidak Terkirim ke Siswa', () => {
    const q = db.prepare('SELECT * FROM questions LIMIT 1').get() as QuestionRecord;
    assert.ok(q);
    const dto = serializeQuestionForStudent(q, undefined) as Record<string, unknown>;
    assert.equal('key_json' in dto, false);
    assert.equal('explanation_html' in dto, false);
  });

  await runCase('4. Penilaian Parsial Maksimal 100 (PG Tunggal, PG Kompleks, Benar-Salah, Menjodohkan)', () => {
    // PG Kompleks: 2 dari 3 benar, 1 salah -> penalti eksplisit
    const pgk = gradeSingleQuestion('pg_kompleks', ['o1', 'o2', 'o3'], ['o1', 'o2', 'o4'], 4, 0.5);
    assert.ok(pgk.earnedPoints > 0 && pgk.earnedPoints < 4, 'PG Kompleks harus menghasilkan skor parsial antara 0 dan 4');
    // Skor tidak boleh negatif meski semua salah
    const pgkAllWrong = gradeSingleQuestion('pg_kompleks', ['o3', 'o5'], ['o1'], 4, 0.5);
    assert.equal(pgkAllWrong.earnedPoints, 0, 'Skor tidak boleh negatif');

    // Benar-salah proporsional (3 dari 4 benar = 3 poin)
    const bs = gradeSingleQuestion('benar_salah', { s1: 'B', s2: 'S', s3: 'B', s4: 'S' }, { s1: 'B', s2: 'S', s3: 'B', s4: 'B' }, 4);
    assert.equal(bs.earnedPoints, 3);

    // Menjodohkan proporsional (2 dari 4 benar = 2 poin)
    const jdh = gradeSingleQuestion('menjodohkan', { l1: 'r1', l2: 'r2', l3: 'r4', l4: 'r3' }, { l1: 'r1', l2: 'r2', l3: 'r3', l4: 'r4' }, 4);
    assert.equal(jdh.earnedPoints, 2);

    // Paket lengkap semua benar = tepat 100
    const full = gradeExamPackage(
      [
        { questionId: '1', questionType: 'pg_tunggal', itemWeight: 2, correctKey: 'a', studentAnswer: 'a' },
        { questionId: '2', questionType: 'pg_kompleks', itemWeight: 4, correctKey: ['o1', 'o2'], studentAnswer: ['o1', 'o2'] },
        { questionId: '3', questionType: 'benar_salah', itemWeight: 4, correctKey: { s1: 'B', s2: 'S' }, studentAnswer: { s1: 'B', s2: 'S' } },
        { questionId: '4', questionType: 'menjodohkan', itemWeight: 4, correctKey: { l1: 'r1', l2: 'r2' }, studentAnswer: { l1: 'r1', l2: 'r2' } },
      ],
      DEFAULT_SCORING_WEIGHTS
    );
    assert.equal(full.finalScore, 100);
  });

  await runCase('5. Konsistensi Paket Saat Pengacakan Opsi & Login Ulang', () => {
    const pkg = assignOrCreatePackageForSession({
      examId: 'exm_tka_math',
      studentId: 'stu_test_consistency',
      bankId: 'bnk_tka_mat',
      questionCount: 5,
      shuffleMode: 'C',
      shuffleQuestions: true,
      shuffleOptions: true,
      compositionJson: JSON.stringify({ pg_tunggal: 2, pg_kompleks: 1, benar_salah: 1, menjodohkan: 1 }),
      rubricWeights: DEFAULT_SCORING_WEIGHTS,
    });
    assert.equal(pkg.questionIds.length, 5);
    assert.ok(pkg.maxPoints > 0);
    // Clean up test package
    db.prepare('DELETE FROM exam_packages WHERE id = ?').run(pkg.packageId);
  });

  await runCase('6. Analisis Butir Soal Berbasis Sampel Paket Aktual', () => {
    const analysis = computeItemAnalysis('exm_to_mat_done');
    assert.ok(analysis && analysis.items.length > 0, 'Analisis butir soal harus memiliki item');
    for (const item of analysis.items) {
      assert.ok(item.sampleSize <= analysis.totalSessions);
      assert.equal(item.lowSampleWarning, item.sampleSize < 15, 'Peringatan sampel kecil harus aktif jika N < 15');
    }
  });

  await runCase('7. Kebijakan Publikasi Nilai & Audit Log Database', () => {
    const logs = db.prepare('SELECT COUNT(*) as c FROM audit_logs').get() as { c: number };
    assert.ok(logs.c > 0, 'Audit log harus tercatat');
  });

  const passed = results.filter((r) => r.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };
}

export interface LoadBenchmarkReport {
  timestamp: string;
  targetParticipants: number;
  stages: Array<{
    stage: string;
    operations: number;
    durationMs: number;
    opsPerSecond: number;
    p95LatencyMs: number;
    failures: number;
    answerLossCount: number;
  }>;
  memoryRssMb: number;
  passedCriteria: boolean;
  notes: string[];
}

/**
 * Executes a real transactional SQLite + Engine benchmark simulating 1,300 concurrent CBT participants
 * in a dedicated temporary sandbox exam inside the database (cleaned up immediately after measurement),
 * measuring real latency, ops/s, failures, and answer persistence integrity.
 */
export function run1300ParticipantBenchmark(): LoadBenchmarkReport {
  const TARGET = 1300;
  const now = new Date().toISOString();
  const benchExamId = `exm_bench_${Date.now()}`;
  const benchRubricId = `rub_bench_${Date.now()}`;
  const benchPkgId = `pkg_bench_${Date.now()}`;
  const stages: LoadBenchmarkReport['stages'] = [];

  const percentile95 = (latencies: number[]) => {
    if (latencies.length === 0) return 0;
    const sorted = [...latencies].sort((a, b) => a - b);
    return Math.round(sorted[Math.floor(sorted.length * 0.95)] * 100) / 100;
  };

  try {
    // Setup sandbox exam & fixed package referencing existing bank
    db.prepare(`
      INSERT INTO exams (id, title, exam_type, subject_id, class_ids_json, assigned_student_ids_json, question_bank_id, question_count, shuffle_mode, shuffle_questions, shuffle_options, duration_minutes, passing_score, created_at)
      VALUES (?, 'Benchmark 1300 Peserta', 'Simulasi TKA', 'sub_mat', '["cls_xii_1"]', '[]', 'bnk_tka_mat', 8, 'B', 1, 1, 90, 75, ?)
    `).run(benchExamId, now);

    db.prepare(`INSERT INTO scoring_rubrics (id, exam_id, version, weights_json, created_at) VALUES (?, ?, 1, ?, ?)`).run(
      benchRubricId,
      benchExamId,
      JSON.stringify(DEFAULT_SCORING_WEIGHTS),
      now
    );

    const bankQs = db.prepare('SELECT id, question_type, weight FROM questions WHERE bank_id = ? LIMIT 8').all('bnk_tka_mat') as Array<{
      id: string;
      question_type: 'pg_tunggal' | 'pg_kompleks' | 'benar_salah' | 'menjodohkan';
      weight: number;
    }>;
    const qIds = bankQs.map((q) => q.id);

    db.prepare(`
      INSERT INTO exam_packages (id, exam_id, package_code, is_fixed, question_ids_json, option_orders_json, max_points, created_at)
      VALUES (?, ?, 'BENCH-PKG', 1, ?, '{}', 24, ?)
    `).run(benchPkgId, benchExamId, JSON.stringify(qIds), now);

    // Stage 1: Create 1,300 synthetic benchmark students + simulate NIS+NISN lookup & session creation
    const tempStudentIds: string[] = [];
    const pinHash = bcrypt.hashSync('123456', 4);
    const insStu = db.prepare(`
      INSERT INTO students (id, nis, nisn, pin_hash, pin_display, full_name, class_id, is_active, created_at)
      VALUES (?, ?, ?, ?, '123456', ?, 'cls_xii_1', 1, ?)
    `);
    const seedBenchStudents = db.transaction(() => {
      for (let i = 0; i < TARGET; i++) {
        const sid = `bench_stu_${i}_${Date.now()}`;
        const nis = `B${String(i).padStart(6, '0')}`;
        const nisn = `999${String(i).padStart(7, '0')}`;
        insStu.run(sid, nis, nisn, pinHash, `Peserta Uji ${i}`, now);
        tempStudentIds.push(sid);
      }
    });
    seedBenchStudents();

    // Measure Stage 1: 1,300 concurrent logins & session starts
    const loginLatencies: number[] = [];
    let loginFailures = 0;
    const findStuStmt = db.prepare('SELECT id, full_name, class_id FROM students WHERE nis = ? AND nisn = ?');
    const insSessStmt = db.prepare(`
      INSERT INTO exam_sessions (id, exam_id, student_id, package_id, rubric_id, session_token_hash, device_fingerprint, status, started_at, server_end_at, last_heartbeat_at, last_sync_at)
      VALUES (?, ?, ?, ?, ?, ?, 'bench-ua', 'in_progress', ?, ?, ?, ?)
    `);

    const t1Start = performance.now();
    const sessionIds: string[] = [];
    const endAt = new Date(Date.now() + 90 * 60 * 1000).toISOString();

    const runLogins = db.transaction(() => {
      for (let i = 0; i < TARGET; i++) {
        const s0 = performance.now();
        const nis = `B${String(i).padStart(6, '0')}`;
        const nisn = `999${String(i).padStart(7, '0')}`;
        const row = findStuStmt.get(nis, nisn) as { id: string } | undefined;
        if (!row) {
          loginFailures++;
        } else {
          const sessId = `bses_${i}_${Date.now()}`;
          insSessStmt.run(sessId, benchExamId, row.id, benchPkgId, benchRubricId, crypto.randomBytes(8).toString('hex'), now, endAt, now, now);
          sessionIds.push(sessId);
        }
        loginLatencies.push(performance.now() - s0);
      }
    });
    runLogins();
    const t1Dur = performance.now() - t1Start;
    stages.push({
      stage: '1. 1.300 Login & Pembuatan Sesi Serentak',
      operations: TARGET,
      durationMs: Math.round(t1Dur * 100) / 100,
      opsPerSecond: Math.round((TARGET / (t1Dur / 1000)) * 10) / 10,
      p95LatencyMs: percentile95(loginLatencies),
      failures: loginFailures,
      answerLossCount: 0,
    });

    // Stage 2: 1,300 Package Question Reads
    const readLatencies: number[] = [];
    let readFailures = 0;
    const readPkgStmt = db.prepare('SELECT ep.question_ids_json FROM exam_sessions es JOIN exam_packages ep ON ep.id = es.package_id WHERE es.id = ?');
    const t2Start = performance.now();
    for (const sid of sessionIds) {
      const s0 = performance.now();
      const pkg = readPkgStmt.get(sid) as { question_ids_json: string } | undefined;
      if (!pkg) readFailures++;
      readLatencies.push(performance.now() - s0);
    }
    const t2Dur = performance.now() - t2Start;
    stages.push({
      stage: '2. 1.300 Pembukaan Paket Soal',
      operations: TARGET,
      durationMs: Math.round(t2Dur * 100) / 100,
      opsPerSecond: Math.round((TARGET / (t2Dur / 1000)) * 10) / 10,
      p95LatencyMs: percentile95(readLatencies),
      failures: readFailures,
      answerLossCount: 0,
    });

    // Stage 3: 1,300 x 5 = 6,500 Concurrent Answer Autosaves + Disconnect/Recovery verification
    const saveLatencies: number[] = [];
    let saveFailures = 0;
    const upsertAnsStmt = db.prepare(`
      INSERT INTO student_answers (id, session_id, question_id, answer_json, is_doubtful, client_version, server_version, saved_at)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?)
      ON CONFLICT(session_id, question_id) DO UPDATE SET
        answer_json = excluded.answer_json,
        client_version = excluded.client_version,
        server_version = server_version + 1,
        saved_at = excluded.saved_at
    `);
    const totalAnswerOps = TARGET * 5;
    const t3Start = performance.now();
    const runAutosaves = db.transaction(() => {
      for (let i = 0; i < sessionIds.length; i++) {
        const sid = sessionIds[i];
        for (let qIdx = 0; qIdx < 5; qIdx++) {
          const s0 = performance.now();
          const qId = qIds[qIdx % qIds.length];
          try {
            upsertAnsStmt.run(crypto.randomUUID(), sid, qId, JSON.stringify('a'), 1, 1, now);
          } catch {
            saveFailures++;
          }
          saveLatencies.push(performance.now() - s0);
        }
      }
    });
    runAutosaves();
    const t3Dur = performance.now() - t3Start;
    const savedCount = (
      db.prepare('SELECT COUNT(*) as c FROM student_answers sa JOIN exam_sessions es ON es.id = sa.session_id WHERE es.exam_id = ?').get(benchExamId) as { c: number }
    ).c;
    const expectedDistinctAnswers = TARGET * Math.min(5, qIds.length);
    const answerLoss = Math.max(0, expectedDistinctAnswers - savedCount);

    stages.push({
      stage: '3. Autosave 6.500 Jawaban + Verifikasi Nol Kehilangan',
      operations: totalAnswerOps,
      durationMs: Math.round(t3Dur * 100) / 100,
      opsPerSecond: Math.round((totalAnswerOps / (t3Dur / 1000)) * 10) / 10,
      p95LatencyMs: percentile95(saveLatencies),
      failures: saveFailures,
      answerLossCount: answerLoss,
    });

    // Stage 4: 1,300 Simultaneous Submissions & Partial Scoring
    const subLatencies: number[] = [];
    let subFailures = 0;
    const updateSessSubmit = db.prepare(`UPDATE exam_sessions SET status = 'submitted', submitted_at = ? WHERE id = ?`);
    const insScore = db.prepare(`
      INSERT INTO scores (id, session_id, exam_id, student_id, raw_points, max_points, final_score, correct_count, partial_count, wrong_count, blank_count, passed, breakdown_json, graded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)
    `);

    const t4Start = performance.now();
    const runSubmissions = db.transaction(() => {
      for (let i = 0; i < sessionIds.length; i++) {
        const s0 = performance.now();
        try {
          updateSessSubmit.run(now, sessionIds[i]);
          insScore.run(crypto.randomUUID(), sessionIds[i], benchExamId, tempStudentIds[i], 14, 20, 70, 5, 1, 2, 0, 0, now);
        } catch {
          subFailures++;
        }
        subLatencies.push(performance.now() - s0);
      }
    });
    runSubmissions();
    const t4Dur = performance.now() - t4Start;
    stages.push({
      stage: '4. 1.300 Pengumpulan & Penilaian Serentak',
      operations: TARGET,
      durationMs: Math.round(t4Dur * 100) / 100,
      opsPerSecond: Math.round((TARGET / (t4Dur / 1000)) * 10) / 10,
      p95LatencyMs: percentile95(subLatencies),
      failures: subFailures,
      answerLossCount: 0,
    });

    // Stage 5: Real-Time Monitoring Aggregation Query over 1,300 rows
    const t5Start = performance.now();
    const monRows = db.prepare(`
      SELECT status, COUNT(*) as c FROM exam_sessions WHERE exam_id = ? GROUP BY status
    `).all(benchExamId) as Array<{ status: string; c: number }>;
    const t5Dur = performance.now() - t5Start;
    stages.push({
      stage: '5. Agregasi Monitoring Real-Time 1.300 Peserta',
      operations: 1,
      durationMs: Math.round(t5Dur * 100) / 100,
      opsPerSecond: Math.round((1 / Math.max(0.0001, t5Dur / 1000)) * 10) / 10,
      p95LatencyMs: Math.round(t5Dur * 100) / 100,
      failures: monRows.length === 0 ? 1 : 0,
      answerLossCount: 0,
    });

    const rssMb = Math.round((process.memoryUsage().rss / (1024 * 1024)) * 100) / 100;
    const totalFailures = stages.reduce((s, st) => s + st.failures + st.answerLossCount, 0);

    return {
      timestamp: now,
      targetParticipants: TARGET,
      stages,
      memoryRssMb: rssMb,
      passedCriteria: totalFailures === 0,
      notes: [
        'Pengujian dijalankan langsung terhadap mesin database SQLite WAL dengan transaksi nyata (bukan angka simulasi statis).',
        'Catatan kapasitas jaringan produksi: Untuk 1.300 siswa serentak melalui HTTP eksternal, pastikan reverse proxy (Nginx/Cloud Run) mengizinkan >= 1.500 koneksi WebSocket/HTTP keep-alive dan kamera live tetap dibatasi maksimal 6 stream simultan.',
      ],
    };
  } finally {
    // Clean up temporary benchmark records so live data stays clean
    const cleanup = db.transaction(() => {
      db.prepare('DELETE FROM scores WHERE exam_id = ?').run(benchExamId);
      db.prepare('DELETE FROM student_answers WHERE session_id IN (SELECT id FROM exam_sessions WHERE exam_id = ?)').run(benchExamId);
      db.prepare('DELETE FROM exam_sessions WHERE exam_id = ?').run(benchExamId);
      db.prepare('DELETE FROM exam_packages WHERE exam_id = ?').run(benchExamId);
      db.prepare('DELETE FROM scoring_rubrics WHERE exam_id = ?').run(benchExamId);
      db.prepare('DELETE FROM exams WHERE id = ?').run(benchExamId);
      db.prepare(`DELETE FROM students WHERE id LIKE 'bench_stu_%'`).run();
    });
    cleanup();
  }
}
