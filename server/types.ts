export type UserRole = 'admin' | 'pengawas' | 'siswa';

export type QuestionType = 'pg_tunggal' | 'pg_kompleks' | 'benar_salah' | 'menjodohkan';

export type DifficultyLevel = 'mudah' | 'sedang' | 'sulit';

export type ShuffleMode = 'A' | 'B' | 'C';

export type PublicationPolicy = 'hidden' | 'view_only' | 'view_download' | 'view_download_print';

export interface QuestionOption {
  id: string;
  label: string;
  text: string;
}

export interface TrueFalseStatement {
  id: string;
  text: string;
}

export interface MatchingItem {
  id: string;
  text: string;
}

export interface MatchingOptions {
  left: MatchingItem[];
  right: MatchingItem[];
}

export interface ScoringWeights {
  pg_tunggal: number;
  pg_kompleks: number;
  benar_salah: number;
  menjodohkan: number;
  pg_kompleks_wrong_penalty: number; // e.g., 0.5 means each wrong choice deducts 0.5 * (weight / correctCount)
}

export interface AuthContext {
  userId: string;
  role: UserRole;
  name: string;
  username?: string;
  studentId?: string;
  nis?: string;
  classId?: string;
  assignedClassIds?: string[];
  assignedExamIds?: string[];
  canUnlockSessions?: boolean;
  sessionTokenId?: string;
}

export interface QuestionRecord {
  id: string;
  bank_id: string;
  subject_id: string;
  topic: string;
  question_type: QuestionType;
  stem_html: string;
  media_path: string | null;
  table_data_json: string | null;
  options_json: string;
  difficulty: DifficultyLevel;
  weight: number | null;
  explanation_html: string | null;
  is_active?: number;
}

export interface AnswerKeyRecord {
  question_id: string;
  key_json: string;
  scoring_mode: string;
  wrong_penalty: number;
}
