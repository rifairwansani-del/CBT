import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileSpreadsheet,
  KeyRound,
  Layers,
  Plus,
  Settings2,
  Trash2,
} from 'lucide-react';
import { apiFetch, withAuthTokenUrl } from '../../lib/api.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import type { ClassExamConfigOverride, PublicationPolicy, ShuffleMode } from '../../types/cbt.ts';

interface ExamItem {
  id: string;
  title: string;
  exam_type: string;
  subject_id: string;
  subject_name: string;
  class_ids_json: string;
  question_bank_id: string;
  bank_name: string;
  question_count: number;
  shuffle_mode: ShuffleMode;
  shuffle_questions: number;
  shuffle_options: number;
  composition_json: string | null;
  duration_minutes: number;
  passing_score: number;
  max_violations: number;
  auto_lock_enabled: number;
  require_fullscreen: number;
  require_camera?: number;
  require_exam_wifi?: number;
  allowed_wifi_ssid?: string;
  proctoring_enabled: number;
  proctoring_sensitivity: string;
  proctoring_tolerance: number;
  proctoring_retention_days: number;
  allow_camera_stream: number;
  publication_policy: PublicationPolicy;
  history_visible?: number;
  access_token_mode?: 'student_pin' | 'exam_token';
  access_token?: string;
  class_configs_json?: string;
  timezone: string;
  start_at: string;
  entry_deadline_at: string;
  end_at: string;
  rubric_weights_json: string | null;
}

interface ExamImportPreview {
  previewId: string;
  totalRows: number;
  validCount: number;
  errorCount: number;
  issues: Array<{ row: number; column: string; message: string }>;
}

const KNOWN_EXAM_TYPES = [
  'Ulangan Harian',
  'Ujian Tengah Semester',
  'Ujian Akhir Semester',
  'Ujian Sekolah',
  'Tryout',
  'Simulasi TKA',
];

function toLocalDateTimeInput(isoStr?: string | null, fallbackOffsetHours = 0): string {
  const dt = isoStr ? new Date(isoStr) : new Date(Date.now() + fallbackOffsetHours * 3600000);
  if (Number.isNaN(dt.getTime())) {
    const fb = new Date(Date.now() + fallbackOffsetHours * 3600000);
    return new Date(fb.getTime() - fb.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  return new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function parseClassConfigsSafe(raw?: string | null): Record<string, ClassExamConfigOverride> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, ClassExamConfigOverride>)
      : {};
  } catch {
    return {};
  }
}

