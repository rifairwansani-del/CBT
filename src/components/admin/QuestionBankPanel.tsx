import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { apiFetch, withAuthTokenUrl } from '../../lib/api.ts';
import { MathRenderer } from '../MathRenderer.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import type { DifficultyLevel, QuestionType } from '../../types/cbt.ts';

interface BankItem {
  id: string;
  name: string;
  subject_id: string;
  subject_name: string;
  subject_code: string;
  description: string;
  question_count: number;
  active_question_count?: number;
}

interface QuestionRow {
  id: string;
  topic: string;
  question_type: QuestionType;
  stem_html: string;
  media_path: string | null;
  options_json: string;
  key_json: string;
  difficulty: DifficultyLevel;
  weight: number | null;
  explanation_html: string | null;
  is_active?: number;
}

interface QuestionImportPreview {
  previewId: string;
  totalRows: number;
  validCount: number;
  errorCount: number;
  warningNote?: string;
  rows: Array<{
    row: number;
    id: string;
    topic: string;
    questionType: QuestionType;
    stemHtml: string;
    valid: boolean;
    errors: string[];
  }>;
  issues: Array<{ row: number; column: string; message: string }>;
}

const DEFAULT_PG_OPTIONS = () => [
  { id: 'a', label: 'A', text: '' },
  { id: 'b', label: 'B', text: '' },
  { id: 'c', label: 'C', text: '' },
  { id: 'd', label: 'D', text: '' },
];

