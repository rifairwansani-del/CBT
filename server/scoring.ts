import type { QuestionType, ScoringWeights } from './types.ts';

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  pg_tunggal: 2,
  pg_kompleks: 4,
  benar_salah: 4,
  menjodohkan: 4,
  pg_kompleks_wrong_penalty: 0.5,
};

export interface GradedItemResult {
  questionId: string;
  questionType: QuestionType;
  maxPoints: number;
  earnedPoints: number;
  status: 'correct' | 'partial' | 'wrong' | 'blank';
  isBlank: boolean;
}

export interface GradedPackageResult {
  rawPoints: number;
  maxPoints: number;
  finalScore: number; // 0 to 100
  correctCount: number;
  partialCount: number;
  wrongCount: number;
  blankCount: number;
  itemResults: GradedItemResult[];
}

export function getQuestionMaxPoints(
  questionType: QuestionType,
  itemWeight: number | null | undefined,
  rubricWeights: ScoringWeights
): number {
  if (typeof itemWeight === 'number' && itemWeight > 0) {
    return itemWeight;
  }
  switch (questionType) {
    case 'pg_tunggal':
      return rubricWeights.pg_tunggal ?? 2;
    case 'pg_kompleks':
      return rubricWeights.pg_kompleks ?? 4;
    case 'benar_salah':
      return rubricWeights.benar_salah ?? 4;
    case 'menjodohkan':
      return rubricWeights.menjodohkan ?? 4;
    default:
      return 2;
  }
}

export function gradeSingleQuestion(
  questionType: QuestionType,
  studentAnswer: unknown,
  correctKey: unknown,
  maxPoints: number,
  wrongPenaltyFactor = 0.5
): GradedItemResult & { questionId: string } {
  const clamp = (val: number) => Math.round(Math.min(maxPoints, Math.max(0, val)) * 10000) / 10000;

  if (studentAnswer === null || studentAnswer === undefined) {
    return {
      questionId: '',
      questionType,
      maxPoints,
      earnedPoints: 0,
      status: 'blank',
      isBlank: true,
    };
  }

  if (questionType === 'pg_tunggal') {
    const ans = typeof studentAnswer === 'string' ? studentAnswer.trim() : '';
    if (!ans) {
      return { questionId: '', questionType, maxPoints, earnedPoints: 0, status: 'blank', isBlank: true };
    }
    const key = typeof correctKey === 'string' ? correctKey.trim() : '';
    const isCorrect = ans === key && key.length > 0;
    return {
      questionId: '',
      questionType,
      maxPoints,
      earnedPoints: isCorrect ? maxPoints : 0,
      status: isCorrect ? 'correct' : 'wrong',
      isBlank: false,
    };
  }

  if (questionType === 'pg_kompleks') {
    const selected = Array.isArray(studentAnswer)
      ? Array.from(new Set(studentAnswer.map((v) => String(v).trim()).filter(Boolean)))
      : [];
    if (selected.length === 0) {
      return { questionId: '', questionType, maxPoints, earnedPoints: 0, status: 'blank', isBlank: true };
    }
    const expected = Array.isArray(correctKey)
      ? Array.from(new Set(correctKey.map((v) => String(v).trim()).filter(Boolean)))
      : [];
    if (expected.length === 0) {
      return { questionId: '', questionType, maxPoints, earnedPoints: 0, status: 'wrong', isBlank: false };
    }

    const expectedSet = new Set(expected);
    let correctSelected = 0;
    let wrongSelected = 0;
    for (const item of selected) {
      if (expectedSet.has(item)) {
        correctSelected++;
      } else {
        wrongSelected++;
      }
    }

    const perCorrect = maxPoints / expected.length;
    const penaltyPerWrong = perCorrect * wrongPenaltyFactor;
    const earned = clamp(correctSelected * perCorrect - wrongSelected * penaltyPerWrong);

    let status: 'correct' | 'partial' | 'wrong' = 'wrong';
    if (correctSelected === expected.length && wrongSelected === 0) {
      status = 'correct';
    } else if (earned > 0) {
      status = 'partial';
    }

    return {
      questionId: '',
      questionType,
      maxPoints,
      earnedPoints: earned,
      status,
      isBlank: false,
    };
  }

  if (questionType === 'benar_salah') {
    const ansObj =
      studentAnswer && typeof studentAnswer === 'object' && !Array.isArray(studentAnswer)
        ? (studentAnswer as Record<string, string>)
        : {};
    const keyObj =
      correctKey && typeof correctKey === 'object' && !Array.isArray(correctKey)
        ? (correctKey as Record<string, string>)
        : {};

    const keys = Object.keys(keyObj);
    const answeredKeys = keys.filter((k) => ansObj[k] === 'B' || ansObj[k] === 'S' || ansObj[k] === 'true' || ansObj[k] === 'false');

    if (answeredKeys.length === 0) {
      return { questionId: '', questionType, maxPoints, earnedPoints: 0, status: 'blank', isBlank: true };
    }

    let matched = 0;
    for (const k of keys) {
      const normalize = (v: unknown) => {
        const s = String(v ?? '').trim().toUpperCase();
        if (s === 'TRUE' || s === 'BENAR' || s === 'B') return 'B';
        if (s === 'FALSE' || s === 'SALAH' || s === 'S') return 'S';
        return s;
      };
      if (normalize(ansObj[k]) !== '' && normalize(ansObj[k]) === normalize(keyObj[k])) {
        matched++;
      }
    }

    const earned = keys.length > 0 ? clamp((matched / keys.length) * maxPoints) : 0;
    let status: 'correct' | 'partial' | 'wrong' = 'wrong';
    if (matched === keys.length && keys.length > 0) status = 'correct';
    else if (earned > 0) status = 'partial';

    return {
      questionId: '',
      questionType,
      maxPoints,
      earnedPoints: earned,
      status,
      isBlank: false,
    };
  }

  if (questionType === 'menjodohkan') {
    const ansObj =
      studentAnswer && typeof studentAnswer === 'object' && !Array.isArray(studentAnswer)
        ? (studentAnswer as Record<string, string>)
        : {};
    const keyObj =
      correctKey && typeof correctKey === 'object' && !Array.isArray(correctKey)
        ? (correctKey as Record<string, string>)
        : {};

    const leftKeys = Object.keys(keyObj);
    const nonEmptyCount = leftKeys.filter((k) => Boolean(ansObj[k])).length;

    if (nonEmptyCount === 0) {
      return { questionId: '', questionType, maxPoints, earnedPoints: 0, status: 'blank', isBlank: true };
    }

    let matched = 0;
    for (const lk of leftKeys) {
      if (ansObj[lk] && String(ansObj[lk]).trim() === String(keyObj[lk]).trim()) {
        matched++;
      }
    }

    const earned = leftKeys.length > 0 ? clamp((matched / leftKeys.length) * maxPoints) : 0;
    let status: 'correct' | 'partial' | 'wrong' = 'wrong';
    if (matched === leftKeys.length && leftKeys.length > 0) status = 'correct';
    else if (earned > 0) status = 'partial';

    return {
      questionId: '',
      questionType,
      maxPoints,
      earnedPoints: earned,
      status,
      isBlank: false,
    };
  }

  return { questionId: '', questionType, maxPoints, earnedPoints: 0, status: 'blank', isBlank: true };
}

