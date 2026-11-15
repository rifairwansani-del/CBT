export type UserRole = 'admin' | 'pengawas' | 'siswa';
export type QuestionType = 'pg_tunggal' | 'pg_kompleks' | 'benar_salah' | 'menjodohkan';
export type DifficultyLevel = 'mudah' | 'sedang' | 'sulit';
export type ShuffleMode = 'A' | 'B' | 'C';
export type PublicationPolicy = 'hidden' | 'view_only' | 'view_download' | 'view_download_print';

export interface InstitutionBranding {
  name: string;
  shortName: string;
  address: string;
  timezone: string;
  logoEndpoint: string;
  academicYear: string;
}

export interface SecuritySettings {
  maxLoginAttempts: number;
  lockoutMinutes: number;
  defaultProctoringRetentionDays: number;
  maxConcurrentCameraStreams: number;
  privacyNotice: string;
}

export interface AuthUser {
  id: string;
  role: UserRole;
  fullName: string;
  username?: string;
  nis?: string;
  nisn?: string;
  birthPlace?: string;
  birthDate?: string;
  gender?: string;
  email?: string;
  photoLink?: string;
  classId?: string;
  className?: string;
  hasPhoto?: boolean;
  photoUrl?: string | null;
  assignedClassIds?: string[];
  assignedExamIds?: string[];
  canUnlockSessions?: boolean;
}

export interface StudentExamSummary {
  id: string;
  title: string;
  examType: string;
  subjectName: string;
  subjectCode: string;
  durationMinutes: number;
  questionCount: number;
  passingScore: number;
  autoLockEnabled: boolean;
  requireFullscreen: boolean;
  maxViolations: number;
  proctoringEnabled: boolean;
  allowCameraStream: boolean;
  timezone: string;
  startAt: string;
  entryDeadlineAt: string;
  endAt: string;
  availability: 'upcoming' | 'open' | 'in_progress' | 'locked' | 'completed' | 'missed';
  publicationPolicy: PublicationPolicy;
  session: {
    id: string;
    status: string;
    startedAt: string;
    serverEndAt: string;
    submittedAt: string | null;
    lockReason: string | null;
    violationCount: number;
  } | null;
  result: {
    finalScore: number;
    rawPoints: number;
    maxPoints: number;
    correctCount: number;
    partialCount: number;
    wrongCount: number;
    blankCount: number;
    passed: boolean;
    gradedAt: string;
  } | null;
}

export interface StudentExamQuestion {
  id: string;
  topic: string;
  questionType: QuestionType;
  stemHtml: string;
  mediaPath: string | null;
  tableData: { headers: string[]; rows: string[][] } | null;
  options: unknown;
  difficulty: DifficultyLevel;
}

export interface ActiveExamPayload {
  serverTime: string;
  session: {
    id: string;
    examId: string;
    examTitle: string;
    subjectName: string;
    packageCode: string;
    status: string;
    startedAt: string;
    serverEndAt: string;
    violationCount: number;
    maxViolations: number;
    autoLockEnabled: boolean;
    requireFullscreen: boolean;
    lockReason: string | null;
    proctoring: {
      enabled: boolean;
      sensitivity: string;
      tolerance: number;
      allowCameraStream: boolean;
    };
  };
  questions: StudentExamQuestion[];
  answers: Record<string, { answer: unknown; isDoubtful: boolean; version: number; savedAt: string }>;
}

export interface ChatMessageItem {
  id: string;
  exam_id: string;
  session_id: string | null;
  sender_role: UserRole;
  sender_id: string;
  sender_name: string;
  recipient_student_id: string;
  message: string;
  server_timestamp: string;
}
