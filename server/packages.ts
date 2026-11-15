import crypto from 'node:crypto';
import { db } from './db.ts';
import { DEFAULT_SCORING_WEIGHTS, getQuestionMaxPoints } from './scoring.ts';
import type { QuestionRecord, QuestionType, ScoringWeights, ShuffleMode } from './types.ts';

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export interface OptionOrderSpec {
  optionOrder?: string[]; // for pg_tunggal, pg_kompleks, benar_salah
  leftOrder?: string[];   // for menjodohkan left column
  rightOrder?: string[];  // for menjodohkan right column
}

export function buildOptionOrdersForQuestions(
  questions: QuestionRecord[],
  shuffleOptions: boolean
): Record<string, OptionOrderSpec> {
  const result: Record<string, OptionOrderSpec> = {};
  for (const q of questions) {
    const parsed = JSON.parse(q.options_json);
    if (q.question_type === 'pg_tunggal' || q.question_type === 'pg_kompleks') {
      const ids = (parsed as Array<{ id: string }>).map((o) => o.id);
      result[q.id] = { optionOrder: shuffleOptions ? shuffleArray(ids) : ids };
    } else if (q.question_type === 'benar_salah') {
      const ids = (parsed as Array<{ id: string }>).map((s) => s.id);
      result[q.id] = { optionOrder: shuffleOptions ? shuffleArray(ids) : ids };
    } else if (q.question_type === 'menjodohkan') {
      const leftIds = (parsed.left as Array<{ id: string }>).map((l) => l.id);
      const rightIds = (parsed.right as Array<{ id: string }>).map((r) => r.id);
      result[q.id] = {
        leftOrder: shuffleOptions ? shuffleArray(leftIds) : leftIds,
        rightOrder: shuffleOptions ? shuffleArray(rightIds) : rightIds,
      };
    }
  }
  return result;
}

