import React, { useEffect, useState } from 'react';
import { BarChart3, Download, FileText, AlertTriangle } from 'lucide-react';
import { apiFetch, withAuthTokenUrl } from '../../lib/api.ts';
import { generateClassReportPDF, generateStudentRaporPDF } from '../../lib/pdf.ts';
import type { InstitutionBranding } from '../../types/cbt.ts';

interface AnalyticsPayload {
  exam: {
    id: string;
    title: string;
    exam_type: string;
    subject_name: string;
    passing_score: number;
  };
  summary: {
    participantCount: number;
    highest: number;
    lowest: number;
    average: number;
    median: number;
    passedCount: number;
    passRate: number;
    passingScore: number;
  };
  distribution: Array<{ range: string; count: number }>;
  byClass: Array<{
    classId: string;
    className: string;
    participantCount: number;
    average: number;
    highest: number;
    lowest: number;
    passRate: number;
  }>;
  studentScores: Array<{
    id: string;
    student_id: string;
    nis: string;
    nisn?: string;
    full_name: string;
    birth_place?: string;
    birth_date?: string;
    gender?: string;
    email?: string;
    photo_link?: string;
    class_name: string;
    raw_points: number;
    max_points: number;
    final_score: number;
    correct_count: number;
    partial_count: number;
    wrong_count: number;
    blank_count: number;
    passed: number;
    graded_at: string;
  }>;
}

interface ItemAnalysisPayload {
  totalSessions: number;
  items: Array<{
    questionId: string;
    topic: string;
    questionType: string;
    authorDifficulty: string;
    empiricalDifficulty: string;
    sampleSize: number;
    lowSampleWarning: boolean;
    correctCount: number;
    partialCount: number;
    wrongCount: number;
    blankCount: number;
    avgPartialScore: number;
    maxPoints: number;
    correctPercent: number;
    discriminationIndex: number | null;
    optionDistribution: Record<string, number>;
  }>;
}

