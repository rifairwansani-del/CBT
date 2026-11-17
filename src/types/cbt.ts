export type UserRole = 'admin' | 'pengawas' | 'siswa';
export type QuestionType = 'pg_tunggal' | 'pg_kompleks' | 'benar_salah' | 'menjodohkan';
export type DifficultyLevel = 'mudah' | 'sedang' | 'sulit';
export type ShuffleMode = 'A' | 'B' | 'C';
export type PublicationPolicy = 'hidden' | 'view_only' | 'view_download' | 'view_download_print';

export interface ClassExamConfigOverride {
  enabled?: boolean;
  startAt?: string;
  entryDeadlineAt?: string;
  endAt?: string;
  durationMinutes?: number;
  accessTokenMode?: 'inherit' | 'student_pin' | 'exam_token';
  accessToken?: string;
  publicationPolicy?: PublicationPolicy | 'inherit';
  historyVisible?: 'inherit' | 'visible' | 'hidden';
}

export interface InstitutionBranding {
  name: string;
  shortName: string;
  address: string;
  timezone: string;
  logoEndpoint: string;
  academicYear: string;
}

export interface ParticipantCardSettings {
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

export type ViolationDeviceScope = 'Android' | 'Desktop' | 'Web' | 'Android & Web/iPad' | 'Android & Desktop' | 'Desktop & Web' | 'Semua Perangkat';

export type ViolationRuleMode = 'record_only' | 'add_points' | 'instant_lock';

export interface ViolationRuleConfig {
  code: string;
  label: string;
  devices: ViolationDeviceScope;
  description: string;
  enabled: boolean;
  mode: ViolationRuleMode;
  points: number;
  autoUnlockMinutes: number; // 0 = manual unlock by admin/pengawas, >0 = auto-unlock after N minutes
  triggerSirenRedScreen?: boolean;
  blockQuestionsUntilResolved?: boolean;
}

export interface GadgetBrandException {
  brand: string;
  excusedEventTypes: string[];
  reasonNote: string;
  enabled: boolean;
}

export interface ViolationPolicySettings {
  rules: ViolationRuleConfig[];
  brandExceptions: GadgetBrandException[];
  wifiDisconnectGraceSeconds: number;
  blockBackNavigation: boolean;
}

export interface SecuritySettings {
  maxLoginAttempts: number;
  lockoutMinutes: number;
  defaultProctoringRetentionDays: number;
  maxConcurrentCameraStreams: number;
  showStudentExamHistory?: boolean;
  privacyNotice: string;
  participantCard?: ParticipantCardSettings;
  violationPolicy?: ViolationPolicySettings;
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
  pinDisplay?: string;
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
  requireCamera?: boolean;
  requireExamWifi?: boolean;
  allowedWifiSsid?: string;
  maxViolations: number;
  proctoringEnabled: boolean;
  allowCameraStream: boolean;
  timezone: string;
  startAt: string;
  entryDeadlineAt: string;
  endAt: string;
  availability: 'upcoming' | 'open' | 'in_progress' | 'locked' | 'completed' | 'missed';
  publicationPolicy: PublicationPolicy;
  usesExamToken?: boolean;
  session: {
    id: string;
    status: string;
    startedAt: string;
    serverEndAt: string;
    submittedAt: string | null;
    lockReason: string | null;
    lockedUntil?: string | null;
    violationCount: number;
    violationPoints?: number;
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
  violationPolicy?: ViolationPolicySettings;
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
    violationPoints?: number;
    maxViolations: number;
    autoLockEnabled: boolean;
    requireFullscreen: boolean;
    requireCamera?: boolean;
    requireExamWifi?: boolean;
    allowedWifiSsid?: string;
    lockReason: string | null;
    lockedUntil?: string | null;
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

export interface StudentMessageItem {
  id: string;
  student_id: string;
  exam_id: string | null;
  session_id: string | null;
  sender_id: string;
  sender_role: UserRole;
  sender_name: string;
  category: 'pesan' | 'pengumuman' | 'peringatan' | 'instruksi' | 'kesan';
  title: string;
  message: string;
  is_read: number;
  read_at: string | null;
  created_at: string;
}
