import express, { type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { db, writeAuditLog } from './db.ts';
import {
  COOKIE_NAME,
  canAccessClassOrExam,
  requireAuth,
  requireRole,
  signToken,
} from './auth.ts';
import {
  BRANDING_DIR,
  MEDIA_DIR,
  deletePrivateStudentPhoto,
  parseBulkPhotoZip,
  readPrivateStudentPhoto,
  saveBrandingLogo,
  savePrivateStudentPhoto,
  saveQuestionMedia,
} from './storage.ts';
import {
  buildClassesTemplateWorkbook,
  buildExamsTemplateWorkbook,
  buildQuestionsTemplateWorkbook,
  buildStaffTemplateWorkbook,
  buildStudentsTemplateWorkbook,
  buildSubjectsTemplateWorkbook,
  previewClassesExcelImport,
  previewExamsExcelImport,
  previewQuestionsExcelImport,
  previewQuestionsWordImport,
  previewStaffExcelImport,
  previewStudentsExcelImport,
  previewSubjectsExcelImport,
  serializeQuestionForExcelExport,
} from './imports.ts';
import { assignOrCreatePackageForSession, buildOptionOrdersForQuestions, serializeQuestionForStudent, type OptionOrderSpec } from './packages.ts';
import { DEFAULT_SCORING_WEIGHTS, gradeExamPackage } from './scoring.ts';
import { computeExamAnalytics, computeItemAnalysis } from './analytics.ts';
import { realtimeHub } from './realtime.ts';
import { run1300ParticipantBenchmark, runFunctionalTestSuite } from './testSuite.ts';
import {
  DEFAULT_VIOLATION_POLICY,
  checkAndApplyAutoUnlockForSession,
  detectDeviceBrandFromUserAgent,
  evaluateViolationAgainstPolicy,
  normalizeViolationPolicy,
} from './violations.ts';
import type { QuestionRecord, ScoringWeights, ShuffleMode } from './types.ts';

const uploadMemory = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function setSessionCookie(req: Request, res: Response, token: string) {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    maxAge: 12 * 60 * 60 * 1000,
  });
}

function parseIdsQuery(raw: unknown): string[] {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Temporary in-memory preview caches keyed by admin userId + previewId
const bulkPhotoPreviewCache = new Map<string, { expiresAt: number; buffers: Map<string, Buffer>; matchedNis: string[] }>();
const studentImportPreviewCache = new Map<string, { expiresAt: number; rows: ReturnType<typeof previewStudentsExcelImport>['rows'] }>();
const questionImportPreviewCache = new Map<string, { expiresAt: number; bankId: string; rows: ReturnType<typeof previewQuestionsExcelImport>['rows'] }>();
const classImportPreviewCache = new Map<string, { expiresAt: number; rows: ReturnType<typeof previewClassesExcelImport>['rows'] }>();
const subjectImportPreviewCache = new Map<string, { expiresAt: number; rows: ReturnType<typeof previewSubjectsExcelImport>['rows'] }>();
const examImportPreviewCache = new Map<string, { expiresAt: number; rows: ReturnType<typeof previewExamsExcelImport>['rows'] }>();
const staffImportPreviewCache = new Map<string, { expiresAt: number; rows: ReturnType<typeof previewStaffExcelImport>['rows'] }>();

function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare('SELECT value_json FROM system_settings WHERE key = ?').get(key) as { value_json: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return fallback;
  }
}

interface ParticipantCardConfig {
  enabled: boolean;
  allowStudentDownload: boolean;
  allowStudentPrint: boolean;
  showPinOnCard: boolean;
  cardTitle: string;
  examSessionNote: string;
  cardNote: string;
  signerTitle: string;
  signerName: string;
}

const DEFAULT_PARTICIPANT_CARD_CONFIG: ParticipantCardConfig = {
  enabled: true,
  allowStudentDownload: true,
  allowStudentPrint: true,
  showPinOnCard: false,
  cardTitle: 'KARTU PESERTA UJIAN',
  examSessionNote: 'Ruang CBT Terpadu · Sesi Sesuai Jadwal Kelas',
  cardNote: 'Kartu peserta ini wajib dibawa dan ditunjukkan kepada pengawas ruang saat ujian berlangsung.',
  signerTitle: 'Ketua Panitia Ujian',
  signerName: '',
};

function normalizeParticipantCardConfig(raw: unknown): ParticipantCardConfig {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    enabled: src.enabled !== false,
    allowStudentDownload: src.allowStudentDownload !== false,
    allowStudentPrint: src.allowStudentPrint !== false,
    showPinOnCard: Boolean(src.showPinOnCard),
    cardTitle: String(src.cardTitle ?? DEFAULT_PARTICIPANT_CARD_CONFIG.cardTitle).trim().slice(0, 100) || DEFAULT_PARTICIPANT_CARD_CONFIG.cardTitle,
    examSessionNote: String(src.examSessionNote ?? DEFAULT_PARTICIPANT_CARD_CONFIG.examSessionNote).trim().slice(0, 140),
    cardNote: String(src.cardNote ?? DEFAULT_PARTICIPANT_CARD_CONFIG.cardNote).trim().slice(0, 400),
    signerTitle: String(src.signerTitle ?? DEFAULT_PARTICIPANT_CARD_CONFIG.signerTitle).trim().slice(0, 100) || DEFAULT_PARTICIPANT_CARD_CONFIG.signerTitle,
    signerName: String(src.signerName ?? '').trim().slice(0, 120),
  };
}

interface ClassExamConfigOverride {
  enabled?: boolean;
  startAt?: string;
  entryDeadlineAt?: string;
  endAt?: string;
  durationMinutes?: number;
  accessTokenMode?: 'inherit' | 'student_pin' | 'exam_token';
  accessToken?: string;
  publicationPolicy?: string;
  historyVisible?: 'inherit' | 'visible' | 'hidden';
}

function parseClassConfigs(raw: unknown): Record<string, ClassExamConfigOverride> {
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, ClassExamConfigOverride>;
    }
    return {};
  } catch {
    return {};
  }
}

function sanitizeClassConfigs(input: unknown): { ok: true; configs: Record<string, ClassExamConfigOverride> } | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: true, configs: {} };
  }
  const result: Record<string, ClassExamConfigOverride> = {};
  for (const [classId, rawCfg] of Object.entries(input as Record<string, unknown>)) {
    if (!classId || !rawCfg || typeof rawCfg !== 'object') continue;
    const c = rawCfg as ClassExamConfigOverride;
    const item: ClassExamConfigOverride = {};
    if (c.enabled === false) item.enabled = false;
    else item.enabled = true;
    if (c.startAt) {
      const dt = new Date(c.startAt);
      if (!Number.isNaN(dt.getTime())) item.startAt = dt.toISOString();
    }
    if (c.entryDeadlineAt) {
      const dt = new Date(c.entryDeadlineAt);
      if (!Number.isNaN(dt.getTime())) item.entryDeadlineAt = dt.toISOString();
    }
    if (c.endAt) {
      const dt = new Date(c.endAt);
      if (!Number.isNaN(dt.getTime())) item.endAt = dt.toISOString();
    }
    if (c.durationMinutes !== undefined && c.durationMinutes !== null && Number(c.durationMinutes) > 0) {
      item.durationMinutes = Math.max(5, Math.min(360, Number(c.durationMinutes)));
    }
    if (c.accessTokenMode === 'student_pin') {
      item.accessTokenMode = 'student_pin';
      item.accessToken = '';
    } else if (c.accessTokenMode === 'exam_token') {
      const tok = String(c.accessToken || '').trim();
      if (tok.length < 4 || tok.length > 32) {
        return { ok: false, error: 'Token khusus per kelas harus terdiri dari 4 hingga 32 karakter.' };
      }
      item.accessTokenMode = 'exam_token';
      item.accessToken = tok;
    } else {
      item.accessTokenMode = 'inherit';
    }
    if (
      c.publicationPolicy &&
      ['hidden', 'view_only', 'view_download', 'view_download_print'].includes(c.publicationPolicy)
    ) {
      item.publicationPolicy = c.publicationPolicy;
    } else {
      item.publicationPolicy = 'inherit';
    }
    if (c.historyVisible === 'visible' || c.historyVisible === 'hidden') {
      item.historyVisible = c.historyVisible;
    } else {
      item.historyVisible = 'inherit';
    }
    result[classId] = item;
  }
  return { ok: true, configs: result };
}

function resolveExamConfigForClass(examRow: Record<string, unknown>, classId: string) {
  const configs = parseClassConfigs(examRow.class_configs_json);
  const ov = configs[classId] || {};
  const enabled = ov.enabled !== false;
  const startAt = ov.startAt || String(examRow.start_at || '');
  const endAt = ov.endAt || String(examRow.end_at || '');
  const entryDeadlineAt = ov.entryDeadlineAt || ov.endAt || String(examRow.entry_deadline_at || endAt);
  const durationMinutes =
    ov.durationMinutes && Number(ov.durationMinutes) > 0
      ? Number(ov.durationMinutes)
      : Number(examRow.duration_minutes || 60);

  let accessTokenMode: 'student_pin' | 'exam_token' =
    examRow.access_token_mode === 'exam_token' ? 'exam_token' : 'student_pin';
  let accessToken = accessTokenMode === 'exam_token' ? String(examRow.access_token || '').trim() : '';

  if (ov.accessTokenMode === 'student_pin') {
    accessTokenMode = 'student_pin';
    accessToken = '';
  } else if (ov.accessTokenMode === 'exam_token') {
    accessTokenMode = 'exam_token';
    accessToken = String(ov.accessToken || '').trim();
  }

  const publicationPolicy =
    ov.publicationPolicy && ov.publicationPolicy !== 'inherit'
      ? String(ov.publicationPolicy)
      : String(examRow.publication_policy || 'view_download_print');

  const historyVisible =
    ov.historyVisible === 'visible'
      ? true
      : ov.historyVisible === 'hidden'
      ? false
      : Number(examRow.history_visible ?? 1) !== 0;

  return {
    enabled,
    startAt,
    entryDeadlineAt,
    endAt,
    durationMinutes,
    accessTokenMode,
    accessToken,
    usesExamToken: accessTokenMode === 'exam_token' && Boolean(accessToken),
    publicationPolicy,
    historyVisible,
  };
}