export const QuestionBankPanel: React.FC = () => {
  const [banks, setBanks] = useState<BankItem[]>([]);
  const [subjects, setSubjects] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [selectedBankId, setSelectedBankId] = useState<string>('');
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'active' | 'hidden'>('all');
  const [qSearch, setQSearch] = useState('');
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [importPreview, setImportPreview] = useState<QuestionImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Bank CRUD
  const [newBankName, setNewBankName] = useState('');
  const [newBankSubId, setNewBankSubId] = useState('');
  const [editingBank, setEditingBank] = useState<{
    id: string;
    name: string;
    subjectId: string;
    description: string;
  } | null>(null);

  // Manual Question Editor Modal (create + edit)
  const [showEditor, setShowEditor] = useState(false);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [qType, setQType] = useState<QuestionType>('pg_tunggal');
  const [topic, setTopic] = useState('Aljabar');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('sedang');
  const [weight, setWeight] = useState(2);
  const [qIsActive, setQIsActive] = useState(true);
  const [stemHtml, setStemHtml] = useState('');
  const [mediaPath, setMediaPath] = useState<string | null>(null);
  const [explanationHtml, setExplanationHtml] = useState('');

  // Type-specific option builders
  const [pgOptions, setPgOptions] = useState(DEFAULT_PG_OPTIONS);
  const [pgSingleKey, setPgSingleKey] = useState('a');
  const [pgMultiKeys, setPgMultiKeys] = useState<string[]>(['a']);
  const [bsStatements, setBsStatements] = useState([
    { id: 's1', text: '', answer: 'B' as 'B' | 'S' },
    { id: 's2', text: '', answer: 'S' as 'B' | 'S' },
  ]);
  const [matchPairs, setMatchPairs] = useState([
    { leftId: 'l1', leftText: '', rightId: 'r1', rightText: '' },
    { leftId: 'l2', leftText: '', rightId: 'r2', rightText: '' },
  ]);

  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    action: () => Promise<void>;
  } | null>(null);

  const loadBanks = async () => {
    try {
      const [bRes, sRes] = await Promise.all([
        apiFetch<{ banks: BankItem[] }>('/api/admin/question-banks'),
        apiFetch<{ subjects: Array<{ id: string; code: string; name: string }> }>('/api/admin/subjects'),
      ]);
      setBanks(bRes.banks);
      setSubjects(sRes.subjects);
      if ((!selectedBankId || !bRes.banks.some((b) => b.id === selectedBankId)) && bRes.banks[0]) {
        setSelectedBankId(bRes.banks[0].id);
      } else if (bRes.banks.length === 0) {
        setSelectedBankId('');
        setQuestions([]);
      }
      if (!newBankSubId && sRes.subjects[0]) setNewBankSubId(sRes.subjects[0].id);
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal memuat bank soal.' });
    }
  };

  const loadQuestions = async (bankId: string) => {
    if (!bankId) return;
    try {
      const res = await apiFetch<{ questions: QuestionRow[] }>(`/api/admin/question-banks/${bankId}/questions`);
      setQuestions(res.questions);
      setSelectedQuestionIds((prev) => prev.filter((id) => res.questions.some((q) => q.id === id)));
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal memuat daftar soal.' });
    }
  };

  useEffect(() => {
    loadBanks();
  }, []);

  useEffect(() => {
    setSelectedQuestionIds([]);
    if (selectedBankId) loadQuestions(selectedBankId);
  }, [selectedBankId]);

  const selectedBank = banks.find((b) => b.id === selectedBankId);
  const activeCount = questions.filter((q) => q.is_active !== 0).length;
  const hiddenCount = questions.length - activeCount;

  const filteredQuestions = questions.filter((q) => {
    const isVisible = q.is_active !== 0;
    if (visibilityFilter === 'active' && !isVisible) return false;
    if (visibilityFilter === 'hidden' && isVisible) return false;
    const term = qSearch.trim().toLowerCase();
    if (!term) return true;
    return (
      q.id.toLowerCase().includes(term) ||
      (q.topic || '').toLowerCase().includes(term) ||
      q.stem_html.toLowerCase().includes(term)
    );
  });

  const allQuestionsSelected =
    filteredQuestions.length > 0 && filteredQuestions.every((q) => selectedQuestionIds.includes(q.id));

  const openCreateEditor = () => {
    setEditingQuestionId(null);
    setQType('pg_tunggal');
    setTopic('Aljabar');
    setDifficulty('sedang');
    setWeight(2);
    setQIsActive(true);
    setStemHtml('');
    setMediaPath(null);
    setExplanationHtml('');
    setPgOptions(DEFAULT_PG_OPTIONS());
    setPgSingleKey('a');
    setPgMultiKeys(['a']);
    setBsStatements([
      { id: 's1', text: '', answer: 'B' },
      { id: 's2', text: '', answer: 'S' },
    ]);
    setMatchPairs([
      { leftId: 'l1', leftText: '', rightId: 'r1', rightText: '' },
      { leftId: 'l2', leftText: '', rightId: 'r2', rightText: '' },
    ]);
    setShowEditor(true);
  };

  const openEditEditor = (q: QuestionRow) => {
    setEditingQuestionId(q.id);
    setQType(q.question_type);
    setTopic(q.topic || 'Umum');
    setDifficulty(q.difficulty || 'sedang');
    setWeight(q.weight ?? (q.question_type === 'pg_tunggal' ? 2 : 4));
    setQIsActive(q.is_active !== 0);
    setStemHtml(q.stem_html);
    setMediaPath(q.media_path);
    setExplanationHtml(q.explanation_html || '');

    try {
      const opts = JSON.parse(q.options_json);
      const key = JSON.parse(q.key_json);

      if (q.question_type === 'pg_tunggal' && Array.isArray(opts)) {
        const mapped = opts.map((o: { id?: string; label?: string; text?: string }, i: number) => ({
          id: o.id || String.fromCharCode(97 + i),
          label: o.label || String.fromCharCode(65 + i),
          text: o.text || '',
        }));
        setPgOptions(mapped.length > 0 ? mapped : DEFAULT_PG_OPTIONS());
        setPgSingleKey(typeof key === 'string' ? key : mapped[0]?.id || 'a');
      } else if (q.question_type === 'pg_kompleks' && Array.isArray(opts)) {
        const mapped = opts.map((o: { id?: string; label?: string; text?: string }, i: number) => ({
          id: o.id || String.fromCharCode(97 + i),
          label: o.label || String(i + 1),
          text: o.text || '',
        }));
        setPgOptions(mapped.length > 0 ? mapped : DEFAULT_PG_OPTIONS());
        setPgMultiKeys(Array.isArray(key) ? key : []);
      } else if (q.question_type === 'benar_salah' && Array.isArray(opts)) {
        const keyMap = (key && typeof key === 'object' ? key : {}) as Record<string, 'B' | 'S'>;
        setBsStatements(
          opts.map((o: { id?: string; text?: string }, i: number) => {
            const id = o.id || `s${i + 1}`;
            return { id, text: o.text || '', answer: keyMap[id] === 'S' ? 'S' : 'B' };
          })
        );
      } else if (q.question_type === 'menjodohkan' && opts && typeof opts === 'object') {
        const leftList = Array.isArray(opts.left) ? (opts.left as Array<{ id: string; text: string }>) : [];
        const rightList = Array.isArray(opts.right) ? (opts.right as Array<{ id: string; text: string }>) : [];
        const rightMap = new Map(rightList.map((r) => [r.id, r]));
        const keyMap = (key && typeof key === 'object' ? key : {}) as Record<string, string>;
        setMatchPairs(
          leftList.map((l, idx) => {
            const matchedRightId = keyMap[l.id] || rightList[idx]?.id || `r${idx + 1}`;
            const rightObj = rightMap.get(matchedRightId) || rightList[idx];
            return {
              leftId: l.id,
              leftText: l.text || '',
              rightId: rightObj?.id || matchedRightId,
              rightText: rightObj?.text || '',
            };
          })
        );
      }
    } catch {
      // Fallback to default builders if JSON malformed
    }
    setShowEditor(true);
  };

  const handleSaveManualQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBank) return;
    let options: unknown = [];
    let correctKey: unknown = '';

    if (qType === 'pg_tunggal') {
      options = pgOptions.map((o, i) => ({ ...o, label: String.fromCharCode(65 + i) }));
      correctKey = pgSingleKey;
    } else if (qType === 'pg_kompleks') {
      options = pgOptions.map((o, i) => ({ ...o, label: String(i + 1) }));
      correctKey = pgMultiKeys;
    } else if (qType === 'benar_salah') {
      options = bsStatements.map((s) => ({ id: s.id, text: s.text }));
      correctKey = Object.fromEntries(bsStatements.map((s) => [s.id, s.answer]));
    } else if (qType === 'menjodohkan') {
      options = {
        left: matchPairs.map((p) => ({ id: p.leftId, text: p.leftText })),
        right: matchPairs.map((p) => ({ id: p.rightId, text: p.rightText })),
      };
      correctKey = Object.fromEntries(matchPairs.map((p) => [p.leftId, p.rightId]));
    }

    setBusy(true);
    setBanner(null);
    try {
      if (editingQuestionId) {
        await apiFetch(`/api/admin/questions/${editingQuestionId}`, {
          method: 'PUT',
          body: JSON.stringify({
            topic,
            questionType: qType,
            stemHtml,
            mediaPath,
            options,
            correctKey,
            difficulty,
            weight,
            explanationHtml,
            isActive: qIsActive,
          }),
        });
        setBanner({ type: 'ok', text: 'Butir soal berhasil diperbarui.' });
      } else {
        await apiFetch('/api/admin/questions', {
          method: 'POST',
          body: JSON.stringify({
            bankId: selectedBank.id,
            subjectId: selectedBank.subject_id,
            topic,
            questionType: qType,
            stemHtml,
            mediaPath,
            options,
            correctKey,
            difficulty,
            weight,
            explanationHtml,
            isActive: qIsActive,
          }),
        });
        setBanner({ type: 'ok', text: 'Soal baru berhasil disimpan ke bank soal.' });
      }
      setShowEditor(false);
      setEditingQuestionId(null);
      await loadQuestions(selectedBank.id);
      await loadBanks();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal menyimpan soal.' });
    } finally {
      setBusy(false);
    }
  };

  const handleToggleQuestionVisibility = async (q: QuestionRow, targetActive: boolean) => {
    if ((q.is_active !== 0) === targetActive) return;
    setTogglingId(q.id);
    setBanner(null);
    try {
      await apiFetch(`/api/admin/questions/${q.id}/visibility`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: targetActive }),
      });
      setQuestions((prev) =>
        prev.map((item) => (item.id === q.id ? { ...item, is_active: targetActive ? 1 : 0 } : item))
      );
      await loadBanks();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal mengubah status tampil soal.' });
    } finally {
      setTogglingId(null);
    }
  };

  const handleBulkVisibility = async (isActive: boolean) => {
    if (selectedQuestionIds.length === 0) return;
    setBusy(true);
    setBanner(null);
    try {
      const res = await apiFetch<{ updatedCount: number }>('/api/admin/questions/bulk-visibility', {
        method: 'POST',
        body: JSON.stringify({ ids: selectedQuestionIds, isActive }),
      });
      setBanner({
        type: 'ok',
        text: `${res.updatedCount} soal berhasil diatur menjadi ${isActive ? 'Ditampilkan (Ya)' : 'Disembunyikan (Tidak)'}.`,
      });
      setSelectedQuestionIds([]);
      await loadQuestions(selectedBankId);
      await loadBanks();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal mengubah visibilitas soal terpilih.' });
    } finally {
      setBusy(false);
    }
  };

  const handleFileImportPreview = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedBankId) return;
    setBanner(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const preview = await apiFetch<QuestionImportPreview>(`/api/admin/question-banks/${selectedBankId}/import-preview`, {
        method: 'POST',
        body: fd,
      });
      setImportPreview(preview);
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal memproses file soal.' });
    } finally {
      setBusy(false);
    }
  };

  const handleCommitImport = async () => {
    if (!importPreview || !selectedBankId) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ importedCount: number }>(`/api/admin/question-banks/${selectedBankId}/import-commit`, {
        method: 'POST',
        body: JSON.stringify({ previewId: importPreview.previewId }),
      });
      setImportPreview(null);
      setBanner({ type: 'ok', text: `${res.importedCount} soal valid berhasil diimpor.` });
      await loadQuestions(selectedBankId);
      await loadBanks();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal menyimpan impor soal.' });
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

  const questionExportUrl = selectedBankId
    ? withAuthTokenUrl(
        `/api/admin/question-banks/${selectedBankId}/questions/export.xlsx${
          selectedQuestionIds.length > 0 ? `?ids=${encodeURIComponent(selectedQuestionIds.join(','))}` : ''
        }`
      )
    : '#';

  return (
    <div className="space-y-6">
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

      {/* Bank Selector, Edit/Delete Bank & Create Bank */}
      <div className="bg-white border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="flex-1 space-y-1.5">
          <label className="text-xs font-semibold text-slate-600">Pilih Bank Soal Aktif</label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedBankId}
              onChange={(e) => setSelectedBankId(e.target.value)}
              className="flex-1 min-w-[220px] min-h-[44px] px-3 rounded-xl border border-slate-300 bg-white text-base sm:text-sm font-semibold text-slate-900"
            >
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  [{b.subject_code}] {b.name} ({b.active_question_count ?? b.question_count} tampil / {b.question_count} total)
                </option>
              ))}
            </select>
            {selectedBank && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setEditingBank({
                      id: selectedBank.id,
                      name: selectedBank.name,
                      subjectId: selectedBank.subject_id,
                      description: selectedBank.description || '',
                    })
                  }
                  className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5"
                  title="Edit bank soal"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Edit Bank</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setConfirmState({
                      title: 'Hapus Bank Soal',
                      message: `Hapus bank soal "${selectedBank.name}" beserta seluruh ${selectedBank.question_count} butir soalnya? Bank soal yang dipakai ujian tidak bisa dihapus.`,
                      confirmLabel: 'Hapus Bank',
                      action: async () => {
                        await apiFetch(`/api/admin/question-banks/${selectedBank.id}`, { method: 'DELETE' });
                        setBanner({ type: 'ok', text: `Bank soal "${selectedBank.name}" berhasil dihapus.` });
                        setSelectedBankId('');
                        await loadBanks();
                      },
                    })
                  }
                  className="min-h-[44px] px-3.5 rounded-xl border border-red-200 hover:bg-red-50 text-xs font-semibold text-red-700 inline-flex items-center gap-1.5"
                  title="Hapus bank soal"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Hapus Bank</span>
                </button>
              </>
            )}
          </div>
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newBankName.trim()) return;
            try {
              await apiFetch('/api/admin/question-banks', {
                method: 'POST',
                body: JSON.stringify({ name: newBankName, subjectId: newBankSubId }),
              });
              setNewBankName('');
              setBanner({ type: 'ok', text: 'Bank soal baru berhasil dibuat.' });
              await loadBanks();
            } catch (err) {
              setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal membuat bank soal.' });
            }
          }}
          className="flex flex-col sm:flex-row sm:items-end gap-2"
        >
          <div className="flex-1">
            <label className="block text-xs font-semibold text-slate-600 mb-1">Buat Bank Soal Baru</label>
            <input
              type="text"
              placeholder="Nama bank soal..."
              value={newBankName}
              onChange={(e) => setNewBankName(e.target.value)}
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 text-base sm:text-sm"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={newBankSubId}
              onChange={(e) => setNewBankSubId(e.target.value)}
              className="flex-1 sm:flex-none min-h-[44px] px-3 rounded-xl border border-slate-300 bg-white text-base sm:text-sm"
            >
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.code} - {s.name}</option>
              ))}
            </select>
            <button type="submit" className="min-h-[44px] px-4 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-semibold shrink-0">
              + Bank
            </button>
          </div>
        </form>
      </div>

      {/* Actions Toolbar + Search & Visibility Filter */}
      <div className="bg-white border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-2xl p-4 space-y-3.5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-display font-bold text-slate-900">
              Daftar Butir Soal
            </p>
            <p className="text-xs text-slate-500 tabular-nums">
              Total {questions.length} butir · Ditampilkan (Ya): <span className="font-semibold text-emerald-700">{activeCount}</span> · Disembunyikan (Tidak): <span className="font-semibold text-amber-700">{hiddenCount}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={withAuthTokenUrl('/api/admin/templates/questions.xlsx')}
              className="min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5"
            >
              <Download className="w-4 h-4" />
              <span>Template Excel</span>
            </a>
            <label className="min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer">
              <FileSpreadsheet className="w-4 h-4" />
              <span>Impor Excel</span>
              <input type="file" accept=".xlsx,.xls" onChange={handleFileImportPreview} className="hidden" />
            </label>
            <label className="min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer">
              <FileText className="w-4 h-4" />
              <span>Impor Word</span>
              <input type="file" accept=".docx" onChange={handleFileImportPreview} className="hidden" />
            </label>
            {selectedBankId && (
              <a
                href={questionExportUrl}
                className="min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5"
              >
                <Download className="w-4 h-4" />
                <span>{selectedQuestionIds.length > 0 ? `Ekspor (${selectedQuestionIds.length})` : 'Ekspor Excel'}</span>
              </a>
            )}
            <button
              type="button"
              disabled={!selectedBank}
              onClick={openCreateEditor}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-blue-900 hover:bg-blue-800 text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>Buat Soal</span>
            </button>
          </div>
        </div>

        {/* Search & Filter Row */}
        <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {filteredQuestions.length > 0 && (
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer min-h-[38px] px-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <input
                  type="checkbox"
                  checked={allQuestionsSelected}
                  onChange={(e) => {
                    const visibleIds = filteredQuestions.map((q) => q.id);
                    if (e.target.checked) {
                      setSelectedQuestionIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
                    } else {
                      setSelectedQuestionIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
                    }
                  }}
                  className="w-4 h-4 rounded border-slate-300"
                />
                <span>Pilih Semua</span>
              </label>
            )}

            <div className="inline-flex p-1 bg-slate-100 rounded-xl overflow-x-auto no-scrollbar max-w-full">
              {[
                { id: 'all', label: `Semua (${questions.length})` },
                { id: 'active', label: `Ditampilkan (${activeCount})` },
                { id: 'hidden', label: `Disembunyikan (${hiddenCount})` },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setVisibilityFilter(tab.id as 'all' | 'active' | 'hidden')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    visibilityFilter === tab.id ? 'bg-white text-blue-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={qSearch}
              onChange={(e) => setQSearch(e.target.value)}
              placeholder="Cari ID, topik, atau isi soal..."
              className="w-full min-h-[40px] pl-9 pr-3 rounded-xl border border-slate-300 text-base sm:text-xs"
            />
          </div>
        </div>
      </div>

      {/* Selected Questions Bulk Bar */}
      {selectedQuestionIds.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs sm:text-sm font-semibold text-blue-900">
            {selectedQuestionIds.length} butir soal dipilih
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => handleBulkVisibility(true)}
              className="min-h-[40px] px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Tampilkan (Ya)</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => handleBulkVisibility(false)}
              className="min-h-[40px] px-3 py-1.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <EyeOff className="w-3.5 h-3.5" />
              <span>Sembunyikan (Tidak)</span>
            </button>
            <a
              href={questionExportUrl}
              className="min-h-[40px] px-3 py-1.5 rounded-xl bg-white border border-blue-200 text-xs font-semibold text-blue-900 inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Ekspor Terpilih</span>
            </a>
            <button
              type="button"
              onClick={() =>
                setConfirmState({
                  title: 'Hapus Soal Terpilih',
                  message: `Hapus ${selectedQuestionIds.length} butir soal terpilih dari bank soal ini?`,
                  confirmLabel: `Hapus ${selectedQuestionIds.length} Soal`,
                  action: async () => {
                    const res = await apiFetch<{ deletedCount: number }>('/api/admin/questions/bulk-delete', {
                      method: 'POST',
                      body: JSON.stringify({ ids: selectedQuestionIds }),
                    });
                    setSelectedQuestionIds([]);
                    setBanner({ type: 'ok', text: `${res.deletedCount} butir soal berhasil dihapus.` });
                    await loadQuestions(selectedBankId);
                    await loadBanks();
                  },
                })
              }
              className="min-h-[40px] px-3 py-1.5 rounded-xl bg-red-700 hover:bg-red-800 text-white text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Hapus Terpilih</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedQuestionIds([])}
              className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700"
            >
              Bersihkan
            </button>
          </div>
        </div>
      )}

      {/* Import Preview */}
      {importPreview && (
        <div className="bg-white border border-blue-200 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display font-bold text-slate-900">Pratinjau Impor Bank Soal</h3>
              <p className="text-xs text-slate-600 mt-0.5">
                Total {importPreview.totalRows} soal · Valid: {importPreview.validCount} · Bermasalah: {importPreview.errorCount}
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
                onClick={handleCommitImport}
                className="px-4 py-2 rounded-xl bg-blue-900 text-white text-xs font-semibold disabled:opacity-50"
              >
                Simpan {importPreview.validCount} Soal Valid
              </button>
            </div>
          </div>

          {importPreview.warningNote && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
              {importPreview.warningNote}
            </div>
          )}

          {importPreview.issues.length > 0 && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 max-h-40 overflow-y-auto space-y-1">
              {importPreview.issues.map((iss, i) => (
                <p key={i}>Baris {iss.row} (Kolom {iss.column}): {iss.message}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Question Cards List */}
      <div className="space-y-3">
        {filteredQuestions.length === 0 ? (
          <div className="bg-white border border-slate-200/80 rounded-2xl p-8 text-center text-sm text-slate-500">
            {questions.length === 0
              ? 'Belum ada butir soal di bank ini. Klik "Buat Soal" atau impor dari Excel/Word.'
              : 'Tidak ada soal yang cocok dengan filter atau pencarian Anda.'}
          </div>
        ) : (
          filteredQuestions.map((q, idx) => {
            const isChecked = selectedQuestionIds.includes(q.id);
            const isVisible = q.is_active !== 0;
            const isToggling = togglingId === q.id;
            return (
              <article
                key={q.id}
                className={`border rounded-2xl p-4 sm:p-5 space-y-3 transition-colors ${
                  isChecked
                    ? 'border-blue-400 bg-blue-50/20'
                    : isVisible
                    ? 'bg-white border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)]'
                    : 'bg-slate-50/80 border-slate-200/80'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs text-slate-500">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <input
                      type="checkbox"
                      aria-label={`Pilih soal ${idx + 1}`}
                      checked={isChecked}
                      onChange={(e) =>
                        setSelectedQuestionIds((prev) =>
                          e.target.checked ? [...prev, q.id] : prev.filter((id) => id !== q.id)
                        )
                      }
                      className="w-4 h-4 rounded border-slate-300"
                    />
                    <span className="font-mono font-bold text-slate-900">#{idx + 1} ({q.id})</span>
                    <span>·</span>
                    <span className="font-semibold text-blue-900">{q.question_type}</span>
                    <span>·</span>
                    <span>{q.topic}</span>
                    <span>·</span>
                    <span className="capitalize">{q.difficulty}</span>
                    <span>·</span>
                    <span className="font-mono">Bobot {q.weight ?? (q.question_type === 'pg_tunggal' ? 2 : 4)}</span>
                    <span>·</span>
                    <span className={`font-semibold inline-flex items-center gap-1 ${isVisible ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {isVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      {isVisible ? 'Ditampilkan' : 'Disembunyikan'}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* Quick Ya / Tidak Segmented Switch */}
                    <div
                      role="group"
                      aria-label={`Tampilkan soal ${q.id}`}
                      className="inline-flex items-center p-0.5 rounded-xl bg-slate-100 border border-slate-200/80"
                    >
                      <button
                        type="button"
                        disabled={isToggling}
                        onClick={() => handleToggleQuestionVisibility(q, true)}
                        className={`min-h-[34px] px-2.5 rounded-lg text-xs font-semibold transition-colors ${
                          isVisible
                            ? 'bg-emerald-700 text-white shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Ya
                      </button>
                      <button
                        type="button"
                        disabled={isToggling}
                        onClick={() => handleToggleQuestionVisibility(q, false)}
                        className={`min-h-[34px] px-2.5 rounded-lg text-xs font-semibold transition-colors ${
                          !isVisible
                            ? 'bg-amber-700 text-white shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Tidak
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => openEditEditor(q)}
                      className="min-h-[38px] px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1"
                      title="Edit soal"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmState({
                          title: 'Hapus Butir Soal',
                          message: `Hapus soal #${idx + 1} (${q.id}) dari bank soal ini?`,
                          confirmLabel: 'Hapus Soal',
                          action: async () => {
                            await apiFetch(`/api/admin/questions/${q.id}`, { method: 'DELETE' });
                            setBanner({ type: 'ok', text: 'Butir soal berhasil dihapus.' });
                            await loadQuestions(selectedBankId);
                            await loadBanks();
                          },
                        })
                      }
                      className="min-h-[38px] px-3 rounded-xl border border-red-200 bg-white hover:bg-red-50 text-red-700 inline-flex items-center gap-1"
                      title="Hapus soal"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Hapus</span>
                    </button>
                  </div>
                </div>

                <div className={`text-sm text-slate-900 leading-relaxed ${!isVisible ? 'opacity-70' : ''}`}>
                  <MathRenderer content={q.stem_html} />
                </div>

                {q.media_path && (
                  <img src={withAuthTokenUrl(q.media_path)} alt="Media soal" className="max-h-40 rounded-lg border border-slate-200" />
                )}

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs space-y-1">
                  <p className="font-semibold text-slate-700">Kunci Jawaban: <span className="font-mono text-emerald-700">{q.key_json}</span></p>
                  {q.explanation_html && (
                    <p className="text-slate-600">
                      Pembahasan: <MathRenderer content={q.explanation_html} />
                    </p>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>

      {/* Edit Bank Modal (Bottom Sheet on Mobile) */}
      {editingBank && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await apiFetch(`/api/admin/question-banks/${editingBank.id}`, {
                  method: 'PUT',
                  body: JSON.stringify({
                    name: editingBank.name,
                    subjectId: editingBank.subjectId,
                    description: editingBank.description,
                  }),
                });
                setEditingBank(null);
                setBanner({ type: 'ok', text: 'Bank soal berhasil diperbarui.' });
                await loadBanks();
              } catch (err) {
                setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal memperbarui bank soal.' });
              } finally {
                setBusy(false);
              }
            }}
            className="bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 max-h-[92dvh] overflow-y-auto pb-safe"
          >
            <div className="w-10 h-1 rounded-full bg-slate-300 mx-auto sm:hidden" />
            <h3 className="text-lg font-display font-bold text-slate-900">Edit Bank Soal</h3>
            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Bank Soal</label>
                <input
                  type="text"
                  required
                  value={editingBank.name}
                  onChange={(e) => setEditingBank({ ...editingBank, name: e.target.value })}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-base sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Mata Pelajaran</label>
                <select
                  value={editingBank.subjectId}
                  onChange={(e) => setEditingBank({ ...editingBank, subjectId: e.target.value })}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm"
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>{s.code} - {s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Deskripsi (Opsional)</label>
                <input
                  type="text"
                  value={editingBank.description}
                  onChange={(e) => setEditingBank({ ...editingBank, description: e.target.value })}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-base sm:text-sm"
                />
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditingBank(null)} className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium">
                Batal
              </button>
              <button type="submit" disabled={busy} className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-900 text-white text-sm font-semibold disabled:opacity-50">
                Simpan Perubahan
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Manual Question Editor Modal (Create & Edit, Mobile Bottom Sheet) */}
      {showEditor && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form onSubmit={handleSaveManualQuestion} className="bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl max-w-2xl w-full p-5 sm:p-6 space-y-4 max-h-[92dvh] overflow-y-auto pb-safe">
            <div className="w-10 h-1 rounded-full bg-slate-300 mx-auto sm:hidden" />
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-display font-bold text-slate-900">
                {editingQuestionId ? `Edit Butir Soal (${editingQuestionId})` : 'Buat Soal Baru'}
              </h3>
              <button type="button" onClick={() => setShowEditor(false)} className="min-h-[38px] px-3 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100">Tutup</button>
            </div>

            {/* Visibility Switch: Tampilkan Soal di Ujian (Ya / Tidak) */}
            <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-slate-900">Tampilkan Soal Ini di Ujian?</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Jika <strong>Tidak</strong>, soal tetap tersimpan di bank soal tetapi tidak akan masuk ke paket ujian siswa.
                </p>
              </div>
              <div className="inline-flex p-1 rounded-xl bg-slate-200/80 shrink-0 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setQIsActive(true)}
                  className={`min-h-[38px] px-4 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    qIsActive ? 'bg-emerald-700 text-white shadow-xs' : 'text-slate-600'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Ya</span>
                </button>
                <button
                  type="button"
                  onClick={() => setQIsActive(false)}
                  className={`min-h-[38px] px-4 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    !qIsActive ? 'bg-amber-700 text-white shadow-xs' : 'text-slate-600'
                  }`}
                >
                  <EyeOff className="w-3.5 h-3.5" />
                  <span>Tidak</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Tipe Soal</label>
                <select
                  value={qType}
                  onChange={(e) => {
                    const nextType = e.target.value as QuestionType;
                    setQType(nextType);
                    setWeight(nextType === 'pg_tunggal' ? 2 : 4);
                  }}
                  className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm"
                >
                  <option value="pg_tunggal">PG Tunggal</option>
                  <option value="pg_kompleks">PG Kompleks (Parsial)</option>
                  <option value="benar_salah">Benar - Salah</option>
                  <option value="menjodohkan">Menjodohkan</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Materi / Topik</label>
                <input type="text" required value={topic} onChange={(e) => setTopic(e.target.value)} className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-slate-300 text-base sm:text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Kesulitan</label>
                  <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as DifficultyLevel)} className="w-full min-h-[42px] px-2 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm">
                    <option value="mudah">Mudah</option>
                    <option value="sedang">Sedang</option>
                    <option value="sulit">Sulit</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Bobot</label>
                  <input type="number" min={1} max={20} value={weight} onChange={(e) => setWeight(Number(e.target.value))} className="w-full min-h-[42px] px-2 py-2 rounded-xl border border-slate-300 text-base sm:text-sm font-mono" />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Pertanyaan (Mendukung rumus KaTeX seperti $x^2 + y^2 = r^2$)
              </label>
              <textarea
                rows={3}
                required
                value={stemHtml}
                onChange={(e) => setStemHtml(e.target.value)}
                placeholder="Tulis pertanyaan di sini..."
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm"
              />
              {stemHtml && (
                <div className="mt-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                  <span className="text-slate-400 block mb-1">Pratinjau Rumus:</span>
                  <MathRenderer content={stemHtml} />
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer">
                <ImageIcon className="w-4 h-4" />
                <span>{mediaPath ? 'Ganti Gambar Soal' : 'Unggah Gambar Soal'}</span>
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    try {
                      const fd = new FormData();
                      fd.append('media', f);
                      const res = await apiFetch<{ mediaPath: string }>('/api/admin/questions/media', { method: 'POST', body: fd });
                      setMediaPath(res.mediaPath);
                    } catch (err) {
                      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal mengunggah gambar.' });
                    }
                  }}
                  className="hidden"
                />
              </label>
              {mediaPath && (
                <>
                  <span className="text-xs text-emerald-700">Gambar terpasang ({mediaPath})</span>
                  <button
                    type="button"
                    onClick={() => setMediaPath(null)}
                    className="text-xs font-semibold text-red-700 hover:underline"
                  >
                    Hapus Gambar
                  </button>
                </>
              )}
            </div>

            {/* Dynamic Options Builder */}
            {(qType === 'pg_tunggal' || qType === 'pg_kompleks') && (
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Opsi Jawaban &amp; Kunci ({qType === 'pg_tunggal' ? 'Pilih 1 benar' : 'Centang beberapa benar'})
                </label>
                {pgOptions.map((opt, idx) => (
                  <div key={opt.id} className="flex items-center gap-2">
                    {qType === 'pg_tunggal' ? (
                      <input type="radio" name="pgKey" checked={pgSingleKey === opt.id} onChange={() => setPgSingleKey(opt.id)} />
                    ) : (
                      <input
                        type="checkbox"
                        checked={pgMultiKeys.includes(opt.id)}
                        onChange={(e) => {
                          setPgMultiKeys((prev) => e.target.checked ? [...prev, opt.id] : prev.filter((x) => x !== opt.id));
                        }}
                      />
                    )}
                    <span className="font-mono text-xs font-bold w-5">{opt.label}.</span>
                    <input
                      type="text"
                      required
                      value={opt.text}
                      onChange={(e) => {
                        const copy = [...pgOptions];
                        copy[idx].text = e.target.value;
                        setPgOptions(copy);
                      }}
                      placeholder={`Teks pilihan ${opt.label}`}
                      className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
                    />
                  </div>
                ))}
                {pgOptions.length < 5 && (
                  <button
                    type="button"
                    onClick={() => {
                      const nextIdx = pgOptions.length;
                      setPgOptions((prev) => [
                        ...prev,
                        {
                          id: String.fromCharCode(97 + nextIdx),
                          label: qType === 'pg_kompleks' ? String(nextIdx + 1) : String.fromCharCode(65 + nextIdx),
                          text: '',
                        },
                      ]);
                    }}
                    className="text-xs font-semibold text-blue-900"
                  >
                    + Tambah Opsi E
                  </button>
                )}
              </div>
            )}

            {qType === 'benar_salah' && (
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700">Pernyataan &amp; Kunci Benar/Salah</label>
                {bsStatements.map((st, idx) => (
                  <div key={st.id} className="flex items-center gap-2">
                    <input
                      type="text"
                      required
                      value={st.text}
                      onChange={(e) => {
                        const copy = [...bsStatements];
                        copy[idx].text = e.target.value;
                        setBsStatements(copy);
                      }}
                      placeholder={`Pernyataan ${idx + 1}`}
                      className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
                    />
                    <select
                      value={st.answer}
                      onChange={(e) => {
                        const copy = [...bsStatements];
                        copy[idx].answer = e.target.value as 'B' | 'S';
                        setBsStatements(copy);
                      }}
                      className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm"
                    >
                      <option value="B">Benar</option>
                      <option value="S">Salah</option>
                    </select>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setBsStatements((p) => [...p, { id: `s${p.length + 1}`, text: '', answer: 'B' }])}
                  className="text-xs font-semibold text-blue-900"
                >
                  + Tambah Pernyataan
                </button>
              </div>
            )}

            {qType === 'menjodohkan' && (
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700">Pasangan Kolom Kiri &amp; Kanan (Otomatis Terkunci Berpasangan)</label>
                {matchPairs.map((pair, idx) => (
                  <div key={pair.leftId} className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      required
                      value={pair.leftText}
                      onChange={(e) => {
                        const copy = [...matchPairs];
                        copy[idx].leftText = e.target.value;
                        setMatchPairs(copy);
                      }}
                      placeholder={`Item kiri ${idx + 1}`}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
                    />
                    <input
                      type="text"
                      required
                      value={pair.rightText}
                      onChange={(e) => {
                        const copy = [...matchPairs];
                        copy[idx].rightText = e.target.value;
                        setMatchPairs(copy);
                      }}
                      placeholder={`Pasangan kanan ${idx + 1}`}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setMatchPairs((p) => [...p, { leftId: `l${p.length + 1}`, leftText: '', rightId: `r${p.length + 1}`, rightText: '' }])}
                  className="text-xs font-semibold text-blue-900"
                >
                  + Tambah Pasangan
                </button>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Pembahasan (Opsional)</label>
              <input
                type="text"
                value={explanationHtml}
                onChange={(e) => setExplanationHtml(e.target.value)}
                placeholder="Pembahasan singkat untuk arsip pendidik..."
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm"
              />
            </div>

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowEditor(false)} className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium">Batal</button>
              <button type="submit" disabled={busy} className="min-h-[44px] px-5 py-2 rounded-xl bg-blue-900 text-white text-sm font-semibold disabled:opacity-50">
                {editingQuestionId ? 'Simpan Perubahan' : 'Simpan Soal'}
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