export const AnalyticsAndReportsPanel: React.FC<{ branding: InstitutionBranding }> = ({ branding }) => {
  const [exams, setExams] = useState<Array<{ id: string; title: string; exam_type: string; subject_name: string }>>([]);
  const [selectedExamId, setSelectedExamId] = useState('');
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null);
  const [itemAnalysis, setItemAnalysis] = useState<ItemAnalysisPayload | null>(null);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [subTab, setSubTab] = useState<'overview' | 'items'>('overview');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ exams?: typeof exams }>('/api/admin/exams')
      .then((res) => {
        setError(null);
        const nextExams = Array.isArray(res?.exams) ? res.exams : [];
        setExams(nextExams);
        const preferred = nextExams.find((e) => e.id === 'exm_to_mat_done') || nextExams[0];
        if (preferred) setSelectedExamId(preferred.id);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Gagal memuat daftar ujian.');
      });
  }, []);

  useEffect(() => {
    setSelectedStudentIds([]);
    if (!selectedExamId) return;
    Promise.all([
      apiFetch<AnalyticsPayload>(`/api/admin/analytics/${selectedExamId}`),
      apiFetch<ItemAnalysisPayload>(`/api/admin/item-analysis/${selectedExamId}`),
    ])
      .then(([a, i]) => {
        setError(null);
        setAnalytics(a);
        setItemAnalysis(i);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Gagal memuat analitik ujian.');
      });
  }, [selectedExamId]);

  const maxDistCount = Math.max(1, ...(analytics?.distribution.map((d) => d.count) || [1]));
  const scoresList = analytics?.studentScores || [];
  const allStudentsSelected =
    scoresList.length > 0 && scoresList.every((s) => selectedStudentIds.includes(s.student_id));

  const analyticsExportUrl = withAuthTokenUrl(
    `/api/admin/analytics/${selectedExamId}/export.xlsx${
      selectedStudentIds.length > 0 ? `?studentIds=${encodeURIComponent(selectedStudentIds.join(','))}` : ''
    }`
  );

  const handleDownloadSelectedRapors = async () => {
    if (!analytics) return;
    const targets = analytics.studentScores.filter((s) => selectedStudentIds.includes(s.student_id));
    for (const s of targets) {
      await generateStudentRaporPDF(
        {
          institution: branding,
          studentName: s.full_name,
          nis: s.nis,
          nisn: s.nisn,
          birthPlace: s.birth_place,
          birthDate: s.birth_date,
          gender: s.gender,
          email: s.email,
          className: s.class_name,
          photoUrl: s.photo_link || `/api/photos/student/${s.student_id}`,
          subjectName: analytics.exam.subject_name,
          examTitle: analytics.exam.title,
          examType: analytics.exam.exam_type,
          examDate: s.graded_at,
          finalScore: s.final_score,
          rawPoints: s.raw_points,
          maxPoints: s.max_points,
          correctCount: s.correct_count,
          partialCount: s.partial_count,
          wrongCount: s.wrong_count,
          blankCount: s.blank_count,
          passingScore: analytics.summary.passingScore,
          passed: Boolean(s.passed),
        },
        'download'
      );
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
          {error}
        </div>
      )}
      {/* Header Controls */}
      <div className="bg-white border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex-1">
          <label className="block text-xs font-semibold text-slate-500 mb-1">Pilih Ujian untuk Analisis &amp; Rapor</label>
          <select
            value={selectedExamId}
            onChange={(e) => setSelectedExamId(e.target.value)}
            className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 bg-white text-base sm:text-sm font-semibold text-slate-900"
          >
            {exams.map((e) => (
              <option key={e.id} value={e.id}>[{e.exam_type}] {e.title} — {e.subject_name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={analyticsExportUrl}
            className="min-h-[42px] px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" />
            <span>{selectedStudentIds.length > 0 ? `Ekspor Terpilih (${selectedStudentIds.length})` : 'Ekspor Excel'}</span>
          </a>
          {selectedStudentIds.length > 0 && analytics && (
            <button
              type="button"
              onClick={handleDownloadSelectedRapors}
              className="min-h-[42px] px-4 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100/70 text-xs font-semibold text-blue-900 flex items-center gap-1.5"
            >
              <Download className="w-4 h-4" />
              <span>Unduh {selectedStudentIds.length} Rapor PDF</span>
            </button>
          )}
          {analytics && analytics.studentScores.length > 0 && (
            <button
              type="button"
              onClick={() =>
                generateClassReportPDF({
                  institution: branding,
                  examTitle: analytics.exam.title,
                  examType: analytics.exam.exam_type,
                  subjectName: analytics.exam.subject_name,
                  summary: analytics.summary,
                  scores:
                    selectedStudentIds.length > 0
                      ? analytics.studentScores.filter((s) => selectedStudentIds.includes(s.student_id))
                      : analytics.studentScores,
                })
              }
              className="min-h-[42px] px-4 rounded-xl bg-blue-900 hover:bg-blue-800 text-white text-xs font-semibold flex items-center gap-1.5"
            >
              <FileText className="w-4 h-4" />
              <span>{selectedStudentIds.length > 0 ? `Laporan PDF (${selectedStudentIds.length})` : 'Unduh Laporan Kelas PDF'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="inline-flex p-1 bg-slate-200/70 rounded-xl overflow-x-auto no-scrollbar max-w-full">
        <button
          type="button"
          onClick={() => setSubTab('overview')}
          className={`min-h-[38px] px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap ${
            subTab === 'overview' ? 'bg-white text-blue-900 shadow-sm' : 'text-slate-600'
          }`}
        >
          Analisis Hasil &amp; Rapor Peserta
        </button>
        <button
          type="button"
          onClick={() => setSubTab('items')}
          className={`min-h-[38px] px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap ${
            subTab === 'items' ? 'bg-white text-blue-900 shadow-sm' : 'text-slate-600'
          }`}
        >
          Analisis Butir Soal (Empiris)
        </button>
      </div>

      {analytics && subTab === 'overview' && (
        <div className="space-y-6">
          {/* KPI Summary Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Peserta Dinilai', val: analytics.summary.participantCount },
              { label: 'Tertinggi', val: analytics.summary.highest.toFixed(1) },
              { label: 'Terendah', val: analytics.summary.lowest.toFixed(1) },
              { label: 'Rata-rata', val: analytics.summary.average.toFixed(2) },
              { label: 'Median', val: analytics.summary.median.toFixed(2) },
              { label: `Ketuntasan (≥${analytics.summary.passingScore})`, val: `${analytics.summary.passRate}%` },
            ].map((k) => (
              <div key={k.label} className="bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-[11px] font-medium text-slate-500">{k.label}</p>
                <p className="text-xl font-display font-bold text-slate-900 tabular-nums mt-1">{k.val}</p>
              </div>
            ))}
          </div>

          {/* Distribution Histogram & Per-Class Comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <h3 className="font-display font-bold text-slate-900 text-sm flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-blue-900" />
                <span>Distribusi Nilai Akhir</span>
              </h3>
              <div className="space-y-3">
                {analytics.distribution.map((d) => (
                  <div key={d.range} className="flex items-center gap-3 text-xs">
                    <span className="w-14 font-mono text-slate-600 tabular-nums">{d.range}</span>
                    <div className="flex-1 h-6 bg-slate-100 rounded-lg overflow-hidden">
                      <div
                        className="h-full bg-blue-900 rounded-lg transition-all"
                        style={{ width: `${(d.count / maxDistCount) * 100}%` }}
                      />
                    </div>
                    <span className="w-10 text-right font-mono font-bold text-slate-800 tabular-nums">{d.count}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <h3 className="font-display font-bold text-slate-900 text-sm">Perbandingan Per Kelas</h3>
              {analytics.byClass.length === 0 ? (
                <p className="text-xs text-slate-500">Belum ada data nilai untuk ujian ini.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="px-3 py-2">Kelas</th>
                        <th className="px-3 py-2 text-right">Peserta</th>
                        <th className="px-3 py-2 text-right">Rata-rata</th>
                        <th className="px-3 py-2 text-right">Tuntas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {analytics.byClass.map((c) => (
                        <tr key={c.classId}>
                          <td className="px-3 py-2.5 font-semibold text-slate-900">{c.className}</td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums">{c.participantCount}</td>
                          <td className="px-3 py-2.5 text-right font-mono font-bold tabular-nums">{c.average.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums">{c.passRate}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          {/* Student Scores & Individual Rapor PDF */}
          <section className="bg-white border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-2xl overflow-hidden">
            <div className="px-4 sm:px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display font-bold text-slate-900 text-sm">Daftar Nilai &amp; Unduh Rapor Individu</h3>
              {selectedStudentIds.length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold text-blue-900">{selectedStudentIds.length} peserta dipilih</span>
                  <button
                    type="button"
                    onClick={() => setSelectedStudentIds([])}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 font-semibold"
                  >
                    Bersihkan
                  </button>
                </div>
              )}
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {scoresList.length > 0 && (
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      aria-label="Pilih semua nilai peserta"
                      checked={allStudentsSelected}
                      onChange={(e) =>
                        setSelectedStudentIds(e.target.checked ? scoresList.map((s) => s.student_id) : [])
                      }
                      className="w-4 h-4 rounded border-slate-300"
                    />
                    <span>Pilih Semua ({scoresList.length})</span>
                  </label>
                </div>
              )}
              {analytics.studentScores.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs">Belum ada sesi yang dinilai pada ujian ini.</div>
              ) : (
                analytics.studentScores.map((s) => {
                  const isChecked = selectedStudentIds.includes(s.student_id);
                  return (
                    <div key={s.id} className={`p-4 space-y-2.5 ${isChecked ? 'bg-blue-50/40' : ''}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            aria-label={`Pilih nilai ${s.full_name}`}
                            checked={isChecked}
                            onChange={(e) =>
                              setSelectedStudentIds((prev) =>
                                e.target.checked
                                  ? [...prev, s.student_id]
                                  : prev.filter((id) => id !== s.student_id)
                              )
                            }
                            className="mt-1 w-4 h-4 rounded border-slate-300 shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="font-semibold text-sm text-slate-900 truncate">{s.full_name}</p>
                            <p className="text-xs font-mono text-slate-500 tabular-nums">{s.nis} · {s.class_name}</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-mono font-bold text-base text-blue-900 tabular-nums">{s.final_score.toFixed(2)}</p>
                          <p className={`text-[11px] font-bold ${s.passed ? 'text-emerald-700' : 'text-red-700'}`}>
                            {s.passed ? 'Tuntas' : 'Belum Tuntas'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs text-slate-600 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200/60 font-mono tabular-nums">
                        <span>B / P / S / K</span>
                        <span>{s.correct_count} / {s.partial_count} / {s.wrong_count} / {s.blank_count}</span>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          generateStudentRaporPDF(
                            {
                              institution: branding,
                              studentName: s.full_name,
                              nis: s.nis,
                              nisn: s.nisn,
                              birthPlace: s.birth_place,
                              birthDate: s.birth_date,
                              gender: s.gender,
                              email: s.email,
                              className: s.class_name,
                              photoUrl: s.photo_link || `/api/photos/student/${s.student_id}`,
                              subjectName: analytics.exam.subject_name,
                              examTitle: analytics.exam.title,
                              examType: analytics.exam.exam_type,
                              examDate: s.graded_at,
                              finalScore: s.final_score,
                              rawPoints: s.raw_points,
                              maxPoints: s.max_points,
                              correctCount: s.correct_count,
                              partialCount: s.partial_count,
                              wrongCount: s.wrong_count,
                              blankCount: s.blank_count,
                              passingScore: analytics.summary.passingScore,
                              passed: Boolean(s.passed),
                            },
                            'download'
                          )
                        }
                        className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center justify-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Unduh Rapor PDF</span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <tr>
                    <th className="pl-4 pr-2 py-3 w-10">
                      <input
                        type="checkbox"
                        aria-label="Pilih semua nilai peserta"
                        checked={allStudentsSelected}
                        onChange={(e) =>
                          setSelectedStudentIds(e.target.checked ? scoresList.map((s) => s.student_id) : [])
                        }
                        className="w-4 h-4 rounded border-slate-300"
                      />
                    </th>
                    <th className="px-4 py-3">NIS</th>
                    <th className="px-4 py-3">Nama Peserta</th>
                    <th className="px-4 py-3">Kelas</th>
                    <th className="px-4 py-3 text-right">B / P / S / K</th>
                    <th className="px-4 py-3 text-right">Nilai Akhir</th>
                    <th className="px-4 py-3">Ketuntasan</th>
                    <th className="px-4 py-3 text-right">Rapor PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {analytics.studentScores.length === 0 ? (
                    <tr><td colSpan={8} className="p-8 text-center text-slate-500 text-xs">Belum ada sesi yang dinilai pada ujian ini.</td></tr>
                  ) : (
                    analytics.studentScores.map((s) => {
                      const isChecked = selectedStudentIds.includes(s.student_id);
                      return (
                        <tr key={s.id} className={`hover:bg-slate-50/70 ${isChecked ? 'bg-blue-50/40' : ''}`}>
                          <td className="pl-4 pr-2 py-3">
                            <input
                              type="checkbox"
                              aria-label={`Pilih nilai ${s.full_name}`}
                              checked={isChecked}
                              onChange={(e) =>
                                setSelectedStudentIds((prev) =>
                                  e.target.checked
                                    ? [...prev, s.student_id]
                                    : prev.filter((id) => id !== s.student_id)
                                )
                              }
                              className="w-4 h-4 rounded border-slate-300"
                            />
                          </td>
                          <td className="px-4 py-3 font-mono text-xs tabular-nums">{s.nis}</td>
                          <td className="px-4 py-3 font-semibold text-slate-900">{s.full_name}</td>
                          <td className="px-4 py-3 text-slate-700">{s.class_name}</td>
                          <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                            {s.correct_count}/{s.partial_count}/{s.wrong_count}/{s.blank_count}
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-bold text-blue-900 tabular-nums">
                            {s.final_score.toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-xs font-bold">
                            <span className={s.passed ? 'text-emerald-700' : 'text-red-700'}>
                              {s.passed ? 'Tuntas' : 'Belum'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                generateStudentRaporPDF(
                                  {
                                    institution: branding,
                                    studentName: s.full_name,
                                    nis: s.nis,
                                    nisn: s.nisn,
                                    birthPlace: s.birth_place,
                                    birthDate: s.birth_date,
                                    gender: s.gender,
                                    email: s.email,
                                    className: s.class_name,
                                    photoUrl: s.photo_link || `/api/photos/student/${s.student_id}`,
                                    subjectName: analytics.exam.subject_name,
                                    examTitle: analytics.exam.title,
                                    examType: analytics.exam.exam_type,
                                    examDate: s.graded_at,
                                    finalScore: s.final_score,
                                    rawPoints: s.raw_points,
                                    maxPoints: s.max_points,
                                    correctCount: s.correct_count,
                                    partialCount: s.partial_count,
                                    wrongCount: s.wrong_count,
                                    blankCount: s.blank_count,
                                    passingScore: analytics.summary.passingScore,
                                    passed: Boolean(s.passed),
                                  },
                                  'download'
                                )
                              }
                              className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-xs font-semibold text-slate-800 inline-flex items-center gap-1"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Rapor</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {itemAnalysis && subTab === 'items' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-slate-100 border border-slate-200 text-xs text-slate-700 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <span>
              Setiap butir dianalisis hanya berdasarkan peserta yang benar-benar menerima soal tersebut dalam paketnya. Butir dengan jumlah sampel <strong>N &lt; 15</strong> ditandai secara eksplisit dan dibedakan antara tingkat kesulitan penyusun vs hasil empiris.
            </span>
          </div>

          <div className="bg-white border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-2xl overflow-hidden">
            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {itemAnalysis.items.map((it) => (
                <div key={it.questionId} className="p-4 space-y-2.5 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono font-bold text-slate-900">{it.questionId}</p>
                      <p className="text-slate-500">{it.topic} · {it.questionType}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono font-bold text-base text-blue-900 tabular-nums">{it.correctPercent}%</p>
                      <p className="text-[11px] text-slate-500 tabular-nums">N = {it.sampleSize}{it.lowSampleWarning ? ' (Kecil)' : ''}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200/60 tabular-nums">
                    <div>
                      <span className="text-slate-500 block">B / P / S / K</span>
                      <span className="font-mono font-semibold text-slate-800">{it.correctCount}/{it.partialCount}/{it.wrongCount}/{it.blankCount}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Daya Pembeda (D)</span>
                      <span className="font-mono font-semibold text-slate-800">{it.discriminationIndex !== null ? it.discriminationIndex.toFixed(2) : 'N kurang (<6)'}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-600">
                    <span className="capitalize">Penyusun: {it.authorDifficulty}</span>
                    <span className="font-semibold text-slate-900">Empiris: {it.empiricalDifficulty}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                  <tr>
                    <th className="px-4 py-3">ID Soal &amp; Materi</th>
                    <th className="px-4 py-3">Tipe</th>
                    <th className="px-4 py-3 text-right">Sampel (N)</th>
                    <th className="px-4 py-3 text-right">B / P / S / K</th>
                    <th className="px-4 py-3 text-right">Rata Skor</th>
                    <th className="px-4 py-3 text-right">% Benar</th>
                    <th className="px-4 py-3">Penyusun vs Empiris</th>
                    <th className="px-4 py-3 text-right">Daya Pembeda (D)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {itemAnalysis.items.map((it) => (
                    <tr key={it.questionId} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <p className="font-mono font-bold text-slate-900">{it.questionId}</p>
                        <p className="text-slate-500">{it.topic}</p>
                      </td>
                      <td className="px-4 py-3">{it.questionType}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        <span>{it.sampleSize}</span>
                        {it.lowSampleWarning && (
                          <span className="block text-[10px] text-amber-700 font-semibold">Sampel kecil</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {it.correctCount}/{it.partialCount}/{it.wrongCount}/{it.blankCount}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {it.avgPartialScore} / {it.maxPoints}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold tabular-nums text-blue-900">
                        {it.correctPercent}%
                      </td>
                      <td className="px-4 py-3">
                        <span className="capitalize text-slate-500">Penyusun: {it.authorDifficulty}</span>
                        <span className="block font-semibold text-slate-900">Empiris: {it.empiricalDifficulty}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {it.discriminationIndex !== null ? it.discriminationIndex.toFixed(2) : 'N kurang (<6)'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
