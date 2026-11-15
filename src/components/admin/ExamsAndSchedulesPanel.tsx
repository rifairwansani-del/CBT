import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Download,
  Edit3,
  FileSpreadsheet,
  Plus,
  Settings2,
  Trash2,
} from 'lucide-react';
import { apiFetch, withAuthTokenUrl } from '../../lib/api.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import type { PublicationPolicy, ShuffleMode } from '../../types/cbt.ts';

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
  proctoring_enabled: number;
  proctoring_sensitivity: string;
  proctoring_tolerance: number;
  proctoring_retention_days: number;
  allow_camera_stream: number;
  publication_policy: PublicationPolicy;
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

export const ExamsAndSchedulesPanel: React.FC = () => {
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [classes, setClasses] = useState<Array<{ id: string; name: string }>>([]);
  const [subjects, setSubjects] = useState<Array<{ id: string; name: string }>>([]);
  const [banks, setBanks] = useState<Array<{ id: string; name: string; question_count: number; active_question_count?: number }>>([]);
  const [selectedExamIds, setSelectedExamIds] = useState<string[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ExamImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    action: () => Promise<void>;
  } | null>(null);

  const buildDefaultForm = (
    subId = subjects[0]?.id || '',
    bankId = banks[0]?.id || '',
    clsIds = classes.slice(0, 2).map((c) => c.id)
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
    proctoringEnabled: false,
    proctoringSensitivity: 'sedang',
    proctoringTolerance: 4,
    proctoringRetentionDays: 14,
    allowCameraStream: false,
    publicationPolicy: 'view_download_print' as PublicationPolicy,
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
      const [eRes, cRes, sRes, bRes] = await Promise.all([
        apiFetch<{ exams: ExamItem[] }>('/api/admin/exams'),
        apiFetch<{ classes: Array<{ id: string; name: string }> }>('/api/admin/classes'),
        apiFetch<{ subjects: Array<{ id: string; name: string }> }>('/api/admin/subjects'),
        apiFetch<{ banks: Array<{ id: string; name: string; question_count: number; active_question_count?: number }> }>('/api/admin/question-banks'),
      ]);
      setExams(eRes.exams);
      setClasses(cRes.classes);
      setSubjects(sRes.subjects);
      setBanks(bRes.banks);
      setSelectedExamIds((prev) => prev.filter((id) => eRes.exams.some((e) => e.id === id)));
      setForm((prev) => ({
        ...prev,
        subjectId: prev.subjectId || sRes.subjects[0]?.id || '',
        questionBankId: prev.questionBankId || bRes.banks[0]?.id || '',
        classIds: prev.classIds.length > 0 ? prev.classIds : cRes.classes.slice(0, 2).map((c) => c.id),
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
      parsedClasses = JSON.parse(ex.class_ids_json || '[]');
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
      proctoringEnabled: Boolean(ex.proctoring_enabled),
      proctoringSensitivity: ex.proctoring_sensitivity || 'sedang',
      proctoringTolerance: ex.proctoring_tolerance || 4,
      proctoringRetentionDays: ex.proctoring_retention_days || 14,
      allowCameraStream: Boolean(ex.allow_camera_stream),
      publicationPolicy: ex.publication_policy,
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
                    Auto-Lock: {ex.auto_lock_enabled ? `Aktif (maks ${ex.max_violations}x)` : 'Nonaktif'} · Kamera AI: {ex.proctoring_enabled ? 'Aktif' : 'Nonaktif'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
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
                <p className="font-bold text-slate-800">Keamanan &amp; Auto-Lock</p>
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.autoLockEnabled} onChange={(e) => setForm({ ...form, autoLockEnabled: e.target.checked })} /> Aktifkan penguncian otomatis</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.requireFullscreen} onChange={(e) => setForm({ ...form, requireFullscreen: e.target.checked })} /> Catat keluar layar penuh (fullscreen)</label>
                <div className="flex items-center gap-2">
                  <span>Batas kejadian sebelum terkunci:</span>
                  <input type="number" min={1} max={20} value={form.maxViolations} onChange={(e) => setForm({ ...form, maxViolations: Number(e.target.value) })} className="w-16 px-2 py-1 rounded border border-slate-300 font-mono" />
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
              </div>
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
