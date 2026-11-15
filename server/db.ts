import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  BRANDING_DIR,
  MEDIA_DIR,
  PHOTOS_DIR,
  ensureStorageDirs,
} from './storage.ts';
import { DEFAULT_SCORING_WEIGHTS, gradeExamPackage } from './scoring.ts';

const DB_PATH = path.resolve(process.cwd(), 'sinarcbt.sqlite');

export const db = new Database(DB_PATH);

// Performance & concurrency pragmas tuned for 1,300+ concurrent CBT sessions
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('cache_size = -64000'); // 64MB page cache
db.pragma('busy_timeout = 5000');
db.pragma('temp_store = MEMORY');

export function initDatabase() {
  ensureStorageDirs();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'pengawas')),
      assigned_class_ids_json TEXT NOT NULL DEFAULT '[]',
      assigned_exam_ids_json TEXT NOT NULL DEFAULT '[]',
      can_unlock_sessions INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      grade_level TEXT NOT NULL,
      academic_year TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      passing_grade REAL NOT NULL DEFAULT 75,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      nis TEXT UNIQUE NOT NULL,
      nisn TEXT UNIQUE NOT NULL,
      pin_hash TEXT NOT NULL,
      pin_display TEXT NOT NULL DEFAULT '******',
      full_name TEXT NOT NULL,
      birth_place TEXT NOT NULL DEFAULT '',
      birth_date TEXT NOT NULL DEFAULT '',
      gender TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      photo_link TEXT NOT NULL DEFAULT '',
      class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
      photo_path TEXT,
      photo_mime TEXT,
      photo_size INTEGER,
      photo_updated_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS question_banks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      description TEXT NOT NULL DEFAULT '',
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      bank_id TEXT NOT NULL REFERENCES question_banks(id) ON DELETE CASCADE,
      subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      topic TEXT NOT NULL,
      question_type TEXT NOT NULL CHECK(question_type IN ('pg_tunggal', 'pg_kompleks', 'benar_salah', 'menjodohkan')),
      stem_html TEXT NOT NULL,
      media_path TEXT,
      table_data_json TEXT,
      options_json TEXT NOT NULL,
      difficulty TEXT NOT NULL CHECK(difficulty IN ('mudah', 'sedang', 'sulit')),
      weight REAL,
      explanation_html TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS answer_keys (
      question_id TEXT PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
      key_json TEXT NOT NULL,
      scoring_mode TEXT NOT NULL DEFAULT 'standard',
      wrong_penalty REAL NOT NULL DEFAULT 0.5,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS exams (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      exam_type TEXT NOT NULL,
      subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
      class_ids_json TEXT NOT NULL DEFAULT '[]',
      assigned_student_ids_json TEXT NOT NULL DEFAULT '[]',
      question_bank_id TEXT NOT NULL REFERENCES question_banks(id) ON DELETE RESTRICT,
      question_count INTEGER NOT NULL,
      shuffle_mode TEXT NOT NULL CHECK(shuffle_mode IN ('A', 'B', 'C')) DEFAULT 'A',
      shuffle_questions INTEGER NOT NULL DEFAULT 1,
      shuffle_options INTEGER NOT NULL DEFAULT 1,
      composition_json TEXT,
      duration_minutes INTEGER NOT NULL,
      passing_score REAL NOT NULL DEFAULT 75,
      max_violations INTEGER NOT NULL DEFAULT 3,
      auto_lock_enabled INTEGER NOT NULL DEFAULT 1,
      require_fullscreen INTEGER NOT NULL DEFAULT 0,
      proctoring_enabled INTEGER NOT NULL DEFAULT 0,
      proctoring_sensitivity TEXT NOT NULL DEFAULT 'sedang',
      proctoring_tolerance INTEGER NOT NULL DEFAULT 5,
      proctoring_retention_days INTEGER NOT NULL DEFAULT 14,
      allow_camera_stream INTEGER NOT NULL DEFAULT 0,
      publication_policy TEXT NOT NULL CHECK(publication_policy IN ('hidden', 'view_only', 'view_download', 'view_download_print')) DEFAULT 'view_download_print',
      history_visible INTEGER NOT NULL DEFAULT 1,
      publish_at TEXT,
      access_token_mode TEXT NOT NULL DEFAULT 'student_pin',
      access_token TEXT NOT NULL DEFAULT '',
      class_configs_json TEXT NOT NULL DEFAULT '{}',
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS exam_schedules (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
      start_at TEXT NOT NULL,
      entry_deadline_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scoring_rubrics (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      version INTEGER NOT NULL DEFAULT 1,
      weights_json TEXT NOT NULL,
      penalty_rule_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS exam_packages (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      package_code TEXT NOT NULL,
      is_fixed INTEGER NOT NULL DEFAULT 0,
      question_ids_json TEXT NOT NULL,
      option_orders_json TEXT NOT NULL,
      max_points REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS exam_sessions (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      package_id TEXT NOT NULL REFERENCES exam_packages(id),
      rubric_id TEXT NOT NULL REFERENCES scoring_rubrics(id),
      session_token_hash TEXT NOT NULL,
      device_fingerprint TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('not_started', 'in_progress', 'locked', 'submitted', 'expired')) DEFAULT 'in_progress',
      started_at TEXT NOT NULL,
      server_end_at TEXT NOT NULL,
      submitted_at TEXT,
      last_heartbeat_at TEXT NOT NULL,
      last_sync_at TEXT NOT NULL,
      violation_count INTEGER NOT NULL DEFAULT 0,
      lock_reason TEXT,
      unlocked_by TEXT,
      unlocked_at TEXT,
      unlock_notes TEXT,
      connection_status TEXT NOT NULL DEFAULT 'online',
      UNIQUE(exam_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS student_answers (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      answer_json TEXT,
      is_doubtful INTEGER NOT NULL DEFAULT 0,
      client_version INTEGER NOT NULL DEFAULT 1,
      server_version INTEGER NOT NULL DEFAULT 1,
      saved_at TEXT NOT NULL,
      UNIQUE(session_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS scores (
      id TEXT PRIMARY KEY,
      session_id TEXT UNIQUE NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      raw_points REAL NOT NULL,
      max_points REAL NOT NULL,
      final_score REAL NOT NULL,
      correct_count INTEGER NOT NULL,
      partial_count INTEGER NOT NULL DEFAULT 0,
      wrong_count INTEGER NOT NULL,
      blank_count INTEGER NOT NULL,
      passed INTEGER NOT NULL DEFAULT 0,
      breakdown_json TEXT NOT NULL,
      graded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS violation_logs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      occurrence_number INTEGER NOT NULL,
      triggered_lock INTEGER NOT NULL DEFAULT 0,
      admin_action TEXT,
      admin_id TEXT,
      action_notes TEXT,
      server_timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS proctoring_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      indicator_type TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      review_status TEXT NOT NULL DEFAULT 'unreviewed',
      reviewed_by TEXT,
      server_timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      session_id TEXT REFERENCES exam_sessions(id) ON DELETE CASCADE,
      sender_role TEXT NOT NULL CHECK(sender_role IN ('siswa', 'admin', 'pengawas')),
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      recipient_student_id TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      server_timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      student_id TEXT REFERENCES students(id) ON DELETE CASCADE,
      report_type TEXT NOT NULL,
      generated_by TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      ip_address TEXT NOT NULL DEFAULT '127.0.0.1',
      server_timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      identifier TEXT PRIMARY KEY,
      ip_address TEXT NOT NULL,
      fail_count INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS student_messages (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      exam_id TEXT REFERENCES exams(id) ON DELETE CASCADE,
      session_id TEXT REFERENCES exam_sessions(id) ON DELETE SET NULL,
      sender_id TEXT NOT NULL,
      sender_role TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'pesan',
      title TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      read_at TEXT,
      created_at TEXT NOT NULL
    );

    -- Critical Indexes for 1,300 concurrent CBT performance
    CREATE INDEX IF NOT EXISTS idx_students_nis ON students(nis);
    CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);
    CREATE INDEX IF NOT EXISTS idx_questions_bank ON questions(bank_id);
    CREATE INDEX IF NOT EXISTS idx_questions_topic_diff ON questions(bank_id, topic, difficulty);
    CREATE INDEX IF NOT EXISTS idx_sessions_exam_status ON exam_sessions(exam_id, status);
    CREATE INDEX IF NOT EXISTS idx_sessions_student ON exam_sessions(student_id);
    CREATE INDEX IF NOT EXISTS idx_answers_session ON student_answers(session_id);
    CREATE INDEX IF NOT EXISTS idx_scores_exam ON scores(exam_id);
    CREATE INDEX IF NOT EXISTS idx_scores_student ON scores(student_id);
    CREATE INDEX IF NOT EXISTS idx_violations_session ON violation_logs(session_id, server_timestamp);
    CREATE INDEX IF NOT EXISTS idx_proctoring_session ON proctoring_events(session_id, server_timestamp);
    CREATE INDEX IF NOT EXISTS idx_chat_exam_student ON chat_messages(exam_id, recipient_student_id, server_timestamp);
    CREATE INDEX IF NOT EXISTS idx_student_messages_student ON student_messages(student_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(server_timestamp);
  `);

  // Safe migration for existing databases: ensure questions.is_active exists
  const questionCols = db.prepare('PRAGMA table_info(questions)').all() as Array<{ name: string }>;
  if (!questionCols.some((c) => c.name === 'is_active')) {
    db.exec('ALTER TABLE questions ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_questions_bank_active ON questions(bank_id, is_active);');

  // Safe migration for existing databases: ensure students.birth_place, birth_date, gender, email, photo_link exist
  const studentCols = db.prepare('PRAGMA table_info(students)').all() as Array<{ name: string }>;
  if (!studentCols.some((c) => c.name === 'birth_place')) {
    db.exec("ALTER TABLE students ADD COLUMN birth_place TEXT NOT NULL DEFAULT '';");
  }
  if (!studentCols.some((c) => c.name === 'birth_date')) {
    db.exec("ALTER TABLE students ADD COLUMN birth_date TEXT NOT NULL DEFAULT '';");
  }
  if (!studentCols.some((c) => c.name === 'gender')) {
    db.exec("ALTER TABLE students ADD COLUMN gender TEXT NOT NULL DEFAULT '';");
  }
  if (!studentCols.some((c) => c.name === 'email')) {
    db.exec("ALTER TABLE students ADD COLUMN email TEXT NOT NULL DEFAULT '';");
  }
  if (!studentCols.some((c) => c.name === 'photo_link')) {
    db.exec("ALTER TABLE students ADD COLUMN photo_link TEXT NOT NULL DEFAULT '';");
  }

  // Safe migration for existing databases: ensure exams.access_token_mode and access_token exist
  const examCols = db.prepare('PRAGMA table_info(exams)').all() as Array<{ name: string }>;
  if (!examCols.some((c) => c.name === 'access_token_mode')) {
    db.exec("ALTER TABLE exams ADD COLUMN access_token_mode TEXT NOT NULL DEFAULT 'student_pin';");
  }
  if (!examCols.some((c) => c.name === 'access_token')) {
    db.exec("ALTER TABLE exams ADD COLUMN access_token TEXT NOT NULL DEFAULT '';");
  }
  if (!examCols.some((c) => c.name === 'history_visible')) {
    db.exec('ALTER TABLE exams ADD COLUMN history_visible INTEGER NOT NULL DEFAULT 1;');
  }
  if (!examCols.some((c) => c.name === 'class_configs_json')) {
    db.exec("ALTER TABLE exams ADD COLUMN class_configs_json TEXT NOT NULL DEFAULT '{}';");
  }

  // Idempotent synthetic backfill for seeded demo accounts created before new profile fields existed
  const demoProfileBackfill: Array<[string, string, string, string, string]> = [
    ['stu_01', 'Jakarta', '2008-05-14', 'L', 'ahmad.fauzan@smanunggulcipta.sch.id'],
    ['stu_02', 'Bandung', '2008-08-21', 'P', 'nadia.putri@smanunggulcipta.sch.id'],
    ['stu_03', 'Surabaya', '2008-03-09', 'L', 'rizky.ramadhan@smanunggulcipta.sch.id'],
    ['stu_04', 'Yogyakarta', '2008-11-17', 'P', 'salsabila.azzahra@smanunggulcipta.sch.id'],
    ['stu_05', 'Semarang', '2008-02-28', 'L', 'dimas.bagus@smanunggulcipta.sch.id'],
    ['stu_06', 'Depok', '2008-09-04', 'P', 'alya.maharani@smanunggulcipta.sch.id'],
    ['stu_07', 'Bogor', '2009-04-12', 'L', 'fajar.nugroho@smanunggulcipta.sch.id'],
    ['stu_08', 'Bekasi', '2009-07-19', 'P', 'intan.permatasari@smanunggulcipta.sch.id'],
    ['stu_09', 'Tangerang', '2010-01-25', 'L', 'bagas.aditya@smanunggulcipta.sch.id'],
    ['stu_10', 'Malang', '2010-06-30', 'P', 'citra.dewi@smanunggulcipta.sch.id'],
  ];
  const backfillBirthStmt = db.prepare(
    "UPDATE students SET birth_place = ?, birth_date = ? WHERE id = ? AND birth_place = '' AND birth_date = ''"
  );
  const backfillContactStmt = db.prepare(
    "UPDATE students SET gender = ?, email = ? WHERE id = ? AND gender = '' AND email = ''"
  );
  for (const [sid, bPlace, bDate, gender, email] of demoProfileBackfill) {
    backfillBirthStmt.run(bPlace, bDate, sid);
    backfillContactStmt.run(gender, email, sid);
  }
}

export function writeAuditLog(params: {
  actorId: string;
  actorRole: string;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}) {
  db.prepare(`
    INSERT INTO audit_logs (id, actor_id, actor_role, actor_name, action, target_type, target_id, details_json, ip_address, server_timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    params.actorId,
    params.actorRole,
    params.actorName,
    params.action,
    params.targetType,
    params.targetId,
    JSON.stringify(params.details || {}),
    params.ipAddress || '127.0.0.1',
    new Date().toISOString()
  );
}

export function seedInitialData() {
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
  if (userCount.c > 0) return;

  const now = new Date().toISOString();

  // Copy generated assets into private storage for realistic initial institution & student identity
  try {
    const logoSrc = path.resolve(process.cwd(), 'src/assets/images/school_emblem_logo_1794573880648.jpg');
    if (fs.existsSync(logoSrc)) {
      fs.copyFileSync(logoSrc, path.join(BRANDING_DIR, 'institution_logo.jpg'));
    }
    const maleSrc = path.resolve(process.cwd(), 'src/assets/images/student_demo_male_1794573881987.jpg');
    const femaleSrc = path.resolve(process.cwd(), 'src/assets/images/student_demo_female_1794573881068.jpg');
    const geomSrc = path.resolve(process.cwd(), 'src/assets/images/math_geometry_diagram_1794573882912.jpg');
    if (fs.existsSync(maleSrc)) {
      fs.copyFileSync(maleSrc, path.join(PHOTOS_DIR, 'stu_01.jpg'));
      fs.copyFileSync(maleSrc, path.join(PHOTOS_DIR, 'stu_03.jpg'));
      fs.copyFileSync(maleSrc, path.join(PHOTOS_DIR, 'stu_05.jpg'));
    }
    if (fs.existsSync(femaleSrc)) {
      fs.copyFileSync(femaleSrc, path.join(PHOTOS_DIR, 'stu_02.jpg'));
      fs.copyFileSync(femaleSrc, path.join(PHOTOS_DIR, 'stu_04.jpg'));
      fs.copyFileSync(femaleSrc, path.join(PHOTOS_DIR, 'stu_06.jpg'));
    }
    if (fs.existsSync(geomSrc)) {
      fs.copyFileSync(geomSrc, path.join(MEDIA_DIR, 'geom_tri.jpg'));
    }
  } catch (err) {
    console.warn('Asset copy warning during seed:', err);
  }

  // System settings
  const settings = [
    ['institution', {
      name: 'SMA Negeri Unggul Cipta Jakarta',
      shortName: 'SMAN Unggul Cipta',
      address: 'Jl. Pendidikan Terpadu No. 18, Jakarta Selatan',
      timezone: 'Asia/Jakarta',
      logoEndpoint: '/api/branding/logo',
      academicYear: '2026/2027',
    }],
    ['security', {
      maxLoginAttempts: 5,
      lockoutMinutes: 5,
      defaultProctoringRetentionDays: 14,
      maxConcurrentCameraStreams: 6,
      showStudentExamHistory: true,
      privacyNotice: 'Kamera pengawasan hanya digunakan untuk indikasi peninjauan pengawas selama ujian berlangsung. Rekaman tidak disimpan permanen melewati masa retensi dan tidak dijadikan bukti tunggal kecurangan.',
    }],
  ];
  const insertSetting = db.prepare('INSERT INTO system_settings (key, value_json, updated_at) VALUES (?, ?, ?)');
  for (const [k, v] of settings) {
    insertSetting.run(k, JSON.stringify(v), now);
  }

  // Users (Admin & Pengawas)
  const adminPass = bcrypt.hashSync('AdminCbt#2026', 10);
  const proctorPass = bcrypt.hashSync('Pengawas#2026', 10);
  db.prepare(`
    INSERT INTO users (id, username, password_hash, full_name, role, assigned_class_ids_json, assigned_exam_ids_json, can_unlock_sessions, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run('usr_admin', 'admin', adminPass, 'Drs. Hendra Wijaya, M.Pd (Admin Utama)', 'admin', '[]', '[]', 1, now);

  db.prepare(`
    INSERT INTO users (id, username, password_hash, full_name, role, assigned_class_ids_json, assigned_exam_ids_json, can_unlock_sessions, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run('usr_pengawas1', 'pengawas1', proctorPass, 'Siti Aminah, S.Pd (Pengawas Ruang)', 'pengawas', JSON.stringify(['cls_xii_1', 'cls_xi_1']), JSON.stringify(['exm_tka_math', 'exm_uh_indo']), 1, now);

  // Classes
  const classes = [
    ['cls_x_1', 'X-1', '10', '2026/2027'],
    ['cls_xi_1', 'XI-IPA-1', '11', '2026/2027'],
    ['cls_xii_1', 'XII-IPA-1', '12', '2026/2027'],
    ['cls_xii_2', 'XII-IPA-2', '12', '2026/2027'],
  ];
  const insClass = db.prepare('INSERT INTO classes (id, name, grade_level, academic_year, created_at) VALUES (?, ?, ?, ?, ?)');
  for (const c of classes) insClass.run(...c, now);

  // Subjects
  const subjects = [
    ['sub_mat', 'MAT', 'Matematika Wajib & TKA', 75],
    ['sub_ind', 'BIN', 'Bahasa Indonesia', 75],
    ['sub_fis', 'FIS', 'Fisika', 72],
    ['sub_ing', 'BIG', 'Bahasa Inggris', 75],
  ];
  const insSub = db.prepare('INSERT INTO subjects (id, code, name, passing_grade, created_at) VALUES (?, ?, ?, ?, ?)');
  for (const s of subjects) insSub.run(...s, now);

  // Synthetic Students (NO real personal data)
  const pinHash = bcrypt.hashSync('123456', 8);
  const students: Array<[string, string, string, string, string, string, string, string, string, string | null]> = [
    ['stu_01', '2026001', '0091234501', 'Ahmad Fauzan Pratama', 'Jakarta', '2008-05-14', 'L', 'ahmad.fauzan@smanunggulcipta.sch.id', 'cls_xii_1', 'stu_01.jpg'],
    ['stu_02', '2026002', '0091234502', 'Nadia Putri Kusuma', 'Bandung', '2008-08-21', 'P', 'nadia.putri@smanunggulcipta.sch.id', 'cls_xii_1', 'stu_02.jpg'],
    ['stu_03', '2026003', '0091234503', 'Rizky Ramadhan', 'Surabaya', '2008-03-09', 'L', 'rizky.ramadhan@smanunggulcipta.sch.id', 'cls_xii_1', 'stu_03.jpg'],
    ['stu_04', '2026004', '0091234504', 'Salsabila Azzahra', 'Yogyakarta', '2008-11-17', 'P', 'salsabila.azzahra@smanunggulcipta.sch.id', 'cls_xii_1', 'stu_04.jpg'],
    ['stu_05', '2026005', '0091234505', 'Dimas Bagus Setiawan', 'Semarang', '2008-02-28', 'L', 'dimas.bagus@smanunggulcipta.sch.id', 'cls_xii_2', 'stu_05.jpg'],
    ['stu_06', '2026006', '0091234506', 'Alya Maharani', 'Depok', '2008-09-04', 'P', 'alya.maharani@smanunggulcipta.sch.id', 'cls_xii_2', 'stu_06.jpg'],
    ['stu_07', '2026007', '0091234507', 'Fajar Nugroho', 'Bogor', '2009-04-12', 'L', 'fajar.nugroho@smanunggulcipta.sch.id', 'cls_xi_1', null],
    ['stu_08', '2026008', '0091234508', 'Intan Permatasari', 'Bekasi', '2009-07-19', 'P', 'intan.permatasari@smanunggulcipta.sch.id', 'cls_xi_1', null],
    ['stu_09', '2026009', '0091234509', 'Bagas Aditya', 'Tangerang', '2010-01-25', 'L', 'bagas.aditya@smanunggulcipta.sch.id', 'cls_x_1', null],
    ['stu_10', '2026010', '0091234510', 'Citra Dewi Lestari', 'Malang', '2010-06-30', 'P', 'citra.dewi@smanunggulcipta.sch.id', 'cls_x_1', null],
  ];
  const insStu = db.prepare(`
    INSERT INTO students (id, nis, nisn, pin_hash, pin_display, full_name, birth_place, birth_date, gender, email, photo_link, class_id, photo_path, photo_mime, photo_size, photo_updated_at, is_active, created_at)
    VALUES (?, ?, ?, ?, '123456', ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, 1, ?)
  `);
  for (const [id, nis, nisn, name, birthPlace, birthDate, gender, email, classId, photo] of students) {
    insStu.run(id, nis, nisn, pinHash, name, birthPlace, birthDate, gender, email, classId, photo, photo ? 'image/jpeg' : null, photo ? 42000 : null, photo ? now : null, now);
  }

  // Question Banks
  db.prepare('INSERT INTO question_banks (id, name, subject_id, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'bnk_tka_mat',
    'Bank Soal Simulasi TKA Matematika 2026',
    'sub_mat',
    'Kumpulan soal HOTS & TKA meliputi Aljabar, Geometri, Kalkulus, dan Statistika dalam 4 tipe soal.',
    'usr_admin',
    now
  );
  db.prepare('INSERT INTO question_banks (id, name, subject_id, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'bnk_uh_ind',
    'Bank Soal Literasi Bahasa Indonesia',
    'sub_ind',
    'Soal literasi membaca, struktur teks, dan kebahasaan untuk Ulangan Harian & UTS.',
    'usr_admin',
    now
  );

  // Seed Questions + Answer Keys (Matematika TKA - 12 rich questions across all 4 types)
  const insQ = db.prepare(`
    INSERT INTO questions (id, bank_id, subject_id, topic, question_type, stem_html, media_path, table_data_json, options_json, difficulty, weight, explanation_html, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insKey = db.prepare(`
    INSERT INTO answer_keys (question_id, key_json, scoring_mode, wrong_penalty, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const mathQuestions: Array<{
    id: string;
    topic: string;
    type: 'pg_tunggal' | 'pg_kompleks' | 'benar_salah' | 'menjodohkan';
    stem: string;
    media: string | null;
    table: unknown;
    options: unknown;
    difficulty: 'mudah' | 'sedang' | 'sulit';
    weight: number;
    key: unknown;
    explanation: string;
  }> = [
    {
      id: 'q_mat_01',
      topic: 'Aljabar & Fungsi Kuadrat',
      type: 'pg_tunggal',
      stem: 'Diketahui fungsi kuadrat $f(x) = x^2 - 6x + 8$. Nilai minimum fungsi tersebut beserta absis titik puncaknya berturut-turut adalah...',
      media: null,
      table: null,
      options: [
        { id: 'a', label: 'A', text: '$-1$ pada $x = 3$' },
        { id: 'b', label: 'B', text: '$1$ pada $x = 3$' },
        { id: 'c', label: 'C', text: '$-1$ pada $x = -3$' },
        { id: 'd', label: 'D', text: '$8$ pada $x = 0$' },
        { id: 'e', label: 'E', text: '$-2$ pada $x = 4$' },
      ],
      difficulty: 'mudah',
      weight: 2,
      key: 'a',
      explanation: 'Absis puncak $x_p = -\\frac{b}{2a} = \\frac{6}{2} = 3$. Nilai minimum $f(3) = 3^2 - 6(3) + 8 = -1$.',
    },
    {
      id: 'q_mat_02',
      topic: 'Geometri & Trigonometri',
      type: 'pg_tunggal',
      stem: 'Perhatikan gambar segitiga siku-siku pada bidang koordinat berikut. Jika panjang sisi tegak $a = 3$ satuan dan sisi datar $b = 4$ satuan, berapakah nilai $\\sin \\beta$?',
      media: '/api/media/geom_tri.jpg',
      table: null,
      options: [
        { id: 'a', label: 'A', text: '$\\frac{3}{5}$' },
        { id: 'b', label: 'B', text: '$\\frac{4}{5}$' },
        { id: 'c', label: 'C', text: '$\\frac{3}{4}$' },
        { id: 'd', label: 'D', text: '$\\frac{4}{3}$' },
      ],
      difficulty: 'mudah',
      weight: 2,
      key: 'a',
      explanation: 'Sisi miring $c = \\sqrt{3^2 + 4^2} = 5$. Sudut $\\beta$ menghadap sisi $a=3$, sehingga $\\sin \\beta = \\frac{a}{c} = \\frac{3}{5}$.',
    },
    {
      id: 'q_mat_03',
      topic: 'Kalkulus Turunan',
      type: 'pg_kompleks',
      stem: 'Diberikan kurva $y = x^3 - 3x^2 - 9x + 5$. Pilihlah <strong>semua</strong> pernyataan yang bernilai benar mengenai kurva tersebut (jawaban benar lebih dari satu):',
      media: null,
      table: null,
      options: [
        { id: 'o1', label: '1', text: 'Turunan pertamanya adalah $y\' = 3x^2 - 6x - 9$' },
        { id: 'o2', label: '2', text: 'Kurva mencapai titik stasioner pada $x = -1$ dan $x = 3$' },
        { id: 'o3', label: '3', text: 'Kurva selalu naik untuk seluruh nilai $x \\in \\mathbb{R}$' },
        { id: 'o4', label: '4', text: 'Gradien garis singgung di $x = 0$ adalah $-9$' },
      ],
      difficulty: 'sedang',
      weight: 4,
      key: ['o1', 'o2', 'o4'],
      explanation: 'Turunan $y\' = 3(x^2-2x-3) = 3(x-3)(x+1)$, stasioner di $x=-1$ dan $x=3$, dan $y\'(0)=-9$.',
    },
    {
      id: 'q_mat_04',
      topic: 'Statistika',
      type: 'benar_salah',
      stem: 'Perhatikan tabel distribusi nilai ulangan matematika berikut ini, kemudian tentukan apakah setiap pernyataan di bawah bernilai Benar (B) atau Salah (S).',
      media: null,
      table: {
        headers: ['Nilai', 'Frekuensi ($f_i$)'],
        rows: [
          ['60', '4'],
          ['70', '6'],
          ['80', '8'],
          ['90', '2'],
        ],
      },
      options: [
        { id: 's1', text: 'Total jumlah siswa pada data tersebut adalah 20 orang.' },
        { id: 's2', text: 'Modus dari data nilai tersebut adalah 70.' },
        { id: 's3', text: 'Rata-rata (mean) nilai siswa adalah 74.' },
        { id: 's4', text: 'Median data berada pada nilai 75.' },
      ],
      difficulty: 'sedang',
      weight: 4,
      key: { s1: 'B', s2: 'S', s3: 'B', s4: 'B' },
      explanation: 'Total frekuensi = $4+6+8+2 = 20$. Modus = 80. Mean = $\\frac{240+420+640+180}{20} = 74$. Data ke-10 adalah 70 dan ke-11 adalah 80, median = 75.',
    },
    {
      id: 'q_mat_05',
      topic: 'Matriks & Transformasi',
      type: 'menjodohkan',
      stem: 'Pasangkan setiap operasi atau ekspresi matematika pada kolom kiri dengan hasil yang tepat pada kolom kanan.',
      media: null,
      table: null,
      options: {
        left: [
          { id: 'l1', text: 'Determinan matriks $\\begin{pmatrix} 4 & 2 \\\\ 3 & 5 \\end{pmatrix}$' },
          { id: 'l2', text: 'Nilai dari $\\log_2 32 + \\log_3 9$' },
          { id: 'l3', text: 'Limit $\\lim_{x \\to 2} \\frac{x^2 - 4}{x - 2}$' },
          { id: 'l4', text: 'Jumlah 5 suku pertama deret $2 + 4 + 6 + \\dots$' },
        ],
        right: [
          { id: 'r1', text: '$14$' },
          { id: 'r2', text: '$7$' },
          { id: 'r3', text: '$4$' },
          { id: 'r4', text: '$30$' },
          { id: 'r5', text: '$20$' },
        ],
      },
      difficulty: 'sedang',
      weight: 4,
      key: { l1: 'r1', l2: 'r2', l3: 'r3', l4: 'r4' },
      explanation: '$\\det = 4(5)-2(3)=14$; $\\log_2 32 + \\log_3 9 = 5+2=7$; $\\lim = 2+2=4$; $S_5 = 2+4+6+8+10=30$.',
    },
    {
      id: 'q_mat_06',
      topic: 'Peluang & Kombinatorika',
      type: 'pg_tunggal',
      stem: 'Dari 6 siswa putra dan 4 siswa putri akan dibentuk tim cerdas cermat beranggotakan 3 orang. Banyak cara membentuk tim jika minimal terdapat 2 siswa putri adalah...',
      media: null,
      table: null,
      options: [
        { id: 'a', label: 'A', text: '$36$ cara' },
        { id: 'b', label: 'B', text: '$40$ cara' },
        { id: 'c', label: 'C', text: '$60$ cara' },
        { id: 'd', label: 'D', text: '$120$ cara' },
      ],
      difficulty: 'sulit',
      weight: 2,
      key: 'b',
      explanation: '2 putri 1 putra: $C(4,2)\\cdot C(6,1) = 6\\cdot 6 = 36$. 3 putri: $C(4,3)=4$. Total = $36 + 4 = 40$.',
    },
    {
      id: 'q_mat_07',
      topic: 'Integral Tentu',
      type: 'pg_kompleks',
      stem: 'Manakah sifat dan hasil integral yang benar untuk $I = \\int_{0}^{2} (3x^2 + 2x) \\, dx$?',
      media: null,
      table: null,
      options: [
        { id: 'o1', label: '1', text: 'Antiturunannya berbentuk $x^3 + x^2 + C$' },
        { id: 'o2', label: '2', text: 'Nilai integral tentu $I = 12$' },
        { id: 'o3', label: '3', text: 'Nilai integral tentu $I = 10$' },
        { id: 'o4', label: '4', text: 'Jika batas ditukar menjadi $\\int_{2}^{0}$, hasilnya $-12$' },
      ],
      difficulty: 'sedang',
      weight: 4,
      key: ['o1', 'o2', 'o4'],
      explanation: '$[x^3 + x^2]_0^2 = (8 + 4) - 0 = 12$. Pembalikan batas mengubah tanda menjadi $-12$.',
    },
    {
      id: 'q_mat_08',
      topic: 'Sistem Persamaan Linear',
      type: 'benar_salah',
      stem: 'Diketahui sistem persamaan $2x + y = 7$ dan $x - y = 2$. Tentukan kebenaran pernyataan berikut:',
      media: null,
      table: null,
      options: [
        { id: 's1', text: 'Nilai $x$ yang memenuhi sistem adalah $3$.' },
        { id: 's2', text: 'Nilai $y$ yang memenuhi sistem adalah $1$.' },
        { id: 's3', text: 'Nilai $x + 2y$ sama dengan $6$.' },
      ],
      difficulty: 'mudah',
      weight: 4,
      key: { s1: 'B', s2: 'B', s3: 'S' },
      explanation: 'Dijumlahkan: $3x = 9 \\Rightarrow x = 3$, maka $y = 1$. Sehingga $x + 2y = 3 + 2 = 5 \\neq 6$.',
    },
    {
      id: 'q_mat_09',
      topic: 'Barisan & Deret Geometri',
      type: 'pg_tunggal',
      stem: 'Suatu deret geometri tak hingga memiliki suku pertama $a = 12$ dan rasio $r = \\frac{1}{3}$. Jumlah tak hingga deret tersebut adalah...',
      media: null,
      table: null,
      options: [
        { id: 'a', label: 'A', text: '$16$' },
        { id: 'b', label: 'B', text: '$18$' },
        { id: 'c', label: 'C', text: '$24$' },
        { id: 'd', label: 'D', text: '$36$' },
      ],
      difficulty: 'mudah',
      weight: 2,
      key: 'b',
      explanation: '$S_\\infty = \\frac{a}{1-r} = \\frac{12}{1 - 1/3} = \\frac{12}{2/3} = 18$.',
    },
    {
      id: 'q_mat_10',
      topic: 'Pertidaksamaan Eksponen',
      type: 'pg_tunggal',
      stem: 'Himpunan penyelesaian dari pertidaksamaan $2^{2x - 1} > 8$ untuk $x \\in \\mathbb{R}$ adalah...',
      media: null,
      table: null,
      options: [
        { id: 'a', label: 'A', text: '$x > 1$' },
        { id: 'b', label: 'B', text: '$x > 2$' },
        { id: 'c', label: 'C', text: '$x < 2$' },
        { id: 'd', label: 'D', text: '$x \\ge 2$' },
      ],
      difficulty: 'sedang',
      weight: 2,
      key: 'b',
      explanation: '$2^{2x-1} > 2^3 \\Rightarrow 2x - 1 > 3 \\Rightarrow 2x > 4 \\Rightarrow x > 2$.',
    },
  ];

  for (const q of mathQuestions) {
    insQ.run(
      q.id,
      'bnk_tka_mat',
      'sub_mat',
      q.topic,
      q.type,
      q.stem,
      q.media,
      q.table ? JSON.stringify(q.table) : null,
      JSON.stringify(q.options),
      q.difficulty,
      q.weight,
      q.explanation,
      now
    );
    insKey.run(q.id, JSON.stringify(q.key), 'standard', 0.5, now);
  }

  // Bahasa Indonesia Questions (6 questions)
  const indoQuestions = [
    {
      id: 'q_ind_01',
      topic: 'Ide Pokok & Paragraf',
      type: 'pg_tunggal',
      stem: 'Bacalah kutipan berikut: "Transformasi digital di sekolah menengah menuntut kesiapan infrastruktur jaringan dan literasi guru secara bersamaan. Tanpa pelatihan pedagogik yang memadai, perangkat mutakhir hanya menjadi pajangan ruang kelas." Simpulan paling tepat dari kutipan tersebut adalah...',
      options: [
        { id: 'a', label: 'A', text: 'Keberhasilan digitalisasi sekolah bergantung pada keseimbangan teknologi dan kesiapan pendidik.' },
        { id: 'b', label: 'B', text: 'Sekolah harus membeli perangkat komputer terbaru sebelum melatih guru.' },
        { id: 'c', label: 'C', text: 'Pelatihan guru tidak diperlukan bila jaringan internet sudah cepat.' },
        { id: 'd', label: 'D', text: 'Ruang kelas tidak cocok menggunakan perangkat digital.' },
      ],
      difficulty: 'mudah',
      weight: 2,
      key: 'a',
      explanation: 'Paragraf menekankan dua syarat simultan: infrastruktur dan literasi/pelatihan guru.',
    },
    {
      id: 'q_ind_02',
      topic: 'Ejaan & Kalimat Efektif (PUEBI/EYD V)',
      type: 'pg_kompleks',
      stem: 'Pilihlah kalimat-kalimat yang sudah memenuhi kaidah EYD V dan keefektifan kalimat:',
      options: [
        { id: 'o1', label: '1', text: 'Para peserta ujian diharap memasuki ruangan lima belas menit sebelum dimulai.' },
        { id: 'o2', label: '2', text: 'Bagi para siswa-siswa dimohon untuk tidak membawa ponsel ke meja ujian.' },
        { id: 'o3', label: '3', text: 'Pengawas mencatat setiap kendala teknis yang terjadi selama sesi berlangsung.' },
        { id: 'o4', label: '4', text: 'Walaupun hujan deras, namun seluruh peserta tetap hadir tepat waktu.' },
      ],
      difficulty: 'sedang',
      weight: 4,
      key: ['o1', 'o3'],
      explanation: 'Kalimat 2 pleonasme ("para siswa-siswa") dan berpreposisi "bagi" pada subjek. Kalimat 4 salah konjungsi ganda ("walaupun... namun").',
    },
    {
      id: 'q_ind_03',
      topic: 'Struktur Teks Argumentasi',
      type: 'benar_salah',
      stem: 'Tentukan benar atau salahnya pernyataan mengenai teks argumentasi berikut:',
      options: [
        { id: 's1', text: 'Teks argumentasi wajib disertai data atau fakta empiris untuk memperkuat opini.' },
        { id: 's2', text: 'Tujuan utama teks argumentasi adalah menghibur pembaca dengan alur imajinatif.' },
        { id: 's3', text: 'Penutup teks argumentasi berisi penegasan ulang posisi penulis berdasarkan bukti.' },
      ],
      difficulty: 'mudah',
      weight: 4,
      key: { s1: 'B', s2: 'S', s3: 'B' },
      explanation: 'Teks argumentasi meyakinkan pembaca dengan bukti/fakta, bukan menghibur dengan fiksi.',
    },
    {
      id: 'q_ind_04',
      topic: 'Majas & Gaya Bahasa',
      type: 'menjodohkan',
      stem: 'Pasangkan kutipan kalimat sastra dengan jenis majas yang tepat:',
      options: {
        left: [
          { id: 'l1', text: 'Peluit pengawas menjerit membelah kesunyian aula.' },
          { id: 'l2', text: 'Ia membanting tulang demi membiayai sekolah adiknya.' },
          { id: 'l3', text: 'Suaranya menggelegar hingga menggetarkan langit-langit gedung.' },
        ],
        right: [
          { id: 'r1', text: 'Personifikasi' },
          { id: 'r2', text: 'Metafora' },
          { id: 'r3', text: 'Hiperbola' },
          { id: 'r4', text: 'Ironi' },
        ],
      },
      difficulty: 'sedang',
      weight: 4,
      key: { l1: 'r1', l2: 'r2', l3: 'r3' },
      explanation: 'Menjerit = personifikasi; membanting tulang = metafora/idiom kerja keras; menggetarkan langit = hiperbola.',
    },
  ];
  for (const q of indoQuestions) {
    insQ.run(q.id, 'bnk_uh_ind', 'sub_ind', q.topic, q.type, q.stem, null, null, JSON.stringify(q.options), q.difficulty, q.weight, q.explanation, now);
    insKey.run(q.id, JSON.stringify(q.key), 'standard', 0.5, now);
  }

  // Create 2 Exams:
  // 1) Active Simulasi TKA Matematika (with Mode C combination, camera optional/enabled, auto-lock)
  // 2) Completed UTS Bahasa Indonesia (so results, analytics, item analysis & rapor PDF are immediately populated!)
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const sixHoursLater = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO exams (id, title, exam_type, subject_id, class_ids_json, assigned_student_ids_json, question_bank_id, question_count, shuffle_mode, shuffle_questions, shuffle_options, composition_json, duration_minutes, passing_score, max_violations, auto_lock_enabled, require_fullscreen, proctoring_enabled, proctoring_sensitivity, proctoring_tolerance, proctoring_retention_days, allow_camera_stream, publication_policy, publish_at, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?, 1, 1, ?, ?, ?, 3, 1, 0, 1, 'sedang', 4, 14, 1, 'view_download_print', ?, 'usr_admin', ?)
  `).run(
    'exm_tka_math',
    'Simulasi TKA Matematika Wajib & Lanjut 2026',
    'Simulasi TKA',
    'sub_mat',
    JSON.stringify(['cls_xii_1', 'cls_xii_2']),
    'bnk_tka_mat',
    8,
    'C',
    JSON.stringify({ pg_tunggal: 3, pg_kompleks: 2, benar_salah: 2, menjodohkan: 1 }),
    90,
    75,
    now,
    now
  );
  db.prepare(`
    INSERT INTO exam_schedules (id, exam_id, timezone, start_at, entry_deadline_at, end_at, status, created_at)
    VALUES (?, ?, 'Asia/Jakarta', ?, ?, ?, 'active', ?)
  `).run('sch_tka_math', 'exm_tka_math', twoHoursAgo, sixHoursLater, sixHoursLater, now);
  db.prepare(`
    INSERT INTO scoring_rubrics (id, exam_id, version, weights_json, penalty_rule_json, created_at)
    VALUES (?, ?, 1, ?, ?, ?)
  `).run('rub_tka_math', 'exm_tka_math', JSON.stringify(DEFAULT_SCORING_WEIGHTS), JSON.stringify({ note: 'Penalti 50% per pilihan salah pada PG Kompleks, skor minimal 0 per soal' }), now);

  // Exam 2: Active Ulangan Harian Bahasa Indonesia
  db.prepare(`
    INSERT INTO exams (id, title, exam_type, subject_id, class_ids_json, assigned_student_ids_json, question_bank_id, question_count, shuffle_mode, shuffle_questions, shuffle_options, composition_json, duration_minutes, passing_score, max_violations, auto_lock_enabled, require_fullscreen, proctoring_enabled, proctoring_sensitivity, proctoring_tolerance, proctoring_retention_days, allow_camera_stream, publication_policy, publish_at, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?, 1, 1, NULL, ?, ?, 3, 1, 0, 0, 'sedang', 5, 14, 0, 'view_download_print', ?, 'usr_admin', ?)
  `).run(
    'exm_uh_indo',
    'Ulangan Harian Literasi & EYD V',
    'Ulangan Harian',
    'sub_ind',
    JSON.stringify(['cls_xii_1', 'cls_xi_1']),
    'bnk_uh_ind',
    4,
    'A',
    45,
    75,
    now,
    now
  );
  db.prepare(`
    INSERT INTO exam_schedules (id, exam_id, timezone, start_at, entry_deadline_at, end_at, status, created_at)
    VALUES (?, ?, 'Asia/Jakarta', ?, ?, ?, 'active', ?)
  `).run('sch_uh_indo', 'exm_uh_indo', twoHoursAgo, sixHoursLater, sixHoursLater, now);
  db.prepare(`
    INSERT INTO scoring_rubrics (id, exam_id, version, weights_json, penalty_rule_json, created_at)
    VALUES (?, ?, 1, ?, '{}', ?)
  `).run('rub_uh_indo', 'exm_uh_indo', JSON.stringify(DEFAULT_SCORING_WEIGHTS), now);

  // Exam 3: Completed Tryout Matematika (pre-graded sessions for Analytics & Item Analysis)
  db.prepare(`
    INSERT INTO exams (id, title, exam_type, subject_id, class_ids_json, assigned_student_ids_json, question_bank_id, question_count, shuffle_mode, shuffle_questions, shuffle_options, composition_json, duration_minutes, passing_score, max_violations, auto_lock_enabled, require_fullscreen, proctoring_enabled, proctoring_sensitivity, proctoring_tolerance, proctoring_retention_days, allow_camera_stream, publication_policy, publish_at, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?, 1, 1, NULL, ?, ?, 3, 1, 0, 0, 'sedang', 5, 14, 0, 'view_download_print', ?, 'usr_admin', ?)
  `).run(
    'exm_to_mat_done',
    'Tryout Tengah Semester Matematika',
    'Tryout',
    'sub_mat',
    JSON.stringify(['cls_xii_1', 'cls_xii_2']),
    'bnk_tka_mat',
    6,
    'B',
    60,
    75,
    twoDaysAgo,
    threeDaysAgo
  );
  db.prepare(`
    INSERT INTO exam_schedules (id, exam_id, timezone, start_at, entry_deadline_at, end_at, status, created_at)
    VALUES (?, ?, 'Asia/Jakarta', ?, ?, ?, 'completed', ?)
  `).run('sch_to_mat_done', 'exm_to_mat_done', threeDaysAgo, twoDaysAgo, twoDaysAgo, threeDaysAgo);
  db.prepare(`
    INSERT INTO scoring_rubrics (id, exam_id, version, weights_json, penalty_rule_json, created_at)
    VALUES (?, ?, 1, ?, '{}', ?)
  `).run('rub_to_mat_done', 'exm_to_mat_done', JSON.stringify(DEFAULT_SCORING_WEIGHTS), threeDaysAgo);

  // Create Fixed Package A & B for exm_to_mat_done and seed realistic graded sessions
  const pkgQuestionsA = ['q_mat_01', 'q_mat_02', 'q_mat_03', 'q_mat_04', 'q_mat_05', 'q_mat_06'];
  const pkgQuestionsB = ['q_mat_01', 'q_mat_03', 'q_mat_04', 'q_mat_06', 'q_mat_07', 'q_mat_08'];
  db.prepare(`
    INSERT INTO exam_packages (id, exam_id, package_code, is_fixed, question_ids_json, option_orders_json, max_points, created_at)
    VALUES (?, ?, ?, 1, ?, '{}', 18, ?)
  `).run('pkg_to_A', 'exm_to_mat_done', 'Paket A', JSON.stringify(pkgQuestionsA), threeDaysAgo);
  db.prepare(`
    INSERT INTO exam_packages (id, exam_id, package_code, is_fixed, question_ids_json, option_orders_json, max_points, created_at)
    VALUES (?, ?, ?, 1, ?, '{}', 20, ?)
  `).run('pkg_to_B', 'exm_to_mat_done', 'Paket B', JSON.stringify(pkgQuestionsB), threeDaysAgo);

  // Seed 6 completed student sessions on exm_to_mat_done so Analytics, Item Analysis, & Rapor PDF work out of the box
  const sampleStudentSessions: Array<{
    stuId: string;
    pkgId: string;
    qIds: string[];
    answers: Record<string, unknown>;
  }> = [
    {
      stuId: 'stu_01',
      pkgId: 'pkg_to_A',
      qIds: pkgQuestionsA,
      answers: {
        q_mat_01: 'a',
        q_mat_02: 'a',
        q_mat_03: ['o1', 'o2', 'o4'],
        q_mat_04: { s1: 'B', s2: 'S', s3: 'B', s4: 'B' },
        q_mat_05: { l1: 'r1', l2: 'r2', l3: 'r3', l4: 'r4' },
        q_mat_06: 'b',
      },
    },
    {
      stuId: 'stu_02',
      pkgId: 'pkg_to_B',
      qIds: pkgQuestionsB,
      answers: {
        q_mat_01: 'a',
        q_mat_03: ['o1', 'o2'],
        q_mat_04: { s1: 'B', s2: 'S', s3: 'B', s4: 'S' },
        q_mat_06: 'b',
        q_mat_07: ['o1', 'o2', 'o4'],
        q_mat_08: { s1: 'B', s2: 'B', s3: 'S' },
      },
    },
    {
      stuId: 'stu_03',
      pkgId: 'pkg_to_A',
      qIds: pkgQuestionsA,
      answers: {
        q_mat_01: 'b',
        q_mat_02: 'a',
        q_mat_03: ['o1', 'o3'],
        q_mat_04: { s1: 'B', s2: 'B', s3: 'S', s4: 'B' },
        q_mat_05: { l1: 'r1', l2: 'r3', l3: 'r2', l4: 'r4' },
        q_mat_06: 'c',
      },
    },
    {
      stuId: 'stu_04',
      pkgId: 'pkg_to_B',
      qIds: pkgQuestionsB,
      answers: {
        q_mat_01: 'a',
        q_mat_03: ['o1', 'o2', 'o4'],
        q_mat_04: { s1: 'B', s2: 'S', s3: 'B', s4: 'B' },
        q_mat_06: 'a',
        q_mat_07: ['o1', 'o2'],
        q_mat_08: { s1: 'B', s2: 'B', s3: 'S' },
      },
    },
    {
      stuId: 'stu_05',
      pkgId: 'pkg_to_A',
      qIds: pkgQuestionsA,
      answers: {
        q_mat_01: 'a',
        q_mat_02: 'b',
        q_mat_03: ['o1'],
        q_mat_04: { s1: 'B', s2: 'S', s3: 'S', s4: 'S' },
        q_mat_05: { l1: 'r1', l2: 'r2', l3: 'r4', l4: 'r3' },
        q_mat_06: null,
      },
    },
    {
      stuId: 'stu_06',
      pkgId: 'pkg_to_B',
      qIds: pkgQuestionsB,
      answers: {
        q_mat_01: 'a',
        q_mat_03: ['o1', 'o2', 'o4'],
        q_mat_04: { s1: 'B', s2: 'S', s3: 'B', s4: 'B' },
        q_mat_06: 'b',
        q_mat_07: ['o1', 'o2', 'o4'],
        q_mat_08: { s1: 'B', s2: 'B', s3: 'B' },
      },
    },
  ];

  const keyLookup = new Map<string, { type: 'pg_tunggal' | 'pg_kompleks' | 'benar_salah' | 'menjodohkan'; weight: number; key: unknown }>();
  for (const mq of mathQuestions) {
    keyLookup.set(mq.id, { type: mq.type, weight: mq.weight, key: mq.key });
  }

  for (const ss of sampleStudentSessions) {
    const sessId = `ses_done_${ss.stuId}`;
    db.prepare(`
      INSERT INTO exam_sessions (id, exam_id, student_id, package_id, rubric_id, session_token_hash, device_fingerprint, status, started_at, server_end_at, submitted_at, last_heartbeat_at, last_sync_at, violation_count, connection_status)
      VALUES (?, 'exm_to_mat_done', ?, ?, 'rub_to_mat_done', 'seeded-token', 'seeded-device', 'submitted', ?, ?, ?, ?, ?, 0, 'offline')
    `).run(sessId, ss.stuId, ss.pkgId, threeDaysAgo, twoDaysAgo, twoDaysAgo, twoDaysAgo, twoDaysAgo);

    const gradeInputs = [];
    for (const qId of ss.qIds) {
      const ans = ss.answers[qId] ?? null;
      if (ans !== null) {
        db.prepare(`
          INSERT INTO student_answers (id, session_id, question_id, answer_json, is_doubtful, client_version, server_version, saved_at)
          VALUES (?, ?, ?, ?, 0, 1, 1, ?)
        `).run(crypto.randomUUID(), sessId, qId, JSON.stringify(ans), twoDaysAgo);
      }
      const meta = keyLookup.get(qId)!;
      gradeInputs.push({
        questionId: qId,
        questionType: meta.type,
        itemWeight: meta.weight,
        correctKey: meta.key,
        studentAnswer: ans,
      });
    }
    const graded = gradeExamPackage(gradeInputs, DEFAULT_SCORING_WEIGHTS);
    db.prepare(`
      INSERT INTO scores (id, session_id, exam_id, student_id, raw_points, max_points, final_score, correct_count, partial_count, wrong_count, blank_count, passed, breakdown_json, graded_at)
      VALUES (?, ?, 'exm_to_mat_done', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      sessId,
      ss.stuId,
      graded.rawPoints,
      graded.maxPoints,
      graded.finalScore,
      graded.correctCount,
      graded.partialCount,
      graded.wrongCount,
      graded.blankCount,
      graded.finalScore >= 75 ? 1 : 0,
      JSON.stringify(graded.itemResults),
      twoDaysAgo
    );
  }

  writeAuditLog({
    actorId: 'usr_admin',
    actorRole: 'admin',
    actorName: 'Drs. Hendra Wijaya, M.Pd (Admin Utama)',
    action: 'SYSTEM_INITIAL_SEED',
    targetType: 'system',
    targetId: 'sinarcbt',
    details: { message: 'Inisialisasi awal database dan data uji sintetis SinarCBT.' },
  });
}
