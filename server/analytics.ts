import { db } from './db.ts';
import { DEFAULT_SCORING_WEIGHTS, getQuestionMaxPoints, gradeSingleQuestion } from './scoring.ts';
import type { QuestionRecord, ScoringWeights } from './types.ts';

export function computeExamAnalytics(examId: string) {
  const exam = db.prepare(`
    SELECT e.*, s.name as subject_name, s.code as subject_code
    FROM exams e
    JOIN subjects s ON s.id = e.subject_id
    WHERE e.id = ?
  `).get(examId) as (Record<string, unknown> & { passing_score: number }) | undefined;

  if (!exam) return null;

  const scores = db.prepare(`
    SELECT sc.*, st.nis, st.nisn, st.full_name, st.birth_place, st.birth_date, st.gender, st.email, st.photo_link, st.class_id, c.name as class_name
    FROM scores sc
    JOIN students st ON st.id = sc.student_id
    JOIN classes c ON c.id = st.class_id
    WHERE sc.exam_id = ?
    ORDER BY sc.final_score DESC
  `).all(examId) as Array<{
    id: string;
    session_id: string;
    student_id: string;
    nis: string;
    nisn: string;
    full_name: string;
    birth_place: string;
    birth_date: string;
    gender: string;
    email: string;
    photo_link: string;
    class_id: string;
    class_name: string;
    raw_points: number;
    max_points: number;
    final_score: number;
    correct_count: number;
    partial_count: number;
    wrong_count: number;
    blank_count: number;
    passed: number;
    graded_at: string;
  }>;

  const n = scores.length;
  const sortedVals = scores.map((s) => s.final_score).sort((a, b) => a - b);
  const highest = n > 0 ? sortedVals[n - 1] : 0;
  const lowest = n > 0 ? sortedVals[0] : 0;
  const average = n > 0 ? Math.round((sortedVals.reduce((a, b) => a + b, 0) / n) * 100) / 100 : 0;
  const median =
    n === 0
      ? 0
      : n % 2 === 1
      ? sortedVals[Math.floor(n / 2)]
      : Math.round(((sortedVals[n / 2 - 1] + sortedVals[n / 2]) / 2) * 100) / 100;

  const passedCount = scores.filter((s) => s.passed === 1).length;
  const passRate = n > 0 ? Math.round((passedCount / n) * 10000) / 100 : 0;

  const distribution = [
    { range: '0-20', count: 0 },
    { range: '21-40', count: 0 },
    { range: '41-60', count: 0 },
    { range: '61-75', count: 0 },
    { range: '76-90', count: 0 },
    { range: '91-100', count: 0 },
  ];
  for (const s of scores) {
    const v = s.final_score;
    if (v <= 20) distribution[0].count++;
    else if (v <= 40) distribution[1].count++;
    else if (v <= 60) distribution[2].count++;
    else if (v <= 75) distribution[3].count++;
    else if (v <= 90) distribution[4].count++;
    else distribution[5].count++;
  }

  // Per-class comparison
  const classBuckets = new Map<string, { className: string; scores: number[]; passed: number }>();
  for (const s of scores) {
    const entry = classBuckets.get(s.class_id) || { className: s.class_name, scores: [], passed: 0 };
    entry.scores.push(s.final_score);
    if (s.passed === 1) entry.passed++;
    classBuckets.set(s.class_id, entry);
  }
  const byClass = Array.from(classBuckets.entries()).map(([classId, b]) => ({
    classId,
    className: b.className,
    participantCount: b.scores.length,
    average: Math.round((b.scores.reduce((a, x) => a + x, 0) / b.scores.length) * 100) / 100,
    highest: Math.max(...b.scores),
    lowest: Math.min(...b.scores),
    passRate: Math.round((b.passed / b.scores.length) * 10000) / 100,
  }));

  return {
    exam,
    summary: {
      participantCount: n,
      highest,
      lowest,
      average,
      median,
      passedCount,
      passRate,
      passingScore: exam.passing_score,
    },
    distribution,
    byClass,
    studentScores: scores,
  };
}