function parseClassIdsSafe(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const ExamsAndSchedulesPanel: React.FC = () => {
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [classes, setClasses] = useState<Array<{ id: string; name: string }>>([]);
  const [subjects, setSubjects] = useState<Array<{ id: string; name: string }>>([]);
  const [banks, setBanks] = useState<Array<{ id: string; name: string; question_count: number; active_question_count?: number }>>([]);
  const [selectedExamIds, setSelectedExamIds] = useState<string[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ExamImportPreview | null>(null);
  const [showBulkTokenModal, setShowBulkTokenModal] = useState(false);
  const [bulkTokenScope, setBulkTokenScope] = useState<'all' | 'selected'>('all');
  const [bulkTokenMode, setBulkTokenMode] = useState<'student_pin' | 'exam_token'>('exam_token');
  const [bulkTokenValue, setBulkTokenValue] = useState('TKA2026');
  const [busy, setBusy] = useState(false);
  const [showStudentHistory, setShowStudentHistory] = useState(true);
  const [togglingHistory, setTogglingHistory] = useState(false);
  const [classConfigModalExam, setClassConfigModalExam] = useState<ExamItem | null>(null);
  const [modalClassIds, setModalClassIds] = useState<string[]>([]);
  const [modalClassConfigs, setModalClassConfigs] = useState<Record<string, ClassExamConfigOverride>>({});
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    action: () => Promise<void>;
  } | null>(null);

  const buildDefaultForm = (
    subId = (Array.isArray(subjects) ? subjects[0]?.id : undefined) || '',
    bankId = (Array.isArray(banks) ? banks[0]?.id : undefined) || '',
    clsIds = (Array.isArray(classes) ? classes : []).slice(0, 2).map((c) => c.id)
  ) => ({
    title: '',
    examType: 'Simulasi TKA',
    customExamType: '',
    subjectId: subId,
    classIds: clsIds,
    questionBankId: bankId,
    questionCount: 8,
    shuffleMode: 'A' as ShuffleMode,
    fixedPackageCount: 2,
    shuffleQuestions: true,
    shuffleOptions: true,
    durationMinutes: 90,
    passingScore: 75,
    timezone: 'Asia/Jakarta',
    startAt: toLocalDateTimeInput(null, 0),
    entryDeadlineAt: toLocalDateTimeInput(null, 4),
    endAt: toLocalDateTimeInput(null, 4),
    autoLockEnabled: true,
    maxViolations: 3,
    requireFullscreen: false,
    requireCamera: false,
    requireExamWifi: false,
    allowedWifiSsid: '',
    proctoringEnabled: false,
    proctoringSensitivity: 'sedang',
    proctoringTolerance: 4,
    proctoringRetentionDays: 14,
    allowCameraStream: false,
    publicationPolicy: 'view_download_print' as PublicationPolicy,
    historyVisible: true,
    accessTokenMode: 'student_pin' as 'student_pin' | 'exam_token',
    accessToken: '',
    weights: {
      pg_tunggal: 2,
      pg_kompleks: 4,
      benar_salah: 4,
      menjodohkan: 4,
      pg_kompleks_wrong_penalty: 0.5,
    },
    comp: {
      pg_tunggal: 3,
      pg_kompleks: 2,
      benar_salah: 2,
      menjodohkan: 1,
    },
  });

  const [form, setForm] = useState(() => buildDefaultForm());

  const loadData = async () => {
    try {
      const [eRes, cRes, sRes, bRes, brandRes] = await Promise.all([
        apiFetch<{ exams?: ExamItem[] }>('/api/admin/exams'),
        apiFetch<{ classes?: Array<{ id: string; name: string }> }>('/api/admin/classes'),
        apiFetch<{ subjects?: Array<{ id: string; name: string }> }>('/api/admin/subjects'),
        apiFetch<{ banks?: Array<{ id: string; name: string; question_count: number; active_question_count?: number }> }>('/api/admin/question-banks'),
        apiFetch<{ security?: { showStudentExamHistory?: boolean } }>('/api/branding').catch(() => null),
      ]);
      const nextExams = Array.isArray(eRes?.exams) ? eRes.exams : [];
      const nextClasses = Array.isArray(cRes?.classes) ? cRes.classes : [];
      const nextSubjects = Array.isArray(sRes?.subjects) ? sRes.subjects : [];
      const nextBanks = Array.isArray(bRes?.banks) ? bRes.banks : [];

      if (brandRes?.security) {
        setShowStudentHistory(brandRes.security.showStudentExamHistory !== false);
      }

      setExams(nextExams);
      setClasses(nextClasses);
      setSubjects(nextSubjects);
      setBanks(nextBanks);
      setSelectedExamIds((prev) => prev.filter((id) => nextExams.some((e) => e.id === id)));
      setForm((prev) => ({
        ...prev,
        subjectId: prev.subjectId || nextSubjects[0]?.id || '',
        questionBankId: prev.questionBankId || nextBanks[0]?.id || '',
        classIds: Array.isArray(prev.classIds) && prev.classIds.length > 0
          ? prev.classIds
          : nextClasses.slice(0, 2).map((c) => c.id),
      }));
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal memuat data ujian dan jadwal.' });
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCreateModal = () => {
    setEditingExamId(null);
    setForm(buildDefaultForm());
    setShowModal(true);
  };

  const openEditModal = (ex: ExamItem) => {
    setEditingExamId(ex.id);
    const isKnown = KNOWN_EXAM_TYPES.includes(ex.exam_type);
    let parsedClasses: string[] = [];
    let parsedWeights = {
      pg_tunggal: 2,
      pg_kompleks: 4,
      benar_salah: 4,
      menjodohkan: 4,
      pg_kompleks_wrong_penalty: 0.5,
    };
    let parsedComp = {
      pg_tunggal: 3,
      pg_kompleks: 2,
      benar_salah: 2,
      menjodohkan: 1,
    };
    try {
      const rawClasses = JSON.parse(ex.class_ids_json || '[]');
      parsedClasses = Array.isArray(rawClasses) ? rawClasses : [];
    } catch {
      parsedClasses = [];
    }
    try {
      if (ex.rubric_weights_json) parsedWeights = { ...parsedWeights, ...JSON.parse(ex.rubric_weights_json) };
    } catch {
      // keep defaults
    }
    try {
      if (ex.composition_json) parsedComp = { ...parsedComp, ...JSON.parse(ex.composition_json) };
    } catch {
      // keep defaults
    }

    setForm({
      title: ex.title,
      examType: isKnown ? ex.exam_type : 'Lainnya',
      customExamType: isKnown ? '' : ex.exam_type,
      subjectId: ex.subject_id,
      classIds: parsedClasses,
      questionBankId: ex.question_bank_id,
      questionCount: ex.question_count,
      shuffleMode: ex.shuffle_mode,
      fixedPackageCount: 2,
      shuffleQuestions: Boolean(ex.shuffle_questions),
      shuffleOptions: Boolean(ex.shuffle_options),
      durationMinutes: ex.duration_minutes,
      passingScore: ex.passing_score,
      timezone: ex.timezone || 'Asia/Jakarta',
      startAt: toLocalDateTimeInput(ex.start_at, 0),
      entryDeadlineAt: toLocalDateTimeInput(ex.entry_deadline_at || ex.end_at, 4),
      endAt: toLocalDateTimeInput(ex.end_at, 4),
      autoLockEnabled: Boolean(ex.auto_lock_enabled),
      maxViolations: ex.max_violations,
      requireFullscreen: Boolean(ex.require_fullscreen),
      requireCamera: Boolean(ex.require_camera),
      requireExamWifi: Boolean(ex.require_exam_wifi),
      allowedWifiSsid: ex.allowed_wifi_ssid || '',
      proctoringEnabled: Boolean(ex.proctoring_enabled),
      proctoringSensitivity: ex.proctoring_sensitivity || 'sedang',
      proctoringTolerance: ex.proctoring_tolerance || 4,
      proctoringRetentionDays: ex.proctoring_retention_days || 14,
      allowCameraStream: Boolean(ex.allow_camera_stream),
      publicationPolicy: ex.publication_policy,
      historyVisible: ex.history_visible !== 0,
      accessTokenMode: ex.access_token_mode === 'exam_token' ? 'exam_token' : 'student_pin',
      accessToken: ex.access_token || '',
      weights: parsedWeights,
      comp: parsedComp,
    });
    setShowModal(true);
  };

  const handleSaveExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanner(null);
    setBusy(true);
    try {
      const payload = {
        ...form,
        examType: form.examType === 'Lainnya' ? form.customExamType || 'Ujian Khusus' : form.examType,
        rubricWeights: form.weights,
        composition: form.shuffleMode === 'C' ? form.comp : null,
      };
      if (editingExamId) {
        await apiFetch(`/api/admin/exams/${editingExamId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setBanner({ type: 'ok', text: 'Konfigurasi ujian dan jadwal berhasil diperbarui.' });
      } else {
        await apiFetch('/api/admin/exams', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setBanner({ type: 'ok', text: 'Ujian, jadwal, dan rubrik penilaian berhasil dibuat.' });
      }
      setShowModal(false);
      setEditingExamId(null);
      await loadData();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal menyimpan ujian.' });
    } finally {
      setBusy(false);
    }
  };

  const handleUpdatePublication = async (examId: string, publicationPolicy: PublicationPolicy) => {
    try {
      await apiFetch(`/api/admin/exams/${examId}/policy`, {
        method: 'PATCH',
        body: JSON.stringify({ publicationPolicy }),
      });
      setBanner({ type: 'ok', text: 'Kebijakan publikasi hasil ujian diperbarui.' });
      await loadData();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal memperbarui kebijakan.' });
    }
  };

  const handleToggleExamHistory = async (exam: ExamItem) => {
    const nextVisible = exam.history_visible === 0;
    try {
      await apiFetch(`/api/admin/exams/${exam.id}/policy`, {
        method: 'PATCH',
        body: JSON.stringify({ historyVisible: nextVisible }),
      });
      setBanner({
        type: 'ok',
        text: nextVisible
          ? `Riwayat & hasil ujian "${exam.title}" kini terlihat oleh siswa.`
          : `Riwayat & hasil ujian "${exam.title}" kini disembunyikan dari siswa.`,
      });
      await loadData();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal mengubah visibilitas riwayat ujian.' });
    }
  };

  const handleExamExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setBanner(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const preview = await apiFetch<ExamImportPreview>('/api/admin/exams/import-preview', {
        method: 'POST',
        body: fd,
      });
      setImportPreview(preview);
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal memproses file Excel ujian.' });
    } finally {
      setBusy(false);
    }
  };

  const handleCommitExamImport = async () => {
    if (!importPreview) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ importedCount: number }>('/api/admin/exams/import-commit', {
        method: 'POST',
        body: JSON.stringify({ previewId: importPreview.previewId }),
      });
      setImportPreview(null);
      setBanner({ type: 'ok', text: `${res.importedCount} jadwal ujian valid berhasil diimpor.` });
      await loadData();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal menyimpan impor ujian.' });
    } finally {
      setBusy(false);
    }
  };

  const runConfirmAction = async () => {
    if (!confirmState) return;
    setBusy(true);
    try {
      await confirmState.action();
      setConfirmState(null);
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Operasi gagal.' });
      setConfirmState(null);
    } finally {
      setBusy(false);
    }
  };

  const generateRandomExamToken = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  };

  const openBulkTokenModal = (scope: 'all' | 'selected') => {
    setBulkTokenScope(scope);
    setBulkTokenMode('exam_token');
    setBulkTokenValue(generateRandomExamToken());
    setShowBulkTokenModal(true);
  };

  const handleSaveBulkExamToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setBanner(null);
    try {
      const res = await apiFetch<{ updatedCount: number; accessTokenMode: string }>('/api/admin/exams/bulk-token', {
        method: 'POST',
        body: JSON.stringify({
          scope: bulkTokenScope,
          examIds: bulkTokenScope === 'selected' ? selectedExamIds : undefined,
          accessTokenMode: bulkTokenMode,
          accessToken: bulkTokenMode === 'exam_token' ? bulkTokenValue.trim() : undefined,
        }),
      });
      setShowBulkTokenModal(false);
      setBanner({
        type: 'ok',
        text:
          res.accessTokenMode === 'exam_token'
            ? `Token ujian khusus "${bulkTokenValue.trim()}" diterapkan pada ${res.updatedCount} ujian.`
            : `${res.updatedCount} ujian dikembalikan menggunakan PIN masing-masing siswa.`,
      });
      await loadData();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal mengatur token ujian.' });
    } finally {
      setBusy(false);
    }
  };

  const openClassConfigModal = (ex: ExamItem) => {
    const cIds = parseClassIdsSafe(ex.class_ids_json);
    const rawConfigs = parseClassConfigsSafe(ex.class_configs_json);
    const formatted: Record<string, ClassExamConfigOverride> = {};
    for (const [cid, cfg] of Object.entries(rawConfigs)) {
      formatted[cid] = {
        ...cfg,
        startAt: cfg.startAt ? toLocalDateTimeInput(cfg.startAt) : '',
        entryDeadlineAt: cfg.entryDeadlineAt ? toLocalDateTimeInput(cfg.entryDeadlineAt) : '',
        endAt: cfg.endAt ? toLocalDateTimeInput(cfg.endAt) : '',
      };
    }
    setModalClassIds(cIds);
    setModalClassConfigs(formatted);
    setClassConfigModalExam(ex);
  };

  const handleSaveClassConfigs = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!classConfigModalExam) return;
    setBusy(true);
    setBanner(null);
    try {
      const payloadConfigs: Record<string, ClassExamConfigOverride> = {};
      for (const cid of modalClassIds) {
        const cfg = modalClassConfigs[cid];
        if (!cfg) continue;
        const hasOverride =
          cfg.enabled === false ||
          Boolean(cfg.startAt) ||
          Boolean(cfg.entryDeadlineAt) ||
          Boolean(cfg.endAt) ||
          Boolean(cfg.durationMinutes && cfg.durationMinutes > 0) ||
          (cfg.accessTokenMode && cfg.accessTokenMode !== 'inherit') ||
          (cfg.publicationPolicy && cfg.publicationPolicy !== 'inherit') ||
          (cfg.historyVisible && cfg.historyVisible !== 'inherit');
        if (!hasOverride) continue;
        payloadConfigs[cid] = {
          enabled: cfg.enabled !== false,
          startAt: cfg.startAt ? new Date(cfg.startAt).toISOString() : undefined,
          entryDeadlineAt: cfg.entryDeadlineAt ? new Date(cfg.entryDeadlineAt).toISOString() : undefined,
          endAt: cfg.endAt ? new Date(cfg.endAt).toISOString() : undefined,
          durationMinutes: cfg.durationMinutes && cfg.durationMinutes > 0 ? Number(cfg.durationMinutes) : undefined,
          accessTokenMode: cfg.accessTokenMode || 'inherit',
          accessToken: cfg.accessTokenMode === 'exam_token' ? String(cfg.accessToken || '').trim() : '',
          publicationPolicy: cfg.publicationPolicy || 'inherit',
          historyVisible: cfg.historyVisible || 'inherit',
        };
      }
      await apiFetch(`/api/admin/exams/${classConfigModalExam.id}/class-configs`, {
        method: 'PUT',
        body: JSON.stringify({
          classIds: modalClassIds,
          classConfigs: payloadConfigs,
        }),
      });
      setBanner({
        type: 'ok',
        text: `Pengaturan per kelas untuk "${classConfigModalExam.title}" berhasil disimpan.`,
      });
      setClassConfigModalExam(null);
      await loadData();
    } catch (err) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal menyimpan pengaturan per kelas.',
      });
    } finally {
      setBusy(false);
    }
  };

  const allExamsSelected = exams.length > 0 && exams.every((ex) => selectedExamIds.includes(ex.id));
  const examExportUrl = withAuthTokenUrl(
    `/api/admin/exams/export.xlsx${selectedExamIds.length > 0 ? `?ids=${encodeURIComponent(selectedExamIds.join(','))}` : ''}`
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-display font-bold text-slate-900">Manajemen Ujian, Jadwal &amp; Publikasi Nilai</h2>
          <p className="text-xs sm:text-sm text-slate-600">
            Satu sistem terpadu untuk Ulangan Harian, UTS, UAS, Ujian Sekolah, Tryout, Simulasi TKA, dan ujian khusus lainnya.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={withAuthTokenUrl('/api/admin/templates/exams.xlsx')}
            className="min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" />
            <span>Template Excel</span>
          </a>
          <label className="min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer">
            <FileSpreadsheet className="w-4 h-4" />
            <span>Impor Excel</span>
            <input type="file" accept=".xlsx,.xls" onChange={handleExamExcelUpload} className="hidden" />
          </label>
          <a
            href={examExportUrl}
            className="min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" />
            <span>{selectedExamIds.length > 0 ? `Ekspor (${selectedExamIds.length})` : 'Ekspor Excel'}</span>
          </a>
          <button
            type="button"
            onClick={() => openBulkTokenModal(selectedExamIds.length > 0 ? 'selected' : 'all')}
            className="min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5"
          >
            <KeyRound className="w-4 h-4 text-[#0e539a]" />
            <span>Atur Token Ujian</span>
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="min-h-[42px] px-4 py-2 rounded-xl bg-blue-900 hover:bg-blue-800 text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Buat Ujian Baru</span>
          </button>
        </div>
      </div>

      {banner && (
        <div
          className={`p-3.5 rounded-xl border text-sm flex items-center gap-2 ${
            banner.type === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {banner.type === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span>{banner.text}</span>
        </div>
      )}

      {/* Global Student History & Results Visibility Control */}
      <div
        className={`rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
          showStudentHistory
            ? 'bg-emerald-50/60 border-emerald-200'
            : 'bg-amber-50/70 border-amber-200'
        }`}
      >
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
              showStudentHistory ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white'
            }`}
          >
            {showStudentHistory ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </div>
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-bold text-slate-900">
              Menu &ldquo;Riwayat &amp; Hasil Ujian&rdquo; Siswa:{' '}
              <span className={showStudentHistory ? 'text-emerald-700' : 'text-amber-700'}>
                {showStudentHistory ? 'Terlihat oleh Siswa' : 'Disembunyikan dari Siswa'}
              </span>
            </p>
            <p className="text-xs text-slate-600 mt-0.5">
              {showStudentHistory
                ? 'Siswa dapat membuka tab Cek Nilai & Rapor serta melihat riwayat ujian selesai sesuai kebijakan publikasi per ujian.'
                : 'Tab Cek Nilai & Rapor, kotak Riwayat Nilai, dan daftar riwayat ujian disembunyikan sementara dari seluruh portal siswa.'}
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={togglingHistory}
          onClick={async () => {
            setTogglingHistory(true);
            setBanner(null);
            try {
              const nextVisible = !showStudentHistory;
              const res = await apiFetch<{ showStudentExamHistory: boolean }>('/api/admin/settings/student-history', {
                method: 'PATCH',
                body: JSON.stringify({ visible: nextVisible }),
              });
              setShowStudentHistory(res.showStudentExamHistory);
              setBanner({
                type: 'ok',
                text: res.showStudentExamHistory
                  ? 'Menu Riwayat & Hasil Ujian sekarang terlihat di portal siswa.'
                  : 'Menu Riwayat & Hasil Ujian sekarang disembunyikan dari portal siswa.',
              });
            } catch (err) {
              setBanner({
                type: 'err',
                text: err instanceof Error ? err.message : 'Gagal mengubah visibilitas riwayat ujian.',
              });
            } finally {
              setTogglingHistory(false);
            }
          }}
          className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50 transition-colors ${
            showStudentHistory
              ? 'border border-amber-300 bg-white hover:bg-amber-50 text-amber-800'
              : 'bg-emerald-600 hover:bg-emerald-700 text-white'
          }`}
        >
          {showStudentHistory ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          <span>{togglingHistory ? 'Menyimpan...' : showStudentHistory ? 'Sembunyikan Riwayat & Hasil' : 'Tampilkan Riwayat & Hasil'}</span>
        </button>
      </div>

      {/* Exam Excel Import Preview */}
      {importPreview && (
        <div className="bg-white border border-blue-200 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display font-bold text-slate-900">Pratinjau Impor Jadwal Ujian Excel</h3>
              <p className="text-xs text-slate-600 mt-0.5">
                Total {importPreview.totalRows} ujian · Valid: {importPreview.validCount} · Bermasalah: {importPreview.errorCount}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setImportPreview(null)}
                className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold"
              >
                Batalkan Impor
              </button>
              <button
                type="button"
                disabled={busy || importPreview.validCount === 0}
                onClick={handleCommitExamImport}
                className="px-4 py-2 rounded-xl bg-blue-900 text-white text-xs font-semibold disabled:opacity-50"
              >
                Simpan {importPreview.validCount} Ujian Valid
              </button>
            </div>
          </div>
          {importPreview.issues.length > 0 && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 max-h-40 overflow-y-auto space-y-1">
              {importPreview.issues.map((iss, i) => (
                <p key={i}>Baris {iss.row} (Kolom {iss.column}): {iss.message}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Select-all & Bulk Action Bar */}
      {exams.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-2xl px-4 py-3">
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer min-h-[38px]">
            <input
              type="checkbox"
              checked={allExamsSelected}
              onChange={(e) => setSelectedExamIds(e.target.checked ? exams.map((ex) => ex.id) : [])}
              className="w-4 h-4 rounded border-slate-300"
            />
            <span>Pilih Semua Ujian ({exams.length})</span>
          </label>
          {selectedExamIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-blue-900">{selectedExamIds.length} ujian dipilih</span>
              <button
                type="button"
                onClick={() => openBulkTokenModal('selected')}
                className="min-h-[38px] px-3 py-1.5 rounded-xl border border-blue-200 bg-white hover:bg-blue-100/50 text-xs font-semibold text-blue-900 inline-flex items-center gap-1"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Atur Token Terpilih</span>
              </button>
              <a
                href={examExportUrl}
                className="min-h-[38px] px-3 py-1.5 rounded-xl border border-blue-200 bg-blue-50 text-xs font-semibold text-blue-900 inline-flex items-center gap-1"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Ekspor Terpilih</span>
              </a>
              <button
                type="button"
                onClick={() =>
                  setConfirmState({
                    title: 'Hapus Ujian Terpilih',
                    message: `Hapus ${selectedExamIds.length} ujian terpilih beserta jadwal, sesi, dan nilainya secara permanen?`,
                    confirmLabel: `Hapus ${selectedExamIds.length} Ujian`,
                    action: async () => {
                      const res = await apiFetch<{ deletedCount: number }>('/api/admin/exams/bulk-delete', {
                        method: 'POST',
                        body: JSON.stringify({ ids: selectedExamIds }),
                      });
                      setSelectedExamIds([]);
                      setBanner({ type: 'ok', text: `${res.deletedCount} ujian berhasil dihapus.` });
                      await loadData();
                    },
                  })
                }
                className="min-h-[38px] px-3 py-1.5 rounded-xl bg-red-700 hover:bg-red-800 text-white text-xs font-semibold inline-flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Hapus Terpilih</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedExamIds([])}
                className="min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600"
              >
                Bersihkan
              </button>
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        {exams.map((ex) => {
          const isChecked = selectedExamIds.includes(ex.id);
          const examClassIds = parseClassIdsSafe(ex.class_ids_json);
          const examClassNames = examClassIds
            .map((cid) => classes.find((c) => c.id === cid)?.name)
            .filter(Boolean);
          const customClassCount = Object.keys(parseClassConfigsSafe(ex.class_configs_json)).filter((cid) =>
            examClassIds.includes(cid)
          ).length;

          return (
            <article
              key={ex.id}
              className={`bg-white border rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 transition-colors ${
                isChecked ? 'border-blue-400 bg-blue-50/20' : 'border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)]'
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  aria-label={`Pilih ujian ${ex.title}`}
                  checked={isChecked}
                  onChange={(e) =>
                    setSelectedExamIds((prev) =>
                      e.target.checked ? [...prev, ex.id] : prev.filter((id) => id !== ex.id)
                    )
                  }
                  className="mt-1 w-4 h-4 rounded border-slate-300 shrink-0"
                />
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-semibold text-blue-900">{ex.exam_type}</span>
                    <span>·</span>
                    <span>{ex.subject_name}</span>
                    <span>·</span>
                    <span className="font-mono">Mode Acak {ex.shuffle_mode}</span>
                  </div>
                  <h3 className="text-base font-display font-bold text-slate-900">{ex.title}</h3>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 tabular-nums">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      {new Date(ex.start_at).toLocaleString('id-ID')} s/d {new Date(ex.end_at).toLocaleString('id-ID')} ({ex.timezone})
                    </span>
                    <span>{ex.question_count} soal · {ex.duration_minutes} menit · KKM {ex.passing_score}</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Auto-Lock: {ex.auto_lock_enabled ? `Aktif (maks ${ex.max_violations} poin)` : 'Nonaktif'} · Kamera AI: {ex.proctoring_enabled ? 'Aktif' : 'Nonaktif'}
                    {ex.require_camera ? ' · Kamera Wajib' : ''}
                    {ex.require_exam_wifi ? ` · WiFi Ujian${ex.allowed_wifi_ssid ? ` (${ex.allowed_wifi_ssid})` : ''}` : ''} · Akses:{' '}
                    <span className="font-medium text-slate-700">
                      {ex.access_token_mode === 'exam_token' && ex.access_token
                        ? `Token Khusus (${ex.access_token})`
                        : 'PIN Peserta'}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">
                    Kelas:{' '}
                    <span className="font-medium text-slate-700">
                      {examClassNames.length > 0 ? examClassNames.join(', ') : 'Belum ada kelas'}
                    </span>
                    {customClassCount > 0 && (
                      <span className="ml-2 font-semibold text-violet-700">
                        · {customClassCount} kelas diatur khusus
                      </span>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => openClassConfigModal(ex)}
                  title="Atur jadwal, durasi, PIN/token, publikasi nilai, dan riwayat per kelas"
                  className={`min-h-[40px] px-3 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                    customClassCount > 0
                      ? 'border-violet-300 bg-violet-50 hover:bg-violet-100 text-violet-800'
                      : 'border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100 text-indigo-800'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>{customClassCount > 0 ? `Atur per Kelas (${customClassCount})` : 'Atur per Kelas'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleExamHistory(ex)}
                  title="Atur apakah ujian ini muncul di menu Riwayat & Hasil Ujian siswa"
                  className={`min-h-[40px] px-3 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                    ex.history_visible === 0
                      ? 'border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800'
                      : 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {ex.history_visible === 0 ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  <span>{ex.history_visible === 0 ? 'Riwayat: Tersembunyi' : 'Riwayat: Terlihat'}</span>
                </button>
                <select
                  aria-label={`Kebijakan publikasi nilai ${ex.title}`}
                  value={ex.publication_policy}
                  onChange={(e) => handleUpdatePublication(ex.id, e.target.value as PublicationPolicy)}
                  className="min-h-[40px] px-3 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-800"
                >
                  <option value="hidden">1. Hasil Disembunyikan</option>
                  <option value="view_only">2. Hanya Dapat Dilihat</option>
                  <option value="view_download">3. Lihat &amp; Unduh PDF</option>
                  <option value="view_download_print">4. Lihat, Unduh &amp; Cetak</option>
                </select>
                <button
                  type="button"
                  onClick={() => openEditModal(ex)}
                  className="min-h-[40px] px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Edit</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setConfirmState({
                      title: 'Hapus Ujian',
                      message: `Hapus ujian "${ex.title}" beserta seluruh jadwal, paket, dan sesi pesertanya?`,
                      confirmLabel: 'Ya, Hapus Ujian',
                      action: async () => {
                        await apiFetch(`/api/admin/exams/${ex.id}`, { method: 'DELETE' });
                        setBanner({ type: 'ok', text: `Ujian "${ex.title}" berhasil dihapus.` });
                        await loadData();
                      },
                    })
                  }
                  className="min-h-[40px] px-3 rounded-xl border border-red-200 hover:bg-red-50 text-xs font-semibold text-red-700 inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Hapus</span>
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {/* Create / Edit Exam Modal (Bottom Sheet on Mobile) */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form onSubmit={handleSaveExam} className="bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl max-w-3xl w-full p-5 sm:p-6 space-y-5 max-h-[92dvh] overflow-y-auto pb-safe">
            <div className="w-10 h-1 rounded-full bg-slate-300 mx-auto sm:hidden" />
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-display font-bold text-slate-900 flex items-center gap-2">
                <Settings2 className="w-5 h-5 text-blue-900" />
                <span>{editingExamId ? 'Edit Konfigurasi Ujian & Jadwal' : 'Konfigurasi Ujian & Jadwal Baru'}</span>
              </h3>
              <button type="button" onClick={() => setShowModal(false)} className="min-h-[38px] px-3 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100">Tutup</button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Ujian</label>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Misal: UAS Matematika Semester Ganjil"
                  className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-slate-300 text-base sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Jenis Ujian</label>
                <select
                  value={form.examType}
                  onChange={(e) => setForm({ ...form, examType: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm"
                >
                  <option value="Ulangan Harian">Ulangan Harian</option>
                  <option value="Ujian Tengah Semester">Ujian Tengah Semester (UTS)</option>
                  <option value="Ujian Akhir Semester">Ujian Akhir Semester (UAS)</option>
                  <option value="Ujian Sekolah">Ujian Sekolah</option>
                  <option value="Tryout">Tryout</option>
                  <option value="Simulasi TKA">Simulasi TKA</option>
                  <option value="Lainnya">Jenis Ujian Tambahan (Kustom)</option>
                </select>
                {form.examType === 'Lainnya' && (
                  <input
                    type="text"
                    required
                    placeholder="Tulis nama jenis ujian..."
                    value={form.customExamType}
                    onChange={(e) => setForm({ ...form, customExamType: e.target.value })}
                    className="mt-2 w-full px-3 py-2 rounded-xl border border-slate-300 text-sm"
                  />
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Mata Pelajaran</label>
                <select
                  value={form.subjectId}
                  onChange={(e) => setForm({ ...form, subjectId: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm"
                >
                  {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Bank Soal</label>
                <select
                  value={form.questionBankId}
                  onChange={(e) => setForm({ ...form, questionBankId: e.target.value })}
                  className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm"
                >
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.active_question_count ?? b.question_count} soal tampil / {b.question_count} total)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Target Classes */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Kelas Peserta</label>
              <div className="flex flex-wrap gap-2">
                {classes.map((c) => {
                  const checked = form.classIds.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer ${
                        checked ? 'bg-blue-50 border-blue-900 text-blue-900' : 'bg-white border-slate-200 text-slate-600'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setForm((prev) => ({
                            ...prev,
                            classIds: e.target.checked
                              ? [...prev.classIds, c.id]
                              : prev.classIds.filter((id) => id !== c.id),
                          }));
                        }}
                        className="sr-only"
                      />
                      {c.name}
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Schedule & Timezone */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Zona Waktu</label>
                <select
                  value={form.timezone}
                  onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                  className="w-full px-2.5 py-2 rounded-xl border border-slate-300 bg-white text-xs"
                >
                  <option value="Asia/Jakarta">WIB (Asia/Jakarta)</option>
                  <option value="Asia/Makassar">WITA (Asia/Makassar)</option>
                  <option value="Asia/Jayapura">WIT (Asia/Jayapura)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Mulai</label>
                <input type="datetime-local" required value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Batas Masuk</label>
                <input type="datetime-local" required value={form.entryDeadlineAt} onChange={(e) => setForm({ ...form, entryDeadlineAt: e.target.value })} className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Selesai</label>
                <input type="datetime-local" required value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs" />
              </div>
            </div>

            {/* Shuffling & Duration */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Jumlah Soal</label>
                <input type="number" min={1} max={200} value={form.questionCount} onChange={(e) => setForm({ ...form, questionCount: Number(e.target.value) })} className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Durasi (Menit)</label>
                <input type="number" min={5} max={360} value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })} className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">KKM Ketuntasan</label>
                <input type="number" min={0} max={100} value={form.passingScore} onChange={(e) => setForm({ ...form, passingScore: Number(e.target.value) })} className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Mode Pengacakan</label>
                <select value={form.shuffleMode} onChange={(e) => setForm({ ...form, shuffleMode: e.target.value as ShuffleMode })} className="w-full px-2.5 py-2 rounded-xl border border-slate-300 bg-white text-xs">
                  <option value="A">Mode A — Acak Individual</option>
                  <option value="B">Mode B — Paket Tetap (A, B, C)</option>
                  <option value="C">Mode C — Paket Kombinasi</option>
                </select>
              </div>
            </div>

            {!editingExamId && form.shuffleMode === 'B' && (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center gap-3 text-xs">
                <span className="font-semibold">Jumlah Paket Tetap:</span>
                <input type="number" min={1} max={10} value={form.fixedPackageCount} onChange={(e) => setForm({ ...form, fixedPackageCount: Number(e.target.value) })} className="w-20 px-2 py-1 rounded border border-slate-300 font-mono" />
                <span className="text-slate-500">Sistem membuat Paket A, B, dst. dan mendistribusikan merata.</span>
              </div>
            )}

            {/* Rubric Weights */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <p className="text-xs font-bold text-slate-800">Bobot Penilaian Parsial (Nilai Akhir Dinormalisasi 0 - 100)</p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                <div><label className="block text-slate-600 mb-0.5">PG Tunggal</label><input type="number" min={1} value={form.weights.pg_tunggal} onChange={(e) => setForm({ ...form, weights: { ...form.weights, pg_tunggal: Number(e.target.value) } })} className="w-full px-2 py-1 rounded border border-slate-300 font-mono bg-white" /></div>
                <div><label className="block text-slate-600 mb-0.5">PG Kompleks</label><input type="number" min={1} value={form.weights.pg_kompleks} onChange={(e) => setForm({ ...form, weights: { ...form.weights, pg_kompleks: Number(e.target.value) } })} className="w-full px-2 py-1 rounded border border-slate-300 font-mono bg-white" /></div>
                <div><label className="block text-slate-600 mb-0.5">Benar-Salah</label><input type="number" min={1} value={form.weights.benar_salah} onChange={(e) => setForm({ ...form, weights: { ...form.weights, benar_salah: Number(e.target.value) } })} className="w-full px-2 py-1 rounded border border-slate-300 font-mono bg-white" /></div>
                <div><label className="block text-slate-600 mb-0.5">Menjodohkan</label><input type="number" min={1} value={form.weights.menjodohkan} onChange={(e) => setForm({ ...form, weights: { ...form.weights, menjodohkan: Number(e.target.value) } })} className="w-full px-2 py-1 rounded border border-slate-300 font-mono bg-white" /></div>
                <div><label className="block text-slate-600 mb-0.5">Penalti PGK</label><input type="number" step="0.1" min={0} max={1} value={form.weights.pg_kompleks_wrong_penalty} onChange={(e) => setForm({ ...form, weights: { ...form.weights, pg_kompleks_wrong_penalty: Number(e.target.value) } })} className="w-full px-2 py-1 rounded border border-slate-300 font-mono bg-white" /></div>
              </div>
            </div>

            {/* Security, Proctoring & Publication */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="p-3.5 rounded-xl border border-slate-200 space-y-2">
                <p className="font-bold text-slate-800">Keamanan, Kamera Wajib &amp; WiFi Ujian</p>
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.autoLockEnabled} onChange={(e) => setForm({ ...form, autoLockEnabled: e.target.checked })} /> Aktifkan penguncian otomatis</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.requireFullscreen} onChange={(e) => setForm({ ...form, requireFullscreen: e.target.checked })} /> Wajib layar penuh (Fullscreen)</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.requireCamera} onChange={(e) => setForm({ ...form, requireCamera: e.target.checked })} /> Wajib kamera aktif (tutup soal jika kamera mati/tertutup)</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.requireExamWifi} onChange={(e) => setForm({ ...form, requireExamWifi: e.target.checked })} /> Wajib terhubung WiFi ujian (deteksi putus &gt; 10 detik)</label>
                {form.requireExamWifi && (
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Nama WiFi / SSID Ujian (Opsional)</label>
                    <input
                      type="text"
                      value={form.allowedWifiSsid}
                      onChange={(e) => setForm({ ...form, allowedWifiSsid: e.target.value })}
                      placeholder="Contoh: WIFI-LAB-CBT"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono text-xs"
                    />
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span>Batas poin pelanggaran sebelum terkunci:</span>
                  <input type="number" min={1} max={30} value={form.maxViolations} onChange={(e) => setForm({ ...form, maxViolations: Number(e.target.value) })} className="w-16 px-2 py-1 rounded border border-slate-300 font-mono" />
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 space-y-2">
                <p className="font-bold text-slate-800">Pengawasan Kamera &amp; Publikasi</p>
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.proctoringEnabled} onChange={(e) => setForm({ ...form, proctoringEnabled: e.target.checked })} /> Aktifkan AI Proctoring (Indikator)</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.allowCameraStream} onChange={(e) => setForm({ ...form, allowCameraStream: e.target.checked })} /> Izinkan live kamera peserta terpilih</label>
                <div>
                  <label className="block text-slate-600 mb-1">Kebijakan Publikasi</label>
                  <select value={form.publicationPolicy} onChange={(e) => setForm({ ...form, publicationPolicy: e.target.value as PublicationPolicy })} className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white">
                    <option value="hidden">Disembunyikan</option>
                    <option value="view_only">Hanya Dilihat</option>
                    <option value="view_download">Lihat &amp; Unduh PDF</option>
                    <option value="view_download_print">Lihat, Unduh &amp; Cetak</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    checked={form.historyVisible}
                    onChange={(e) => setForm({ ...form, historyVisible: e.target.checked })}
                  />
                  <span>Tampilkan di Riwayat &amp; Hasil Ujian Siswa</span>
                </label>
              </div>
            </div>

            {/* Token / PIN Mulai Tes Setting */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold text-slate-800 flex items-center gap-1.5">
                  <KeyRound className="w-4 h-4 text-[#0e539a]" />
                  <span>Pengaturan PIN / Token Saat Mulai Tes</span>
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, accessTokenMode: 'student_pin' })}
                  className={`min-h-[40px] px-3 py-2 rounded-xl border text-left font-semibold transition-colors ${
                    form.accessTokenMode === 'student_pin'
                      ? 'bg-white border-[#0e539a] text-[#0e539a] shadow-xs'
                      : 'bg-white/60 border-slate-200 text-slate-600'
                  }`}
                >
                  Gunakan PIN Peserta Masing-Masing
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      accessTokenMode: 'exam_token',
                      accessToken: prev.accessToken || generateRandomExamToken(),
                    }))
                  }
                  className={`min-h-[40px] px-3 py-2 rounded-xl border text-left font-semibold transition-colors ${
                    form.accessTokenMode === 'exam_token'
                      ? 'bg-white border-[#0e539a] text-[#0e539a] shadow-xs'
                      : 'bg-white/60 border-slate-200 text-slate-600'
                  }`}
                >
                  Token Khusus untuk Ujian Ini
                </button>
              </div>
              {form.accessTokenMode === 'exam_token' && (
                <div className="flex flex-col sm:flex-row gap-2 pt-1">
                  <input
                    type="text"
                    required
                    minLength={4}
                    maxLength={32}
                    value={form.accessToken}
                    onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
                    placeholder="Masukkan Token Khusus (min. 4 karakter)"
                    className="flex-1 min-h-[40px] px-3 py-2 rounded-xl border border-slate-300 bg-white font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, accessToken: generateRandomExamToken() })}
                    className="min-h-[40px] px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 font-semibold text-slate-700 whitespace-nowrap shrink-0"
                  >
                    Acak Token
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium">Batal</button>
              <button type="submit" disabled={busy} className="min-h-[44px] px-5 py-2 rounded-xl bg-blue-900 text-white text-sm font-semibold disabled:opacity-50">
                {editingExamId ? 'Simpan Perubahan' : 'Simpan Ujian'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Bulk Exam Token Modal (All vs Selected Exams) */}
      {showBulkTokenModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form
            onSubmit={handleSaveBulkExamToken}
            className="bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 max-h-[92dvh] overflow-y-auto pb-safe"
          >
            <div className="w-10 h-1 rounded-full bg-slate-300 mx-auto sm:hidden" />
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <h3 className="text-lg font-display font-bold text-slate-900 flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-[#0e539a]" />
                <span>Pengaturan Token Ujian</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowBulkTokenModal(false)}
                className="min-h-[36px] px-2.5 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100"
              >
                Tutup
              </button>
            </div>

            <div className="space-y-4 text-sm">
              <div>
                <p className="text-xs font-semibold text-slate-700 mb-2">Sasaran Ujian</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setBulkTokenScope('all')}
                    className={`min-h-[42px] px-3 py-2 rounded-xl border text-xs font-semibold transition-colors ${
                      bulkTokenScope === 'all'
                        ? 'bg-blue-50 border-[#0e539a] text-[#0e539a]'
                        : 'bg-white border-slate-200 text-slate-700'
                    }`}
                  >
                    Semua Ujian ({exams.length})
                  </button>
                  <button
                    type="button"
                    disabled={selectedExamIds.length === 0}
                    onClick={() => setBulkTokenScope('selected')}
                    className={`min-h-[42px] px-3 py-2 rounded-xl border text-xs font-semibold transition-colors disabled:opacity-50 ${
                      bulkTokenScope === 'selected'
                        ? 'bg-blue-50 border-[#0e539a] text-[#0e539a]'
                        : 'bg-white border-slate-200 text-slate-700'
                    }`}
                  >
                    Ujian Terpilih ({selectedExamIds.length})
                  </button>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-700 mb-2">Mode Validasi Mulai Tes</p>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setBulkTokenMode('exam_token')}
                    className={`w-full min-h-[42px] px-3 py-2 rounded-xl border text-xs font-semibold text-left transition-colors ${
                      bulkTokenMode === 'exam_token'
                        ? 'bg-blue-50 border-[#0e539a] text-[#0e539a]'
                        : 'bg-white border-slate-200 text-slate-700'
                    }`}
                  >
                    Token Khusus Ujian (Seragam untuk sasaran terpilih)
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkTokenMode('student_pin')}
                    className={`w-full min-h-[42px] px-3 py-2 rounded-xl border text-xs font-semibold text-left transition-colors ${
                      bulkTokenMode === 'student_pin'
                        ? 'bg-blue-50 border-[#0e539a] text-[#0e539a]'
                        : 'bg-white border-slate-200 text-slate-700'
                    }`}
                  >
                    Gunakan PIN Masing-Masing Siswa
                  </button>
                </div>
              </div>

              {bulkTokenMode === 'exam_token' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Token Khusus (Min. 4 Karakter)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      minLength={4}
                      maxLength={32}
                      value={bulkTokenValue}
                      onChange={(e) => setBulkTokenValue(e.target.value)}
                      className="flex-1 min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 font-mono text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setBulkTokenValue(generateRandomExamToken())}
                      className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 whitespace-nowrap shrink-0"
                    >
                      Acak
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowBulkTokenModal(false)}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={busy}
                className="min-h-[44px] px-5 py-2 rounded-xl bg-[#0e539a] hover:bg-[#0b437e] text-white text-sm font-semibold disabled:opacity-50"
              >
                {busy ? 'Menyimpan...' : 'Terapkan ke Ujian'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Per-Class Exam Configuration Modal */}
      {classConfigModalExam && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form
            onSubmit={handleSaveClassConfigs}
            className="bg-white border border-indigo-200 rounded-t-3xl sm:rounded-2xl max-w-4xl w-full p-5 sm:p-6 space-y-5 max-h-[92dvh] overflow-y-auto pb-safe shadow-2xl"
          >
            <div className="w-10 h-1 rounded-full bg-slate-300 mx-auto sm:hidden" />
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-lg font-display font-bold text-slate-900 flex items-center gap-2">
                  <Layers className="w-5 h-5 text-indigo-700" />
                  <span>Pengaturan Ujian per Kelas</span>
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  {classConfigModalExam.title} · Atur jadwal, durasi, token/PIN, publikasi nilai, dan visibilitas riwayat masing-masing kelas.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setClassConfigModalExam(null)}
                className="min-h-[36px] px-3 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100"
              >
                Tutup
              </button>
            </div>

            {/* Class Participation Checkboxes */}
            <div>
              <p className="text-xs font-bold text-slate-700 mb-2">Pilih Kelas Peserta Ujian Ini</p>
              <div className="flex flex-wrap gap-2">
                {classes.map((c) => {
                  const checked = modalClassIds.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      className={`px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
                        checked
                          ? 'bg-indigo-50 border-indigo-600 text-indigo-900'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setModalClassIds((prev) =>
                            e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)
                          );
                        }}
                        className="sr-only"
                      />
                      {c.name}
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Per-Class Settings Cards */}
            {modalClassIds.length === 0 ? (
              <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-500">
                Pilih minimal satu kelas peserta di atas untuk mengatur konfigurasi masing-masing kelas.
              </div>
            ) : (
              <div className="space-y-3">
                {modalClassIds.map((cid) => {
                  const cls = classes.find((c) => c.id === cid);
                  if (!cls) return null;
                  const cfg: ClassExamConfigOverride = modalClassConfigs[cid] || {};
                  const isCustom =
                    cfg.enabled === false ||
                    Boolean(cfg.startAt) ||
                    Boolean(cfg.entryDeadlineAt) ||
                    Boolean(cfg.endAt) ||
                    Boolean(cfg.durationMinutes && cfg.durationMinutes > 0) ||
                    (cfg.accessTokenMode && cfg.accessTokenMode !== 'inherit') ||
                    (cfg.publicationPolicy && cfg.publicationPolicy !== 'inherit') ||
                    (cfg.historyVisible && cfg.historyVisible !== 'inherit');

                  const updateClsCfg = (patch: Partial<ClassExamConfigOverride>) => {
                    setModalClassConfigs((prev) => ({
                      ...prev,
                      [cid]: { ...(prev[cid] || {}), ...patch },
                    }));
                  };

                  return (
                    <div
                      key={cid}
                      className={`rounded-2xl border p-4 space-y-3 transition-colors ${
                        cfg.enabled === false
                          ? 'bg-rose-50/40 border-rose-200'
                          : isCustom
                          ? 'bg-indigo-50/40 border-indigo-200'
                          : 'bg-slate-50/60 border-slate-200'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <span className="px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-xs font-bold">
                            {cls.name}
                          </span>
                          <span className="text-xs font-semibold text-slate-700">
                            {cfg.enabled === false
                              ? 'Dinonaktifkan untuk kelas ini'
                              : isCustom
                              ? 'Pengaturan Khusus Aktif'
                              : 'Mengikuti Pengaturan Utama Ujian'}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <label className="inline-flex items-center gap-1.5 font-semibold text-slate-700 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={cfg.enabled !== false}
                              onChange={(e) => updateClsCfg({ enabled: e.target.checked })}
                            />
                            <span>Aktif di Kelas Ini</span>
                          </label>
                          <button
                            type="button"
                            onClick={() =>
                              updateClsCfg({
                                startAt: toLocalDateTimeInput(classConfigModalExam.start_at),
                                entryDeadlineAt: toLocalDateTimeInput(
                                  classConfigModalExam.entry_deadline_at || classConfigModalExam.end_at
                                ),
                                endAt: toLocalDateTimeInput(classConfigModalExam.end_at),
                                durationMinutes: classConfigModalExam.duration_minutes,
                              })
                            }
                            className="px-2.5 py-1 rounded-lg border border-indigo-200 bg-white hover:bg-indigo-50 font-semibold text-indigo-800"
                          >
                            Salin Jadwal Utama
                          </button>
                          {isCustom && (
                            <button
                              type="button"
                              onClick={() =>
                                setModalClassConfigs((prev) => {
                                  const next = { ...prev };
                                  delete next[cid];
                                  return next;
                                })
                              }
                              className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 font-semibold text-slate-600"
                            >
                              Reset ke Utama
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 text-xs">
                        <div>
                          <label className="block font-semibold text-slate-600 mb-1">Mulai Khusus</label>
                          <input
                            type="datetime-local"
                            value={cfg.startAt || ''}
                            onChange={(e) => updateClsCfg({ startAt: e.target.value })}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                          />
                        </div>
                        <div>
                          <label className="block font-semibold text-slate-600 mb-1">Batas Masuk Khusus</label>
                          <input
                            type="datetime-local"
                            value={cfg.entryDeadlineAt || ''}
                            onChange={(e) => updateClsCfg({ entryDeadlineAt: e.target.value })}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                          />
                        </div>
                        <div>
                          <label className="block font-semibold text-slate-600 mb-1">Selesai Khusus</label>
                          <input
                            type="datetime-local"
                            value={cfg.endAt || ''}
                            onChange={(e) => updateClsCfg({ endAt: e.target.value })}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                          />
                        </div>
                        <div>
                          <label className="block font-semibold text-slate-600 mb-1">Durasi (Menit)</label>
                          <input
                            type="number"
                            min={5}
                            max={360}
                            placeholder={`${classConfigModalExam.duration_minutes} (utama)`}
                            value={cfg.durationMinutes || ''}
                            onChange={(e) =>
                              updateClsCfg({
                                durationMinutes: e.target.value ? Number(e.target.value) : undefined,
                              })
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-mono"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                        <div>
                          <label className="block font-semibold text-slate-600 mb-1">PIN / Token Akses Kelas</label>
                          <select
                            value={cfg.accessTokenMode || 'inherit'}
                            onChange={(e) => {
                              const mode = e.target.value as 'inherit' | 'student_pin' | 'exam_token';
                              updateClsCfg({
                                accessTokenMode: mode,
                                accessToken:
                                  mode === 'exam_token'
                                    ? cfg.accessToken || generateRandomExamToken()
                                    : '',
                              });
                            }}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                          >
                            <option value="inherit">Ikuti Pengaturan Utama</option>
                            <option value="student_pin">Gunakan PIN Siswa</option>
                            <option value="exam_token">Token Khusus Kelas Ini</option>
                          </select>
                          {cfg.accessTokenMode === 'exam_token' && (
                            <div className="flex gap-1.5 mt-1.5">
                              <input
                                type="text"
                                required
                                minLength={4}
                                maxLength={32}
                                placeholder="Token (min 4 karakter)"
                                value={cfg.accessToken || ''}
                                onChange={(e) => updateClsCfg({ accessToken: e.target.value })}
                                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-indigo-300 bg-white font-mono"
                              />
                              <button
                                type="button"
                                onClick={() => updateClsCfg({ accessToken: generateRandomExamToken() })}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 font-semibold shrink-0"
                              >
                                Acak
                              </button>
                            </div>
                          )}
                        </div>

                        <div>
                          <label className="block font-semibold text-slate-600 mb-1">Publikasi Nilai Kelas</label>
                          <select
                            value={cfg.publicationPolicy || 'inherit'}
                            onChange={(e) =>
                              updateClsCfg({
                                publicationPolicy: e.target.value as PublicationPolicy | 'inherit',
                              })
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                          >
                            <option value="inherit">Ikuti Pengaturan Utama</option>
                            <option value="hidden">1. Hasil Disembunyikan</option>
                            <option value="view_only">2. Hanya Dapat Dilihat</option>
                            <option value="view_download">3. Lihat &amp; Unduh PDF</option>
                            <option value="view_download_print">4. Lihat, Unduh &amp; Cetak</option>
                          </select>
                        </div>

                        <div>
                          <label className="block font-semibold text-slate-600 mb-1">Riwayat &amp; Hasil Kelas</label>
                          <select
                            value={cfg.historyVisible || 'inherit'}
                            onChange={(e) =>
                              updateClsCfg({
                                historyVisible: e.target.value as 'inherit' | 'visible' | 'hidden',
                              })
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                          >
                            <option value="inherit">Ikuti Pengaturan Utama</option>
                            <option value="visible">Terlihat oleh Kelas Ini</option>
                            <option value="hidden">Disembunyikan untuk Kelas Ini</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setClassConfigModalExam(null)}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={busy}
                className="min-h-[44px] px-5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white text-sm font-semibold disabled:opacity-50"
              >
                {busy ? 'Menyimpan...' : 'Simpan Pengaturan per Kelas'}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmState)}
        title={confirmState?.title || ''}
        message={confirmState?.message || ''}
        confirmLabel={confirmState?.confirmLabel}
        busy={busy}
        onCancel={() => setConfirmState(null)}
        onConfirm={runConfirmAction}
      />
    </div>
  );
};