export function assignOrCreatePackageForSession(params: {
  examId: string;
  studentId: string;
  bankId: string;
  questionCount: number;
  shuffleMode: ShuffleMode;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  compositionJson: string | null;
  rubricWeights: ScoringWeights;
}): { packageId: string; packageCode: string; questionIds: string[]; optionOrders: Record<string, OptionOrderSpec>; maxPoints: number } {
  const {
    examId,
    studentId,
    bankId,
    questionCount,
    shuffleMode,
    shuffleQuestions,
    shuffleOptions,
    compositionJson,
    rubricWeights,
  } = params;

  // Mode B: Fixed packages (Paket A, B, C...)
  if (shuffleMode === 'B') {
    const fixedPackages = db
      .prepare('SELECT * FROM exam_packages WHERE exam_id = ? AND is_fixed = 1 ORDER BY package_code ASC')
      .all(examId) as Array<{
      id: string;
      package_code: string;
      question_ids_json: string;
      option_orders_json: string;
      max_points: number;
    }>;

    if (fixedPackages.length > 0) {
      // Deterministic balanced distribution across students
      const existingSessionCount = (
        db.prepare('SELECT COUNT(*) as c FROM exam_sessions WHERE exam_id = ?').get(examId) as { c: number }
      ).c;
      const chosen = fixedPackages[existingSessionCount % fixedPackages.length];
      let optionOrders = JSON.parse(chosen.option_orders_json || '{}') as Record<string, OptionOrderSpec>;
      const qIds = JSON.parse(chosen.question_ids_json) as string[];
      if (Object.keys(optionOrders).length === 0 && qIds.length > 0) {
        const placeholders = qIds.map(() => '?').join(',');
        const qRows = db.prepare(`SELECT * FROM questions WHERE id IN (${placeholders})`).all(...qIds) as QuestionRecord[];
        optionOrders = buildOptionOrdersForQuestions(qRows, shuffleOptions);
      }
      return {
        packageId: chosen.id,
        packageCode: chosen.package_code,
        questionIds: qIds,
        optionOrders,
        maxPoints: chosen.max_points,
      };
    }
  }

  // Fetch only active questions (Tampilkan = Ya)
  const bankQuestions = db
    .prepare('SELECT * FROM questions WHERE bank_id = ? AND COALESCE(is_active, 1) = 1')
    .all(bankId) as QuestionRecord[];
  if (bankQuestions.length === 0) {
    throw new Error('Tidak ada soal aktif (Tampilkan: Ya) di bank soal ini. Aktifkan minimal satu butir soal terlebih dahulu.');
  }

  let selected: QuestionRecord[] = [];
  const targetCount = Math.min(questionCount, bankQuestions.length);

  if (shuffleMode === 'C' && compositionJson) {
    // Mode C: Stratified composition by question_type (and/or topic/difficulty)
    try {
      const comp = JSON.parse(compositionJson) as Record<string, number>;
      const usedIds = new Set<string>();
      for (const [qType, count] of Object.entries(comp)) {
        if (typeof count !== 'number' || count <= 0) continue;
        const pool = shuffleArray(bankQuestions.filter((q) => q.question_type === qType && !usedIds.has(q.id)));
        const picked = pool.slice(0, count);
        for (const p of picked) {
          selected.push(p);
          usedIds.add(p.id);
        }
      }
      // Fill remainder if targetCount not yet met
      if (selected.length < targetCount) {
        const rest = shuffleArray(bankQuestions.filter((q) => !usedIds.has(q.id)));
        selected.push(...rest.slice(0, targetCount - selected.length));
      }
      if (selected.length > targetCount) {
        selected = selected.slice(0, targetCount);
      }
    } catch {
      selected = shuffleArray(bankQuestions).slice(0, targetCount);
    }
  } else {
    // Mode A: Individual random draw
    selected = (shuffleQuestions ? shuffleArray(bankQuestions) : bankQuestions).slice(0, targetCount);
  }

  if (shuffleQuestions) {
    selected = shuffleArray(selected);
  }

  const questionIds = selected.map((q) => q.id);
  const optionOrders = buildOptionOrdersForQuestions(selected, shuffleOptions);
  const maxPoints = selected.reduce(
    (sum, q) => sum + getQuestionMaxPoints(q.question_type, q.weight, rubricWeights || DEFAULT_SCORING_WEIGHTS),
    0
  );

  const packageId = `pkg_${crypto.randomUUID().slice(0, 12)}`;
  const packageCode = `IND-${studentId.slice(-4)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

  db.prepare(`
    INSERT INTO exam_packages (id, exam_id, package_code, is_fixed, question_ids_json, option_orders_json, max_points, created_at)
    VALUES (?, ?, ?, 0, ?, ?, ?, ?)
  `).run(packageId, examId, packageCode, JSON.stringify(questionIds), JSON.stringify(optionOrders), maxPoints, new Date().toISOString());

  return {
    packageId,
    packageCode,
    questionIds,
    optionOrders,
    maxPoints,
  };
}

export function serializeQuestionForStudent(
  q: QuestionRecord,
  orderSpec: OptionOrderSpec | undefined
) {
  const rawOptions = JSON.parse(q.options_json);
  let safeOptions: unknown = rawOptions;

  if (q.question_type === 'pg_tunggal' || q.question_type === 'pg_kompleks') {
    const arr = rawOptions as Array<{ id: string; label: string; text: string }>;
    const order = orderSpec?.optionOrder;
    const ordered = order && order.length > 0
      ? order.map((id) => arr.find((o) => o.id === id)).filter((x): x is { id: string; label: string; text: string } => Boolean(x))
      : arr;
    const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
    safeOptions = ordered.map((o, idx) => ({
      id: o.id, // stable ID for grading even when shuffled
      displayLabel: q.question_type === 'pg_tunggal' ? letters[idx] || String(idx + 1) : String(idx + 1),
      text: o.text,
    }));
  } else if (q.question_type === 'benar_salah') {
    const arr = rawOptions as Array<{ id: string; text: string }>;
    const order = orderSpec?.optionOrder;
    safeOptions = order && order.length > 0
      ? order.map((id) => arr.find((s) => s.id === id)).filter(Boolean)
      : arr;
  } else if (q.question_type === 'menjodohkan') {
    const obj = rawOptions as { left: Array<{ id: string; text: string }>; right: Array<{ id: string; text: string }> };
    const leftOrder = orderSpec?.leftOrder;
    const rightOrder = orderSpec?.rightOrder;
    safeOptions = {
      left: leftOrder && leftOrder.length > 0
        ? leftOrder.map((id) => obj.left.find((l) => l.id === id)).filter(Boolean)
        : obj.left,
      right: rightOrder && rightOrder.length > 0
        ? rightOrder.map((id) => obj.right.find((r) => r.id === id)).filter(Boolean)
        : obj.right,
    };
  }

  // SECURITY: Never include answer_keys or explanation_html during active exam!
  return {
    id: q.id,
    topic: q.topic,
    questionType: q.question_type as QuestionType,
    stemHtml: q.stem_html,
    mediaPath: q.media_path,
    tableData: q.table_data_json ? JSON.parse(q.table_data_json) : null,
    options: safeOptions,
    difficulty: q.difficulty,
  };
}