export function gradeExamPackage(
  items: Array<{
    questionId: string;
    questionType: QuestionType;
    itemWeight: number | null;
    correctKey: unknown;
    wrongPenalty?: number;
    studentAnswer: unknown;
  }>,
  rubricWeights: ScoringWeights
): GradedPackageResult {
  let rawPoints = 0;
  let maxPoints = 0;
  let correctCount = 0;
  let partialCount = 0;
  let wrongCount = 0;
  let blankCount = 0;
  const itemResults: GradedItemResult[] = [];

  for (const item of items) {
    const itemMax = getQuestionMaxPoints(item.questionType, item.itemWeight, rubricWeights);
    const penaltyFactor =
      typeof item.wrongPenalty === 'number' && item.wrongPenalty >= 0
        ? item.wrongPenalty
        : rubricWeights.pg_kompleks_wrong_penalty ?? 0.5;

    const graded = gradeSingleQuestion(
      item.questionType,
      item.studentAnswer,
      item.correctKey,
      itemMax,
      penaltyFactor
    );
    graded.questionId = item.questionId;

    maxPoints += itemMax;
    rawPoints += graded.earnedPoints;

    if (graded.status === 'correct') correctCount++;
    else if (graded.status === 'partial') partialCount++;
    else if (graded.status === 'wrong') wrongCount++;
    else blankCount++;

    itemResults.push(graded);
  }

  const finalScore =
    maxPoints > 0
      ? Math.round(Math.min(100, Math.max(0, (rawPoints / maxPoints) * 100)) * 100) / 100
      : 0;

  return {
    rawPoints: Math.round(rawPoints * 100) / 100,
    maxPoints: Math.round(maxPoints * 100) / 100,
    finalScore,
    correctCount,
    partialCount,
    wrongCount,
    blankCount,
    itemResults,
  };
}