function finalizeAndGradeSession(sessionId: string, finalStatus: 'submitted' | 'expired') {
  const session = db.prepare('SELECT * FROM exam_sessions WHERE id = ?').get(sessionId) as {
    id: string;
    exam_id: string;
    student_id: string;
    package_id: string;
    rubric_id: string;
    status: string;
  } | undefined;
  if (!session) return null;

  const existingScore = db.prepare('SELECT * FROM scores WHERE session_id = ?').get(sessionId) as Record<string, unknown> | undefined;
  if (existingScore && (session.status === 'submitted' || session.status === 'expired')) {
    return existingScore;
  }

  const now = new Date().toISOString();
  const exam = db.prepare('SELECT passing_score FROM exams WHERE id = ?').get(session.exam_id) as { passing_score: number };
  const pkg = db.prepare('SELECT question_ids_json FROM exam_packages WHERE id = ?').get(session.package_id) as { question_ids_json: string };
  const rubric = db.prepare('SELECT weights_json FROM scoring_rubrics WHERE id = ?').get(session.rubric_id) as { weights_json: string } | undefined;
  const weights: ScoringWeights = rubric ? JSON.parse(rubric.weights_json) : DEFAULT_SCORING_WEIGHTS;

  const qIds = JSON.parse(pkg.question_ids_json) as string[];
  const answersRows = db.prepare('SELECT question_id, answer_json FROM student_answers WHERE session_id = ?').all(sessionId) as Array<{
    question_id: string;
    answer_json: string | null;
  }>;
  const ansMap = new Map(answersRows.map((a) => [a.question_id, a.answer_json ? JSON.parse(a.answer_json) : null]));

  const placeholders = qIds.map(() => '?').join(',');
  const qRows = qIds.length > 0
    ? (db.prepare(`
        SELECT q.id, q.question_type, q.weight, ak.key_json, ak.wrong_penalty
        FROM questions q
        JOIN answer_keys ak ON ak.question_id = q.id
        WHERE q.id IN (${placeholders})
      `).all(...qIds) as Array<{
        id: string;
        question_type: 'pg_tunggal' | 'pg_kompleks' | 'benar_salah' | 'menjodohkan';
        weight: number | null;
        key_json: string;
        wrong_penalty: number;
      }>)
    : [];
  const qMap = new Map(qRows.map((q) => [q.id, q]));

  const gradeInputs = qIds
    .map((qId) => {
      const q = qMap.get(qId);
      if (!q) return null;
      return {
        questionId: qId,
        questionType: q.question_type,
        itemWeight: q.weight,
        correctKey: JSON.parse(q.key_json),
        wrongPenalty: q.wrong_penalty,
        studentAnswer: ansMap.get(qId) ?? null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  const graded = gradeExamPackage(gradeInputs, weights);
  const passed = graded.finalScore >= (exam?.passing_score ?? 75) ? 1 : 0;

  const tx = db.transaction(() => {
    db.prepare(`UPDATE exam_sessions SET status = ?, submitted_at = COALESCE(submitted_at, ?), connection_status = 'offline' WHERE id = ?`).run(
      finalStatus,
      now,
      sessionId
    );

    if (!existingScore) {
      db.prepare(`
        INSERT INTO scores (id, session_id, exam_id, student_id, raw_points, max_points, final_score, correct_count, partial_count, wrong_count, blank_count, passed, breakdown_json, graded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        sessionId,
        session.exam_id,
        session.student_id,
        graded.rawPoints,
        graded.maxPoints,
        graded.finalScore,
        graded.correctCount,
        graded.partialCount,
        graded.wrongCount,
        graded.blankCount,
        passed,
        JSON.stringify(graded.itemResults),
        now
      );
    }
  });
  tx();

  realtimeHub.queueMonitorUpdate({
    kind: 'session_submitted',
    priority: 'high',
    examId: session.exam_id,
    sessionId,
    studentId: session.student_id,
    status: finalStatus,
    finalScore: graded.finalScore,
    timestamp: now,
  });

  return db.prepare('SELECT * FROM scores WHERE session_id = ?').get(sessionId);
}

export function createApiRouter() {
  const router = express.Router();

  // ======================== HEALTH & SERVER TIME ========================
  router.get('/health', (_req, res) => {
    res.json({ ok: true, serverTime: new Date().toISOString() });
  });

  router.get('/server-time', (_req, res) => {
    res.json({ serverTime: new Date().toISOString(), epochMs: Date.now() });
  });

  router.get('/branding', (_req, res) => {
    const inst = getSetting('institution', {
      name: 'SMA Negeri Unggul Cipta Jakarta',
      shortName: 'SMAN Unggul Cipta',
      address: 'Jl. Pendidikan Terpadu No. 18, Jakarta Selatan',
      timezone: 'Asia/Jakarta',
      logoEndpoint: '/api/branding/logo',
      academicYear: '2026/2027',
    });
    const secRaw = getSetting<Record<string, unknown>>('security', {
      privacyNotice: 'Kamera pengawasan hanya menghasilkan indikator peninjauan.',
      defaultProctoringRetentionDays: 14,
      maxConcurrentCameraStreams: 6,
      showStudentExamHistory: true,
    });
    const sec = {
      ...secRaw,
      showStudentExamHistory: secRaw.showStudentExamHistory !== false,
      participantCard: normalizeParticipantCardConfig(secRaw.participantCard),
      violationPolicy: normalizeViolationPolicy(secRaw.violationPolicy),
    };
    res.json({ institution: inst, security: sec });
  });

  router.get('/branding/logo', (_req, res) => {
    for (const ext of ['png', 'jpg']) {
      const p = path.join(BRANDING_DIR, `institution_logo.${ext}`);
      if (fs.existsSync(p)) {
        res.setHeader('Content-Type', ext === 'png' ? 'image/png' : 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.sendFile(p);
        return;
      }
    }
    res.status(404).json({ error: 'Logo belum diunggah.' });
  });

  // ======================== AUTHENTICATION ========================
  router.post('/auth/student-login', (req: Request, res: Response) => {
    const { nis, nisn, deviceFingerprint } = req.body || {};
    const cleanNis = String(nis || '').trim();
    const cleanNisn = String(nisn || '').trim();
    const ip = req.ip || '127.0.0.1';

    if (!cleanNis || !cleanNisn) {
      res.status(400).json({ error: 'NIS dan NISN wajib diisi.' });
      return;
    }

    const attemptKey = `stu:${cleanNis}`;
    const attempt = db.prepare('SELECT * FROM login_attempts WHERE identifier = ?').get(attemptKey) as
      | { fail_count: number; locked_until: string | null }
      | undefined;

    if (attempt?.locked_until && new Date(attempt.locked_until).getTime() > Date.now()) {
      const waitSec = Math.ceil((new Date(attempt.locked_until).getTime() - Date.now()) / 1000);
      res.status(429).json({
        error: `Terlalu banyak percobaan login gagal. Coba lagi dalam ${waitSec} detik atau hubungi pengawas.`,
      });
      return;
    }

    const student = db.prepare(`
      SELECT s.*, c.name as class_name
      FROM students s
      JOIN classes c ON c.id = s.class_id
      WHERE s.nis = ? AND s.nisn = ?
    `).get(cleanNis, cleanNisn) as
      | {
          id: string;
          nis: string;
          nisn: string;
          pin_hash: string;
          full_name: string;
          birth_place: string;
          birth_date: string;
          gender: string;
          email: string;
          photo_link: string;
          class_id: string;
          class_name: string;
          photo_path: string | null;
          is_active: number;
        }
      | undefined;

    const recordFailure = () => {
      const nextCount = (attempt?.fail_count || 0) + 1;
      const lockedUntil = nextCount >= 5 ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null;
      db.prepare(`
        INSERT INTO login_attempts (identifier, ip_address, fail_count, locked_until, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(identifier) DO UPDATE SET fail_count = excluded.fail_count, locked_until = excluded.locked_until, updated_at = excluded.updated_at
      `).run(attemptKey, ip, nextCount, lockedUntil, new Date().toISOString());
    };

    if (!student) {
      recordFailure();
      res.status(401).json({ error: 'Kombinasi NIS dan NISN tidak ditemukan.' });
      return;
    }

    if (!student.is_active) {
      res.status(403).json({ error: 'Akun peserta dinonaktifkan oleh admin. Hubungi panitia ujian.' });
      return;
    }

    // Clear rate-limit counter on success
    db.prepare('DELETE FROM login_attempts WHERE identifier = ?').run(attemptKey);

    const sessionTokenId = crypto.randomUUID();
    const token = signToken({
      userId: student.id,
      role: 'siswa',
      name: student.full_name,
      studentId: student.id,
      nis: student.nis,
      classId: student.class_id,
      sessionTokenId,
    });

    // Update active session fingerprint if any active session exists (allows legitimate resume, flags duplicate)
    if (deviceFingerprint) {
      // Handled per-exam when entering exam room
    }

    setSessionCookie(req, res, token);

    writeAuditLog({
      actorId: student.id,
      actorRole: 'siswa',
      actorName: student.full_name,
      action: 'STUDENT_LOGIN',
      targetType: 'student',
      targetId: student.id,
      details: { nis: student.nis },
      ipAddress: ip,
    });

    const resolvedPhotoUrl = student.photo_link
      ? student.photo_link
      : student.photo_path
      ? `/api/photos/student/${student.id}`
      : null;

    res.json({
      token,
      user: {
        id: student.id,
        role: 'siswa',
        fullName: student.full_name,
        nis: student.nis,
        nisn: student.nisn,
        birthPlace: student.birth_place || '',
        birthDate: student.birth_date || '',
        gender: student.gender || '',
        email: student.email || '',
        photoLink: student.photo_link || '',
        classId: student.class_id,
        className: student.class_name,
        hasPhoto: Boolean(resolvedPhotoUrl),
        photoUrl: resolvedPhotoUrl,
      },
    });
  });

  router.post('/auth/staff-login', (req: Request, res: Response) => {
    const { username, password } = req.body || {};
    const cleanUser = String(username || '').trim();
    const cleanPass = String(password || '').trim();
    const ip = req.ip || '127.0.0.1';

    if (!cleanUser || !cleanPass) {
      res.status(400).json({ error: 'Username dan kata sandi wajib diisi.' });
      return;
    }

    const attemptKey = `staff:${cleanUser}`;
    const attempt = db.prepare('SELECT * FROM login_attempts WHERE identifier = ?').get(attemptKey) as
      | { fail_count: number; locked_until: string | null }
      | undefined;

    if (attempt?.locked_until && new Date(attempt.locked_until).getTime() > Date.now()) {
      res.status(429).json({ error: 'Akun terkunci sementara karena terlalu banyak percobaan gagal.' });
      return;
    }

    const staff = db.prepare('SELECT * FROM users WHERE username = ?').get(cleanUser) as
      | {
          id: string;
          username: string;
          password_hash: string;
          full_name: string;
          role: 'admin' | 'pengawas';
          assigned_class_ids_json: string;
          assigned_exam_ids_json: string;
          can_unlock_sessions: number;
          is_active: number;
        }
      | undefined;

    if (!staff || !bcrypt.compareSync(cleanPass, staff.password_hash)) {
      const nextCount = (attempt?.fail_count || 0) + 1;
      const lockedUntil = nextCount >= 5 ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null;
      db.prepare(`
        INSERT INTO login_attempts (identifier, ip_address, fail_count, locked_until, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(identifier) DO UPDATE SET fail_count = excluded.fail_count, locked_until = excluded.locked_until, updated_at = excluded.updated_at
      `).run(attemptKey, ip, nextCount, lockedUntil, new Date().toISOString());
      res.status(401).json({ error: 'Username atau kata sandi salah.' });
      return;
    }

    if (!staff.is_active) {
      res.status(403).json({ error: 'Akun pengawas/admin dinonaktifkan.' });
      return;
    }

    db.prepare('DELETE FROM login_attempts WHERE identifier = ?').run(attemptKey);

    const assignedClassIds = JSON.parse(staff.assigned_class_ids_json || '[]') as string[];
    const assignedExamIds = JSON.parse(staff.assigned_exam_ids_json || '[]') as string[];
    const canUnlockSessions = Boolean(staff.can_unlock_sessions);

    const token = signToken({
      userId: staff.id,
      role: staff.role,
      name: staff.full_name,
      username: staff.username,
      assignedClassIds,
      assignedExamIds,
      canUnlockSessions,
    });

    setSessionCookie(req, res, token);

    writeAuditLog({
      actorId: staff.id,
      actorRole: staff.role,
      actorName: staff.full_name,
      action: 'STAFF_LOGIN',
      targetType: 'user',
      targetId: staff.id,
      ipAddress: ip,
    });

    res.json({
      token,
      user: {
        id: staff.id,
        role: staff.role,
        username: staff.username,
        fullName: staff.full_name,
        assignedClassIds,
        assignedExamIds,
        canUnlockSessions,
      },
    });
  });

  // Unified login for Siswa (NIS + NISN), Admin, and Pengawas (Username + Kata Sandi)
  router.post('/auth/unified-login', (req: Request, res: Response) => {
    const { identifier, secret } = req.body || {};
    const cleanId = String(identifier || '').trim();
    const cleanSecret = String(secret || '').trim();
    const ip = req.ip || '127.0.0.1';

    if (!cleanId || !cleanSecret) {
      res.status(400).json({ error: 'NIS / Username dan NISN / Kata Sandi wajib diisi.' });
      return;
    }

    const attemptKey = `unified:${cleanId.toLowerCase()}`;
    const attempt = db.prepare('SELECT * FROM login_attempts WHERE identifier = ?').get(attemptKey) as
      | { fail_count: number; locked_until: string | null }
      | undefined;

    if (attempt?.locked_until && new Date(attempt.locked_until).getTime() > Date.now()) {
      const waitSec = Math.ceil((new Date(attempt.locked_until).getTime() - Date.now()) / 1000);
      res.status(429).json({
        error: `Terlalu banyak percobaan login gagal. Coba lagi dalam ${waitSec} detik.`,
      });
      return;
    }

    const recordFailure = () => {
      const nextCount = (attempt?.fail_count || 0) + 1;
      const lockedUntil = nextCount >= 5 ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null;
      db.prepare(`
        INSERT INTO login_attempts (identifier, ip_address, fail_count, locked_until, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(identifier) DO UPDATE SET fail_count = excluded.fail_count, locked_until = excluded.locked_until, updated_at = excluded.updated_at
      `).run(attemptKey, ip, nextCount, lockedUntil, new Date().toISOString());
    };

    // 1. Check staff account (Admin / Pengawas) by username
    const staff = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(cleanId) as
      | {
          id: string;
          username: string;
          password_hash: string;
          full_name: string;
          role: 'admin' | 'pengawas';
          assigned_class_ids_json: string;
          assigned_exam_ids_json: string;
          can_unlock_sessions: number;
          is_active: number;
        }
      | undefined;

    if (staff && bcrypt.compareSync(cleanSecret, staff.password_hash)) {
      if (!staff.is_active) {
        res.status(403).json({ error: 'Akun pengawas/admin dinonaktifkan.' });
        return;
      }

      db.prepare('DELETE FROM login_attempts WHERE identifier = ?').run(attemptKey);

      const assignedClassIds = JSON.parse(staff.assigned_class_ids_json || '[]') as string[];
      const assignedExamIds = JSON.parse(staff.assigned_exam_ids_json || '[]') as string[];
      const canUnlockSessions = Boolean(staff.can_unlock_sessions);

      const token = signToken({
        userId: staff.id,
        role: staff.role,
        name: staff.full_name,
        username: staff.username,
        assignedClassIds,
        assignedExamIds,
        canUnlockSessions,
      });

      setSessionCookie(req, res, token);

      writeAuditLog({
        actorId: staff.id,
        actorRole: staff.role,
        actorName: staff.full_name,
        action: 'STAFF_LOGIN',
        targetType: 'user',
        targetId: staff.id,
        ipAddress: ip,
      });

      res.json({
        token,
        user: {
          id: staff.id,
          role: staff.role,
          username: staff.username,
          fullName: staff.full_name,
          assignedClassIds,
          assignedExamIds,
          canUnlockSessions,
        },
      });
      return;
    }

    // 2. Check student account by NIS + NISN
    const student = db.prepare(`
      SELECT s.*, c.name as class_name
      FROM students s
      JOIN classes c ON c.id = s.class_id
      WHERE s.nis = ? AND s.nisn = ?
    `).get(cleanId, cleanSecret) as
      | {
          id: string;
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
          photo_path: string | null;
          is_active: number;
        }
      | undefined;

    if (student) {
      if (!student.is_active) {
        res.status(403).json({ error: 'Akun peserta dinonaktifkan oleh admin. Hubungi panitia ujian.' });
        return;
      }

      db.prepare('DELETE FROM login_attempts WHERE identifier = ?').run(attemptKey);

      const sessionTokenId = crypto.randomUUID();
      const token = signToken({
        userId: student.id,
        role: 'siswa',
        name: student.full_name,
        studentId: student.id,
        nis: student.nis,
        classId: student.class_id,
        sessionTokenId,
      });

      setSessionCookie(req, res, token);

      writeAuditLog({
        actorId: student.id,
        actorRole: 'siswa',
        actorName: student.full_name,
        action: 'STUDENT_LOGIN',
        targetType: 'student',
        targetId: student.id,
        details: { nis: student.nis },
        ipAddress: ip,
      });

      const resolvedPhotoUrl = student.photo_link
        ? student.photo_link
        : student.photo_path
        ? `/api/photos/student/${student.id}`
        : null;

      res.json({
        token,
        user: {
          id: student.id,
          role: 'siswa',
          fullName: student.full_name,
          nis: student.nis,
          nisn: student.nisn,
          birthPlace: student.birth_place || '',
          birthDate: student.birth_date || '',
          gender: student.gender || '',
          email: student.email || '',
          photoLink: student.photo_link || '',
          classId: student.class_id,
          className: student.class_name,
          hasPhoto: Boolean(resolvedPhotoUrl),
          photoUrl: resolvedPhotoUrl,
        },
      });
      return;
    }

    recordFailure();
    res.status(401).json({ error: 'NIS / Username atau NISN / Kata Sandi tidak sesuai.' });
  });

  router.post('/auth/logout', (req, res) => {
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      sameSite: isHttps ? 'none' : 'lax',
      secure: isHttps,
    });
    res.json({ ok: true });
  });

  router.get('/auth/me', requireAuth, (req, res) => {
    const auth = req.auth!;
    if (auth.role === 'siswa') {
      const s = db.prepare(`
        SELECT s.id, s.nis, s.nisn, s.pin_display, s.full_name, s.birth_place, s.birth_date, s.gender, s.email, s.photo_link, s.class_id, c.name as class_name, s.photo_path
        FROM students s JOIN classes c ON c.id = s.class_id
        WHERE s.id = ? AND s.is_active = 1
      `).get(auth.studentId!) as
        | { id: string; nis: string; nisn: string; pin_display: string; full_name: string; birth_place: string; birth_date: string; gender: string; email: string; photo_link: string; class_id: string; class_name: string; photo_path: string | null }
        | undefined;
      if (!s) {
        res.status(401).json({ error: 'Siswa tidak ditemukan atau nonaktif.' });
        return;
      }
      const secSetting = getSetting<Record<string, unknown>>('security', {});
      const cardCfg = normalizeParticipantCardConfig(secSetting.participantCard);
      const resolvedPhotoUrl = s.photo_link
        ? s.photo_link
        : s.photo_path
        ? `/api/photos/student/${s.id}`
        : null;
      res.json({
        user: {
          id: s.id,
          role: 'siswa',
          fullName: s.full_name,
          nis: s.nis,
          nisn: s.nisn,
          birthPlace: s.birth_place || '',
          birthDate: s.birth_date || '',
          gender: s.gender || '',
          email: s.email || '',
          photoLink: s.photo_link || '',
          pinDisplay: cardCfg.enabled && cardCfg.showPinOnCard ? s.pin_display : undefined,
          classId: s.class_id,
          className: s.class_name,
          hasPhoto: Boolean(resolvedPhotoUrl),
          photoUrl: resolvedPhotoUrl,
        },
      });
      return;
    }

    const staff = db.prepare('SELECT id, username, full_name, role, assigned_class_ids_json, assigned_exam_ids_json, can_unlock_sessions FROM users WHERE id = ? AND is_active = 1').get(auth.userId) as
      | { id: string; username: string; full_name: string; role: 'admin' | 'pengawas'; assigned_class_ids_json: string; assigned_exam_ids_json: string; can_unlock_sessions: number }
      | undefined;
    if (!staff) {
      res.status(401).json({ error: 'Akun staff tidak aktif.' });
      return;
    }
    res.json({
      user: {
        id: staff.id,
        role: staff.role,
        username: staff.username,
        fullName: staff.full_name,
        assignedClassIds: JSON.parse(staff.assigned_class_ids_json || '[]'),
        assignedExamIds: JSON.parse(staff.assigned_exam_ids_json || '[]'),
        canUnlockSessions: Boolean(staff.can_unlock_sessions),
      },
    });
  });

  // ======================== PRIVATE RBAC MEDIA & PHOTO DELIVERY ========================
  router.get('/photos/student/:studentId', requireAuth, (req, res) => {
    const { studentId } = req.params;
    const auth = req.auth!;

    const student = db.prepare('SELECT id, class_id, photo_path, photo_mime FROM students WHERE id = ?').get(studentId) as
      | { id: string; class_id: string; photo_path: string | null; photo_mime: string | null }
      | undefined;

    if (!student) {
      res.status(404).json({ error: 'Siswa tidak ditemukan.' });
      return;
    }

    // Strict RBAC check
    if (auth.role === 'siswa') {
      if (auth.studentId !== student.id) {
        res.status(403).json({ error: 'Akses foto ditolak: siswa hanya dapat mengakses foto miliknya sendiri.' });
        return;
      }
    } else if (auth.role === 'pengawas') {
      if (!canAccessClassOrExam(auth, student.class_id, null)) {
        res.status(403).json({ error: 'Akses foto ditolak: siswa di luar kelas binaan pengawas.' });
        return;
      }
    }

    if (!student.photo_path) {
      res.status(404).json({ error: 'Foto resmi belum diunggah.' });
      return;
    }

    const buf = readPrivateStudentPhoto(student.photo_path);
    if (!buf) {
      res.status(404).json({ error: 'Berkas foto tidak ditemukan di penyimpanan privat.' });
      return;
    }

    res.setHeader('Content-Type', student.photo_mime || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=120');
    res.send(buf);
  });

  router.get('/media/:filename', requireAuth, (req, res) => {
    const safeName = path.basename(req.params.filename);
    const fullPath = path.join(MEDIA_DIR, safeName);
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Media tidak ditemukan.' });
      return;
    }
    res.sendFile(fullPath);
  });

  // ======================== STUDENT PORTAL & EXAM ENGINE ========================
  router.get('/student/dashboard', requireAuth, requireRole(['siswa']), (req, res) => {
    const auth = req.auth!;
    const studentId = auth.studentId!;
    const classId = auth.classId!;
    const nowMs = Date.now();

    const exams = db.prepare(`
      SELECT e.*, sub.name as subject_name, sub.code as subject_code,
             sch.timezone, sch.start_at, sch.entry_deadline_at, sch.end_at, sch.status as schedule_status
      FROM exams e
      JOIN subjects sub ON sub.id = e.subject_id
      JOIN exam_schedules sch ON sch.exam_id = e.id
      ORDER BY sch.start_at DESC
    `).all() as Array<Record<string, unknown> & {
      id: string;
      class_ids_json: string;
      assigned_student_ids_json: string;
      start_at: string;
      entry_deadline_at: string;
      end_at: string;
      publication_policy: string;
      publish_at: string | null;
    }>;

    const sessions = db.prepare(`
      SELECT es.*, sc.final_score, sc.raw_points, sc.max_points, sc.correct_count, sc.partial_count, sc.wrong_count, sc.blank_count, sc.passed, sc.graded_at
      FROM exam_sessions es
      LEFT JOIN scores sc ON sc.session_id = es.id
      WHERE es.student_id = ?
    `).all(studentId) as Array<Record<string, unknown> & { exam_id: string; status: string }>;
    const sessionByExam = new Map(sessions.map((s) => [s.exam_id, s]));

    // Auto-unlock any student sessions whose timed lock duration has already elapsed
    for (const s of sessions) {
      if (s.status === 'locked' && s.locked_until) {
        const resUnlock = checkAndApplyAutoUnlockForSession(String(s.id));
        if (resUnlock.unlocked) {
          s.status = 'in_progress';
          s.lock_reason = null;
          s.locked_until = null;
        }
      }
    }

    const visibleExams = exams
      .filter((e) => {
        const classIds = JSON.parse(e.class_ids_json || '[]') as string[];
        const stuIds = JSON.parse(e.assigned_student_ids_json || '[]') as string[];
        return classIds.includes(classId) || stuIds.includes(studentId);
      })
      .map((e) => {
        const sess = sessionByExam.get(e.id);
        const clsCfg = resolveExamConfigForClass(e, classId);
        if (!clsCfg.enabled && !sess) {
          return null;
        }
        const startMs = new Date(clsCfg.startAt).getTime();
        const deadlineMs = new Date(clsCfg.entryDeadlineAt).getTime();
        const endMs = new Date(clsCfg.endAt).getTime();

        let availability: 'upcoming' | 'open' | 'in_progress' | 'locked' | 'completed' | 'missed' = 'upcoming';
        if (sess) {
          if (sess.status === 'submitted' || sess.status === 'expired') availability = 'completed';
          else if (sess.status === 'locked') availability = 'locked';
          else availability = 'in_progress';
        } else if (nowMs < startMs) {
          availability = 'upcoming';
        } else if (nowMs <= deadlineMs && nowMs <= endMs) {
          availability = 'open';
        } else {
          availability = 'missed';
        }

        // Enforce backend publication policy (including per-class override)!
        const publishAtMs = e.publish_at ? new Date(e.publish_at).getTime() : 0;
        const isPublished = clsCfg.publicationPolicy !== 'hidden' && (!e.publish_at || nowMs >= publishAtMs);

        return {
          id: e.id,
          title: e.title,
          examType: e.exam_type,
          subjectName: e.subject_name,
          subjectCode: e.subject_code,
          durationMinutes: clsCfg.durationMinutes,
          questionCount: e.question_count,
          passingScore: e.passing_score,
          autoLockEnabled: Boolean(e.auto_lock_enabled),
          requireFullscreen: Boolean(e.require_fullscreen),
          requireCamera: Boolean(e.require_camera),
          requireExamWifi: Boolean(e.require_exam_wifi),
          allowedWifiSsid: String(e.allowed_wifi_ssid || ''),
          maxViolations: e.max_violations,
          proctoringEnabled: Boolean(e.proctoring_enabled),
          allowCameraStream: Boolean(e.allow_camera_stream),
          timezone: e.timezone,
          startAt: clsCfg.startAt,
          entryDeadlineAt: clsCfg.entryDeadlineAt,
          endAt: clsCfg.endAt,
          availability,
          publicationPolicy: isPublished ? clsCfg.publicationPolicy : 'hidden',
          historyVisible: clsCfg.historyVisible,
          usesExamToken: clsCfg.usesExamToken,
          session: sess
            ? {
                id: sess.id,
                status: sess.status,
                startedAt: sess.started_at,
                serverEndAt: sess.server_end_at,
                submittedAt: sess.submitted_at,
                lockReason: sess.lock_reason,
                lockedUntil: sess.locked_until || null,
                violationCount: sess.violation_count,
                violationPoints: sess.violation_points ?? sess.violation_count,
              }
            : null,
          result:
            sess && (sess.status === 'submitted' || sess.status === 'expired') && isPublished
              ? {
                  finalScore: sess.final_score,
                  rawPoints: sess.raw_points,
                  maxPoints: sess.max_points,
                  correctCount: sess.correct_count,
                  partialCount: sess.partial_count,
                  wrongCount: sess.wrong_count,
                  blankCount: sess.blank_count,
                  passed: Boolean(sess.passed),
                  gradedAt: sess.graded_at,
                }
              : null,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    const secSetting = getSetting<Record<string, unknown>>('security', { showStudentExamHistory: true });
    const showStudentHistory = secSetting.showStudentExamHistory !== false;
    const participantCard = normalizeParticipantCardConfig(secSetting.participantCard);
    const studentPinRow =
      participantCard.enabled && participantCard.showPinOnCard
        ? (db.prepare('SELECT pin_display FROM students WHERE id = ?').get(studentId) as { pin_display?: string } | undefined)
        : undefined;
    const finalExams = showStudentHistory
      ? visibleExams.filter((e) => {
          const isHistoryExam = e.availability === 'completed' || e.availability === 'missed';
          return !isHistoryExam || e.historyVisible !== false;
        })
      : visibleExams.filter((e) => e.availability !== 'completed' && e.availability !== 'missed');

    res.json({
      serverTime: new Date().toISOString(),
      showStudentHistory,
      participantCard,
      studentPin: studentPinRow?.pin_display || undefined,
      exams: finalExams,
    });
  });

  // Start or resume an exam session
  router.post('/student/exams/:examId/start', requireAuth, requireRole(['siswa']), (req, res) => {
    const auth = req.auth!;
    const studentId = auth.studentId!;
    const { examId } = req.params;
    const { pin, token, deviceFingerprint, forceTakeover, deviceType, deviceBrand } = req.body || {};
    const cleanPin = String(pin ?? token ?? '').trim();
    const ip = req.ip || '127.0.0.1';
    const ua = String(req.headers['user-agent'] || '');
    const resolvedDeviceType = String(deviceType || (/Android/i.test(ua) ? 'android' : /iPad|iPhone/i.test(ua) ? 'ios_ipad' : 'desktop')).slice(0, 32);
    const resolvedDeviceBrand = detectDeviceBrandFromUserAgent(ua, deviceBrand);
    const secRaw = getSetting<Record<string, unknown>>('security', {});
    const violationPolicy = normalizeViolationPolicy(secRaw.violationPolicy);

    if (!cleanPin) {
      res.status(400).json({ error: 'PIN / Password Ujian / Token wajib diisi untuk memulai ujian.' });
      return;
    }

    const exam = db.prepare(`
      SELECT e.*, sub.name as subject_name, sch.start_at, sch.entry_deadline_at, sch.end_at
      FROM exams e
      JOIN subjects sub ON sub.id = e.subject_id
      JOIN exam_schedules sch ON sch.exam_id = e.id
      WHERE e.id = ?
    `).get(examId) as
      | (Record<string, unknown> & {
          id: string;
          title: string;
          subject_name: string;
          class_ids_json: string;
          assigned_student_ids_json: string;
          question_bank_id: string;
          question_count: number;
          shuffle_mode: ShuffleMode;
          shuffle_questions: number;
          shuffle_options: number;
          composition_json: string | null;
          duration_minutes: number;
          max_violations: number;
          auto_lock_enabled: number;
          require_fullscreen: number;
          proctoring_enabled: number;
          proctoring_sensitivity: string;
          proctoring_tolerance: number;
          allow_camera_stream: number;
          access_token_mode?: string;
          access_token?: string;
          start_at: string;
          entry_deadline_at: string;
          end_at: string;
        })
      | undefined;

    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }

    const allowedClasses = JSON.parse(exam.class_ids_json || '[]') as string[];
    const allowedStudents = JSON.parse(exam.assigned_student_ids_json || '[]') as string[];
    if (!allowedClasses.includes(auth.classId!) && !allowedStudents.includes(studentId)) {
      res.status(403).json({ error: 'Anda tidak terdaftar sebagai peserta pada ujian ini.' });
      return;
    }

    const clsCfg = resolveExamConfigForClass(exam, auth.classId!);
    if (!clsCfg.enabled) {
      res.status(403).json({ error: 'Ujian saat ini dinonaktifkan untuk kelas Anda.' });
      return;
    }

    // Verify exam access token or student exam PIN with brute-force protection
    const pinAttemptKey = `exampin:${studentId}`;
    const pinAttempt = db.prepare('SELECT * FROM login_attempts WHERE identifier = ?').get(pinAttemptKey) as
      | { fail_count: number; locked_until: string | null }
      | undefined;

    if (pinAttempt?.locked_until && new Date(pinAttempt.locked_until).getTime() > Date.now()) {
      const waitSec = Math.ceil((new Date(pinAttempt.locked_until).getTime() - Date.now()) / 1000);
      res.status(429).json({
        error: `Terlalu banyak percobaan PIN / Token salah. Coba lagi dalam ${waitSec} detik atau hubungi pengawas untuk reset PIN.`,
      });
      return;
    }

    const studentRecord = db.prepare('SELECT pin_hash, is_active FROM students WHERE id = ?').get(studentId) as
      | { pin_hash: string; is_active: number }
      | undefined;

    if (!studentRecord || !studentRecord.is_active) {
      res.status(403).json({ error: 'Akun peserta tidak aktif. Hubungi panitia ujian.' });
      return;
    }

    const usesExamToken = clsCfg.usesExamToken;
    const tokenValid = usesExamToken
      ? cleanPin === clsCfg.accessToken
      : bcrypt.compareSync(cleanPin, studentRecord.pin_hash);

    if (!tokenValid) {
      const nextCount = (pinAttempt?.fail_count || 0) + 1;
      const lockedUntil = nextCount >= 5 ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null;
      db.prepare(`
        INSERT INTO login_attempts (identifier, ip_address, fail_count, locked_until, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(identifier) DO UPDATE SET fail_count = excluded.fail_count, locked_until = excluded.locked_until, updated_at = excluded.updated_at
      `).run(pinAttemptKey, ip, nextCount, lockedUntil, new Date().toISOString());
      res.status(401).json({
        error: usesExamToken
          ? 'Token ujian tidak sesuai. Periksa kembali token khusus ujian ini atau hubungi pengawas.'
          : 'PIN / Password Ujian tidak sesuai. Periksa kembali atau hubungi panitia.',
      });
      return;
    }

    db.prepare('DELETE FROM login_attempts WHERE identifier = ?').run(pinAttemptKey);

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    let session = db.prepare('SELECT * FROM exam_sessions WHERE exam_id = ? AND student_id = ?').get(examId, studentId) as
      | {
          id: string;
          package_id: string;
          rubric_id: string;
          session_token_hash: string;
          device_fingerprint: string;
          device_type: string;
          device_brand: string;
          status: string;
          started_at: string;
          server_end_at: string;
          violation_count: number;
          violation_points: number;
          lock_reason: string | null;
          locked_until: string | null;
        }
      | undefined;

    if (!session) {
      // Verify schedule window (with per-class override) before creating new session
      const startMs = new Date(clsCfg.startAt).getTime();
      const deadlineMs = new Date(clsCfg.entryDeadlineAt).getTime();
      if (nowMs < startMs) {
        res.status(403).json({ error: 'Ujian belum dimulai sesuai jadwal kelas Anda.' });
        return;
      }
      if (nowMs > deadlineMs) {
        res.status(403).json({ error: 'Batas akhir masuk ujian untuk kelas Anda telah terlewati.' });
        return;
      }

      const rubricRow = db.prepare('SELECT id, weights_json FROM scoring_rubrics WHERE exam_id = ? ORDER BY version DESC LIMIT 1').get(examId) as
        | { id: string; weights_json: string }
        | undefined;
      const rubricWeights: ScoringWeights = rubricRow ? JSON.parse(rubricRow.weights_json) : DEFAULT_SCORING_WEIGHTS;
      const rubricId = rubricRow?.id || (() => {
        const rid = `rub_${crypto.randomUUID().slice(0, 8)}`;
        db.prepare('INSERT INTO scoring_rubrics (id, exam_id, version, weights_json, created_at) VALUES (?, ?, 1, ?, ?)').run(
          rid,
          examId,
          JSON.stringify(DEFAULT_SCORING_WEIGHTS),
          nowIso
        );
        return rid;
      })();

      const pkg = assignOrCreatePackageForSession({
        examId,
        studentId,
        bankId: exam.question_bank_id,
        questionCount: exam.question_count,
        shuffleMode: exam.shuffle_mode,
        shuffleQuestions: Boolean(exam.shuffle_questions),
        shuffleOptions: Boolean(exam.shuffle_options),
        compositionJson: exam.composition_json,
        rubricWeights,
      });

      const scheduleEndMs = new Date(clsCfg.endAt).getTime();
      const durationEndMs = nowMs + clsCfg.durationMinutes * 60 * 1000;
      const effectiveEndMs = Math.min(scheduleEndMs, durationEndMs);

      const sessId = `ses_${crypto.randomUUID().slice(0, 12)}`;
      const fp = String(deviceFingerprint || req.headers['user-agent'] || 'browser').slice(0, 120);
      const tokenHash = crypto.createHash('sha256').update(auth.sessionTokenId || sessId).digest('hex');

      db.prepare(`
        INSERT INTO exam_sessions (id, exam_id, student_id, package_id, rubric_id, session_token_hash, device_fingerprint, device_type, device_brand, status, started_at, server_end_at, last_heartbeat_at, last_sync_at, connection_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_progress', ?, ?, ?, ?, 'online')
      `).run(sessId, examId, studentId, pkg.packageId, rubricId, tokenHash, fp, resolvedDeviceType, resolvedDeviceBrand, nowIso, new Date(effectiveEndMs).toISOString(), nowIso, nowIso);

      session = db.prepare('SELECT * FROM exam_sessions WHERE id = ?').get(sessId) as typeof session;

      realtimeHub.queueMonitorUpdate({
        kind: 'session_started',
        priority: 'normal',
        examId,
        sessionId: sessId,
        studentId,
        status: 'in_progress',
        timestamp: nowIso,
      });
    } else {
      // Auto-unlock if timed lock already expired
      if (session.status === 'locked' && session.locked_until) {
        const autoUnlockRes = checkAndApplyAutoUnlockForSession(session.id);
        if (autoUnlockRes.unlocked) {
          session = db.prepare('SELECT * FROM exam_sessions WHERE id = ?').get(session.id) as typeof session;
        }
      }

      // Check if time already expired on server!
      if (nowMs >= new Date(session.server_end_at).getTime() && (session.status === 'in_progress' || session.status === 'locked')) {
        finalizeAndGradeSession(session.id, 'expired');
        res.status(409).json({ error: 'Waktu ujian telah habis menurut server dan jawaban Anda telah dikumpulkan.' });
        return;
      }

      if (session.status === 'submitted' || session.status === 'expired') {
        res.status(409).json({ error: 'Sesi ujian Anda sudah selesai dan tidak dapat dibuka ulang.' });
        return;
      }

      const incomingTokenHash = crypto.createHash('sha256').update(auth.sessionTokenId || session.id).digest('hex');

      // Log "Login ulang di tengah ujian" when student closed app/relogged in with a new auth token
      if (session.session_token_hash !== incomingTokenHash) {
        const isDifferentDevice =
          Boolean(session.device_fingerprint) &&
          Boolean(deviceFingerprint) &&
          session.device_fingerprint !== String(deviceFingerprint).slice(0, 120);

        const reloginEval = evaluateViolationAgainstPolicy({
          policy: violationPolicy,
          eventType: isDifferentDevice ? 'sesi_ganda_terdeteksi' : 'login_ulang_tengah_ujian',
          deviceBrand: resolvedDeviceBrand,
          autoLockEnabled: Boolean(exam.auto_lock_enabled),
          currentPoints: session.violation_points ?? session.violation_count,
          maxViolationPoints: exam.max_violations,
        });

        if (!reloginEval.ignored) {
          const nextOcc = session.violation_count + 1;
          db.prepare(`
            INSERT INTO violation_logs (
              id, session_id, exam_id, student_id, event_type, details_json,
              device_type, device_brand, points_added, is_excused, excuse_reason,
              occurrence_number, triggered_lock, server_timestamp
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            crypto.randomUUID(),
            session.id,
            examId,
            studentId,
            isDifferentDevice ? 'sesi_ganda_terdeteksi' : 'login_ulang_tengah_ujian',
            JSON.stringify({
              previousDevice: session.device_fingerprint,
              newDevice: String(deviceFingerprint || '').slice(0, 120),
              reloginDetected: true,
            }),
            resolvedDeviceType,
            resolvedDeviceBrand,
            reloginEval.pointsAdded,
            reloginEval.isExcused ? 1 : 0,
            reloginEval.excuseReason,
            nextOcc,
            reloginEval.willLock ? 1 : 0,
            nowIso
          );

          db.prepare(`
            UPDATE exam_sessions
            SET violation_count = ?,
                violation_points = ?,
                status = CASE WHEN ? = 1 THEN 'locked' ELSE status END,
                lock_reason = COALESCE(?, lock_reason),
                locked_until = COALESCE(?, locked_until),
                locked_by_event_type = COALESCE(?, locked_by_event_type)
            WHERE id = ?
          `).run(
            nextOcc,
            reloginEval.nextPoints,
            reloginEval.willLock ? 1 : 0,
            reloginEval.lockReason,
            reloginEval.lockedUntil,
            reloginEval.willLock ? (isDifferentDevice ? 'sesi_ganda_terdeteksi' : 'login_ulang_tengah_ujian') : null,
            session.id
          );

          realtimeHub.queueMonitorUpdate({
            kind: 'violation_logged',
            priority: reloginEval.willLock ? 'high' : 'normal',
            examId,
            sessionId: session.id,
            studentId,
            eventType: isDifferentDevice ? 'sesi_ganda_terdeteksi' : 'login_ulang_tengah_ujian',
            violationCount: nextOcc,
            locked: reloginEval.willLock,
            timestamp: nowIso,
          });
        }

        if (isDifferentDevice && !forceTakeover) {
          res.status(409).json({
            error: 'Terdeteksi sesi ujian aktif pada perangkat/browser lain. Peristiwa ini tercatat pada log pengawasan.',
            code: 'DUPLICATE_SESSION_DETECTED',
          });
          return;
        }
      }

      db.prepare(`
        UPDATE exam_sessions
        SET session_token_hash = ?, device_type = ?, device_brand = CASE WHEN ? != '' THEN ? ELSE device_brand END,
            last_heartbeat_at = ?, connection_status = 'online'
        WHERE id = ?
      `).run(incomingTokenHash, resolvedDeviceType, resolvedDeviceBrand, resolvedDeviceBrand, nowIso, session.id);
      session = db.prepare('SELECT * FROM exam_sessions WHERE id = ?').get(session.id) as typeof session;
    }

    // Load fixed/assigned package (NEVER regenerates!)
    const pkgRow = db.prepare('SELECT * FROM exam_packages WHERE id = ?').get(session!.package_id) as {
      id: string;
      package_code: string;
      question_ids_json: string;
      option_orders_json: string;
    };
    const qIds = JSON.parse(pkgRow.question_ids_json) as string[];
    const optionOrders = JSON.parse(pkgRow.option_orders_json || '{}') as Record<string, OptionOrderSpec>;
    const placeholders = qIds.map(() => '?').join(',');
    const qRows = qIds.length > 0
      ? (db.prepare(`SELECT * FROM questions WHERE id IN (${placeholders})`).all(...qIds) as QuestionRecord[])
      : [];
    const qMap = new Map(qRows.map((q) => [q.id, q]));
    const orderedQuestions = qIds
      .map((id) => qMap.get(id))
      .filter((q): q is QuestionRecord => Boolean(q))
      .map((q) => serializeQuestionForStudent(q, optionOrders[q.id]));

    // Load existing answers
    const savedAnswers = db.prepare('SELECT question_id, answer_json, is_doubtful, client_version, server_version, saved_at FROM student_answers WHERE session_id = ?').all(session!.id) as Array<{
      question_id: string;
      answer_json: string | null;
      is_doubtful: number;
      client_version: number;
      server_version: number;
      saved_at: string;
    }>;

    const answersMap: Record<string, { answer: unknown; isDoubtful: boolean; version: number; savedAt: string }> = {};
    for (const a of savedAnswers) {
      answersMap[a.question_id] = {
        answer: a.answer_json ? JSON.parse(a.answer_json) : null,
        isDoubtful: Boolean(a.is_doubtful),
        version: a.client_version,
        savedAt: a.saved_at,
      };
    }

    res.json({
      serverTime: nowIso,
      violationPolicy,
      session: {
        id: session!.id,
        examId: exam.id,
        examTitle: exam.title,
        subjectName: exam.subject_name,
        packageCode: pkgRow.package_code,
        status: session!.status,
        startedAt: session!.started_at,
        serverEndAt: session!.server_end_at,
        violationCount: session!.violation_count,
        violationPoints: session!.violation_points ?? session!.violation_count,
        maxViolations: exam.max_violations,
        autoLockEnabled: Boolean(exam.auto_lock_enabled),
        requireFullscreen: Boolean(exam.require_fullscreen),
        requireCamera: Boolean(exam.require_camera),
        requireExamWifi: Boolean(exam.require_exam_wifi),
        allowedWifiSsid: String(exam.allowed_wifi_ssid || ''),
        lockReason: session!.lock_reason,
        lockedUntil: session!.locked_until || null,
        proctoring: {
          enabled: Boolean(exam.proctoring_enabled),
          sensitivity: exam.proctoring_sensitivity,
          tolerance: exam.proctoring_tolerance,
          allowCameraStream: Boolean(exam.allow_camera_stream),
        },
      },
      questions: orderedQuestions,
      answers: answersMap,
    });
  });

  // Batch & Conflict-Safe Autosave Endpoint
  router.post('/student/sessions/:sessionId/answers', requireAuth, requireRole(['siswa']), (req, res) => {
    const auth = req.auth!;
    const { sessionId } = req.params;
    const { items } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Data jawaban kosong.' });
      return;
    }

    const session = db.prepare('SELECT * FROM exam_sessions WHERE id = ? AND student_id = ?').get(sessionId, auth.studentId!) as
      | { id: string; exam_id: string; status: string; server_end_at: string }
      | undefined;

    if (!session) {
      res.status(404).json({ error: 'Sesi ujian tidak ditemukan.' });
      return;
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    if (nowMs > new Date(session.server_end_at).getTime() + 15000) {
      finalizeAndGradeSession(session.id, 'expired');
      res.status(409).json({ error: 'Waktu ujian telah berakhir menurut jam server.', status: 'expired' });
      return;
    }

    if (session.status === 'submitted' || session.status === 'expired') {
      res.status(409).json({ error: 'Ujian sudah dikumpulkan.', status: session.status });
      return;
    }

    if (session.status === 'locked') {
      const autoUnlocked = checkAndApplyAutoUnlockForSession(session.id);
      if (!autoUnlocked.unlocked) {
        res.status(423).json({ error: 'Sesi sedang terkunci. Tunggu buka kunci otomatis atau hubungi pengawas sebelum menyimpan perubahan baru.', status: 'locked' });
        return;
      }
    }

    const selectExisting = db.prepare('SELECT client_version FROM student_answers WHERE session_id = ? AND question_id = ?');
    const upsertStmt = db.prepare(`
      INSERT INTO student_answers (id, session_id, question_id, answer_json, is_doubtful, client_version, server_version, saved_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(session_id, question_id) DO UPDATE SET
        answer_json = excluded.answer_json,
        is_doubtful = excluded.is_doubtful,
        client_version = excluded.client_version,
        server_version = server_version + 1,
        saved_at = excluded.saved_at
    `);

    const savedResults: Array<{ questionId: string; status: 'saved' | 'stale_ignored'; serverVersion: number }> = [];

    const tx = db.transaction(() => {
      for (const item of items) {
        const qId = String(item.questionId || '');
        const clientVer = Number(item.clientVersion || 1);
        const isDoubtful = item.isDoubtful ? 1 : 0;
        const answerJson = item.answer === undefined ? null : JSON.stringify(item.answer);

        const existing = selectExisting.get(sessionId, qId) as { client_version: number } | undefined;
        if (existing && clientVer < existing.client_version) {
          savedResults.push({ questionId: qId, status: 'stale_ignored', serverVersion: existing.client_version });
          continue;
        }

        upsertStmt.run(crypto.randomUUID(), sessionId, qId, answerJson, isDoubtful, clientVer, nowIso);
        savedResults.push({ questionId: qId, status: 'saved', serverVersion: clientVer });
      }

      db.prepare(`UPDATE exam_sessions SET last_heartbeat_at = ?, last_sync_at = ?, connection_status = 'online' WHERE id = ?`).run(
        nowIso,
        nowIso,
        sessionId
      );
    });
    tx();

    realtimeHub.queueMonitorUpdate({
      kind: 'answer_synced',
      examId: session.exam_id,
      sessionId,
      timestamp: nowIso,
    });

    res.json({
      serverTime: nowIso,
      savedCount: savedResults.filter((r) => r.status === 'saved').length,
      results: savedResults,
    });
  });

  // Heartbeat & session lock/auto-unlock status polling
  router.post('/student/sessions/:sessionId/heartbeat', requireAuth, requireRole(['siswa']), (req, res) => {
    const auth = req.auth!;
    const { sessionId } = req.params;
    let session = db.prepare('SELECT id, exam_id, status, server_end_at, lock_reason, locked_until, violation_count, violation_points FROM exam_sessions WHERE id = ? AND student_id = ?').get(sessionId, auth.studentId!) as
      | { id: string; exam_id: string; status: string; server_end_at: string; lock_reason: string | null; locked_until: string | null; violation_count: number; violation_points: number }
      | undefined;

    if (!session) {
      res.status(404).json({ error: 'Sesi tidak ditemukan.' });
      return;
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    if ((session.status === 'in_progress' || session.status === 'locked') && nowMs >= new Date(session.server_end_at).getTime()) {
      finalizeAndGradeSession(session.id, 'expired');
      res.json({ serverTime: nowIso, status: 'expired', serverEndAt: session.server_end_at });
      return;
    }

    if (session.status === 'locked' && session.locked_until) {
      const autoUnlockRes = checkAndApplyAutoUnlockForSession(session.id);
      if (autoUnlockRes.unlocked) {
        session = db.prepare('SELECT id, exam_id, status, server_end_at, lock_reason, locked_until, violation_count, violation_points FROM exam_sessions WHERE id = ?').get(session.id) as typeof session;
        realtimeHub.sendToStudent(session.id, {
          type: 'session:unlocked',
          notes: autoUnlockRes.unlockNotes,
          autoUnlocked: true,
          timestamp: nowIso,
        });
        realtimeHub.queueMonitorUpdate({
          kind: 'session_unlocked',
          priority: 'high',
          examId: session.exam_id,
          sessionId: session.id,
          studentId: auth.studentId!,
          status: 'in_progress',
          timestamp: nowIso,
        });
      }
    }

    db.prepare(`UPDATE exam_sessions SET last_heartbeat_at = ?, connection_status = 'online' WHERE id = ?`).run(nowIso, sessionId);

    res.json({
      serverTime: nowIso,
      status: session.status,
      serverEndAt: session.server_end_at,
      lockReason: session.lock_reason,
      lockedUntil: session.locked_until,
      violationCount: session.violation_count,
      violationPoints: session.violation_points ?? session.violation_count,
    });
  });

  // Submit exam
  router.post('/student/sessions/:sessionId/submit', requireAuth, requireRole(['siswa']), (req, res) => {
    const auth = req.auth!;
    const { sessionId } = req.params;
    let session = db.prepare('SELECT id, status FROM exam_sessions WHERE id = ? AND student_id = ?').get(sessionId, auth.studentId!) as
      | { id: string; status: string }
      | undefined;

    if (!session) {
      res.status(404).json({ error: 'Sesi tidak ditemukan.' });
      return;
    }
    if (session.status === 'locked') {
      const autoUnlockRes = checkAndApplyAutoUnlockForSession(session.id);
      if (!autoUnlockRes.unlocked) {
        res.status(423).json({ error: 'Sesi terkunci. Hubungi pengawas untuk membuka kunci atau pengawas dapat mengumpulkan sesi.' });
        return;
      }
    }

    const score = finalizeAndGradeSession(sessionId, 'submitted');
    res.json({ ok: true, status: 'submitted', graded: Boolean(score) });
  });

  // Observed browser / device violation event (device-aware, gadget brand exception, points & auto-unlock)
  router.post('/student/sessions/:sessionId/violations', requireAuth, requireRole(['siswa']), (req, res) => {
    const auth = req.auth!;
    const { sessionId } = req.params;
    const { eventType, details, deviceType, deviceBrand, durationSeconds } = req.body || {};

    const cleanType = String(eventType || 'peristiwa_browser').slice(0, 64);

    // Back button is NEVER counted as a violation, only rejected cleanly on the client
    if (cleanType === 'tombol_back' || cleanType === 'back_button') {
      res.json({ ignored: true, reason: 'Tombol Back ditolak sistem dan tidak dihitung sebagai pelanggaran.' });
      return;
    }

    const session = db.prepare(`
      SELECT es.*, e.max_violations, e.auto_lock_enabled
      FROM exam_sessions es
      JOIN exams e ON e.id = es.exam_id
      WHERE es.id = ? AND es.student_id = ?
    `).get(sessionId, auth.studentId!) as
      | {
          id: string;
          exam_id: string;
          student_id: string;
          status: string;
          violation_count: number;
          violation_points: number;
          max_violations: number;
          auto_lock_enabled: number;
          device_type: string;
          device_brand: string;
          lock_reason: string | null;
          locked_until: string | null;
        }
      | undefined;

    if (!session) {
      res.status(404).json({ error: 'Sesi tidak ditemukan.' });
      return;
    }
    if (session.status === 'submitted' || session.status === 'expired') {
      res.json({ status: session.status, violationCount: session.violation_count, violationPoints: session.violation_points });
      return;
    }

    const ua = String(req.headers['user-agent'] || '');
    const resolvedDeviceType = String(deviceType || session.device_type || 'web').slice(0, 32);
    const resolvedDeviceBrand = detectDeviceBrandFromUserAgent(ua, deviceBrand || session.device_brand);
    const cleanDuration =
      durationSeconds !== undefined && durationSeconds !== null && Number.isFinite(Number(durationSeconds))
        ? Math.max(0, Math.round(Number(durationSeconds)))
        : null;

    const secRaw = getSetting<Record<string, unknown>>('security', {});
    const policy = normalizeViolationPolicy(secRaw.violationPolicy);

    const evaluated = evaluateViolationAgainstPolicy({
      policy,
      eventType: cleanType,
      deviceBrand: resolvedDeviceBrand,
      autoLockEnabled: Boolean(session.auto_lock_enabled),
      currentPoints: session.violation_points ?? session.violation_count,
      maxViolationPoints: session.max_violations,
      durationSeconds: cleanDuration,
    });

    if (evaluated.ignored) {
      res.json({
        ignored: true,
        status: session.status,
        violationCount: session.violation_count,
        violationPoints: session.violation_points,
        maxViolations: session.max_violations,
        locked: session.status === 'locked',
        lockReason: session.lock_reason,
        lockedUntil: session.locked_until,
      });
      return;
    }

    const nowIso = new Date().toISOString();
    const nextCount = session.violation_count + 1;
    const logId = crypto.randomUUID();
    const alreadyLocked = session.status === 'locked';
    const nextLocked = alreadyLocked || evaluated.willLock;
    const nextLockReason = evaluated.willLock ? evaluated.lockReason : session.lock_reason;
    const nextLockedUntil = evaluated.willLock ? evaluated.lockedUntil : session.locked_until;

    db.prepare(`
      INSERT INTO violation_logs (
        id, session_id, exam_id, student_id, event_type, details_json,
        device_type, device_brand, duration_seconds, points_added, is_excused, excuse_reason,
        occurrence_number, triggered_lock, server_timestamp
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      logId,
      session.id,
      session.exam_id,
      session.student_id,
      cleanType,
      JSON.stringify({ ...(details && typeof details === 'object' ? details : {}), label: evaluated.rule?.label || cleanType }),
      resolvedDeviceType,
      resolvedDeviceBrand,
      cleanDuration,
      evaluated.pointsAdded,
      evaluated.isExcused ? 1 : 0,
      evaluated.excuseReason,
      nextCount,
      evaluated.willLock ? 1 : 0,
      nowIso
    );

    let finalCount = nextCount;
    let finalPoints = evaluated.nextPoints;

    // Companion event: pressing Home button on Android is always accompanied by "Keluar dari aplikasi"
    if (cleanType === 'tombol_home' && !(details as Record<string, unknown> | undefined)?.skipCompanionExit) {
      const exitEval = evaluateViolationAgainstPolicy({
        policy,
        eventType: 'keluar_aplikasi',
        deviceBrand: resolvedDeviceBrand,
        autoLockEnabled: Boolean(session.auto_lock_enabled),
        currentPoints: finalPoints,
        maxViolationPoints: session.max_violations,
        durationSeconds: cleanDuration,
      });
      if (!exitEval.ignored) {
        finalCount += 1;
        finalPoints = exitEval.nextPoints;
        db.prepare(`
          INSERT INTO violation_logs (
            id, session_id, exam_id, student_id, event_type, details_json,
            device_type, device_brand, duration_seconds, points_added, is_excused, excuse_reason,
            occurrence_number, triggered_lock, server_timestamp
          )
          VALUES (?, ?, ?, ?, 'keluar_aplikasi', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          crypto.randomUUID(),
          session.id,
          session.exam_id,
          session.student_id,
          JSON.stringify({ accompaniedBy: 'tombol_home', label: 'Keluar dari aplikasi' }),
          resolvedDeviceType,
          resolvedDeviceBrand,
          cleanDuration,
          exitEval.pointsAdded,
          exitEval.isExcused ? 1 : 0,
          exitEval.excuseReason,
          finalCount,
          exitEval.willLock ? 1 : 0,
          nowIso
        );
        if (exitEval.willLock && !nextLocked) {
          db.prepare(`
            UPDATE exam_sessions
            SET violation_count = ?, violation_points = ?, status = 'locked', lock_reason = ?, locked_until = ?, locked_by_event_type = 'keluar_aplikasi'
            WHERE id = ?
          `).run(finalCount, finalPoints, exitEval.lockReason, exitEval.lockedUntil, session.id);
        }
      }
    }

    if (evaluated.willLock) {
      db.prepare(`
        UPDATE exam_sessions
        SET violation_count = ?, violation_points = ?, status = 'locked', lock_reason = ?, locked_until = ?, locked_by_event_type = ?
        WHERE id = ?
      `).run(finalCount, finalPoints, nextLockReason, nextLockedUntil, cleanType, session.id);
    } else {
      db.prepare(`
        UPDATE exam_sessions
        SET violation_count = ?, violation_points = ?, device_type = ?,
            device_brand = CASE WHEN ? != '' THEN ? ELSE device_brand END
        WHERE id = ?
      `).run(finalCount, finalPoints, resolvedDeviceType, resolvedDeviceBrand, resolvedDeviceBrand, session.id);
    }

    realtimeHub.queueMonitorUpdate({
      kind: 'violation_logged',
      priority: evaluated.willLock ? 'high' : 'normal',
      examId: session.exam_id,
      sessionId: session.id,
      studentId: session.student_id,
      eventType: cleanType,
      deviceType: resolvedDeviceType,
      deviceBrand: resolvedDeviceBrand,
      isExcused: evaluated.isExcused,
      excuseReason: evaluated.excuseReason,
      violationCount: finalCount,
      violationPoints: finalPoints,
      locked: nextLocked,
      timestamp: nowIso,
    });

    res.json({
      id: logId,
      status: nextLocked ? 'locked' : session.status,
      violationCount: finalCount,
      violationPoints: finalPoints,
      maxViolations: session.max_violations,
      locked: nextLocked,
      lockReason: nextLockReason,
      lockedUntil: nextLockedUntil,
      isExcused: evaluated.isExcused,
      excuseReason: evaluated.excuseReason,
      pointsAdded: evaluated.pointsAdded,
      mode: evaluated.rule?.mode || 'add_points',
      triggerSirenRedScreen: Boolean(evaluated.rule?.triggerSirenRedScreen),
    });
  });

  // Update away-duration seconds on an already-recorded exit/leave log once student returns
  router.patch('/student/sessions/:sessionId/violations/:logId/duration', requireAuth, requireRole(['siswa']), (req, res) => {
    const auth = req.auth!;
    const { sessionId, logId } = req.params;
    const durationSec = Math.max(0, Math.round(Number(req.body?.durationSeconds || 0)));

    const row = db
      .prepare('SELECT id FROM violation_logs WHERE id = ? AND session_id = ? AND student_id = ?')
      .get(logId, sessionId, auth.studentId!) as { id: string } | undefined;

    if (!row) {
      res.status(404).json({ error: 'Log pelanggaran tidak ditemukan.' });
      return;
    }

    db.prepare('UPDATE violation_logs SET duration_seconds = ? WHERE id = ?').run(durationSec, logId);
    res.json({ ok: true, durationSeconds: durationSec });
  });

  // On-device AI Proctoring Indicator (indicator ONLY, never automatic lock or accusation)
  router.post('/student/sessions/:sessionId/proctoring', requireAuth, requireRole(['siswa']), (req, res) => {
    const auth = req.auth!;
    const { sessionId } = req.params;
    const { indicatorType, confidence, note } = req.body || {};

    const session = db.prepare('SELECT id, exam_id, student_id, status FROM exam_sessions WHERE id = ? AND student_id = ?').get(sessionId, auth.studentId!) as
      | { id: string; exam_id: string; student_id: string; status: string }
      | undefined;
    if (!session) {
      res.status(404).json({ error: 'Sesi tidak ditemukan.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO proctoring_events (id, session_id, exam_id, student_id, indicator_type, confidence, note, review_status, server_timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'unreviewed', ?)
    `).run(
      id,
      session.id,
      session.exam_id,
      session.student_id,
      String(indicatorType || 'indikator_kamera').slice(0, 64),
      Number(confidence || 0),
      String(note || 'Indikator peninjauan pengawas (bukan bukti otomatis kecurangan).').slice(0, 255),
      nowIso
    );

    realtimeHub.queueMonitorUpdate({
      kind: 'proctoring_indicator',
      examId: session.exam_id,
      sessionId: session.id,
      studentId: session.student_id,
      indicatorType,
      timestamp: nowIso,
    });

    res.json({ ok: true, id });
  });

  // Student-Proctor Help Chat (Student can ONLY message proctor/admin, never other students)
  router.get('/chat/:examId/:studentId', requireAuth, (req, res) => {
    const auth = req.auth!;
    const { examId, studentId } = req.params;

    if (auth.role === 'siswa' && auth.studentId !== studentId) {
      res.status(403).json({ error: 'Siswa tidak diizinkan membaca pesan peserta lain.' });
      return;
    }

    const messages = db.prepare(`
      SELECT * FROM chat_messages
      WHERE exam_id = ? AND recipient_student_id = ?
      ORDER BY server_timestamp ASC
    `).all(examId, studentId);

    res.json({ messages });
  });

  router.post('/chat/:examId/:studentId', requireAuth, (req, res) => {
    const auth = req.auth!;
    const { examId, studentId } = req.params;
    const { message, sessionId } = req.body || {};
    const cleanMsg = String(message || '').trim();

    if (!cleanMsg || cleanMsg.length > 1000) {
      res.status(400).json({ error: 'Pesan tidak valid (1-1000 karakter).' });
      return;
    }

    if (auth.role === 'siswa' && auth.studentId !== studentId) {
      res.status(403).json({ error: 'Siswa tidak boleh mengirim pesan ke peserta lain.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO chat_messages (id, exam_id, session_id, sender_role, sender_id, sender_name, recipient_student_id, message, is_read, server_timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(id, examId, sessionId || null, auth.role, auth.userId, auth.name, studentId, cleanMsg, nowIso);

    const record = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id);

    if (auth.role === 'siswa') {
      realtimeHub.broadcastToAdmins({ type: 'chat:new', message: record });
    } else if (sessionId) {
      realtimeHub.sendToStudent(String(sessionId), { type: 'chat:new', message: record });
    }

    res.json({ message: record });
  });

  // Student Inbox Messages / Kesan / Pengumuman from Admin & Pengawas
  router.get('/student/messages', requireAuth, requireRole(['siswa']), (req, res) => {
    const auth = req.auth!;
    const messages = db.prepare(`
      SELECT id, student_id, exam_id, session_id, sender_id, sender_role, sender_name, category, title, message, is_read, read_at, created_at
      FROM student_messages
      WHERE student_id = ?
      ORDER BY created_at DESC
      LIMIT 40
    `).all(auth.studentId!);

    res.json({ messages });
  });

  router.post('/student/messages/:messageId/read', requireAuth, requireRole(['siswa']), (req, res) => {
    const auth = req.auth!;
    const { messageId } = req.params;
    const nowIso = new Date().toISOString();

    if (messageId === 'all') {
      db.prepare(`
        UPDATE student_messages
        SET is_read = 1, read_at = COALESCE(read_at, ?)
        WHERE student_id = ? AND is_read = 0
      `).run(nowIso, auth.studentId!);
    } else {
      db.prepare(`
        UPDATE student_messages
        SET is_read = 1, read_at = COALESCE(read_at, ?)
        WHERE id = ? AND student_id = ?
      `).run(nowIso, messageId, auth.studentId!);
    }

    res.json({ ok: true });
  });

  // Student Rapor / Result Details (Strictly gated by publication_policy & publish_at!)
  router.get('/student/results/:examId', requireAuth, requireRole(['siswa']), (req, res) => {
    const auth = req.auth!;
    const { examId } = req.params;
    const exam = db.prepare(`
      SELECT e.*, sub.name as subject_name, sub.code as subject_code
      FROM exams e JOIN subjects sub ON sub.id = e.subject_id
      WHERE e.id = ?
    `).get(examId) as Record<string, unknown> & { publication_policy: string; publish_at: string | null } | undefined;

    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }

    const clsCfg = resolveExamConfigForClass(exam, auth.classId || '');
    const secSetting = getSetting<{ showStudentExamHistory?: boolean }>('security', { showStudentExamHistory: true });
    if (secSetting.showStudentExamHistory === false || !clsCfg.historyVisible) {
      res.status(403).json({ error: 'Riwayat dan hasil ujian untuk tes ini disembunyikan oleh admin.' });
      return;
    }

    const publishAtMs = exam.publish_at ? new Date(exam.publish_at).getTime() : 0;
    if (clsCfg.publicationPolicy === 'hidden' || (exam.publish_at && Date.now() < publishAtMs)) {
      res.status(403).json({ error: 'Hasil ujian belum dipublikasikan oleh admin.' });
      return;
    }

    const score = db.prepare(`
      SELECT sc.*, es.started_at, es.submitted_at, st.nis, st.nisn, st.full_name, c.name as class_name
      FROM scores sc
      JOIN exam_sessions es ON es.id = sc.session_id
      JOIN students st ON st.id = sc.student_id
      JOIN classes c ON c.id = st.class_id
      WHERE sc.exam_id = ? AND sc.student_id = ?
    `).get(examId, auth.studentId!);

    if (!score) {
      res.status(404).json({ error: 'Nilai Anda untuk ujian ini belum tersedia.' });
      return;
    }

    res.json({
      policy: clsCfg.publicationPolicy,
      exam: {
        id: exam.id,
        title: exam.title,
        examType: exam.exam_type,
        subjectName: exam.subject_name,
        passingScore: exam.passing_score,
      },
      score,
    });
  });

  // ======================== ADMIN & PENGAWAS MONITORING ========================
  router.get('/monitor/exams', requireAuth, requireRole(['admin', 'pengawas']), (req, res) => {
    const auth = req.auth!;
    const allExams = db.prepare(`
      SELECT e.*, sub.name as subject_name, sch.start_at, sch.end_at, sch.timezone
      FROM exams e
      JOIN subjects sub ON sub.id = e.subject_id
      JOIN exam_schedules sch ON sch.exam_id = e.id
      ORDER BY sch.start_at DESC
    `).all() as Array<Record<string, unknown> & { id: string; class_ids_json: string }>;

    const filtered = auth.role === 'admin'
      ? allExams
      : allExams.filter((e) => {
          const examClasses = JSON.parse(e.class_ids_json || '[]') as string[];
          const assignedExams = auth.assignedExamIds || [];
          const assignedClasses = auth.assignedClassIds || [];
          return assignedExams.includes(e.id) || examClasses.some((c) => assignedClasses.includes(c));
        });

    res.json({ exams: filtered });
  });

  router.get('/monitor/exams/:examId/participants', requireAuth, requireRole(['admin', 'pengawas']), (req, res) => {
    const auth = req.auth!;
    const { examId } = req.params;
    const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(examId) as
      | { id: string; title: string; class_ids_json: string; assigned_student_ids_json: string; allow_camera_stream: number }
      | undefined;

    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }

    const examClassIds = JSON.parse(exam.class_ids_json || '[]') as string[];
    const assignedStuIds = JSON.parse(exam.assigned_student_ids_json || '[]') as string[];

    if (auth.role === 'pengawas') {
      const hasExam = (auth.assignedExamIds || []).includes(examId);
      const hasClass = examClassIds.some((c) => (auth.assignedClassIds || []).includes(c));
      if (!hasExam && !hasClass) {
        res.status(403).json({ error: 'Pengawas tidak memiliki akses ke ujian ini.' });
        return;
      }
    }

    const students = db.prepare(`
      SELECT st.id, st.nis, st.nisn, st.full_name, st.class_id, c.name as class_name, st.photo_path, st.photo_link, st.is_active
      FROM students st
      JOIN classes c ON c.id = st.class_id
      WHERE st.is_active = 1
      ORDER BY c.name ASC, st.full_name ASC
    `).all() as Array<{
      id: string;
      nis: string;
      nisn: string;
      full_name: string;
      class_id: string;
      class_name: string;
      photo_path: string | null;
      photo_link: string | null;
    }>;

    const targetStudents = students.filter((s) => {
      const inExam = examClassIds.includes(s.class_id) || assignedStuIds.includes(s.id);
      if (!inExam) return false;
      if (auth.role === 'pengawas' && (auth.assignedClassIds || []).length > 0) {
        return auth.assignedClassIds!.includes(s.class_id);
      }
      return true;
    });

    const sessions = db.prepare(`
      SELECT es.*, sc.final_score,
             (SELECT COUNT(*) FROM student_answers sa WHERE sa.session_id = es.id AND sa.answer_json IS NOT NULL) as answered_count,
             (SELECT COUNT(*) FROM proctoring_events pe WHERE pe.session_id = es.id) as proctoring_count
      FROM exam_sessions es
      LEFT JOIN scores sc ON sc.session_id = es.id
      WHERE es.exam_id = ?
    `).all(examId) as Array<Record<string, unknown> & { student_id: string; status: string; violation_count: number; proctoring_count: number; last_heartbeat_at: string }>;

    const sessMap = new Map(sessions.map((s) => [s.student_id, s]));
    const nowMs = Date.now();

    const participants = targetStudents.map((st) => {
      const sess = sessMap.get(st.id);
      if (sess && sess.status === 'locked' && sess.locked_until) {
        const resAuto = checkAndApplyAutoUnlockForSession(String(sess.id));
        if (resAuto.unlocked) {
          sess.status = 'in_progress';
          sess.lock_reason = null;
          sess.locked_until = null;
        }
      }
      const isDisconnected = sess && sess.status === 'in_progress' && nowMs - new Date(sess.last_heartbeat_at).getTime() > 45000;
      const resolvedPhoto = st.photo_link
        ? st.photo_link
        : st.photo_path
        ? `/api/photos/student/${st.id}`
        : null;
      return {
        studentId: st.id,
        nis: st.nis,
        nisn: st.nisn,
        fullName: st.full_name,
        classId: st.class_id,
        className: st.class_name,
        hasPhoto: Boolean(resolvedPhoto),
        photoUrl: resolvedPhoto,
        sessionId: sess?.id || null,
        status: sess ? (isDisconnected ? 'disconnected' : sess.status) : 'not_logged_in',
        rawStatus: sess?.status || 'not_logged_in',
        violationCount: sess?.violation_count || 0,
        violationPoints: Number(sess?.violation_points ?? sess?.violation_count ?? 0),
        proctoringCount: sess?.proctoring_count || 0,
        answeredCount: sess?.answered_count || 0,
        finalScore: sess?.final_score ?? null,
        lockReason: sess?.lock_reason || null,
        lockedUntil: (sess?.locked_until as string | null | undefined) || null,
        deviceType: String(sess?.device_type || ''),
        deviceBrand: String(sess?.device_brand || ''),
        lastHeartbeatAt: sess?.last_heartbeat_at || null,
      };
    });

    const stats = {
      total: participants.length,
      notLoggedIn: participants.filter((p) => p.status === 'not_logged_in').length,
      inProgress: participants.filter((p) => p.status === 'in_progress').length,
      submitted: participants.filter((p) => p.rawStatus === 'submitted' || p.rawStatus === 'expired').length,
      locked: participants.filter((p) => p.rawStatus === 'locked').length,
      disconnected: participants.filter((p) => p.status === 'disconnected').length,
      withIndicators: participants.filter((p) => p.violationCount > 0 || p.proctoringCount > 0).length,
    };

    res.json({ exam, stats, participants });
  });

  // Participant detail (violation logs + proctoring indicators)
  router.get('/monitor/sessions/:sessionId/detail', requireAuth, requireRole(['admin', 'pengawas']), (req, res) => {
    const { sessionId } = req.params;
    const session = db.prepare(`
      SELECT es.*, st.nis, st.nisn, st.full_name, st.class_id, c.name as class_name, st.photo_path
      FROM exam_sessions es
      JOIN students st ON st.id = es.student_id
      JOIN classes c ON c.id = st.class_id
      WHERE es.id = ?
    `).get(sessionId) as (Record<string, unknown> & { class_id: string; exam_id: string; student_id: string; photo_path: string | null }) | undefined;

    if (!session) {
      res.status(404).json({ error: 'Sesi tidak ditemukan.' });
      return;
    }

    if (!canAccessClassOrExam(req.auth!, session.class_id, session.exam_id)) {
      res.status(403).json({ error: 'Tidak memiliki izin melihat peserta ini.' });
      return;
    }

    const violations = db.prepare('SELECT * FROM violation_logs WHERE session_id = ? ORDER BY server_timestamp DESC').all(sessionId);
    const proctoring = db.prepare('SELECT * FROM proctoring_events WHERE session_id = ? ORDER BY server_timestamp DESC').all(sessionId);

    res.json({
      session: {
        ...session,
        photoUrl: session.photo_path ? `/api/photos/student/${session.student_id}` : null,
      },
      violations,
      proctoring,
    });
  });

  // Unlock locked session (Admin or Pengawas with explicit permission)
  router.post('/monitor/sessions/:sessionId/unlock', requireAuth, requireRole(['admin', 'pengawas']), (req, res) => {
    const auth = req.auth!;
    const { sessionId } = req.params;
    const { notes, markTechnicalIssue } = req.body || {};

    if (auth.role === 'pengawas' && !auth.canUnlockSessions) {
      res.status(403).json({ error: 'Pengawas ini tidak diberi izin khusus untuk membuka sesi terkunci.' });
      return;
    }

    const session = db.prepare(`
      SELECT es.*, st.class_id, st.full_name
      FROM exam_sessions es JOIN students st ON st.id = es.student_id
      WHERE es.id = ?
    `).get(sessionId) as { id: string; exam_id: string; student_id: string; class_id: string; full_name: string; status: string; server_end_at: string } | undefined;

    if (!session) {
      res.status(404).json({ error: 'Sesi tidak ditemukan.' });
      return;
    }

    if (!canAccessClassOrExam(auth, session.class_id, session.exam_id)) {
      res.status(403).json({ error: 'Sesi di luar kelas/ujian yang ditugaskan.' });
      return;
    }

    if (Date.now() >= new Date(session.server_end_at).getTime()) {
      finalizeAndGradeSession(session.id, 'expired');
      res.status(409).json({ error: 'Waktu ujian telah habis sehingga sesi otomatis dikumpulkan.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const unlockNote = String(notes || (markTechnicalIssue ? 'Gangguan teknis terverifikasi' : 'Dibuka kembali oleh pengawas/admin'));

    db.prepare(`
      UPDATE exam_sessions
      SET status = 'in_progress', lock_reason = NULL, locked_until = NULL, locked_by_event_type = NULL, unlocked_by = ?, unlocked_at = ?, unlock_notes = ?
      WHERE id = ?
    `).run(auth.userId, nowIso, unlockNote, sessionId);

    // Record admin unlock action in immutable violation_logs
    db.prepare(`
      INSERT INTO violation_logs (id, session_id, exam_id, student_id, event_type, details_json, occurrence_number, triggered_lock, admin_action, admin_id, action_notes, server_timestamp)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      sessionId,
      session.exam_id,
      session.student_id,
      markTechnicalIssue ? 'klarifikasi_gangguan_teknis' : 'pembukaan_kunci_sesi',
      JSON.stringify({ unlockedByName: auth.name }),
      'UNLOCK_SESSION',
      auth.userId,
      unlockNote,
      nowIso
    );

    writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      actorName: auth.name,
      action: 'UNLOCK_EXAM_SESSION',
      targetType: 'exam_session',
      targetId: sessionId,
      details: { studentName: session.full_name, notes: unlockNote, markTechnicalIssue: Boolean(markTechnicalIssue) },
      ipAddress: req.ip,
    });

    realtimeHub.sendToStudent(sessionId, {
      type: 'session:unlocked',
      notes: unlockNote,
      timestamp: nowIso,
    });
    realtimeHub.queueMonitorUpdate({
      kind: 'session_unlocked',
      priority: 'high',
      examId: session.exam_id,
      sessionId,
      studentId: session.student_id,
      status: 'in_progress',
      timestamp: nowIso,
    });

    res.json({ ok: true, status: 'in_progress' });
  });

  // Force submit session by admin/proctor
  router.post('/monitor/sessions/:sessionId/force-submit', requireAuth, requireRole(['admin', 'pengawas']), (req, res) => {
    const auth = req.auth!;
    const { sessionId } = req.params;
    const session = db.prepare('SELECT es.*, st.class_id FROM exam_sessions es JOIN students st ON st.id = es.student_id WHERE es.id = ?').get(sessionId) as
      | { id: string; exam_id: string; class_id: string }
      | undefined;
    if (!session) {
      res.status(404).json({ error: 'Sesi tidak ditemukan.' });
      return;
    }
    if (!canAccessClassOrExam(auth, session.class_id, session.exam_id)) {
      res.status(403).json({ error: 'Akses ditolak.' });
      return;
    }
    const score = finalizeAndGradeSession(sessionId, 'submitted');
    writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      actorName: auth.name,
      action: 'FORCE_SUBMIT_SESSION',
      targetType: 'exam_session',
      targetId: sessionId,
      ipAddress: req.ip,
    });
    realtimeHub.sendToStudent(sessionId, { type: 'session:force_submitted' });
    res.json({ ok: true, score });
  });

  // Lock active session manually by admin/proctor
  router.post('/monitor/sessions/:sessionId/lock', requireAuth, requireRole(['admin', 'pengawas']), (req, res) => {
    const auth = req.auth!;
    const { sessionId } = req.params;
    const { reason } = req.body || {};

    const session = db.prepare(`
      SELECT es.*, st.class_id, st.full_name
      FROM exam_sessions es JOIN students st ON st.id = es.student_id
      WHERE es.id = ?
    `).get(sessionId) as
      | { id: string; exam_id: string; student_id: string; class_id: string; full_name: string; status: string; violation_count: number }
      | undefined;

    if (!session) {
      res.status(404).json({ error: 'Sesi tidak ditemukan.' });
      return;
    }
    if (!canAccessClassOrExam(auth, session.class_id, session.exam_id)) {
      res.status(403).json({ error: 'Sesi di luar kelas/ujian yang ditugaskan.' });
      return;
    }
    if (session.status === 'submitted' || session.status === 'expired') {
      res.status(409).json({ error: 'Sesi sudah selesai dan tidak dapat dikunci.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const lockReason = String(reason || `Sesi dikunci oleh ${auth.role === 'admin' ? 'Admin' : 'Pengawas'} (${auth.name}).`).trim().slice(0, 240);

    db.prepare(`
      UPDATE exam_sessions
      SET status = 'locked', lock_reason = ?
      WHERE id = ?
    `).run(lockReason, sessionId);

    db.prepare(`
      INSERT INTO violation_logs (id, session_id, exam_id, student_id, event_type, details_json, occurrence_number, triggered_lock, admin_action, admin_id, action_notes, server_timestamp)
      VALUES (?, ?, ?, ?, 'penguncian_manual_pengawas', ?, ?, 1, 'LOCK_SESSION', ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      sessionId,
      session.exam_id,
      session.student_id,
      JSON.stringify({ lockedByName: auth.name }),
      session.violation_count,
      auth.userId,
      lockReason,
      nowIso
    );

    writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      actorName: auth.name,
      action: 'LOCK_EXAM_SESSION',
      targetType: 'exam_session',
      targetId: sessionId,
      details: { studentName: session.full_name, reason: lockReason },
      ipAddress: req.ip,
    });

    realtimeHub.sendToStudent(sessionId, {
      type: 'session:locked',
      lockReason,
      timestamp: nowIso,
    });
    realtimeHub.queueMonitorUpdate({
      kind: 'session_locked',
      priority: 'high',
      examId: session.exam_id,
      sessionId,
      studentId: session.student_id,
      status: 'locked',
      timestamp: nowIso,
    });

    res.json({ ok: true, status: 'locked', lockReason });
  });

  // Reset session: reset violation counter/unlock OR full session reset (retake from scratch)
  router.post('/monitor/sessions/:sessionId/reset', requireAuth, requireRole(['admin', 'pengawas']), (req, res) => {
    const auth = req.auth!;
    const { sessionId } = req.params;
    const { mode, notes } = req.body || {};
    const resetMode = mode === 'full_session' ? 'full_session' : 'violations';

    if (auth.role === 'pengawas' && !auth.canUnlockSessions) {
      res.status(403).json({ error: 'Pengawas ini tidak diberi izin khusus untuk mereset sesi peserta.' });
      return;
    }

    const session = db.prepare(`
      SELECT es.*, st.class_id, st.full_name, st.nis
      FROM exam_sessions es JOIN students st ON st.id = es.student_id
      WHERE es.id = ?
    `).get(sessionId) as
      | { id: string; exam_id: string; student_id: string; class_id: string; full_name: string; nis: string; status: string; server_end_at: string }
      | undefined;

    if (!session) {
      res.status(404).json({ error: 'Sesi tidak ditemukan.' });
      return;
    }
    if (!canAccessClassOrExam(auth, session.class_id, session.exam_id)) {
      res.status(403).json({ error: 'Sesi di luar kelas/ujian yang ditugaskan.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const cleanNote = String(notes || (resetMode === 'full_session' ? 'Reset sesi ujian dari awal' : 'Reset pelanggaran & buka kunci')).trim().slice(0, 240);

    if (resetMode === 'full_session') {
      const tx = db.transaction(() => {
        db.prepare('DELETE FROM exam_sessions WHERE id = ?').run(sessionId);
        db.prepare('DELETE FROM login_attempts WHERE identifier = ?').run(`exampin:${session.student_id}`);
      });
      tx();

      writeAuditLog({
        actorId: auth.userId,
        actorRole: auth.role,
        actorName: auth.name,
        action: 'RESET_EXAM_SESSION',
        targetType: 'exam_session',
        targetId: sessionId,
        details: { studentName: session.full_name, nis: session.nis, examId: session.exam_id, notes: cleanNote },
        ipAddress: req.ip,
      });

      realtimeHub.sendToStudent(sessionId, {
        type: 'session:reset_exam',
        notes: cleanNote,
        timestamp: nowIso,
      });
      realtimeHub.sendToStudentAccount(session.student_id, {
        type: 'session:reset_exam',
        examId: session.exam_id,
        notes: cleanNote,
        timestamp: nowIso,
      });
      realtimeHub.queueMonitorUpdate({
        kind: 'session_reset',
        priority: 'high',
        examId: session.exam_id,
        sessionId,
        studentId: session.student_id,
        timestamp: nowIso,
      });

      res.json({ ok: true, mode: 'full_session' });
      return;
    }

    // Mode: 'violations' -> reset violation_count to 0, clear lock_reason, reopen if locked & time remains
    const stillHasTime = Date.now() < new Date(session.server_end_at).getTime();
    const nextStatus = session.status === 'locked' && stillHasTime ? 'in_progress' : session.status;

    db.prepare(`
      UPDATE exam_sessions
      SET violation_count = 0,
          violation_points = 0,
          lock_reason = NULL,
          locked_until = NULL,
          locked_by_event_type = NULL,
          status = ?,
          unlocked_by = ?,
          unlocked_at = ?,
          unlock_notes = ?
      WHERE id = ?
    `).run(nextStatus, auth.userId, nowIso, cleanNote, sessionId);

    db.prepare('DELETE FROM login_attempts WHERE identifier = ?').run(`exampin:${session.student_id}`);

    db.prepare(`
      INSERT INTO violation_logs (id, session_id, exam_id, student_id, event_type, details_json, occurrence_number, triggered_lock, admin_action, admin_id, action_notes, server_timestamp)
      VALUES (?, ?, ?, ?, 'reset_pelanggaran_admin', ?, 0, 0, 'RESET_VIOLATIONS', ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      sessionId,
      session.exam_id,
      session.student_id,
      JSON.stringify({ resetByName: auth.name }),
      auth.userId,
      cleanNote,
      nowIso
    );

    writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      actorName: auth.name,
      action: 'RESET_SESSION_VIOLATIONS',
      targetType: 'exam_session',
      targetId: sessionId,
      details: { studentName: session.full_name, notes: cleanNote },
      ipAddress: req.ip,
    });

    realtimeHub.sendToStudent(sessionId, {
      type: 'session:reset_violations',
      status: nextStatus,
      notes: cleanNote,
      timestamp: nowIso,
    });
    realtimeHub.queueMonitorUpdate({
      kind: 'violations_reset',
      priority: 'high',
      examId: session.exam_id,
      sessionId,
      studentId: session.student_id,
      status: nextStatus,
      timestamp: nowIso,
    });

    res.json({ ok: true, mode: 'violations', status: nextStatus });
  });

  // Extend session timer (+extraMinutes)
  router.post('/monitor/sessions/:sessionId/extend-time', requireAuth, requireRole(['admin', 'pengawas']), (req, res) => {
    const auth = req.auth!;
    const { sessionId } = req.params;
    const extraMinutes = Math.max(1, Math.min(180, Number(req.body?.extraMinutes || 0)));

    if (!Number.isFinite(extraMinutes) || extraMinutes < 1) {
      res.status(400).json({ error: 'Tambahan waktu harus antara 1 hingga 180 menit.' });
      return;
    }

    const session = db.prepare(`
      SELECT es.*, st.class_id, st.full_name
      FROM exam_sessions es JOIN students st ON st.id = es.student_id
      WHERE es.id = ?
    `).get(sessionId) as
      | { id: string; exam_id: string; student_id: string; class_id: string; full_name: string; status: string; server_end_at: string }
      | undefined;

    if (!session) {
      res.status(404).json({ error: 'Sesi tidak ditemukan.' });
      return;
    }
    if (!canAccessClassOrExam(auth, session.class_id, session.exam_id)) {
      res.status(403).json({ error: 'Akses ditolak.' });
      return;
    }
    if (session.status === 'submitted' || session.status === 'expired') {
      res.status(409).json({ error: 'Sesi sudah selesai. Gunakan Reset Ujian jika peserta perlu mengulang.' });
      return;
    }

    const baseMs = Math.max(Date.now(), new Date(session.server_end_at).getTime());
    const nextEndIso = new Date(baseMs + extraMinutes * 60 * 1000).toISOString();
    const nowIso = new Date().toISOString();

    db.prepare('UPDATE exam_sessions SET server_end_at = ? WHERE id = ?').run(nextEndIso, sessionId);

    writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      actorName: auth.name,
      action: 'EXTEND_SESSION_TIME',
      targetType: 'exam_session',
      targetId: sessionId,
      details: { studentName: session.full_name, extraMinutes, serverEndAt: nextEndIso },
      ipAddress: req.ip,
    });

    realtimeHub.sendToStudent(sessionId, {
      type: 'session:time_extended',
      extraMinutes,
      serverEndAt: nextEndIso,
      timestamp: nowIso,
    });
    realtimeHub.queueMonitorUpdate({
      kind: 'time_extended',
      examId: session.exam_id,
      sessionId,
      studentId: session.student_id,
      timestamp: nowIso,
    });

    res.json({ ok: true, extraMinutes, serverEndAt: nextEndIso });
  });

  // Bulk monitoring actions for selected sessions in an exam
  router.post('/monitor/exams/:examId/bulk-action', requireAuth, requireRole(['admin', 'pengawas']), (req, res) => {
    const auth = req.auth!;
    const { examId } = req.params;
    const { action, sessionIds, notes, extraMinutes } = req.body || {};
    const validActions = ['lock', 'unlock', 'reset_violations', 'reset_session', 'extend_time', 'force_submit'];
    if (!validActions.includes(action)) {
      res.status(400).json({ error: 'Aksi monitoring massal tidak valid.' });
      return;
    }

    if (auth.role === 'pengawas' && (action === 'unlock' || action === 'reset_session' || action === 'reset_violations') && !auth.canUnlockSessions) {
      res.status(403).json({ error: 'Pengawas ini tidak memiliki izin membuka kunci / mereset sesi.' });
      return;
    }

    const ids = Array.isArray(sessionIds) ? (sessionIds as string[]).map((s) => String(s).trim()).filter(Boolean) : [];
    if (ids.length === 0) {
      res.status(400).json({ error: 'Pilih minimal satu peserta yang sudah memiliki sesi ujian.' });
      return;
    }

    const placeholders = ids.map(() => '?').join(',');
    const sessions = db.prepare(`
      SELECT es.*, st.class_id, st.full_name
      FROM exam_sessions es JOIN students st ON st.id = es.student_id
      WHERE es.exam_id = ? AND es.id IN (${placeholders})
    `).all(examId, ...ids) as Array<{
      id: string;
      exam_id: string;
      student_id: string;
      class_id: string;
      full_name: string;
      status: string;
      violation_count: number;
      server_end_at: string;
    }>;

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const cleanNotes = String(notes || '').trim().slice(0, 240);
    const addMins = Math.max(1, Math.min(180, Number(extraMinutes || 10)));

    let affectedCount = 0;
    let skippedCount = 0;

    for (const sess of sessions) {
      if (!canAccessClassOrExam(auth, sess.class_id, sess.exam_id)) {
        skippedCount++;
        continue;
      }

      if (action === 'lock') {
        if (sess.status === 'submitted' || sess.status === 'expired' || sess.status === 'locked') {
          skippedCount++;
          continue;
        }
        const reason = cleanNotes || `Sesi dikunci massal oleh ${auth.name}.`;
        db.prepare(`UPDATE exam_sessions SET status = 'locked', lock_reason = ? WHERE id = ?`).run(reason, sess.id);
        db.prepare(`
          INSERT INTO violation_logs (id, session_id, exam_id, student_id, event_type, details_json, occurrence_number, triggered_lock, admin_action, admin_id, action_notes, server_timestamp)
          VALUES (?, ?, ?, ?, 'penguncian_manual_pengawas', ?, ?, 1, 'LOCK_SESSION', ?, ?, ?)
        `).run(crypto.randomUUID(), sess.id, sess.exam_id, sess.student_id, JSON.stringify({ bulk: true }), sess.violation_count, auth.userId, reason, nowIso);
        realtimeHub.sendToStudent(sess.id, { type: 'session:locked', lockReason: reason, timestamp: nowIso });
        affectedCount++;
      } else if (action === 'unlock') {
        if (sess.status !== 'locked' || nowMs >= new Date(sess.server_end_at).getTime()) {
          skippedCount++;
          continue;
        }
        const reason = cleanNotes || `Dibuka kembali oleh ${auth.name}.`;
        db.prepare(`UPDATE exam_sessions SET status = 'in_progress', lock_reason = NULL, unlocked_by = ?, unlocked_at = ?, unlock_notes = ? WHERE id = ?`).run(
          auth.userId,
          nowIso,
          reason,
          sess.id
        );
        db.prepare(`
          INSERT INTO violation_logs (id, session_id, exam_id, student_id, event_type, details_json, occurrence_number, triggered_lock, admin_action, admin_id, action_notes, server_timestamp)
          VALUES (?, ?, ?, ?, 'pembukaan_kunci_sesi', ?, 0, 0, 'UNLOCK_SESSION', ?, ?, ?)
        `).run(crypto.randomUUID(), sess.id, sess.exam_id, sess.student_id, JSON.stringify({ bulk: true }), auth.userId, reason, nowIso);
        realtimeHub.sendToStudent(sess.id, { type: 'session:unlocked', notes: reason, timestamp: nowIso });
        affectedCount++;
      } else if (action === 'reset_violations') {
        const nextStatus = sess.status === 'locked' && nowMs < new Date(sess.server_end_at).getTime() ? 'in_progress' : sess.status;
        const reason = cleanNotes || `Reset pelanggaran massal oleh ${auth.name}.`;
        db.prepare(`UPDATE exam_sessions SET violation_count = 0, lock_reason = NULL, status = ?, unlocked_by = ?, unlocked_at = ?, unlock_notes = ? WHERE id = ?`).run(
          nextStatus,
          auth.userId,
          nowIso,
          reason,
          sess.id
        );
        db.prepare('DELETE FROM login_attempts WHERE identifier = ?').run(`exampin:${sess.student_id}`);
        realtimeHub.sendToStudent(sess.id, { type: 'session:reset_violations', status: nextStatus, notes: reason, timestamp: nowIso });
        affectedCount++;
      } else if (action === 'reset_session') {
        db.prepare('DELETE FROM exam_sessions WHERE id = ?').run(sess.id);
        db.prepare('DELETE FROM login_attempts WHERE identifier = ?').run(`exampin:${sess.student_id}`);
        realtimeHub.sendToStudent(sess.id, { type: 'session:reset_exam', notes: cleanNotes || 'Sesi direset oleh admin/pengawas.', timestamp: nowIso });
        realtimeHub.sendToStudentAccount(sess.student_id, { type: 'session:reset_exam', examId: sess.exam_id, notes: cleanNotes || 'Sesi direset oleh admin/pengawas.', timestamp: nowIso });
        affectedCount++;
      } else if (action === 'extend_time') {
        if (sess.status === 'submitted' || sess.status === 'expired') {
          skippedCount++;
          continue;
        }
        const baseMs = Math.max(nowMs, new Date(sess.server_end_at).getTime());
        const nextEndIso = new Date(baseMs + addMins * 60 * 1000).toISOString();
        db.prepare('UPDATE exam_sessions SET server_end_at = ? WHERE id = ?').run(nextEndIso, sess.id);
        realtimeHub.sendToStudent(sess.id, { type: 'session:time_extended', extraMinutes: addMins, serverEndAt: nextEndIso, timestamp: nowIso });
        affectedCount++;
      } else if (action === 'force_submit') {
        if (sess.status === 'submitted' || sess.status === 'expired') {
          skippedCount++;
          continue;
        }
        finalizeAndGradeSession(sess.id, 'submitted');
        realtimeHub.sendToStudent(sess.id, { type: 'session:force_submitted' });
        affectedCount++;
      }
    }

    writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      actorName: auth.name,
      action: `BULK_MONITOR_${String(action).toUpperCase()}`,
      targetType: 'exam',
      targetId: examId,
      details: { affectedCount, skippedCount, extraMinutes: action === 'extend_time' ? addMins : undefined },
      ipAddress: req.ip,
    });

    realtimeHub.queueMonitorUpdate({
      kind: 'bulk_action',
      priority: 'high',
      examId,
      action,
      timestamp: nowIso,
    });

    res.json({ ok: true, affectedCount, skippedCount });
  });

  // Review proctoring indicator
  router.post('/monitor/proctoring/:eventId/review', requireAuth, requireRole(['admin', 'pengawas']), (req, res) => {
    const auth = req.auth!;
    const { eventId } = req.params;
    const { reviewStatus } = req.body || {};
    const valid = ['unreviewed', 'confirmed_technical', 'noted_for_review', 'cleared'];
    if (!valid.includes(reviewStatus)) {
      res.status(400).json({ error: 'Status peninjauan tidak valid.' });
      return;
    }
    db.prepare('UPDATE proctoring_events SET review_status = ?, reviewed_by = ? WHERE id = ?').run(reviewStatus, auth.userId, eventId);
    res.json({ ok: true });
  });

  // ======================== ADMIN: CLASSES, SUBJECTS, STUDENTS, PHOTOS ========================
  router.get('/admin/overview', requireAuth, requireRole(['admin', 'pengawas']), (_req, res) => {
    const totalStudents = (db.prepare('SELECT COUNT(*) as c FROM students WHERE is_active = 1').get() as { c: number }).c;
    const totalClasses = (db.prepare('SELECT COUNT(*) as c FROM classes').get() as { c: number }).c;
    const totalSubjects = (db.prepare('SELECT COUNT(*) as c FROM subjects').get() as { c: number }).c;
    const totalQuestions = (db.prepare('SELECT COUNT(*) as c FROM questions').get() as { c: number }).c;
    const totalExams = (db.prepare('SELECT COUNT(*) as c FROM exams').get() as { c: number }).c;
    const activeSessions = (db.prepare(`SELECT COUNT(*) as c FROM exam_sessions WHERE status = 'in_progress'`).get() as { c: number }).c;
    const lockedSessions = (db.prepare(`SELECT COUNT(*) as c FROM exam_sessions WHERE status = 'locked'`).get() as { c: number }).c;
    const photosUploaded = (db.prepare('SELECT COUNT(*) as c FROM students WHERE photo_path IS NOT NULL').get() as { c: number }).c;

    res.json({
      totalStudents,
      totalClasses,
      totalSubjects,
      totalQuestions,
      totalExams,
      activeSessions,
      lockedSessions,
      photosUploaded,
    });
  });

  router.get('/admin/classes', requireAuth, requireRole(['admin', 'pengawas']), (_req, res) => {
    const classes = db.prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.is_active = 1) as student_count
      FROM classes c ORDER BY c.grade_level ASC, c.name ASC
    `).all();
    res.json({ classes });
  });

  router.post('/admin/classes', requireAuth, requireRole(['admin']), (req, res) => {
    const { name, gradeLevel, academicYear } = req.body || {};
    if (!name || !gradeLevel) {
      res.status(400).json({ error: 'Nama kelas dan tingkat wajib diisi.' });
      return;
    }
    const id = `cls_${crypto.randomUUID().slice(0, 8)}`;
    try {
      db.prepare('INSERT INTO classes (id, name, grade_level, academic_year, created_at) VALUES (?, ?, ?, ?, ?)').run(
        id,
        String(name).trim(),
        String(gradeLevel).trim(),
        String(academicYear || '2026/2027').trim(),
        new Date().toISOString()
      );
      writeAuditLog({
        actorId: req.auth!.userId,
        actorRole: 'admin',
        actorName: req.auth!.name,
        action: 'CREATE_CLASS',
        targetType: 'class',
        targetId: id,
        details: { name },
      });
      res.json({ ok: true, id });
    } catch {
      res.status(409).json({ error: 'Nama kelas sudah ada.' });
    }
  });

  router.put('/admin/classes/:classId', requireAuth, requireRole(['admin']), (req, res) => {
    const { classId } = req.params;
    const { name, gradeLevel, academicYear } = req.body || {};
    const existing = db.prepare('SELECT id FROM classes WHERE id = ?').get(classId);
    if (!existing) {
      res.status(404).json({ error: 'Kelas tidak ditemukan.' });
      return;
    }
    try {
      db.prepare(`
        UPDATE classes
        SET name = COALESCE(?, name),
            grade_level = COALESCE(?, grade_level),
            academic_year = COALESCE(?, academic_year)
        WHERE id = ?
      `).run(
        name ? String(name).trim() : null,
        gradeLevel ? String(gradeLevel).trim() : null,
        academicYear ? String(academicYear).trim() : null,
        classId
      );
      writeAuditLog({
        actorId: req.auth!.userId,
        actorRole: 'admin',
        actorName: req.auth!.name,
        action: 'UPDATE_CLASS',
        targetType: 'class',
        targetId: classId,
        details: { name, gradeLevel, academicYear },
      });
      res.json({ ok: true });
    } catch {
      res.status(409).json({ error: 'Nama kelas sudah digunakan oleh kelas lain.' });
    }
  });

  router.delete('/admin/classes/:classId', requireAuth, requireRole(['admin']), (req, res) => {
    const { classId } = req.params;
    const cnt = (db.prepare('SELECT COUNT(*) as c FROM students WHERE class_id = ?').get(classId) as { c: number }).c;
    if (cnt > 0) {
      res.status(409).json({ error: `Kelas tidak dapat dihapus karena masih memiliki ${cnt} siswa.` });
      return;
    }
    db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'DELETE_CLASS',
      targetType: 'class',
      targetId: classId,
    });
    res.json({ ok: true });
  });

  router.post('/admin/classes/bulk-delete', requireAuth, requireRole(['admin']), (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : [];
    if (ids.length === 0) {
      res.status(400).json({ error: 'Pilih minimal satu kelas.' });
      return;
    }
    let deletedCount = 0;
    const skipped: string[] = [];
    const cntStmt = db.prepare('SELECT name, (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) as c FROM classes c WHERE c.id = ?');
    const delStmt = db.prepare('DELETE FROM classes WHERE id = ?');
    const tx = db.transaction(() => {
      for (const id of ids) {
        const row = cntStmt.get(id) as { name: string; c: number } | undefined;
        if (!row) continue;
        if (row.c > 0) {
          skipped.push(`${row.name} (${row.c} siswa)`);
        } else {
          delStmt.run(id);
          deletedCount++;
        }
      }
    });
    tx();
    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'BULK_DELETE_CLASSES',
      targetType: 'class',
      targetId: 'bulk',
      details: { deletedCount, skipped },
    });
    res.json({ ok: true, deletedCount, skipped });
  });

  router.get('/admin/templates/classes.xlsx', requireAuth, requireRole(['admin']), (_req, res) => {
    const buf = buildClassesTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="template_kelas_sinarcbt.xlsx"');
    res.send(buf);
  });

  router.post('/admin/classes/import-preview', requireAuth, requireRole(['admin']), uploadMemory.single('file'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Berkas Excel tidak ditemukan.' });
      return;
    }
    const existingNames = new Set((db.prepare('SELECT name FROM classes').all() as Array<{ name: string }>).map((r) => r.name));
    const parsed = previewClassesExcelImport(req.file.buffer, existingNames);
    const previewId = crypto.randomUUID();
    classImportPreviewCache.set(previewId, { expiresAt: Date.now() + 15 * 60 * 1000, rows: parsed.rows });
    res.json({
      previewId,
      totalRows: parsed.rows.length,
      validCount: parsed.rows.filter((r) => r.valid).length,
      errorCount: parsed.rows.filter((r) => !r.valid).length,
      rows: parsed.rows,
      issues: parsed.issues,
    });
  });

  router.post('/admin/classes/import-commit', requireAuth, requireRole(['admin']), (req, res) => {
    const { previewId } = req.body || {};
    const cached = classImportPreviewCache.get(String(previewId || ''));
    if (!cached || cached.expiresAt < Date.now()) {
      res.status(404).json({ error: 'Pratinjau impor kelas sudah kedaluwarsa.' });
      return;
    }
    const validRows = cached.rows.filter((r) => r.valid);
    const now = new Date().toISOString();
    const ins = db.prepare('INSERT INTO classes (id, name, grade_level, academic_year, created_at) VALUES (?, ?, ?, ?, ?)');
    const tx = db.transaction(() => {
      for (const r of validRows) {
        ins.run(`cls_${crypto.randomUUID().slice(0, 8)}`, r.name, r.gradeLevel, r.academicYear, now);
      }
    });
    tx();
    classImportPreviewCache.delete(String(previewId));
    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'IMPORT_CLASSES_EXCEL',
      targetType: 'class',
      targetId: 'bulk',
      details: { importedCount: validRows.length },
    });
    res.json({ ok: true, importedCount: validRows.length });
  });

  router.get('/admin/classes/export.xlsx', requireAuth, requireRole(['admin']), (req, res) => {
    const ids = parseIdsQuery(req.query.ids);
    const sql = ids.length > 0
      ? `SELECT c.name as NAMA_KELAS, c.grade_level as TINGKAT, c.academic_year as TAHUN_AJARAN,
                (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.is_active = 1) as JUMLAH_SISWA
         FROM classes c WHERE c.id IN (${ids.map(() => '?').join(',')}) ORDER BY c.grade_level ASC, c.name ASC`
      : `SELECT c.name as NAMA_KELAS, c.grade_level as TINGKAT, c.academic_year as TAHUN_AJARAN,
                (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.is_active = 1) as JUMLAH_SISWA
         FROM classes c ORDER BY c.grade_level ASC, c.name ASC`;
    const rows = ids.length > 0 ? db.prepare(sql).all(...ids) : db.prepare(sql).all();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'DataKelas');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="ekspor_kelas_sinarcbt.xlsx"');
    res.send(buf);
  });

  router.get('/admin/subjects', requireAuth, requireRole(['admin', 'pengawas']), (_req, res) => {
    const subjects = db.prepare('SELECT * FROM subjects ORDER BY name ASC').all();
    res.json({ subjects });
  });

  router.post('/admin/subjects', requireAuth, requireRole(['admin']), (req, res) => {
    const { code, name, passingGrade } = req.body || {};
    if (!code || !name) {
      res.status(400).json({ error: 'Kode dan nama mata pelajaran wajib diisi.' });
      return;
    }
    const id = `sub_${crypto.randomUUID().slice(0, 8)}`;
    try {
      db.prepare('INSERT INTO subjects (id, code, name, passing_grade, created_at) VALUES (?, ?, ?, ?, ?)').run(
        id,
        String(code).trim().toUpperCase(),
        String(name).trim(),
        Number(passingGrade || 75),
        new Date().toISOString()
      );
      res.json({ ok: true, id });
    } catch {
      res.status(409).json({ error: 'Kode mata pelajaran sudah digunakan.' });
    }
  });

  router.put('/admin/subjects/:subjectId', requireAuth, requireRole(['admin']), (req, res) => {
    const { subjectId } = req.params;
    const { code, name, passingGrade } = req.body || {};
    const existing = db.prepare('SELECT id FROM subjects WHERE id = ?').get(subjectId);
    if (!existing) {
      res.status(404).json({ error: 'Mata pelajaran tidak ditemukan.' });
      return;
    }
    try {
      db.prepare(`
        UPDATE subjects
        SET code = COALESCE(?, code),
            name = COALESCE(?, name),
            passing_grade = COALESCE(?, passing_grade)
        WHERE id = ?
      `).run(
        code ? String(code).trim().toUpperCase() : null,
        name ? String(name).trim() : null,
        passingGrade !== undefined ? Number(passingGrade) : null,
        subjectId
      );
      writeAuditLog({
        actorId: req.auth!.userId,
        actorRole: 'admin',
        actorName: req.auth!.name,
        action: 'UPDATE_SUBJECT',
        targetType: 'subject',
        targetId: subjectId,
        details: { code, name, passingGrade },
      });
      res.json({ ok: true });
    } catch {
      res.status(409).json({ error: 'Kode mata pelajaran sudah digunakan.' });
    }
  });

  router.delete('/admin/subjects/:subjectId', requireAuth, requireRole(['admin']), (req, res) => {
    const { subjectId } = req.params;
    const examCnt = (db.prepare('SELECT COUNT(*) as c FROM exams WHERE subject_id = ?').get(subjectId) as { c: number }).c;
    const bankCnt = (db.prepare('SELECT COUNT(*) as c FROM question_banks WHERE subject_id = ?').get(subjectId) as { c: number }).c;
    if (examCnt > 0 || bankCnt > 0) {
      res.status(409).json({ error: `Mata pelajaran masih digunakan oleh ${examCnt} ujian dan ${bankCnt} bank soal.` });
      return;
    }
    db.prepare('DELETE FROM subjects WHERE id = ?').run(subjectId);
    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'DELETE_SUBJECT',
      targetType: 'subject',
      targetId: subjectId,
    });
    res.json({ ok: true });
  });

  router.post('/admin/subjects/bulk-delete', requireAuth, requireRole(['admin']), (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : [];
    if (ids.length === 0) {
      res.status(400).json({ error: 'Pilih minimal satu mata pelajaran.' });
      return;
    }
    let deletedCount = 0;
    const skipped: string[] = [];
    const chkStmt = db.prepare(`
      SELECT s.name,
             (SELECT COUNT(*) FROM exams e WHERE e.subject_id = s.id) as ec,
             (SELECT COUNT(*) FROM question_banks qb WHERE qb.subject_id = s.id) as bc
      FROM subjects s WHERE s.id = ?
    `);
    const delStmt = db.prepare('DELETE FROM subjects WHERE id = ?');
    const tx = db.transaction(() => {
      for (const id of ids) {
        const row = chkStmt.get(id) as { name: string; ec: number; bc: number } | undefined;
        if (!row) continue;
        if (row.ec > 0 || row.bc > 0) {
          skipped.push(row.name);
        } else {
          delStmt.run(id);
          deletedCount++;
        }
      }
    });
    tx();
    res.json({ ok: true, deletedCount, skipped });
  });

  router.get('/admin/templates/subjects.xlsx', requireAuth, requireRole(['admin']), (_req, res) => {
    const buf = buildSubjectsTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="template_mapel_sinarcbt.xlsx"');
    res.send(buf);
  });

  router.post('/admin/subjects/import-preview', requireAuth, requireRole(['admin']), uploadMemory.single('file'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Berkas Excel tidak ditemukan.' });
      return;
    }
    const existingCodes = new Set((db.prepare('SELECT code FROM subjects').all() as Array<{ code: string }>).map((r) => r.code));
    const parsed = previewSubjectsExcelImport(req.file.buffer, existingCodes);
    const previewId = crypto.randomUUID();
    subjectImportPreviewCache.set(previewId, { expiresAt: Date.now() + 15 * 60 * 1000, rows: parsed.rows });
    res.json({
      previewId,
      totalRows: parsed.rows.length,
      validCount: parsed.rows.filter((r) => r.valid).length,
      errorCount: parsed.rows.filter((r) => !r.valid).length,
      rows: parsed.rows,
      issues: parsed.issues,
    });
  });

  router.post('/admin/subjects/import-commit', requireAuth, requireRole(['admin']), (req, res) => {
    const { previewId } = req.body || {};
    const cached = subjectImportPreviewCache.get(String(previewId || ''));
    if (!cached || cached.expiresAt < Date.now()) {
      res.status(404).json({ error: 'Pratinjau impor mapel sudah kedaluwarsa.' });
      return;
    }
    const validRows = cached.rows.filter((r) => r.valid);
    const now = new Date().toISOString();
    const ins = db.prepare('INSERT INTO subjects (id, code, name, passing_grade, created_at) VALUES (?, ?, ?, ?, ?)');
    const tx = db.transaction(() => {
      for (const r of validRows) {
        ins.run(`sub_${crypto.randomUUID().slice(0, 8)}`, r.code, r.name, r.passingGrade, now);
      }
    });
    tx();
    subjectImportPreviewCache.delete(String(previewId));
    res.json({ ok: true, importedCount: validRows.length });
  });

  router.get('/admin/subjects/export.xlsx', requireAuth, requireRole(['admin']), (req, res) => {
    const ids = parseIdsQuery(req.query.ids);
    const sql = ids.length > 0
      ? `SELECT code as KODE_MAPEL, name as NAMA_MAPEL, passing_grade as KKM FROM subjects WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY name ASC`
      : `SELECT code as KODE_MAPEL, name as NAMA_MAPEL, passing_grade as KKM FROM subjects ORDER BY name ASC`;
    const rows = ids.length > 0 ? db.prepare(sql).all(...ids) : db.prepare(sql).all();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'MataPelajaran');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="ekspor_mapel_sinarcbt.xlsx"');
    res.send(buf);
  });

  // Students CRUD
  const normalizeStudentGender = (val: unknown): string | null => {
    const raw = String(val ?? '').trim().toLowerCase();
    if (!raw) return '';
    if (raw === 'l' || raw === 'laki-laki' || raw === 'laki laki' || raw === 'laki' || raw === 'male' || raw === 'm') return 'L';
    if (raw === 'p' || raw === 'perempuan' || raw === 'wanita' || raw === 'female' || raw === 'f') return 'P';
    return null;
  };

  router.get('/admin/students', requireAuth, requireRole(['admin', 'pengawas']), (req, res) => {
    const students = db.prepare(`
      SELECT s.id, s.nis, s.nisn, s.pin_display, s.full_name, s.birth_place, s.birth_date, s.gender, s.email, s.photo_link, s.class_id, c.name as class_name,
             s.photo_path, s.photo_mime, s.photo_size, s.photo_updated_at, s.is_active, s.created_at
      FROM students s
      JOIN classes c ON c.id = s.class_id
      ORDER BY c.name ASC, s.full_name ASC
    `).all() as Array<Record<string, unknown> & { id: string; class_id: string; photo_path: string | null; photo_link: string | null }>;

    const scoped = req.auth!.role === 'admin'
      ? students
      : students.filter((s) => (req.auth!.assignedClassIds || []).includes(s.class_id));

    res.json({
      students: scoped.map((s) => {
        const photoLink = String(s.photo_link || '').trim();
        const photoUrl = photoLink
          ? photoLink
          : s.photo_path
          ? `/api/photos/student/${s.id}`
          : null;
        return {
          ...s,
          photo_link: photoLink,
          hasPhoto: Boolean(photoUrl),
          photoUrl,
        };
      }),
    });
  });

  router.post('/admin/students', requireAuth, requireRole(['admin']), (req, res) => {
    const { nis, nisn, fullName, birthPlace, birthDate, gender, email, photoLink, classId, pin } = req.body || {};
    if (!nis || !nisn || !fullName || !classId) {
      res.status(400).json({ error: 'NIS, NISN, nama lengkap, dan kelas wajib diisi.' });
      return;
    }
    const normGender = gender !== undefined ? normalizeStudentGender(gender) : '';
    if (normGender === null) {
      res.status(400).json({ error: 'Jenis kelamin harus L (Laki-laki) atau P (Perempuan).' });
      return;
    }
    const cleanEmail = String(email || '').trim();
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({ error: 'Format alamat email tidak valid.' });
      return;
    }
    const cleanPhotoLink = String(photoLink || '').trim();
    if (cleanPhotoLink && !/^https?:\/\/.+/i.test(cleanPhotoLink) && !cleanPhotoLink.startsWith('/api/')) {
      res.status(400).json({ error: 'Link foto harus diawali http:// atau https://.' });
      return;
    }
    const cleanPin = String(pin || '123456').trim();
    const cleanBirthPlace = String(birthPlace || '').trim();
    const cleanBirthDate = String(birthDate || '').trim();
    const id = `stu_${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    try {
      db.prepare(`
        INSERT INTO students (id, nis, nisn, pin_hash, pin_display, full_name, birth_place, birth_date, gender, email, photo_link, class_id, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(id, String(nis).trim(), String(nisn).trim(), bcrypt.hashSync(cleanPin, 8), cleanPin, String(fullName).trim(), cleanBirthPlace, cleanBirthDate, normGender, cleanEmail, cleanPhotoLink, classId, now);
      writeAuditLog({
        actorId: req.auth!.userId,
        actorRole: 'admin',
        actorName: req.auth!.name,
        action: 'CREATE_STUDENT',
        targetType: 'student',
        targetId: id,
        details: { nis, fullName, birthPlace: cleanBirthPlace, birthDate: cleanBirthDate, gender: normGender, email: cleanEmail, photoLink: cleanPhotoLink },
      });
      res.json({ ok: true, id });
    } catch {
      res.status(409).json({ error: 'NIS atau NISN sudah terdaftar di sistem.' });
    }
  });

  router.put('/admin/students/:studentId', requireAuth, requireRole(['admin']), (req, res) => {
    const { studentId } = req.params;
    const { nis, nisn, fullName, birthPlace, birthDate, gender, email, photoLink, classId, isActive, resetPin } = req.body || {};
    const existing = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId) as { id: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Siswa tidak ditemukan.' });
      return;
    }

    const normGender = gender !== undefined ? normalizeStudentGender(gender) : null;
    if (gender !== undefined && normGender === null) {
      res.status(400).json({ error: 'Jenis kelamin harus L (Laki-laki) atau P (Perempuan).' });
      return;
    }
    const cleanEmail = email !== undefined ? String(email).trim() : null;
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({ error: 'Format alamat email tidak valid.' });
      return;
    }
    const cleanPhotoLink = photoLink !== undefined ? String(photoLink).trim() : null;
    if (cleanPhotoLink && !/^https?:\/\/.+/i.test(cleanPhotoLink) && !cleanPhotoLink.startsWith('/api/')) {
      res.status(400).json({ error: 'Link foto harus diawali http:// atau https://.' });
      return;
    }

    try {
      if (resetPin) {
        const cleanPin = String(resetPin).trim();
        db.prepare('UPDATE students SET pin_hash = ?, pin_display = ? WHERE id = ?').run(bcrypt.hashSync(cleanPin, 8), cleanPin, studentId);
        db.prepare('DELETE FROM login_attempts WHERE identifier = ?').run(`stu:${nis}`);
      }
      db.prepare(`
        UPDATE students
        SET nis = COALESCE(?, nis),
            nisn = COALESCE(?, nisn),
            full_name = COALESCE(?, full_name),
            birth_place = COALESCE(?, birth_place),
            birth_date = COALESCE(?, birth_date),
            gender = COALESCE(?, gender),
            email = COALESCE(?, email),
            photo_link = COALESCE(?, photo_link),
            class_id = COALESCE(?, class_id),
            is_active = COALESCE(?, is_active)
        WHERE id = ?
      `).run(
        nis ? String(nis).trim() : null,
        nisn ? String(nisn).trim() : null,
        fullName ? String(fullName).trim() : null,
        birthPlace !== undefined ? String(birthPlace).trim() : null,
        birthDate !== undefined ? String(birthDate).trim() : null,
        normGender,
        cleanEmail,
        cleanPhotoLink,
        classId || null,
        typeof isActive === 'boolean' ? (isActive ? 1 : 0) : null,
        studentId
      );
      writeAuditLog({
        actorId: req.auth!.userId,
        actorRole: 'admin',
        actorName: req.auth!.name,
        action: resetPin ? 'RESET_STUDENT_PIN' : 'UPDATE_STUDENT',
        targetType: 'student',
        targetId: studentId,
        details: { nis, fullName, birthPlace, birthDate, gender: normGender, email: cleanEmail, photoLink: cleanPhotoLink, isActive },
      });
      res.json({ ok: true });
    } catch {
      res.status(409).json({ error: 'Gagal memperbarui siswa: kemungkinan NIS/NISN bentrok.' });
    }
  });

  router.delete('/admin/students/:studentId', requireAuth, requireRole(['admin']), (req, res) => {
    const { studentId } = req.params;
    const existing = db.prepare('SELECT id, nis, full_name, photo_path FROM students WHERE id = ?').get(studentId) as
      | { id: string; nis: string; full_name: string; photo_path: string | null }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Siswa tidak ditemukan.' });
      return;
    }
    deletePrivateStudentPhoto(existing.photo_path);
    db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'DELETE_STUDENT',
      targetType: 'student',
      targetId: studentId,
      details: { nis: existing.nis, fullName: existing.full_name },
    });
    res.json({ ok: true });
  });

  router.post('/admin/students/bulk-delete', requireAuth, requireRole(['admin']), (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : [];
    if (ids.length === 0) {
      res.status(400).json({ error: 'Pilih minimal satu siswa untuk dihapus.' });
      return;
    }
    const selStmt = db.prepare('SELECT id, photo_path FROM students WHERE id = ?');
    const delStmt = db.prepare('DELETE FROM students WHERE id = ?');
    let deletedCount = 0;
    const tx = db.transaction(() => {
      for (const id of ids) {
        const stu = selStmt.get(id) as { id: string; photo_path: string | null } | undefined;
        if (!stu) continue;
        deletePrivateStudentPhoto(stu.photo_path);
        delStmt.run(id);
        deletedCount++;
      }
    });
    tx();
    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'BULK_DELETE_STUDENTS',
      targetType: 'student',
      targetId: 'bulk',
      details: { deletedCount },
    });
    res.json({ ok: true, deletedCount });
  });

  // Bulk or targeted student PIN / Token update (all students, specific class, or selected students)
  router.post('/admin/students/bulk-pin', requireAuth, requireRole(['admin']), (req, res) => {
    const { scope, classId, studentIds, mode, pinValue } = req.body || {};
    const cleanScope = scope === 'class' || scope === 'selected' ? scope : 'all';
    const cleanMode = mode === 'random' ? 'random' : 'custom';
    const cleanPinValue = String(pinValue || '').trim();

    if (cleanMode === 'custom' && (cleanPinValue.length < 4 || cleanPinValue.length > 32)) {
      res.status(400).json({ error: 'PIN / Token seragam harus terdiri dari 4 hingga 32 karakter.' });
      return;
    }

    let targets: Array<{ id: string; nis: string }> = [];
    if (cleanScope === 'all') {
      targets = db.prepare('SELECT id, nis FROM students').all() as Array<{ id: string; nis: string }>;
    } else if (cleanScope === 'class') {
      const cleanClassId = String(classId || '').trim();
      if (!cleanClassId) {
        res.status(400).json({ error: 'Pilih kelas tujuan terlebih dahulu.' });
        return;
      }
      targets = db.prepare('SELECT id, nis FROM students WHERE class_id = ?').all(cleanClassId) as Array<{ id: string; nis: string }>;
    } else {
      const ids = Array.isArray(studentIds) ? (studentIds as string[]).map((id) => String(id).trim()).filter(Boolean) : [];
      if (ids.length === 0) {
        res.status(400).json({ error: 'Pilih minimal satu siswa tujuan.' });
        return;
      }
      const placeholders = ids.map(() => '?').join(',');
      targets = db.prepare(`SELECT id, nis FROM students WHERE id IN (${placeholders})`).all(...ids) as Array<{ id: string; nis: string }>;
    }

    if (targets.length === 0) {
      res.status(404).json({ error: 'Tidak ada siswa yang sesuai dengan sasaran pilihan.' });
      return;
    }

    const updStmt = db.prepare('UPDATE students SET pin_hash = ?, pin_display = ? WHERE id = ?');
    const clearAttemptStmt = db.prepare('DELETE FROM login_attempts WHERE identifier = ?');
    const sharedHash = cleanMode === 'custom' ? bcrypt.hashSync(cleanPinValue, 8) : '';

    const tx = db.transaction(() => {
      for (const stu of targets) {
        if (cleanMode === 'custom') {
          updStmt.run(sharedHash, cleanPinValue, stu.id);
        } else {
          const randPin = String(Math.floor(100000 + Math.random() * 900000));
          updStmt.run(bcrypt.hashSync(randPin, 6), randPin, stu.id);
        }
        clearAttemptStmt.run(`exampin:${stu.id}`);
        clearAttemptStmt.run(`stu:${stu.nis}`);
      }
    });
    tx();

    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'BULK_UPDATE_STUDENT_PIN',
      targetType: 'student',
      targetId: cleanScope,
      details: {
        scope: cleanScope,
        classId: classId || null,
        mode: cleanMode,
        updatedCount: targets.length,
      },
    });

    res.json({ ok: true, updatedCount: targets.length, scope: cleanScope, mode: cleanMode });
  });

  // Bulk or targeted student account actions (lock account, unlock account, reset access lockouts)
  router.post('/admin/students/bulk-action', requireAuth, requireRole(['admin']), (req, res) => {
    const { action, scope, classId, studentIds } = req.body || {};
    const validActions = ['lock_account', 'unlock_account', 'reset_access'];
    if (!validActions.includes(action)) {
      res.status(400).json({ error: 'Aksi akun siswa tidak valid.' });
      return;
    }

    const cleanScope = scope === 'class' || scope === 'selected' ? scope : 'all';
    let targets: Array<{ id: string; nis: string; full_name: string }> = [];

    if (cleanScope === 'all') {
      targets = db.prepare('SELECT id, nis, full_name FROM students').all() as Array<{ id: string; nis: string; full_name: string }>;
    } else if (cleanScope === 'class') {
      const cleanClassId = String(classId || '').trim();
      if (!cleanClassId) {
        res.status(400).json({ error: 'Pilih kelas tujuan terlebih dahulu.' });
        return;
      }
      targets = db.prepare('SELECT id, nis, full_name FROM students WHERE class_id = ?').all(cleanClassId) as Array<{ id: string; nis: string; full_name: string }>;
    } else {
      const ids = Array.isArray(studentIds) ? (studentIds as string[]).map((id) => String(id).trim()).filter(Boolean) : [];
      if (ids.length === 0) {
        res.status(400).json({ error: 'Pilih minimal satu siswa tujuan.' });
        return;
      }
      const placeholders = ids.map(() => '?').join(',');
      targets = db.prepare(`SELECT id, nis, full_name FROM students WHERE id IN (${placeholders})`).all(...ids) as Array<{ id: string; nis: string; full_name: string }>;
    }

    if (targets.length === 0) {
      res.status(404).json({ error: 'Tidak ada siswa yang sesuai dengan sasaran pilihan.' });
      return;
    }

    const setStatusStmt = db.prepare('UPDATE students SET is_active = ? WHERE id = ?');
    const clearAttemptStmt = db.prepare('DELETE FROM login_attempts WHERE identifier = ?');

    const tx = db.transaction(() => {
      for (const stu of targets) {
        if (action === 'lock_account') {
          setStatusStmt.run(0, stu.id);
        } else {
          setStatusStmt.run(1, stu.id);
          clearAttemptStmt.run(`unified:${stu.nis.toLowerCase()}`);
          clearAttemptStmt.run(`stu:${stu.nis}`);
          clearAttemptStmt.run(`exampin:${stu.id}`);
        }
      }
    });
    tx();

    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorName: req.auth!.name,
      action: `BULK_STUDENT_${String(action).toUpperCase()}`,
      targetType: 'student',
      targetId: cleanScope,
      details: { action, scope: cleanScope, classId: classId || null, updatedCount: targets.length },
      ipAddress: req.ip,
    });

    res.json({ ok: true, action, updatedCount: targets.length });
  });

  // Send message / notice / kesan from Admin or Pengawas to students (all, class, exam participants, or selected)
  router.post('/admin/messages/send', requireAuth, requireRole(['admin', 'pengawas']), (req, res) => {
    const auth = req.auth!;
    const { scope, classId, studentIds, examId, category, title, message } = req.body || {};
    const cleanMessage = String(message || '').trim();
    const cleanTitle = String(title || '').trim().slice(0, 120);
    const cleanCategory = ['pesan', 'pengumuman', 'peringatan', 'instruksi', 'kesan'].includes(category) ? category : 'pesan';

    if (!cleanMessage || cleanMessage.length > 1000) {
      res.status(400).json({ error: 'Isi pesan wajib diisi (maksimal 1.000 karakter).' });
      return;
    }

    const cleanScope = ['all', 'class', 'selected', 'exam'].includes(scope) ? scope : 'selected';
    if (auth.role === 'pengawas' && cleanScope === 'all') {
      res.status(403).json({ error: 'Pengawas hanya dapat mengirim pesan ke peserta kelas/ujian binaan.' });
      return;
    }

    let targets: Array<{ id: string; class_id: string }> = [];

    if (cleanScope === 'all') {
      targets = db.prepare('SELECT id, class_id FROM students WHERE is_active = 1').all() as Array<{ id: string; class_id: string }>;
    } else if (cleanScope === 'class') {
      const cleanClassId = String(classId || '').trim();
      if (!cleanClassId) {
        res.status(400).json({ error: 'Pilih kelas tujuan terlebih dahulu.' });
        return;
      }
      if (auth.role === 'pengawas' && !canAccessClassOrExam(auth, cleanClassId, null)) {
        res.status(403).json({ error: 'Kelas di luar penugasan pengawas.' });
        return;
      }
      targets = db.prepare('SELECT id, class_id FROM students WHERE class_id = ? AND is_active = 1').all(cleanClassId) as Array<{ id: string; class_id: string }>;
    } else if (cleanScope === 'exam') {
      const cleanExamId = String(examId || '').trim();
      const exam = db.prepare('SELECT id, class_ids_json, assigned_student_ids_json FROM exams WHERE id = ?').get(cleanExamId) as
        | { id: string; class_ids_json: string; assigned_student_ids_json: string }
        | undefined;
      if (!exam) {
        res.status(404).json({ error: 'Ujian tujuan tidak ditemukan.' });
        return;
      }
      const examClassIds = JSON.parse(exam.class_ids_json || '[]') as string[];
      const assignedStuIds = JSON.parse(exam.assigned_student_ids_json || '[]') as string[];
      const allActive = db.prepare('SELECT id, class_id FROM students WHERE is_active = 1').all() as Array<{ id: string; class_id: string }>;
      targets = allActive.filter((s) => {
        const inExam = examClassIds.includes(s.class_id) || assignedStuIds.includes(s.id);
        if (!inExam) return false;
        if (auth.role === 'pengawas' && (auth.assignedClassIds || []).length > 0) {
          return auth.assignedClassIds!.includes(s.class_id);
        }
        return true;
      });
    } else {
      const ids = Array.isArray(studentIds) ? (studentIds as string[]).map((id) => String(id).trim()).filter(Boolean) : [];
      if (ids.length === 0) {
        res.status(400).json({ error: 'Pilih minimal satu siswa tujuan.' });
        return;
      }
      const placeholders = ids.map(() => '?').join(',');
      const found = db.prepare(`SELECT id, class_id FROM students WHERE id IN (${placeholders})`).all(...ids) as Array<{ id: string; class_id: string }>;
      targets = auth.role === 'pengawas'
        ? found.filter((s) => canAccessClassOrExam(auth, s.class_id, examId || null))
        : found;
    }

    if (targets.length === 0) {
      res.status(404).json({ error: 'Tidak ada siswa yang sesuai dengan sasaran pilihan.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const cleanExamId = examId ? String(examId).trim() : null;
    const findSessStmt = cleanExamId
      ? db.prepare('SELECT id FROM exam_sessions WHERE exam_id = ? AND student_id = ?')
      : null;

    const insertMsgStmt = db.prepare(`
      INSERT INTO student_messages (id, student_id, exam_id, session_id, sender_id, sender_role, sender_name, category, title, message, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `);
    const insertChatStmt = db.prepare(`
      INSERT INTO chat_messages (id, exam_id, session_id, sender_role, sender_id, sender_name, recipient_student_id, message, is_read, server_timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `);

    const createdPayloads: Array<{ studentId: string; sessionId: string | null; record: Record<string, unknown>; chatRecord?: Record<string, unknown> }> = [];

    const tx = db.transaction(() => {
      for (const stu of targets) {
        const msgId = crypto.randomUUID();
        const sessRow = findSessStmt ? (findSessStmt.get(cleanExamId!, stu.id) as { id: string } | undefined) : undefined;
        const sessId = sessRow?.id || null;

        insertMsgStmt.run(
          msgId,
          stu.id,
          cleanExamId,
          sessId,
          auth.userId,
          auth.role,
          auth.name,
          cleanCategory,
          cleanTitle,
          cleanMessage,
          nowIso
        );

        let chatRecord: Record<string, unknown> | undefined;
        if (cleanExamId && sessId) {
          const chatId = crypto.randomUUID();
          const chatBody = cleanTitle ? `[${cleanTitle}] ${cleanMessage}` : cleanMessage;
          insertChatStmt.run(chatId, cleanExamId, sessId, auth.role, auth.userId, auth.name, stu.id, chatBody, nowIso);
          chatRecord = {
            id: chatId,
            exam_id: cleanExamId,
            session_id: sessId,
            sender_role: auth.role,
            sender_id: auth.userId,
            sender_name: auth.name,
            recipient_student_id: stu.id,
            message: chatBody,
            server_timestamp: nowIso,
          };
        }

        createdPayloads.push({
          studentId: stu.id,
          sessionId: sessId,
          record: {
            id: msgId,
            student_id: stu.id,
            exam_id: cleanExamId,
            session_id: sessId,
            sender_id: auth.userId,
            sender_role: auth.role,
            sender_name: auth.name,
            category: cleanCategory,
            title: cleanTitle,
            message: cleanMessage,
            is_read: 0,
            read_at: null,
            created_at: nowIso,
          },
          chatRecord,
        });
      }
    });
    tx();

    for (const item of createdPayloads) {
      realtimeHub.sendToStudentAccount(item.studentId, {
        type: 'student:message',
        message: item.record,
      });
      if (item.sessionId && item.chatRecord) {
        realtimeHub.sendToStudent(item.sessionId, {
          type: 'chat:new',
          message: item.chatRecord,
        });
      }
    }

    writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      actorName: auth.name,
      action: 'SEND_STUDENT_MESSAGE',
      targetType: 'student_message',
      targetId: cleanScope,
      details: {
        scope: cleanScope,
        category: cleanCategory,
        title: cleanTitle,
        sentCount: createdPayloads.length,
        examId: cleanExamId,
      },
      ipAddress: req.ip,
    });

    res.json({ ok: true, sentCount: createdPayloads.length });
  });

  // Student Excel Template, Import Preview, Commit, & Export
  router.get('/admin/templates/students.xlsx', requireAuth, requireRole(['admin']), (_req, res) => {
    const buf = buildStudentsTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="template_data_siswa_sinarcbt.xlsx"');
    res.send(buf);
  });

  router.post('/admin/students/import-preview', requireAuth, requireRole(['admin']), uploadMemory.single('file'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Berkas Excel tidak ditemukan.' });
      return;
    }
    const existingNis = new Set((db.prepare('SELECT nis FROM students').all() as Array<{ nis: string }>).map((r) => r.nis));
    const existingNisn = new Set((db.prepare('SELECT nisn FROM students').all() as Array<{ nisn: string }>).map((r) => r.nisn));
    const validClasses = new Set((db.prepare('SELECT name FROM classes').all() as Array<{ name: string }>).map((r) => r.name));

    const parsed = previewStudentsExcelImport(req.file.buffer, existingNis, existingNisn, validClasses);
    const previewId = crypto.randomUUID();
    studentImportPreviewCache.set(previewId, { expiresAt: Date.now() + 15 * 60 * 1000, rows: parsed.rows });

    res.json({
      previewId,
      totalRows: parsed.rows.length,
      validCount: parsed.rows.filter((r) => r.valid).length,
      errorCount: parsed.rows.filter((r) => !r.valid).length,
      rows: parsed.rows,
      issues: parsed.issues,
    });
  });

  router.post('/admin/students/import-commit', requireAuth, requireRole(['admin']), (req, res) => {
    const { previewId } = req.body || {};
    const cached = studentImportPreviewCache.get(String(previewId || ''));
    if (!cached || cached.expiresAt < Date.now()) {
      res.status(404).json({ error: 'Pratinjau impor sudah kedaluwarsa. Silakan unggah ulang file Excel.' });
      return;
    }

    const classes = db.prepare('SELECT id, name FROM classes').all() as Array<{ id: string; name: string }>;
    const classByName = new Map(classes.map((c) => [c.name, c.id]));
    const now = new Date().toISOString();
    const validRows = cached.rows.filter((r) => r.valid);

    const ins = db.prepare(`
      INSERT INTO students (id, nis, nisn, pin_hash, pin_display, full_name, birth_place, birth_date, gender, email, photo_link, class_id, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);

    const tx = db.transaction(() => {
      for (const r of validRows) {
        const classId = classByName.get(r.className);
        if (!classId) continue;
        ins.run(
          `stu_${crypto.randomUUID().slice(0, 10)}`,
          r.nis,
          r.nisn,
          bcrypt.hashSync(r.pin, 8),
          r.pin,
          r.fullName,
          r.birthPlace || '',
          r.birthDate || '',
          r.gender || '',
          r.email || '',
          r.photoLink || '',
          classId,
          now
        );
      }
    });
    tx();
    studentImportPreviewCache.delete(String(previewId));

    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'IMPORT_STUDENTS_EXCEL',
      targetType: 'student',
      targetId: 'bulk',
      details: { importedCount: validRows.length },
    });

    res.json({ ok: true, importedCount: validRows.length });
  });

  router.get('/admin/students/export.xlsx', requireAuth, requireRole(['admin']), (req, res) => {
    const ids = parseIdsQuery(req.query.ids);
    const sql = ids.length > 0
      ? `SELECT s.nis as NIS, s.nisn as NISN, s.full_name as NAMA_LENGKAP, s.gender as JENIS_KELAMIN,
                s.birth_place as TEMPAT_LAHIR, s.birth_date as TANGGAL_LAHIR,
                s.email as ALAMAT_EMAIL, s.photo_link as LINK_FOTO,
                c.name as KELAS, s.pin_display as PIN,
                CASE WHEN s.is_active = 1 THEN 'Aktif' ELSE 'Nonaktif' END as STATUS,
                CASE WHEN s.photo_link <> '' THEN 'Link Eksternal' WHEN s.photo_path IS NOT NULL THEN 'Ada Foto' ELSE 'Belum Ada' END as FOTO_RESMI
         FROM students s JOIN classes c ON c.id = s.class_id
         WHERE s.id IN (${ids.map(() => '?').join(',')})
         ORDER BY c.name ASC, s.full_name ASC`
      : `SELECT s.nis as NIS, s.nisn as NISN, s.full_name as NAMA_LENGKAP, s.gender as JENIS_KELAMIN,
                s.birth_place as TEMPAT_LAHIR, s.birth_date as TANGGAL_LAHIR,
                s.email as ALAMAT_EMAIL, s.photo_link as LINK_FOTO,
                c.name as KELAS, s.pin_display as PIN,
                CASE WHEN s.is_active = 1 THEN 'Aktif' ELSE 'Nonaktif' END as STATUS,
                CASE WHEN s.photo_link <> '' THEN 'Link Eksternal' WHEN s.photo_path IS NOT NULL THEN 'Ada Foto' ELSE 'Belum Ada' END as FOTO_RESMI
         FROM students s JOIN classes c ON c.id = s.class_id
         ORDER BY c.name ASC, s.full_name ASC`;
    const rows = ids.length > 0 ? db.prepare(sql).all(...ids) : db.prepare(sql).all();
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'DataSiswa');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="ekspor_siswa_sinarcbt.xlsx"');
    res.send(buf);
  });

  // Official Student Photo Management (ADMIN ONLY!)
  router.post('/admin/photos/student/:studentId', requireAuth, requireRole(['admin']), uploadMemory.single('photo'), (req, res) => {
    const { studentId } = req.params;
    const student = db.prepare('SELECT id, nis, full_name, photo_path FROM students WHERE id = ?').get(studentId) as
      | { id: string; nis: string; full_name: string; photo_path: string | null }
      | undefined;

    if (!student) {
      res.status(404).json({ error: 'Siswa tidak ditemukan.' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'Berkas foto wajib dipilih (JPG, JPEG, atau PNG).' });
      return;
    }

    try {
      const saved = savePrivateStudentPhoto(student.id, req.file.buffer);
      const now = new Date().toISOString();
      db.prepare("UPDATE students SET photo_path = ?, photo_mime = ?, photo_size = ?, photo_link = '', photo_updated_at = ? WHERE id = ?").run(
        saved.path,
        saved.mime,
        saved.size,
        now,
        student.id
      );

      writeAuditLog({
        actorId: req.auth!.userId,
        actorRole: 'admin',
        actorName: req.auth!.name,
        action: student.photo_path ? 'REPLACE_STUDENT_PHOTO' : 'UPLOAD_STUDENT_PHOTO',
        targetType: 'student_photo',
        targetId: student.id,
        details: { nis: student.nis, fullName: student.full_name, size: saved.size, mime: saved.mime },
        ipAddress: req.ip,
      });

      res.json({ ok: true, photoUrl: `/api/photos/student/${student.id}`, updatedAt: now });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal menyimpan foto.' });
    }
  });

  router.delete('/admin/photos/student/:studentId', requireAuth, requireRole(['admin']), (req, res) => {
    const { studentId } = req.params;
    const student = db.prepare('SELECT id, nis, full_name, photo_path FROM students WHERE id = ?').get(studentId) as
      | { id: string; nis: string; full_name: string; photo_path: string | null }
      | undefined;
    if (!student) {
      res.status(404).json({ error: 'Siswa tidak ditemukan.' });
      return;
    }
    deletePrivateStudentPhoto(student.photo_path);
    db.prepare("UPDATE students SET photo_path = NULL, photo_mime = NULL, photo_size = NULL, photo_link = '', photo_updated_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      student.id
    );
    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'DELETE_STUDENT_PHOTO',
      targetType: 'student_photo',
      targetId: student.id,
      details: { nis: student.nis, fullName: student.full_name },
      ipAddress: req.ip,
    });
    res.json({ ok: true });
  });

  router.post('/admin/photos/bulk-preview', requireAuth, requireRole(['admin']), uploadMemory.single('zipFile'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Berkas ZIP tidak ditemukan.' });
      return;
    }
    const findStmt = db.prepare(`
      SELECT s.id, s.nis, s.full_name, c.name as class_name
      FROM students s JOIN classes c ON c.id = s.class_id
      WHERE s.nis = ?
    `);

    try {
      const parsed = parseBulkPhotoZip(req.file.buffer, (nis) => findStmt.get(nis) as { id: string; nis: string; full_name: string; class_name: string } | undefined);
      const previewId = crypto.randomUUID();
      bulkPhotoPreviewCache.set(previewId, {
        expiresAt: Date.now() + 15 * 60 * 1000,
        buffers: parsed.validBuffers,
        matchedNis: parsed.entries.filter((e) => e.status === 'matched').map((e) => e.nisCandidate),
      });

      res.json({
        previewId,
        totalFiles: parsed.entries.length,
        matchedCount: parsed.entries.filter((e) => e.status === 'matched').length,
        errorCount: parsed.entries.filter((e) => e.status !== 'matched').length,
        entries: parsed.entries,
      });
    } catch {
      res.status(400).json({ error: 'Berkas ZIP rusak atau tidak dapat dibaca.' });
    }
  });

  router.post('/admin/photos/bulk-commit', requireAuth, requireRole(['admin']), (req, res) => {
    const { previewId } = req.body || {};
    const cached = bulkPhotoPreviewCache.get(String(previewId || ''));
    if (!cached || cached.expiresAt < Date.now()) {
      res.status(404).json({ error: 'Pratinjau foto massal sudah kedaluwarsa. Unggah ulang berkas ZIP.' });
      return;
    }

    const now = new Date().toISOString();
    let savedCount = 0;
    const upd = db.prepare("UPDATE students SET photo_path = ?, photo_mime = ?, photo_size = ?, photo_link = '', photo_updated_at = ? WHERE id = ?");

    for (const [studentId, buf] of cached.buffers.entries()) {
      const saved = savePrivateStudentPhoto(studentId, buf);
      upd.run(saved.path, saved.mime, saved.size, now, studentId);
      savedCount++;
    }

    bulkPhotoPreviewCache.delete(String(previewId));

    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'BULK_UPLOAD_STUDENT_PHOTOS',
      targetType: 'student_photo',
      targetId: 'bulk_zip',
      details: { savedCount, matchedNis: cached.matchedNis },
      ipAddress: req.ip,
    });

    res.json({ ok: true, savedCount });
  });

  // ======================== ADMIN: QUESTION BANKS & QUESTIONS ========================
  router.get('/admin/question-banks', requireAuth, requireRole(['admin']), (_req, res) => {
    const banks = db.prepare(`
      SELECT qb.*, s.name as subject_name, s.code as subject_code,
             (SELECT COUNT(*) FROM questions q WHERE q.bank_id = qb.id) as question_count,
             (SELECT COUNT(*) FROM questions q WHERE q.bank_id = qb.id AND COALESCE(q.is_active, 1) = 1) as active_question_count
      FROM question_banks qb
      JOIN subjects s ON s.id = qb.subject_id
      ORDER BY qb.created_at DESC
    `).all();
    res.json({ banks });
  });

  router.post('/admin/question-banks', requireAuth, requireRole(['admin']), (req, res) => {
    const { name, subjectId, description } = req.body || {};
    if (!name || !subjectId) {
      res.status(400).json({ error: 'Nama bank soal dan mata pelajaran wajib diisi.' });
      return;
    }
    const id = `bnk_${crypto.randomUUID().slice(0, 8)}`;
    db.prepare('INSERT INTO question_banks (id, name, subject_id, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      String(name).trim(),
      subjectId,
      String(description || '').trim(),
      req.auth!.userId,
      new Date().toISOString()
    );
    res.json({ ok: true, id });
  });

  router.put('/admin/question-banks/:bankId', requireAuth, requireRole(['admin']), (req, res) => {
    const { bankId } = req.params;
    const { name, subjectId, description } = req.body || {};
    const existing = db.prepare('SELECT id FROM question_banks WHERE id = ?').get(bankId);
    if (!existing) {
      res.status(404).json({ error: 'Bank soal tidak ditemukan.' });
      return;
    }
    db.prepare(`
      UPDATE question_banks
      SET name = COALESCE(?, name),
          subject_id = COALESCE(?, subject_id),
          description = COALESCE(?, description)
      WHERE id = ?
    `).run(name ? String(name).trim() : null, subjectId || null, description !== undefined ? String(description).trim() : null, bankId);
    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'UPDATE_QUESTION_BANK',
      targetType: 'question_bank',
      targetId: bankId,
      details: { name, subjectId },
    });
    res.json({ ok: true });
  });

  router.delete('/admin/question-banks/:bankId', requireAuth, requireRole(['admin']), (req, res) => {
    const { bankId } = req.params;
    const examCnt = (db.prepare('SELECT COUNT(*) as c FROM exams WHERE question_bank_id = ?').get(bankId) as { c: number }).c;
    if (examCnt > 0) {
      res.status(409).json({ error: `Bank soal tidak dapat dihapus karena sedang digunakan oleh ${examCnt} ujian.` });
      return;
    }
    db.prepare('DELETE FROM question_banks WHERE id = ?').run(bankId);
    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'DELETE_QUESTION_BANK',
      targetType: 'question_bank',
      targetId: bankId,
    });
    res.json({ ok: true });
  });

  router.get('/admin/question-banks/:bankId/questions', requireAuth, requireRole(['admin']), (req, res) => {
    const questions = db.prepare(`
      SELECT q.*, ak.key_json, ak.wrong_penalty
      FROM questions q
      JOIN answer_keys ak ON ak.question_id = q.id
      WHERE q.bank_id = ?
      ORDER BY q.created_at ASC
    `).all(req.params.bankId);
    res.json({ questions });
  });

  router.get('/admin/question-banks/:bankId/questions/export.xlsx', requireAuth, requireRole(['admin']), (req, res) => {
    const { bankId } = req.params;
    const ids = parseIdsQuery(req.query.ids);
    const sql = ids.length > 0
      ? `SELECT q.*, sub.code as subject_code, ak.key_json
         FROM questions q
         JOIN subjects sub ON sub.id = q.subject_id
         JOIN answer_keys ak ON ak.question_id = q.id
         WHERE q.bank_id = ? AND q.id IN (${ids.map(() => '?').join(',')})
         ORDER BY q.created_at ASC`
      : `SELECT q.*, sub.code as subject_code, ak.key_json
         FROM questions q
         JOIN subjects sub ON sub.id = q.subject_id
         JOIN answer_keys ak ON ak.question_id = q.id
         WHERE q.bank_id = ?
         ORDER BY q.created_at ASC`;
    const rows = (ids.length > 0 ? db.prepare(sql).all(bankId, ...ids) : db.prepare(sql).all(bankId)) as Array<Parameters<typeof serializeQuestionForExcelExport>[0]>;
    const excelRows = rows.map(serializeQuestionForExcelExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(excelRows), 'BankSoalTKA');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ekspor_soal_${bankId}.xlsx"`);
    res.send(buf);
  });

  router.post('/admin/questions', requireAuth, requireRole(['admin']), (req, res) => {
    const { bankId, subjectId, topic, questionType, stemHtml, mediaPath, tableData, options, correctKey, difficulty, weight, explanationHtml, isActive } = req.body || {};
    if (!bankId || !subjectId || !questionType || !stemHtml || !options || correctKey === undefined) {
      res.status(400).json({ error: 'Data soal, opsi, dan kunci jawaban wajib lengkap.' });
      return;
    }
    const id = `q_${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    const activeFlag = isActive === false ? 0 : 1;

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO questions (id, bank_id, subject_id, topic, question_type, stem_html, media_path, table_data_json, options_json, difficulty, weight, explanation_html, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        bankId,
        subjectId,
        String(topic || 'Umum').trim(),
        questionType,
        String(stemHtml),
        mediaPath || null,
        tableData ? JSON.stringify(tableData) : null,
        JSON.stringify(options),
        difficulty || 'sedang',
        weight ? Number(weight) : null,
        explanationHtml ? String(explanationHtml) : null,
        activeFlag,
        now
      );

      db.prepare(`INSERT INTO answer_keys (question_id, key_json, scoring_mode, wrong_penalty, updated_at) VALUES (?, ?, 'standard', 0.5, ?)`).run(
        id,
        JSON.stringify(correctKey),
        now
      );
    });
    tx();

    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'CREATE_QUESTION',
      targetType: 'question',
      targetId: id,
      details: { bankId, questionType, isActive: Boolean(activeFlag) },
    });

    res.json({ ok: true, id });
  });

  router.put('/admin/questions/:questionId', requireAuth, requireRole(['admin']), (req, res) => {
    const { questionId } = req.params;
    const { topic, questionType, stemHtml, mediaPath, tableData, options, correctKey, difficulty, weight, explanationHtml, isActive } = req.body || {};
    const existing = db.prepare('SELECT id FROM questions WHERE id = ?').get(questionId);
    if (!existing) {
      res.status(404).json({ error: 'Soal tidak ditemukan.' });
      return;
    }
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE questions
        SET topic = COALESCE(?, topic),
            question_type = COALESCE(?, question_type),
            stem_html = COALESCE(?, stem_html),
            media_path = ?,
            table_data_json = COALESCE(?, table_data_json),
            options_json = COALESCE(?, options_json),
            difficulty = COALESCE(?, difficulty),
            weight = COALESCE(?, weight),
            explanation_html = ?,
            is_active = COALESCE(?, is_active)
        WHERE id = ?
      `).run(
        topic ? String(topic).trim() : null,
        questionType || null,
        stemHtml ? String(stemHtml) : null,
        mediaPath !== undefined ? mediaPath : null,
        tableData !== undefined ? (tableData ? JSON.stringify(tableData) : null) : null,
        options ? JSON.stringify(options) : null,
        difficulty || null,
        weight !== undefined ? Number(weight) : null,
        explanationHtml !== undefined ? (explanationHtml ? String(explanationHtml) : null) : null,
        typeof isActive === 'boolean' ? (isActive ? 1 : 0) : null,
        questionId
      );
      if (correctKey !== undefined) {
        db.prepare('UPDATE answer_keys SET key_json = ?, updated_at = ? WHERE question_id = ?').run(JSON.stringify(correctKey), now, questionId);
      }
    });
    tx();
    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'UPDATE_QUESTION',
      targetType: 'question',
      targetId: questionId,
      details: { questionType, topic, isActive },
    });
    res.json({ ok: true });
  });

  router.patch('/admin/questions/:questionId/visibility', requireAuth, requireRole(['admin']), (req, res) => {
    const { questionId } = req.params;
    const { isActive } = req.body || {};
    if (typeof isActive !== 'boolean') {
      res.status(400).json({ error: 'Status tampil (isActive: true/false) wajib diisi.' });
      return;
    }
    const info = db.prepare('UPDATE questions SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, questionId);
    if (info.changes === 0) {
      res.status(404).json({ error: 'Soal tidak ditemukan.' });
      return;
    }
    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'TOGGLE_QUESTION_VISIBILITY',
      targetType: 'question',
      targetId: questionId,
      details: { isActive },
    });
    res.json({ ok: true, isActive });
  });

  router.post('/admin/questions/bulk-visibility', requireAuth, requireRole(['admin']), (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : [];
    const { isActive } = req.body || {};
    if (ids.length === 0 || typeof isActive !== 'boolean') {
      res.status(400).json({ error: 'Pilih minimal satu soal dan tentukan status tampil (Ya/Tidak).' });
      return;
    }
    const updStmt = db.prepare('UPDATE questions SET is_active = ? WHERE id = ?');
    let updatedCount = 0;
    const tx = db.transaction(() => {
      for (const id of ids) {
        updatedCount += updStmt.run(isActive ? 1 : 0, id).changes;
      }
    });
    tx();
    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'BULK_TOGGLE_QUESTION_VISIBILITY',
      targetType: 'question',
      targetId: 'bulk',
      details: { updatedCount, isActive },
    });
    res.json({ ok: true, updatedCount, isActive });
  });

  router.delete('/admin/questions/:questionId', requireAuth, requireRole(['admin']), (req, res) => {
    db.prepare('DELETE FROM questions WHERE id = ?').run(req.params.questionId);
    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'DELETE_QUESTION',
      targetType: 'question',
      targetId: req.params.questionId,
    });
    res.json({ ok: true });
  });

  router.post('/admin/questions/bulk-delete', requireAuth, requireRole(['admin']), (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : [];
    if (ids.length === 0) {
      res.status(400).json({ error: 'Pilih minimal satu soal untuk dihapus.' });
      return;
    }
    const delStmt = db.prepare('DELETE FROM questions WHERE id = ?');
    let deletedCount = 0;
    const tx = db.transaction(() => {
      for (const id of ids) {
        const info = delStmt.run(id);
        deletedCount += info.changes;
      }
    });
    tx();
    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'BULK_DELETE_QUESTIONS',
      targetType: 'question',
      targetId: 'bulk',
      details: { deletedCount },
    });
    res.json({ ok: true, deletedCount });
  });

  router.post('/admin/questions/media', requireAuth, requireRole(['admin']), uploadMemory.single('media'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'File media gambar wajib dipilih.' });
      return;
    }
    try {
      const saved = saveQuestionMedia(`qmedia_${Date.now()}`, req.file.buffer);
      res.json({ ok: true, mediaPath: `/api/media/${saved.path}` });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal mengunggah gambar soal.' });
    }
  });

  // Question Templates & Excel / Word Import
  router.get('/admin/templates/questions.xlsx', requireAuth, requireRole(['admin']), (_req, res) => {
    const buf = buildQuestionsTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="template_bank_soal_tka_sinarcbt.xlsx"');
    res.send(buf);
  });

  router.post('/admin/question-banks/:bankId/import-preview', requireAuth, requireRole(['admin']), uploadMemory.single('file'), async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Berkas Excel atau Word (.docx) wajib dipilih.' });
      return;
    }
    const { bankId } = req.params;
    const validSubjects = new Set((db.prepare('SELECT code FROM subjects').all() as Array<{ code: string }>).map((s) => s.code));
    const ext = path.extname(req.file.originalname).toLowerCase();

    try {
      const parsed = ext === '.docx'
        ? await previewQuestionsWordImport(req.file.buffer, validSubjects)
        : previewQuestionsExcelImport(req.file.buffer, validSubjects);

      const previewId = crypto.randomUUID();
      questionImportPreviewCache.set(previewId, {
        expiresAt: Date.now() + 15 * 60 * 1000,
        bankId,
        rows: parsed.rows,
      });

      res.json({
        previewId,
        totalRows: parsed.rows.length,
        validCount: parsed.rows.filter((r) => r.valid).length,
        errorCount: parsed.rows.filter((r) => !r.valid).length,
        rows: parsed.rows,
        issues: parsed.issues,
        warningNote: 'warningNote' in parsed ? parsed.warningNote : undefined,
      });
    } catch {
      res.status(400).json({ error: 'Berkas tidak dapat diproses. Pastikan format Excel (.xlsx) atau Word (.docx) valid.' });
    }
  });

  router.post('/admin/question-banks/:bankId/import-commit', requireAuth, requireRole(['admin']), (req, res) => {
    const { previewId } = req.body || {};
    const cached = questionImportPreviewCache.get(String(previewId || ''));
    if (!cached || cached.expiresAt < Date.now()) {
      res.status(404).json({ error: 'Pratinjau impor soal sudah kedaluwarsa.' });
      return;
    }

    const subjects = db.prepare('SELECT id, code FROM subjects').all() as Array<{ id: string; code: string }>;
    const subjectByCode = new Map(subjects.map((s) => [s.code, s.id]));
    const validRows = cached.rows.filter((r) => r.valid);
    const now = new Date().toISOString();

    const insQ = db.prepare(`
      INSERT INTO questions (id, bank_id, subject_id, topic, question_type, stem_html, options_json, difficulty, weight, explanation_html, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insKey = db.prepare(`
      INSERT INTO answer_keys (question_id, key_json, scoring_mode, wrong_penalty, updated_at)
      VALUES (?, ?, 'standard', 0.5, ?)
    `);

    const tx = db.transaction(() => {
      for (const r of validRows) {
        const qId = `${r.id}_${crypto.randomUUID().slice(0, 6)}`;
        const subId = subjectByCode.get(r.subjectCode) || subjects[0]?.id;
        insQ.run(qId, cached.bankId, subId, r.topic, r.questionType, r.stemHtml, JSON.stringify(r.options), r.difficulty, r.weight, r.explanationHtml, r.isActive ? 1 : 0, now);
        insKey.run(qId, JSON.stringify(r.correctKey), now);
      }
    });
    tx();
    questionImportPreviewCache.delete(String(previewId));

    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'IMPORT_QUESTIONS',
      targetType: 'question_bank',
      targetId: cached.bankId,
      details: { importedCount: validRows.length },
    });

    res.json({ ok: true, importedCount: validRows.length });
  });

  // ======================== ADMIN: EXAMS, SCHEDULES, PACKAGES & RUBRICS ========================
  router.get('/admin/exams', requireAuth, requireRole(['admin', 'pengawas']), (_req, res) => {
    const exams = db.prepare(`
      SELECT e.*, sub.name as subject_name, sub.code as subject_code, qb.name as bank_name,
             sch.timezone, sch.start_at, sch.entry_deadline_at, sch.end_at, sch.status as schedule_status,
             sr.weights_json as rubric_weights_json
      FROM exams e
      JOIN subjects sub ON sub.id = e.subject_id
      JOIN question_banks qb ON qb.id = e.question_bank_id
      LEFT JOIN exam_schedules sch ON sch.exam_id = e.id
      LEFT JOIN scoring_rubrics sr ON sr.exam_id = e.id
      ORDER BY e.created_at DESC
    `).all();
    res.json({ exams });
  });

  router.post('/admin/exams', requireAuth, requireRole(['admin']), (req, res) => {
    const b = req.body || {};
    if (!b.title || !b.subjectId || !b.questionBankId || !b.startAt || !b.endAt) {
      res.status(400).json({ error: 'Judul ujian, mata pelajaran, bank soal, dan jadwal wajib diisi.' });
      return;
    }

    const activeCountRow = db
      .prepare('SELECT COUNT(*) as c FROM questions WHERE bank_id = ? AND COALESCE(is_active, 1) = 1')
      .get(b.questionBankId) as { c: number };
    if (activeCountRow.c === 0) {
      res.status(400).json({ error: 'Bank soal yang dipilih belum memiliki soal aktif (Tampilkan: Ya). Aktifkan minimal 1 soal di Bank Soal terlebih dahulu.' });
      return;
    }

    const examId = `exm_${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    const weights: ScoringWeights = b.rubricWeights || DEFAULT_SCORING_WEIGHTS;

    const accessTokenMode = b.accessTokenMode === 'exam_token' ? 'exam_token' : 'student_pin';
    const accessToken = accessTokenMode === 'exam_token' ? String(b.accessToken || '').trim() : '';
    if (accessTokenMode === 'exam_token' && (accessToken.length < 4 || accessToken.length > 32)) {
      res.status(400).json({ error: 'Token khusus ujian harus terdiri dari 4 hingga 32 karakter.' });
      return;
    }

    const sanitizedClassConfigs = sanitizeClassConfigs(b.classConfigs);
    if (!sanitizedClassConfigs.ok) {
      res.status(400).json({ error: sanitizedClassConfigs.error });
      return;
    }

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO exams (
          id, title, exam_type, subject_id, class_ids_json, assigned_student_ids_json,
          question_bank_id, question_count, shuffle_mode, shuffle_questions, shuffle_options,
          composition_json, duration_minutes, passing_score, max_violations, auto_lock_enabled,
          require_fullscreen, require_camera, require_exam_wifi, allowed_wifi_ssid,
          proctoring_enabled, proctoring_sensitivity, proctoring_tolerance,
          proctoring_retention_days, allow_camera_stream, publication_policy, history_visible, publish_at,
          access_token_mode, access_token, class_configs_json, created_by, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        examId,
        String(b.title).trim(),
        String(b.examType || 'Ulangan Harian').trim(),
        b.subjectId,
        JSON.stringify(b.classIds || []),
        JSON.stringify(b.assignedStudentIds || []),
        b.questionBankId,
        Number(b.questionCount || 10),
        b.shuffleMode || 'A',
        b.shuffleQuestions === false ? 0 : 1,
        b.shuffleOptions === false ? 0 : 1,
        b.composition ? JSON.stringify(b.composition) : null,
        Number(b.durationMinutes || 60),
        Number(b.passingScore || 75),
        Number(b.maxViolations || 3),
        b.autoLockEnabled === false ? 0 : 1,
        b.requireFullscreen ? 1 : 0,
        b.requireCamera ? 1 : 0,
        b.requireExamWifi ? 1 : 0,
        String(b.allowedWifiSsid || '').trim().slice(0, 64),
        b.proctoringEnabled ? 1 : 0,
        b.proctoringSensitivity || 'sedang',
        Number(b.proctoringTolerance || 5),
        Number(b.proctoringRetentionDays || 14),
        b.allowCameraStream ? 1 : 0,
        b.publicationPolicy || 'view_download_print',
        b.historyVisible === false ? 0 : 1,
        b.publishAt || null,
        accessTokenMode,
        accessToken,
        JSON.stringify(sanitizedClassConfigs.configs),
        req.auth!.userId,
        now
      );

      db.prepare(`
        INSERT INTO exam_schedules (id, exam_id, timezone, start_at, entry_deadline_at, end_at, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
      `).run(
        `sch_${crypto.randomUUID().slice(0, 8)}`,
        examId,
        b.timezone || 'Asia/Jakarta',
        new Date(b.startAt).toISOString(),
        new Date(b.entryDeadlineAt || b.endAt).toISOString(),
        new Date(b.endAt).toISOString(),
        now
      );

      db.prepare(`
        INSERT INTO scoring_rubrics (id, exam_id, version, weights_json, penalty_rule_json, created_at)
        VALUES (?, ?, 1, ?, ?, ?)
      `).run(
        `rub_${crypto.randomUUID().slice(0, 8)}`,
        examId,
        JSON.stringify(weights),
        JSON.stringify({ wrongPenaltyFactor: weights.pg_kompleks_wrong_penalty }),
        now
      );

      // If Mode B (Paket Tetap), auto-generate requested fixed packages (Paket A, B, C...) using ONLY active questions
      if (b.shuffleMode === 'B') {
        const pkgCount = Math.max(1, Math.min(10, Number(b.fixedPackageCount || 2)));
        const bankQs = db.prepare('SELECT * FROM questions WHERE bank_id = ? AND COALESCE(is_active, 1) = 1').all(b.questionBankId) as QuestionRecord[];
        const targetCount = Math.min(Number(b.questionCount || 10), bankQs.length);
        for (let i = 0; i < pkgCount; i++) {
          const code = `Paket ${String.fromCharCode(65 + i)}`;
          const shuffled = [...bankQs].sort(() => Math.random() - 0.5).slice(0, targetCount);
          const qIds = shuffled.map((q) => q.id);
          const optOrders = buildOptionOrdersForQuestions(shuffled, b.shuffleOptions !== false);
          const maxPts = shuffled.reduce((s, q) => s + (q.weight || weights[q.question_type] || 2), 0);
          db.prepare(`
            INSERT INTO exam_packages (id, exam_id, package_code, is_fixed, question_ids_json, option_orders_json, max_points, created_at)
            VALUES (?, ?, ?, 1, ?, ?, ?, ?)
          `).run(`pkg_${crypto.randomUUID().slice(0, 10)}`, examId, code, JSON.stringify(qIds), JSON.stringify(optOrders), maxPts, now);
        }
      }
    });
    tx();

    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'CREATE_EXAM',
      targetType: 'exam',
      targetId: examId,
      details: { title: b.title, shuffleMode: b.shuffleMode },
    });

    realtimeHub.broadcastToStudents({
      type: 'exam:schedule_updated',
      examId,
      title: String(b.title || '').trim(),
      action: 'created',
      timestamp: new Date().toISOString(),
    });

    res.json({ ok: true, id: examId });
  });

  router.patch('/admin/exams/:examId/policy', requireAuth, requireRole(['admin']), (req, res) => {
    const { examId } = req.params;
    const { publicationPolicy, historyVisible, publishAt, autoLockEnabled, maxViolations, proctoringEnabled, allowCameraStream } = req.body || {};

    db.prepare(`
      UPDATE exams
      SET publication_policy = COALESCE(?, publication_policy),
          history_visible = COALESCE(?, history_visible),
          publish_at = ?,
          auto_lock_enabled = COALESCE(?, auto_lock_enabled),
          max_violations = COALESCE(?, max_violations),
          proctoring_enabled = COALESCE(?, proctoring_enabled),
          allow_camera_stream = COALESCE(?, allow_camera_stream)
      WHERE id = ?
    `).run(
      publicationPolicy || null,
      typeof historyVisible === 'boolean' ? (historyVisible ? 1 : 0) : null,
      publishAt !== undefined ? publishAt : null,
      typeof autoLockEnabled === 'boolean' ? (autoLockEnabled ? 1 : 0) : null,
      maxViolations ? Number(maxViolations) : null,
      typeof proctoringEnabled === 'boolean' ? (proctoringEnabled ? 1 : 0) : null,
      typeof allowCameraStream === 'boolean' ? (allowCameraStream ? 1 : 0) : null,
      examId
    );

    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'UPDATE_EXAM_POLICY',
      targetType: 'exam',
      targetId: examId,
      details: { publicationPolicy, historyVisible, publishAt, autoLockEnabled, proctoringEnabled },
    });

    realtimeHub.broadcastToStudents({
      type: 'exam:schedule_updated',
      examId,
      action: 'policy_updated',
      timestamp: new Date().toISOString(),
    });

    res.json({ ok: true });
  });

  router.put('/admin/exams/:examId/class-configs', requireAuth, requireRole(['admin']), (req, res) => {
    const { examId } = req.params;
    const { classIds, classConfigs } = req.body || {};
    const existing = db.prepare('SELECT id, title FROM exams WHERE id = ?').get(examId) as { id: string; title: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }

    const sanitized = sanitizeClassConfigs(classConfigs);
    if (!sanitized.ok) {
      res.status(400).json({ error: sanitized.error });
      return;
    }

    db.prepare(`
      UPDATE exams
      SET class_ids_json = COALESCE(?, class_ids_json),
          class_configs_json = ?
      WHERE id = ?
    `).run(
      Array.isArray(classIds) ? JSON.stringify(classIds) : null,
      JSON.stringify(sanitized.configs),
      examId
    );

    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'UPDATE_EXAM_CLASS_CONFIGS',
      targetType: 'exam',
      targetId: examId,
      details: { classIds, configuredClasses: Object.keys(sanitized.configs) },
    });

    realtimeHub.broadcastToStudents({
      type: 'exam:schedule_updated',
      examId,
      title: existing.title,
      action: 'class_schedule_updated',
      timestamp: new Date().toISOString(),
    });

    res.json({ ok: true, classConfigs: sanitized.configs });
  });

  router.put('/admin/exams/:examId', requireAuth, requireRole(['admin']), (req, res) => {
    const { examId } = req.params;
    const b = req.body || {};
    const existing = db.prepare('SELECT id FROM exams WHERE id = ?').get(examId);
    if (!existing) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }

    const accessTokenMode =
      b.accessTokenMode === 'exam_token' ? 'exam_token' : b.accessTokenMode === 'student_pin' ? 'student_pin' : null;
    const cleanAccessToken = accessTokenMode === 'exam_token' ? String(b.accessToken || '').trim() : accessTokenMode === 'student_pin' ? '' : null;
    if (accessTokenMode === 'exam_token' && (!cleanAccessToken || cleanAccessToken.length < 4 || cleanAccessToken.length > 32)) {
      res.status(400).json({ error: 'Token khusus ujian harus terdiri dari 4 hingga 32 karakter.' });
      return;
    }

    let classConfigsJsonToSave: string | null = null;
    if (b.classConfigs !== undefined) {
      const sanitizedClassConfigs = sanitizeClassConfigs(b.classConfigs);
      if (!sanitizedClassConfigs.ok) {
        res.status(400).json({ error: sanitizedClassConfigs.error });
        return;
      }
      classConfigsJsonToSave = JSON.stringify(sanitizedClassConfigs.configs);
    }

    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE exams
        SET title = COALESCE(?, title),
            exam_type = COALESCE(?, exam_type),
            subject_id = COALESCE(?, subject_id),
            class_ids_json = COALESCE(?, class_ids_json),
            question_bank_id = COALESCE(?, question_bank_id),
            question_count = COALESCE(?, question_count),
            shuffle_mode = COALESCE(?, shuffle_mode),
            shuffle_questions = COALESCE(?, shuffle_questions),
            shuffle_options = COALESCE(?, shuffle_options),
            composition_json = ?,
            duration_minutes = COALESCE(?, duration_minutes),
            passing_score = COALESCE(?, passing_score),
            max_violations = COALESCE(?, max_violations),
            auto_lock_enabled = COALESCE(?, auto_lock_enabled),
            require_fullscreen = COALESCE(?, require_fullscreen),
            require_camera = COALESCE(?, require_camera),
            require_exam_wifi = COALESCE(?, require_exam_wifi),
            allowed_wifi_ssid = COALESCE(?, allowed_wifi_ssid),
            proctoring_enabled = COALESCE(?, proctoring_enabled),
            proctoring_sensitivity = COALESCE(?, proctoring_sensitivity),
            proctoring_tolerance = COALESCE(?, proctoring_tolerance),
            proctoring_retention_days = COALESCE(?, proctoring_retention_days),
            allow_camera_stream = COALESCE(?, allow_camera_stream),
            publication_policy = COALESCE(?, publication_policy),
            history_visible = COALESCE(?, history_visible),
            access_token_mode = COALESCE(?, access_token_mode),
            access_token = COALESCE(?, access_token),
            class_configs_json = COALESCE(?, class_configs_json)
        WHERE id = ?
      `).run(
        b.title ? String(b.title).trim() : null,
        b.examType ? String(b.examType).trim() : null,
        b.subjectId || null,
        Array.isArray(b.classIds) ? JSON.stringify(b.classIds) : null,
        b.questionBankId || null,
        b.questionCount ? Number(b.questionCount) : null,
        b.shuffleMode || null,
        typeof b.shuffleQuestions === 'boolean' ? (b.shuffleQuestions ? 1 : 0) : null,
        typeof b.shuffleOptions === 'boolean' ? (b.shuffleOptions ? 1 : 0) : null,
        b.composition !== undefined ? (b.composition ? JSON.stringify(b.composition) : null) : null,
        b.durationMinutes ? Number(b.durationMinutes) : null,
        b.passingScore !== undefined ? Number(b.passingScore) : null,
        b.maxViolations ? Number(b.maxViolations) : null,
        typeof b.autoLockEnabled === 'boolean' ? (b.autoLockEnabled ? 1 : 0) : null,
        typeof b.requireFullscreen === 'boolean' ? (b.requireFullscreen ? 1 : 0) : null,
        typeof b.requireCamera === 'boolean' ? (b.requireCamera ? 1 : 0) : null,
        typeof b.requireExamWifi === 'boolean' ? (b.requireExamWifi ? 1 : 0) : null,
        b.allowedWifiSsid !== undefined ? String(b.allowedWifiSsid || '').trim().slice(0, 64) : null,
        typeof b.proctoringEnabled === 'boolean' ? (b.proctoringEnabled ? 1 : 0) : null,
        b.proctoringSensitivity || null,
        b.proctoringTolerance ? Number(b.proctoringTolerance) : null,
        b.proctoringRetentionDays ? Number(b.proctoringRetentionDays) : null,
        typeof b.allowCameraStream === 'boolean' ? (b.allowCameraStream ? 1 : 0) : null,
        b.publicationPolicy || null,
        typeof b.historyVisible === 'boolean' ? (b.historyVisible ? 1 : 0) : null,
        accessTokenMode,
        cleanAccessToken,
        classConfigsJsonToSave,
        examId
      );

      if (b.startAt && b.endAt) {
        db.prepare(`
          UPDATE exam_schedules
          SET timezone = COALESCE(?, timezone),
              start_at = ?,
              entry_deadline_at = ?,
              end_at = ?
          WHERE exam_id = ?
        `).run(
          b.timezone || null,
          new Date(b.startAt).toISOString(),
          new Date(b.entryDeadlineAt || b.endAt).toISOString(),
          new Date(b.endAt).toISOString(),
          examId
        );
      }

      if (b.rubricWeights) {
        db.prepare(`
          UPDATE scoring_rubrics
          SET weights_json = ?,
              penalty_rule_json = ?
          WHERE exam_id = ?
        `).run(
          JSON.stringify(b.rubricWeights),
          JSON.stringify({ wrongPenaltyFactor: b.rubricWeights.pg_kompleks_wrong_penalty ?? 0.5 }),
          examId
        );
      }
    });
    tx();

    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'UPDATE_EXAM',
      targetType: 'exam',
      targetId: examId,
      details: { title: b.title },
    });
    realtimeHub.broadcastToStudents({
      type: 'exam:schedule_updated',
      examId,
      title: b.title ? String(b.title).trim() : undefined,
      action: 'updated',
      timestamp: new Date().toISOString(),
    });

    res.json({ ok: true });
  });

  // Bulk exam token/PIN setting (all exams or selected exams)
  router.post('/admin/exams/bulk-token', requireAuth, requireRole(['admin']), (req, res) => {
    const { scope, examIds, accessTokenMode, accessToken } = req.body || {};
    const cleanScope = scope === 'selected' ? 'selected' : 'all';
    const cleanMode = accessTokenMode === 'exam_token' ? 'exam_token' : 'student_pin';
    const cleanToken = cleanMode === 'exam_token' ? String(accessToken || '').trim() : '';

    if (cleanMode === 'exam_token' && (cleanToken.length < 4 || cleanToken.length > 32)) {
      res.status(400).json({ error: 'Token khusus ujian harus terdiri dari 4 hingga 32 karakter.' });
      return;
    }

    let targets: Array<{ id: string }> = [];
    if (cleanScope === 'all') {
      targets = db.prepare('SELECT id FROM exams').all() as Array<{ id: string }>;
    } else {
      const ids = Array.isArray(examIds) ? (examIds as string[]).map((id) => String(id).trim()).filter(Boolean) : [];
      if (ids.length === 0) {
        res.status(400).json({ error: 'Pilih minimal satu ujian tujuan.' });
        return;
      }
      const placeholders = ids.map(() => '?').join(',');
      targets = db.prepare(`SELECT id FROM exams WHERE id IN (${placeholders})`).all(...ids) as Array<{ id: string }>;
    }

    if (targets.length === 0) {
      res.status(404).json({ error: 'Tidak ada ujian yang sesuai dengan sasaran pilihan.' });
      return;
    }

    const updStmt = db.prepare('UPDATE exams SET access_token_mode = ?, access_token = ? WHERE id = ?');
    const tx = db.transaction(() => {
      for (const ex of targets) {
        updStmt.run(cleanMode, cleanToken, ex.id);
      }
    });
    tx();

    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'BULK_UPDATE_EXAM_TOKEN',
      targetType: 'exam',
      targetId: cleanScope,
      details: { scope: cleanScope, accessTokenMode: cleanMode, updatedCount: targets.length },
    });

    res.json({ ok: true, updatedCount: targets.length, accessTokenMode: cleanMode });
  });

  router.delete('/admin/exams/:examId', requireAuth, requireRole(['admin']), (req, res) => {
    const { examId } = req.params;
    const existing = db.prepare('SELECT title FROM exams WHERE id = ?').get(examId) as { title: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }
    db.prepare('DELETE FROM exams WHERE id = ?').run(examId);
    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'DELETE_EXAM',
      targetType: 'exam',
      targetId: examId,
      details: { title: existing.title },
    });
    res.json({ ok: true });
  });

  router.post('/admin/exams/bulk-delete', requireAuth, requireRole(['admin']), (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : [];
    if (ids.length === 0) {
      res.status(400).json({ error: 'Pilih minimal satu ujian untuk dihapus.' });
      return;
    }
    const delStmt = db.prepare('DELETE FROM exams WHERE id = ?');
    let deletedCount = 0;
    const tx = db.transaction(() => {
      for (const id of ids) {
        deletedCount += delStmt.run(id).changes;
      }
    });
    tx();
    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'BULK_DELETE_EXAMS',
      targetType: 'exam',
      targetId: 'bulk',
      details: { deletedCount },
    });
    res.json({ ok: true, deletedCount });
  });

  router.get('/admin/templates/exams.xlsx', requireAuth, requireRole(['admin']), (_req, res) => {
    const buf = buildExamsTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="template_ujian_sinarcbt.xlsx"');
    res.send(buf);
  });

  router.post('/admin/exams/import-preview', requireAuth, requireRole(['admin']), uploadMemory.single('file'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Berkas Excel tidak ditemukan.' });
      return;
    }
    const subjects = db.prepare('SELECT id, code FROM subjects').all() as Array<{ id: string; code: string }>;
    const banks = db.prepare('SELECT id, name FROM question_banks').all() as Array<{ id: string; name: string }>;
    const classes = db.prepare('SELECT id, name FROM classes').all() as Array<{ id: string; name: string }>;
    const subjectByCode = new Map(subjects.map((s) => [s.code.toUpperCase(), s.id]));
    const bankByName = new Map(banks.map((b) => [b.name.trim().toLowerCase(), b.id]));
    const classByName = new Map(classes.map((c) => [c.name, c.id]));

    const parsed = previewExamsExcelImport(req.file.buffer, subjectByCode, bankByName, classByName);
    const previewId = crypto.randomUUID();
    examImportPreviewCache.set(previewId, { expiresAt: Date.now() + 15 * 60 * 1000, rows: parsed.rows });
    res.json({
      previewId,
      totalRows: parsed.rows.length,
      validCount: parsed.rows.filter((r) => r.valid).length,
      errorCount: parsed.rows.filter((r) => !r.valid).length,
      rows: parsed.rows,
      issues: parsed.issues,
    });
  });

  router.post('/admin/exams/import-commit', requireAuth, requireRole(['admin']), (req, res) => {
    const { previewId } = req.body || {};
    const cached = examImportPreviewCache.get(String(previewId || ''));
    if (!cached || cached.expiresAt < Date.now()) {
      res.status(404).json({ error: 'Pratinjau impor ujian sudah kedaluwarsa.' });
      return;
    }
    const validRows = cached.rows.filter((r) => r.valid);
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      for (const r of validRows) {
        const examId = `exm_${crypto.randomUUID().slice(0, 10)}`;
        db.prepare(`
          INSERT INTO exams (
            id, title, exam_type, subject_id, class_ids_json, assigned_student_ids_json,
            question_bank_id, question_count, shuffle_mode, shuffle_questions, shuffle_options,
            duration_minutes, passing_score, max_violations, auto_lock_enabled,
            require_fullscreen, proctoring_enabled, publication_policy, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?, 1, 1, ?, ?, 3, 1, 0, 0, ?, ?, ?)
        `).run(
          examId,
          r.title,
          r.examType,
          r.subjectId,
          JSON.stringify(r.classIds),
          r.questionBankId,
          r.questionCount,
          r.shuffleMode,
          r.durationMinutes,
          r.passingScore,
          r.publicationPolicy,
          req.auth!.userId,
          now
        );
        db.prepare(`
          INSERT INTO exam_schedules (id, exam_id, timezone, start_at, entry_deadline_at, end_at, status, created_at)
          VALUES (?, ?, 'Asia/Jakarta', ?, ?, ?, 'active', ?)
        `).run(`sch_${crypto.randomUUID().slice(0, 8)}`, examId, r.startAt, r.entryDeadlineAt, r.endAt, now);
        db.prepare(`
          INSERT INTO scoring_rubrics (id, exam_id, version, weights_json, penalty_rule_json, created_at)
          VALUES (?, ?, 1, ?, ?, ?)
        `).run(
          `rub_${crypto.randomUUID().slice(0, 8)}`,
          examId,
          JSON.stringify(DEFAULT_SCORING_WEIGHTS),
          JSON.stringify({ wrongPenaltyFactor: DEFAULT_SCORING_WEIGHTS.pg_kompleks_wrong_penalty }),
          now
        );
      }
    });
    tx();
    examImportPreviewCache.delete(String(previewId));
    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'IMPORT_EXAMS_EXCEL',
      targetType: 'exam',
      targetId: 'bulk',
      details: { importedCount: validRows.length },
    });
    res.json({ ok: true, importedCount: validRows.length });
  });

  router.get('/admin/exams/export.xlsx', requireAuth, requireRole(['admin']), (req, res) => {
    const ids = parseIdsQuery(req.query.ids);
    const classes = db.prepare('SELECT id, name FROM classes').all() as Array<{ id: string; name: string }>;
    const classMap = new Map(classes.map((c) => [c.id, c.name]));

    const sql = ids.length > 0
      ? `SELECT e.*, sub.code as subject_code, qb.name as bank_name, sch.start_at, sch.entry_deadline_at, sch.end_at
         FROM exams e
         JOIN subjects sub ON sub.id = e.subject_id
         JOIN question_banks qb ON qb.id = e.question_bank_id
         LEFT JOIN exam_schedules sch ON sch.exam_id = e.id
         WHERE e.id IN (${ids.map(() => '?').join(',')})
         ORDER BY e.created_at DESC`
      : `SELECT e.*, sub.code as subject_code, qb.name as bank_name, sch.start_at, sch.entry_deadline_at, sch.end_at
         FROM exams e
         JOIN subjects sub ON sub.id = e.subject_id
         JOIN question_banks qb ON qb.id = e.question_bank_id
         LEFT JOIN exam_schedules sch ON sch.exam_id = e.id
         ORDER BY e.created_at DESC`;
    const exams = (ids.length > 0 ? db.prepare(sql).all(...ids) : db.prepare(sql).all()) as Array<Record<string, unknown>>;
    const excelRows = exams.map((e) => {
      const cids = JSON.parse(String(e.class_ids_json || '[]')) as string[];
      return {
        NAMA_UJIAN: e.title,
        JENIS_UJIAN: e.exam_type,
        KODE_MAPEL: e.subject_code,
        NAMA_BANK: e.bank_name,
        KELAS_PESERTA: cids.map((id) => classMap.get(id) || id).join(', '),
        JUMLAH_SOAL: e.question_count,
        DURASI_MENIT: e.duration_minutes,
        KKM: e.passing_score,
        MODE_ACAK: e.shuffle_mode,
        WAKTU_MULAI: e.start_at,
        BATAS_MASUK: e.entry_deadline_at,
        WAKTU_SELESAI: e.end_at,
        PUBLIKASI: e.publication_policy,
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(excelRows), 'JadwalUjian');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="ekspor_ujian_sinarcbt.xlsx"');
    res.send(buf);
  });

  // ======================== ADMIN: ANALYTICS, ITEM ANALYSIS, RAPOR & EXPORTS ========================
  router.get('/admin/analytics/:examId', requireAuth, requireRole(['admin']), (req, res) => {
    const analytics = computeExamAnalytics(req.params.examId);
    if (!analytics) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }
    res.json(analytics);
  });

  router.get('/admin/item-analysis/:examId', requireAuth, requireRole(['admin']), (req, res) => {
    const analysis = computeItemAnalysis(req.params.examId);
    if (!analysis) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }
    res.json(analysis);
  });

  router.get('/admin/analytics/:examId/export.xlsx', requireAuth, requireRole(['admin']), (req, res) => {
    const analytics = computeExamAnalytics(req.params.examId);
    if (!analytics) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }
    const selectedStudentIds = new Set(parseIdsQuery(req.query.studentIds));
    const filteredScores = selectedStudentIds.size > 0
      ? analytics.studentScores.filter((s) => selectedStudentIds.has(s.student_id))
      : analytics.studentScores;

    const itemAnalysis = computeItemAnalysis(req.params.examId);
    const wb = XLSX.utils.book_new();

    const scoreRows = filteredScores.map((s, idx) => ({
      NO: idx + 1,
      NIS: s.nis,
      NAMA_SISWA: s.full_name,
      KELAS: s.class_name,
      POIN_DIPEROLEH: s.raw_points,
      POIN_MAKSIMUM: s.max_points,
      NILAI_AKHIR: s.final_score,
      BENAR: s.correct_count,
      PARSIAL: s.partial_count,
      SALAH: s.wrong_count,
      KOSONG: s.blank_count,
      KETUNTASAN: s.passed ? 'Tuntas' : 'Belum Tuntas',
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(scoreRows), 'NilaiPeserta');

    if (itemAnalysis) {
      const itemRows = itemAnalysis.items.map((it) => ({
        ID_SOAL: it.questionId,
        MATERI: it.topic,
        TIPE: it.questionType,
        SAMPEL_N: it.sampleSize,
        PERINGATAN_SAMPEL_KECIL: it.lowSampleWarning ? 'Ya (<15)' : 'Cukup',
        BENAR: it.correctCount,
        PARSIAL: it.partialCount,
        SALAH: it.wrongCount,
        KOSONG: it.blankCount,
        RATA_SKOR_PARSIAL: it.avgPartialScore,
        PERSEN_BENAR: it.correctPercent,
        TINGKAT_PENYUSUN: it.authorDifficulty,
        TINGKAT_EMPIRIS: it.empiricalDifficulty,
        DAYA_PEMBEDA: it.discriminationIndex ?? 'Sampel kurang',
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(itemRows), 'AnalisisButir');
    }

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="analisis_${req.params.examId}.xlsx"`);
    res.send(buf);
  });

  // ======================== ADMIN: STAFF (PENGAWAS), SETTINGS, LOGS, BACKUP & TESTS ========================
  router.get('/admin/staff', requireAuth, requireRole(['admin']), (_req, res) => {
    const staff = db.prepare(`
      SELECT id, username, full_name, role, assigned_class_ids_json, assigned_exam_ids_json, can_unlock_sessions, is_active, created_at
      FROM users ORDER BY role ASC, full_name ASC
    `).all();
    res.json({ staff });
  });

  router.post('/admin/staff', requireAuth, requireRole(['admin']), (req, res) => {
    const { username, password, fullName, assignedClassIds, assignedExamIds, canUnlockSessions } = req.body || {};
    if (!username || !password || !fullName) {
      res.status(400).json({ error: 'Username, password, dan nama lengkap wajib diisi.' });
      return;
    }
    const id = `usr_${crypto.randomUUID().slice(0, 8)}`;
    try {
      db.prepare(`
        INSERT INTO users (id, username, password_hash, full_name, role, assigned_class_ids_json, assigned_exam_ids_json, can_unlock_sessions, is_active, created_at)
        VALUES (?, ?, ?, ?, 'pengawas', ?, ?, ?, 1, ?)
      `).run(
        id,
        String(username).trim(),
        bcrypt.hashSync(String(password), 10),
        String(fullName).trim(),
        JSON.stringify(assignedClassIds || []),
        JSON.stringify(assignedExamIds || []),
        canUnlockSessions ? 1 : 0,
        new Date().toISOString()
      );
      writeAuditLog({
        actorId: req.auth!.userId,
        actorRole: 'admin',
        actorName: req.auth!.name,
        action: 'CREATE_PROCTOR',
        targetType: 'user',
        targetId: id,
        details: { username, canUnlockSessions },
      });
      res.json({ ok: true, id });
    } catch {
      res.status(409).json({ error: 'Username sudah digunakan.' });
    }
  });

  router.patch('/admin/staff/:userId', requireAuth, requireRole(['admin']), (req, res) => {
    const { isActive, canUnlockSessions, assignedClassIds, assignedExamIds } = req.body || {};
    db.prepare(`
      UPDATE users
      SET is_active = COALESCE(?, is_active),
          can_unlock_sessions = COALESCE(?, can_unlock_sessions),
          assigned_class_ids_json = COALESCE(?, assigned_class_ids_json),
          assigned_exam_ids_json = COALESCE(?, assigned_exam_ids_json)
      WHERE id = ? AND role = 'pengawas'
    `).run(
      typeof isActive === 'boolean' ? (isActive ? 1 : 0) : null,
      typeof canUnlockSessions === 'boolean' ? (canUnlockSessions ? 1 : 0) : null,
      assignedClassIds ? JSON.stringify(assignedClassIds) : null,
      assignedExamIds ? JSON.stringify(assignedExamIds) : null,
      req.params.userId
    );
    res.json({ ok: true });
  });

  router.put('/admin/staff/:userId', requireAuth, requireRole(['admin']), (req, res) => {
    const { userId } = req.params;
    const { username, fullName, password, assignedClassIds, assignedExamIds, canUnlockSessions, isActive } = req.body || {};
    const existing = db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId) as { id: string; role: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Akun staff tidak ditemukan.' });
      return;
    }
    try {
      db.prepare(`
        UPDATE users
        SET username = COALESCE(?, username),
            full_name = COALESCE(?, full_name),
            assigned_class_ids_json = COALESCE(?, assigned_class_ids_json),
            assigned_exam_ids_json = COALESCE(?, assigned_exam_ids_json),
            can_unlock_sessions = COALESCE(?, can_unlock_sessions),
            is_active = COALESCE(?, is_active)
        WHERE id = ?
      `).run(
        username ? String(username).trim() : null,
        fullName ? String(fullName).trim() : null,
        assignedClassIds ? JSON.stringify(assignedClassIds) : null,
        assignedExamIds ? JSON.stringify(assignedExamIds) : null,
        existing.role === 'pengawas' && typeof canUnlockSessions === 'boolean' ? (canUnlockSessions ? 1 : 0) : null,
        existing.role === 'pengawas' && typeof isActive === 'boolean' ? (isActive ? 1 : 0) : null,
        userId
      );
      if (password && String(password).trim().length >= 4) {
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(password).trim(), 10), userId);
      }
      writeAuditLog({
        actorId: req.auth!.userId,
        actorRole: 'admin',
        actorName: req.auth!.name,
        action: 'UPDATE_STAFF',
        targetType: 'user',
        targetId: userId,
        details: { username, fullName },
      });
      res.json({ ok: true });
    } catch {
      res.status(409).json({ error: 'Username sudah digunakan oleh akun lain.' });
    }
  });

  router.delete('/admin/staff/:userId', requireAuth, requireRole(['admin']), (req, res) => {
    const { userId } = req.params;
    const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId) as { id: string; role: string } | undefined;
    if (!target) {
      res.status(404).json({ error: 'Akun tidak ditemukan.' });
      return;
    }
    if (target.id === req.auth!.userId || target.role === 'admin') {
      res.status(403).json({ error: 'Akun admin utama atau akun yang sedang digunakan tidak boleh dihapus.' });
      return;
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'DELETE_STAFF',
      targetType: 'user',
      targetId: userId,
    });
    res.json({ ok: true });
  });

  router.post('/admin/staff/bulk-delete', requireAuth, requireRole(['admin']), (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : [];
    if (ids.length === 0) {
      res.status(400).json({ error: 'Pilih minimal satu akun pengawas untuk dihapus.' });
      return;
    }
    const delStmt = db.prepare("DELETE FROM users WHERE id = ? AND role = 'pengawas' AND id != ?");
    let deletedCount = 0;
    const tx = db.transaction(() => {
      for (const id of ids) {
        deletedCount += delStmt.run(id, req.auth!.userId).changes;
      }
    });
    tx();
    res.json({ ok: true, deletedCount });
  });

  router.get('/admin/templates/staff.xlsx', requireAuth, requireRole(['admin']), (_req, res) => {
    const buf = buildStaffTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="template_pengawas_sinarcbt.xlsx"');
    res.send(buf);
  });

  router.post('/admin/staff/import-preview', requireAuth, requireRole(['admin']), uploadMemory.single('file'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Berkas Excel tidak ditemukan.' });
      return;
    }
    const existingUsers = new Set((db.prepare('SELECT username FROM users').all() as Array<{ username: string }>).map((u) => u.username));
    const classes = db.prepare('SELECT id, name FROM classes').all() as Array<{ id: string; name: string }>;
    const classByName = new Map(classes.map((c) => [c.name, c.id]));
    const parsed = previewStaffExcelImport(req.file.buffer, existingUsers, classByName);
    const previewId = crypto.randomUUID();
    staffImportPreviewCache.set(previewId, { expiresAt: Date.now() + 15 * 60 * 1000, rows: parsed.rows });
    res.json({
      previewId,
      totalRows: parsed.rows.length,
      validCount: parsed.rows.filter((r) => r.valid).length,
      errorCount: parsed.rows.filter((r) => !r.valid).length,
      rows: parsed.rows,
      issues: parsed.issues,
    });
  });

  router.post('/admin/staff/import-commit', requireAuth, requireRole(['admin']), (req, res) => {
    const { previewId } = req.body || {};
    const cached = staffImportPreviewCache.get(String(previewId || ''));
    if (!cached || cached.expiresAt < Date.now()) {
      res.status(404).json({ error: 'Pratinjau impor pengawas sudah kedaluwarsa.' });
      return;
    }
    const validRows = cached.rows.filter((r) => r.valid);
    const now = new Date().toISOString();
    const ins = db.prepare(`
      INSERT INTO users (id, username, password_hash, full_name, role, assigned_class_ids_json, assigned_exam_ids_json, can_unlock_sessions, is_active, created_at)
      VALUES (?, ?, ?, ?, 'pengawas', ?, '[]', ?, 1, ?)
    `);
    const tx = db.transaction(() => {
      for (const r of validRows) {
        ins.run(
          `usr_${crypto.randomUUID().slice(0, 8)}`,
          r.username,
          bcrypt.hashSync(r.password, 10),
          r.fullName,
          JSON.stringify(r.assignedClassIds),
          r.canUnlockSessions ? 1 : 0,
          now
        );
      }
    });
    tx();
    staffImportPreviewCache.delete(String(previewId));
    res.json({ ok: true, importedCount: validRows.length });
  });

  router.get('/admin/staff/export.xlsx', requireAuth, requireRole(['admin']), (req, res) => {
    const ids = parseIdsQuery(req.query.ids);
    const classes = db.prepare('SELECT id, name FROM classes').all() as Array<{ id: string; name: string }>;
    const classMap = new Map(classes.map((c) => [c.id, c.name]));
    const sql = ids.length > 0
      ? `SELECT username, full_name, role, assigned_class_ids_json, can_unlock_sessions, is_active FROM users WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY role ASC, full_name ASC`
      : `SELECT username, full_name, role, assigned_class_ids_json, can_unlock_sessions, is_active FROM users ORDER BY role ASC, full_name ASC`;
    const rows = (ids.length > 0 ? db.prepare(sql).all(...ids) : db.prepare(sql).all()) as Array<Record<string, unknown>>;
    const excelRows = rows.map((u) => {
      const cids = JSON.parse(String(u.assigned_class_ids_json || '[]')) as string[];
      return {
        USERNAME: u.username,
        NAMA_LENGKAP: u.full_name,
        PERAN: u.role,
        KELAS_TUGAS: cids.map((id) => classMap.get(id) || id).join(', '),
        IZIN_BUKA_KUNCI: u.can_unlock_sessions ? 'Ya' : 'Tidak',
        STATUS: u.is_active ? 'Aktif' : 'Nonaktif',
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(excelRows), 'Pengawas');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="ekspor_staff_sinarcbt.xlsx"');
    res.send(buf);
  });

  router.put('/admin/settings', requireAuth, requireRole(['admin']), (req, res) => {
    const { institution, security } = req.body || {};
    const now = new Date().toISOString();
    if (institution) {
      db.prepare(`INSERT INTO system_settings (key, value_json, updated_at) VALUES ('institution', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`).run(
        JSON.stringify(institution),
        now
      );
    }
    if (security) {
      const normalizedSecurity = {
        ...security,
        showStudentExamHistory: security.showStudentExamHistory !== false,
        participantCard: normalizeParticipantCardConfig(security.participantCard),
        violationPolicy: normalizeViolationPolicy(security.violationPolicy ?? DEFAULT_VIOLATION_POLICY),
      };
      db.prepare(`INSERT INTO system_settings (key, value_json, updated_at) VALUES ('security', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`).run(
        JSON.stringify(normalizedSecurity),
        now
      );
    }
    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'UPDATE_SYSTEM_SETTINGS',
      targetType: 'system_settings',
      targetId: 'global',
    });
    res.json({ ok: true });
  });

  router.patch('/admin/settings/student-history', requireAuth, requireRole(['admin']), (req, res) => {
    const visible = req.body?.visible !== false;
    const now = new Date().toISOString();
    const currentSec = getSetting<Record<string, unknown>>('security', {
      maxLoginAttempts: 5,
      lockoutMinutes: 5,
      defaultProctoringRetentionDays: 14,
      maxConcurrentCameraStreams: 6,
      privacyNotice: 'Kamera pengawasan hanya menghasilkan indikator peninjauan.',
    });
    const updatedSec = {
      ...currentSec,
      showStudentExamHistory: visible,
    };
    db.prepare(`INSERT INTO system_settings (key, value_json, updated_at) VALUES ('security', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`).run(
      JSON.stringify(updatedSec),
      now
    );
    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'TOGGLE_STUDENT_HISTORY_VISIBILITY',
      targetType: 'system_settings',
      targetId: 'security',
      details: { showStudentExamHistory: visible },
    });
    res.json({ ok: true, showStudentExamHistory: visible });
  });

  router.post('/admin/branding/logo', requireAuth, requireRole(['admin']), uploadMemory.single('logo'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Berkas logo wajib diunggah.' });
      return;
    }
    try {
      saveBrandingLogo(req.file.buffer);
      writeAuditLog({
        actorId: req.auth!.userId,
        actorRole: 'admin',
        actorName: req.auth!.name,
        action: 'UPDATE_INSTITUTION_LOGO',
        targetType: 'branding',
        targetId: 'logo',
      });
      res.json({ ok: true, logoEndpoint: `/api/branding/logo?v=${Date.now()}` });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Logo tidak valid.' });
    }
  });

  // Immutable Violation Logs & Audit Logs
  router.get('/admin/violation-logs', requireAuth, requireRole(['admin', 'pengawas']), (req, res) => {
    const { examId, eventType } = req.query;
    let sql = `
      SELECT vl.*, st.nis, st.full_name, c.name as class_name, e.title as exam_title
      FROM violation_logs vl
      JOIN students st ON st.id = vl.student_id
      JOIN classes c ON c.id = st.class_id
      JOIN exams e ON e.id = vl.exam_id
      WHERE 1=1
    `;
    const params: string[] = [];
    if (examId) {
      sql += ' AND vl.exam_id = ?';
      params.push(String(examId));
    }
    if (eventType) {
      sql += ' AND vl.event_type = ?';
      params.push(String(eventType));
    }
    sql += ' ORDER BY vl.server_timestamp DESC LIMIT 500';
    const logs = db.prepare(sql).all(...params);
    res.json({ logs });
  });

  router.get('/admin/violation-logs/export.xlsx', requireAuth, requireRole(['admin']), (req, res) => {
    const ids = parseIdsQuery(req.query.ids);
    const sql = ids.length > 0
      ? `SELECT vl.server_timestamp as WAKTU_SERVER, st.nis as NIS, st.full_name as NAMA_SISWA,
                c.name as KELAS, e.title as UJIAN, vl.event_type as JENIS_KEJADIAN,
                vl.device_type as PERANGKAT, vl.device_brand as MEREK_GADGET,
                vl.duration_seconds as LAMA_KELUAR_DETIK, vl.points_added as POIN,
                CASE WHEN vl.is_excused = 1 THEN vl.excuse_reason ELSE 'Tidak' END as PENGECUALIAN,
                vl.occurrence_number as KEJADIAN_KE, vl.triggered_lock as MEMICU_KUNCI,
                vl.admin_action as TINDAKAN_ADMIN, vl.action_notes as CATATAN
         FROM violation_logs vl
         JOIN students st ON st.id = vl.student_id
         JOIN classes c ON c.id = st.class_id
         JOIN exams e ON e.id = vl.exam_id
         WHERE vl.id IN (${ids.map(() => '?').join(',')})
         ORDER BY vl.server_timestamp DESC`
      : `SELECT vl.server_timestamp as WAKTU_SERVER, st.nis as NIS, st.full_name as NAMA_SISWA,
                c.name as KELAS, e.title as UJIAN, vl.event_type as JENIS_KEJADIAN,
                vl.device_type as PERANGKAT, vl.device_brand as MEREK_GADGET,
                vl.duration_seconds as LAMA_KELUAR_DETIK, vl.points_added as POIN,
                CASE WHEN vl.is_excused = 1 THEN vl.excuse_reason ELSE 'Tidak' END as PENGECUALIAN,
                vl.occurrence_number as KEJADIAN_KE, vl.triggered_lock as MEMICU_KUNCI,
                vl.admin_action as TINDAKAN_ADMIN, vl.action_notes as CATATAN
         FROM violation_logs vl
         JOIN students st ON st.id = vl.student_id
         JOIN classes c ON c.id = st.class_id
         JOIN exams e ON e.id = vl.exam_id
         ORDER BY vl.server_timestamp DESC`;
    const rows = ids.length > 0 ? db.prepare(sql).all(...ids) : db.prepare(sql).all();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'LogPelanggaran');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="log_pelanggaran_sinarcbt.xlsx"');
    res.send(buf);
  });

  router.get('/admin/audit-logs', requireAuth, requireRole(['admin']), (_req, res) => {
    const logs = db.prepare('SELECT * FROM audit_logs ORDER BY server_timestamp DESC LIMIT 300').all();
    res.json({ logs });
  });

  router.get('/admin/audit-logs/export.xlsx', requireAuth, requireRole(['admin']), (req, res) => {
    const ids = parseIdsQuery(req.query.ids);
    const sql = ids.length > 0
      ? `SELECT server_timestamp as WAKTU_SERVER, actor_name as AKTOR, actor_role as PERAN, action as AKSI, target_type as TIPE_TARGET, target_id as ID_TARGET, details_json as DETAIL FROM audit_logs WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY server_timestamp DESC`
      : `SELECT server_timestamp as WAKTU_SERVER, actor_name as AKTOR, actor_role as PERAN, action as AKSI, target_type as TIPE_TARGET, target_id as ID_TARGET, details_json as DETAIL FROM audit_logs ORDER BY server_timestamp DESC LIMIT 1000`;
    const rows = ids.length > 0 ? db.prepare(sql).all(...ids) : db.prepare(sql).all();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'AuditLog');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="audit_log_sinarcbt.xlsx"');
    res.send(buf);
  });

  // Database Backup Export & Import
  router.get('/admin/backup.json', requireAuth, requireRole(['admin']), (req, res) => {
    const tables = [
      'classes', 'subjects', 'students', 'question_banks', 'questions', 'answer_keys',
      'exams', 'exam_schedules', 'scoring_rubrics', 'exam_packages', 'exam_sessions',
      'student_answers', 'scores', 'violation_logs', 'proctoring_events', 'chat_messages',
      'system_settings', 'audit_logs',
    ];
    const snapshot: Record<string, unknown[]> = {};
    for (const t of tables) {
      snapshot[t] = db.prepare(`SELECT * FROM ${t}`).all();
    }
    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'EXPORT_DATABASE_BACKUP',
      targetType: 'system',
      targetId: 'backup',
    });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="sinarcbt_backup_${new Date().toISOString().slice(0, 10)}.json"`);
    res.send(JSON.stringify({ exportedAt: new Date().toISOString(), snapshot }, null, 2));
  });

  router.post('/admin/backup/import', requireAuth, requireRole(['admin']), uploadMemory.single('file'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Berkas backup JSON tidak ditemukan.' });
      return;
    }
    try {
      const parsed = JSON.parse(req.file.buffer.toString('utf8')) as { snapshot?: Record<string, Array<Record<string, unknown>>> };
      if (!parsed?.snapshot || typeof parsed.snapshot !== 'object') {
        res.status(400).json({ error: 'Struktur berkas JSON backup tidak valid.' });
        return;
      }

      const allowedTables = [
        'classes', 'subjects', 'students', 'question_banks', 'questions', 'answer_keys',
        'exams', 'exam_schedules', 'scoring_rubrics', 'system_settings',
      ];
      let restoredRecords = 0;

      const tx = db.transaction(() => {
        for (const table of allowedTables) {
          const rows = parsed.snapshot![table];
          if (!Array.isArray(rows) || rows.length === 0) continue;
          const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
          const validColSet = new Set(cols.map((c) => c.name));
          for (const row of rows) {
            const keys = Object.keys(row).filter((k) => validColSet.has(k));
            if (keys.length === 0) continue;
            const placeholders = keys.map(() => '?').join(', ');
            db.prepare(`INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`).run(
              ...keys.map((k) => row[k])
            );
            restoredRecords++;
          }
        }
      });
      tx();

      writeAuditLog({
        actorId: req.auth!.userId,
        actorRole: 'admin',
        actorName: req.auth!.name,
        action: 'IMPORT_DATABASE_BACKUP',
        targetType: 'system',
        targetId: 'backup_restore',
        details: { restoredRecords },
      });

      res.json({ ok: true, restoredRecords });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal memulihkan backup JSON.' });
    }
  });

  // Functional Tests & 1,300-Participant Load Benchmark Endpoints
  router.post('/admin/run-tests', requireAuth, requireRole(['admin']), async (req, res) => {
    const report = await runFunctionalTestSuite();
    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'RUN_FUNCTIONAL_TESTS',
      targetType: 'qa',
      targetId: 'functional_suite',
      details: { passed: report.passed, total: report.total },
    });
    res.json(report);
  });

  router.post('/admin/run-load-test', requireAuth, requireRole(['admin']), (req, res) => {
    const report = run1300ParticipantBenchmark();
    writeAuditLog({
      actorId: req.auth!.userId,
      actorRole: 'admin',
      actorName: req.auth!.name,
      action: 'RUN_1300_LOAD_BENCHMARK',
      targetType: 'qa',
      targetId: 'load_1300',
      details: { passedCriteria: report.passedCriteria, memoryRssMb: report.memoryRssMb },
    });
    res.json(report);
  });

  return router;
}