export function computeItemAnalysis(examId: string) {
  const exam = db.prepare('SELECT id, title, question_bank_id FROM exams WHERE id = ?').get(examId) as
    | { id: string; title: string; question_bank_id: string }
    | undefined;
  if (!exam) return null;

  const rubricRow = db
    .prepare('SELECT weights_json FROM scoring_rubrics WHERE exam_id = ? ORDER BY version DESC LIMIT 1')
    .get(examId) as { weights_json: string } | undefined;
  const rubricWeights: ScoringWeights = rubricRow ? JSON.parse(rubricRow.weights_json) : DEFAULT_SCORING_WEIGHTS;

  const sessions = db.prepare(`
    SELECT es.id as session_id, es.package_id, ep.question_ids_json, sc.final_score
    FROM exam_sessions es
    JOIN exam_packages ep ON ep.id = es.package_id
    JOIN scores sc ON sc.session_id = es.id
    WHERE es.exam_id = ? AND es.status IN ('submitted', 'expired')
  `).all(examId) as Array<{
    session_id: string;
    package_id: string;
    question_ids_json: string;
    final_score: number;
  }>;

  if (sessions.length === 0) {
    return { exam, totalSessions: 0, items: [] };
  }

  // Sort sessions by total score for top 27% vs bottom 27% discrimination index
  const sortedByScore = [...sessions].sort((a, b) => b.final_score - a.final_score);
  const groupSize = Math.max(1, Math.floor(sortedByScore.length * 0.27));
  const upperSet = new Set(sortedByScore.slice(0, groupSize).map((s) => s.session_id));
  const lowerSet = new Set(sortedByScore.slice(-groupSize).map((s) => s.session_id));

  // Load all answers for this exam
  const allAnswers = db.prepare(`
    SELECT sa.session_id, sa.question_id, sa.answer_json
    FROM student_answers sa
    JOIN exam_sessions es ON es.id = sa.session_id
    WHERE es.exam_id = ?
  `).all(examId) as Array<{ session_id: string; question_id: string; answer_json: string | null }>;

  const answerMap = new Map<string, Map<string, unknown>>();
  for (const row of allAnswers) {
    if (!answerMap.has(row.session_id)) answerMap.set(row.session_id, new Map());
    answerMap.get(row.session_id)!.set(row.question_id, row.answer_json ? JSON.parse(row.answer_json) : null);
  }

  // Load all questions & answer keys in this bank
  const questions = db.prepare(`
    SELECT q.*, ak.key_json, ak.wrong_penalty
    FROM questions q
    JOIN answer_keys ak ON ak.question_id = q.id
    WHERE q.bank_id = ?
  `).all(exam.question_bank_id) as Array<QuestionRecord & { key_json: string; wrong_penalty: number }>;
  const qMap = new Map(questions.map((q) => [q.id, q]));

  // Aggregate ONLY over sessions that actually received each question
  const itemStats = new Map<
    string,
    {
      receivedCount: number;
      correctCount: number;
      partialCount: number;
      wrongCount: number;
      blankCount: number;
      totalEarned: number;
      maxPoints: number;
      upperRatioSum: number;
      upperCount: number;
      lowerRatioSum: number;
      lowerCount: number;
      optionCounts: Record<string, number>;
    }
  >();

  for (const s of sessions) {
    const qIds = JSON.parse(s.question_ids_json) as string[];
    const sessAnswers = answerMap.get(s.session_id);

    for (const qId of qIds) {
      const q = qMap.get(qId);
      if (!q) continue;

      const maxPts = getQuestionMaxPoints(q.question_type, q.weight, rubricWeights);
      const ans = sessAnswers?.get(qId) ?? null;
      const key = JSON.parse(q.key_json);
      const graded = gradeSingleQuestion(q.question_type, ans, key, maxPts, q.wrong_penalty);

      const stat = itemStats.get(qId) || {
        receivedCount: 0,
        correctCount: 0,
        partialCount: 0,
        wrongCount: 0,
        blankCount: 0,
        totalEarned: 0,
        maxPoints: maxPts,
        upperRatioSum: 0,
        upperCount: 0,
        lowerRatioSum: 0,
        lowerCount: 0,
        optionCounts: {},
      };

      stat.receivedCount++;
      stat.totalEarned += graded.earnedPoints;
      if (graded.status === 'correct') stat.correctCount++;
      else if (graded.status === 'partial') stat.partialCount++;
      else if (graded.status === 'wrong') stat.wrongCount++;
      else stat.blankCount++;

      const ratio = maxPts > 0 ? graded.earnedPoints / maxPts : 0;
      if (upperSet.has(s.session_id)) {
        stat.upperRatioSum += ratio;
        stat.upperCount++;
      }
      if (lowerSet.has(s.session_id)) {
        stat.lowerRatioSum += ratio;
        stat.lowerCount++;
      }

      // Option distractor tracking for PG Tunggal & PG Kompleks
      if (q.question_type === 'pg_tunggal' && typeof ans === 'string' && ans) {
        stat.optionCounts[ans] = (stat.optionCounts[ans] || 0) + 1;
      } else if (q.question_type === 'pg_kompleks' && Array.isArray(ans)) {
        for (const optId of ans) {
          const k = String(optId);
          stat.optionCounts[k] = (stat.optionCounts[k] || 0) + 1;
        }
      }

      itemStats.set(qId, stat);
    }
  }

  const items = Array.from(itemStats.entries()).map(([qId, st]) => {
    const q = qMap.get(qId)!;
    const avgPartial = st.receivedCount > 0 ? Math.round((st.totalEarned / st.receivedCount) * 100) / 100 : 0;
    const correctPct = st.receivedCount > 0 ? Math.round(((st.totalEarned / (st.receivedCount * st.maxPoints)) * 100) * 100) / 100 : 0;
    const pIndex = correctPct / 100;

    let empiricalDifficulty: 'Mudah' | 'Sedang' | 'Sukar' = 'Sedang';
    if (pIndex > 0.7) empiricalDifficulty = 'Mudah';
    else if (pIndex < 0.3) empiricalDifficulty = 'Sukar';

    let discriminationIndex: number | null = null;
    if (st.upperCount >= 1 && st.lowerCount >= 1 && st.receivedCount >= 6) {
      const upperAvg = st.upperRatioSum / st.upperCount;
      const lowerAvg = st.lowerRatioSum / st.lowerCount;
      discriminationIndex = Math.round((upperAvg - lowerAvg) * 100) / 100;
    }

    return {
      questionId: qId,
      topic: q.topic,
      questionType: q.question_type,
      authorDifficulty: q.difficulty,
      empiricalDifficulty,
      sampleSize: st.receivedCount,
      lowSampleWarning: st.receivedCount < 15,
      correctCount: st.correctCount,
      partialCount: st.partialCount,
      wrongCount: st.wrongCount,
      blankCount: st.blankCount,
      avgPartialScore: avgPartial,
      maxPoints: st.maxPoints,
      correctPercent: correctPct,
      discriminationIndex,
      optionDistribution: st.optionCounts,
    };
  });

  return {
    exam,
    totalSessions: sessions.length,
    items,
  };
}
