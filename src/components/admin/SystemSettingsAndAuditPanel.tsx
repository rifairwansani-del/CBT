import React, { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Database,
  Download,
  Edit3,
  FileSpreadsheet,
  Play,
  Shield,
  Trash2,
  Upload,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { apiFetch, withAuthTokenUrl } from '../../lib/api.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import type { InstitutionBranding, SecuritySettings } from '../../types/cbt.ts';

interface FunctionalTestReport {
  total: number;
  passed: number;
  failed: number;
  results: Array<{ name: string; passed: boolean; durationMs: number; detail: string }>;
}

interface LoadBenchmarkReport {
  timestamp: string;
  targetParticipants: number;
  stages: Array<{
    stage: string;
    operations: number;
    durationMs: number;
    opsPerSecond: number;
    p95LatencyMs: number;
    failures: number;
    answerLossCount: number;
  }>;
  memoryRssMb: number;
  passedCriteria: boolean;
  notes: string[];
}

interface StaffMember {
  id: string;
  username: string;
  full_name: string;
  role: string;
  assigned_class_ids_json: string;
  can_unlock_sessions: number;
  is_active: number;
}

interface StaffImportPreview {
  previewId: string;
  totalRows: number;
  validCount: number;
  errorCount: number;
  issues: Array<{ row: number; column: string; message: string }>;
}

export const SystemSettingsAndAuditPanel: React.FC<{
  branding: InstitutionBranding;
  onBrandingUpdated: () => void;
}> = ({ branding, onBrandingUpdated }) => {
  const [subTab, setSubTab] = useState<'branding' | 'staff' | 'logs' | 'qa'>('branding');
  const [instForm, setInstForm] = useState<InstitutionBranding>(branding);
  const [secForm, setSecForm] = useState<SecuritySettings>({
    maxLoginAttempts: 5,
    lockoutMinutes: 5,
    defaultProctoringRetentionDays: 14,
    maxConcurrentCameraStreams: 6,
    privacyNotice: '',
  });

  // Staff state
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [classes, setClasses] = useState<Array<{ id: string; name: string }>>([]);
  const [newProctor, setNewProctor] = useState({
    username: '',
    password: '',
    fullName: '',
    assignedClassIds: [] as string[],
    canUnlockSessions: false,
  });
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [editingStaff, setEditingStaff] = useState<{
    id: string;
    role: string;
    username: string;
    fullName: string;
    password: string;
    assignedClassIds: string[];
    canUnlockSessions: boolean;
    isActive: boolean;
  } | null>(null);
  const [staffImportPreview, setStaffImportPreview] = useState<StaffImportPreview | null>(null);

  // Logs selection state
  const [violationLogs, setViolationLogs] = useState<Array<Record<string, unknown>>>([]);
  const [auditLogs, setAuditLogs] = useState<Array<Record<string, unknown>>>([]);
  const [selectedViolationIds, setSelectedViolationIds] = useState<string[]>([]);
  const [selectedAuditIds, setSelectedAuditIds] = useState<string[]>([]);

  // QA & busy state
  const [funcReport, setFuncReport] = useState<FunctionalTestReport | null>(null);
  const [loadReport, setLoadReport] = useState<LoadBenchmarkReport | null>(null);
  const [runningQa, setRunningQa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    action: () => Promise<void>;
  } | null>(null);

  const loadSettingsData = async () => {
    try {
      const [bRes, stRes, clRes, vlRes, alRes] = await Promise.all([
        apiFetch<{ institution: InstitutionBranding; security: SecuritySettings }>('/api/branding'),
        apiFetch<{ staff: StaffMember[] }>('/api/admin/staff'),
        apiFetch<{ classes: typeof classes }>('/api/admin/classes'),
        apiFetch<{ logs: Array<Record<string, unknown>> }>('/api/admin/violation-logs'),
        apiFetch<{ logs: Array<Record<string, unknown>> }>('/api/admin/audit-logs'),
      ]);
      setInstForm(bRes.institution);
      setSecForm(bRes.security);
      setStaff(stRes.staff);
      setClasses(clRes.classes);
      setViolationLogs(vlRes.logs);
      setAuditLogs(alRes.logs);
      setSelectedStaffIds((prev) =>
        prev.filter((id) => stRes.staff.some((s) => s.id === id && s.role === 'pengawas'))
      );
      setSelectedViolationIds((prev) =>
        prev.filter((id) => vlRes.logs.some((v) => String(v.id || '') === id))
      );
      setSelectedAuditIds((prev) =>
        prev.filter((id) => alRes.logs.some((a) => String(a.id || '') === id))
      );
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal memuat pengaturan sistem.' });
    }
  };

  useEffect(() => {
    loadSettingsData();
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ institution: instForm, security: secForm }),
      });
      setBanner({ type: 'ok', text: 'Pengaturan lembaga & kebijakan keamanan berhasil disimpan.' });
      onBrandingUpdated();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal menyimpan pengaturan.' });
    }
  };

  const handleBackupImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setBanner(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await apiFetch<{ restoredRecords: number }>('/api/admin/backup/import', {
        method: 'POST',
        body: fd,
      });
      setBanner({ type: 'ok', text: `Backup berhasil dipulihkan (${res.restoredRecords} baris data diperbarui).` });
      onBrandingUpdated();
      await loadSettingsData();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal memulihkan backup JSON.' });
    } finally {
      setBusy(false);
    }
  };

  const handleCreateProctor = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/staff', {
        method: 'POST',
        body: JSON.stringify(newProctor),
      });
      setNewProctor({ username: '', password: '', fullName: '', assignedClassIds: [], canUnlockSessions: false });
      setBanner({ type: 'ok', text: 'Akun pengawas baru ditambahkan.' });
      await loadSettingsData();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal menambahkan pengawas.' });
    }
  };

  const handleUpdateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStaff) return;
    setBusy(true);
    setBanner(null);
    try {
      await apiFetch(`/api/admin/staff/${editingStaff.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          username: editingStaff.username,
          fullName: editingStaff.fullName,
          password: editingStaff.password.trim() || undefined,
          assignedClassIds: editingStaff.assignedClassIds,
          canUnlockSessions: editingStaff.canUnlockSessions,
          isActive: editingStaff.isActive,
        }),
      });
      setEditingStaff(null);
      setBanner({ type: 'ok', text: 'Akun staff berhasil diperbarui.' });
      await loadSettingsData();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal memperbarui akun staff.' });
    } finally {
      setBusy(false);
    }
  };

  const handleStaffExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setBanner(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const preview = await apiFetch<StaffImportPreview>('/api/admin/staff/import-preview', {
        method: 'POST',
        body: fd,
      });
      setStaffImportPreview(preview);
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal memproses Excel pengawas.' });
    } finally {
      setBusy(false);
    }
  };

  const handleCommitStaffImport = async () => {
    if (!staffImportPreview) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ importedCount: number }>('/api/admin/staff/import-commit', {
        method: 'POST',
        body: JSON.stringify({ previewId: staffImportPreview.previewId }),
      });
      setStaffImportPreview(null);
      setBanner({ type: 'ok', text: `${res.importedCount} akun pengawas berhasil diimpor.` });
      await loadSettingsData();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal menyimpan impor pengawas.' });
    } finally {
      setBusy(false);
    }
  };

  const runFunctional = async () => {
    setRunningQa(true);
    setBanner(null);
    try {
      const res = await apiFetch<FunctionalTestReport>('/api/admin/run-tests', { method: 'POST' });
      setFuncReport(res);
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal menjalankan pengujian fungsional.' });
    } finally {
      setRunningQa(false);
    }
  };

  const runLoadBenchmark = async () => {
    setRunningQa(true);
    setBanner(null);
    try {
      const res = await apiFetch<LoadBenchmarkReport>('/api/admin/run-load-test', { method: 'POST' });
      setLoadReport(res);
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal menjalankan uji beban.' });
    } finally {
      setRunningQa(false);
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

  const selectableStaff = staff.filter((s) => s.role === 'pengawas');
  const allProctorsSelected =
    selectableStaff.length > 0 && selectableStaff.every((s) => selectedStaffIds.includes(s.id));

  const staffExportUrl = withAuthTokenUrl(
    `/api/admin/staff/export.xlsx${selectedStaffIds.length > 0 ? `?ids=${encodeURIComponent(selectedStaffIds.join(','))}` : ''}`
  );
  const violationExportUrl = withAuthTokenUrl(
    `/api/admin/violation-logs/export.xlsx${selectedViolationIds.length > 0 ? `?ids=${encodeURIComponent(selectedViolationIds.join(','))}` : ''}`
  );
  const auditExportUrl = withAuthTokenUrl(
    `/api/admin/audit-logs/export.xlsx${selectedAuditIds.length > 0 ? `?ids=${encodeURIComponent(selectedAuditIds.join(','))}` : ''}`
  );

  const allViolationsSelected =
    violationLogs.length > 0 && violationLogs.every((v) => selectedViolationIds.includes(String(v.id || '')));
  const allAuditsSelected =
    auditLogs.length > 0 && auditLogs.every((a) => selectedAuditIds.includes(String(a.id || '')));

  return (
    <div className="space-y-6">
      <div className="inline-flex p-1 bg-slate-200/70 rounded-xl gap-1 overflow-x-auto no-scrollbar max-w-full">
        {[
          { id: 'branding', label: 'Identitas Lembaga & Privasi' },
          { id: 'staff', label: 'Akun Pengawas' },
          { id: 'logs', label: 'Log Pelanggaran & Audit' },
          { id: 'qa', label: 'Pengujian & Uji Beban 1.300 Peserta' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id as typeof subTab)}
            className={`min-h-[38px] px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap ${
              subTab === t.id ? 'bg-white text-blue-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {banner && (
        <div
          className={`p-3.5 rounded-xl border text-sm ${
            banner.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {banner.text}
        </div>
      )}

      {subTab === 'branding' && (
        <form onSubmit={handleSaveSettings} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 max-w-3xl">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <h3 className="font-display font-bold text-slate-900">Identitas Visual Lembaga &amp; Kebijakan Privasi</h3>
            <label className="px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer">
              <Upload className="w-4 h-4" />
              <span>Unggah Logo Lembaga</span>
              <input
                type="file"
                accept=".jpg,.jpeg,.png"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  try {
                    const fd = new FormData();
                    fd.append('logo', f);
                    const res = await apiFetch<{ logoEndpoint: string }>('/api/admin/branding/logo', { method: 'POST', body: fd });
                    setInstForm((p) => ({ ...p, logoEndpoint: res.logoEndpoint }));
                    onBrandingUpdated();
                  } catch (err) {
                    setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal mengunggah logo.' });
                  }
                }}
                className="hidden"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Lembaga</label>
              <input type="text" value={instForm.name} onChange={(e) => setInstForm({ ...instForm, name: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-300" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Singkat</label>
              <input type="text" value={instForm.shortName} onChange={(e) => setInstForm({ ...instForm, shortName: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-300" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Alamat Lembaga</label>
              <input type="text" value={instForm.address} onChange={(e) => setInstForm({ ...instForm, address: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-300" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Zona Waktu Baku Server</label>
              <select value={instForm.timezone} onChange={(e) => setInstForm({ ...instForm, timezone: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white">
                <option value="Asia/Jakarta">WIB (Asia/Jakarta)</option>
                <option value="Asia/Makassar">WITA (Asia/Makassar)</option>
                <option value="Asia/Jayapura">WIT (Asia/Jayapura)</option>
              </select>
            </div>
          </div>

          <div className="space-y-3 pt-2 border-t border-slate-100 text-sm">
            <h4 className="font-bold text-slate-800 text-xs">Kebijakan Perlindungan Siswa &amp; Kamera Proctoring</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Retensi Bukti Kamera (Hari)</label>
                <input type="number" min={1} max={90} value={secForm.defaultProctoringRetentionDays} onChange={(e) => setSecForm({ ...secForm, defaultProctoringRetentionDays: Number(e.target.value) })} className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Batas Stream Kamera Simultan</label>
                <input type="number" min={1} max={12} value={secForm.maxConcurrentCameraStreams} onChange={(e) => setSecForm({ ...secForm, maxConcurrentCameraStreams: Number(e.target.value) })} className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Pemberitahuan Privasi Peserta</label>
              <textarea rows={2} value={secForm.privacyNotice} onChange={(e) => setSecForm({ ...secForm, privacyNotice: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs" />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={withAuthTokenUrl('/api/admin/backup.json')}
                className="px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5"
              >
                <Database className="w-4 h-4" />
                <span>Unduh Backup Database (JSON)</span>
              </a>
              <label className="px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer">
                <Upload className="w-4 h-4" />
                <span>Impor / Pulihkan Backup (JSON)</span>
                <input type="file" accept=".json,application/json" onChange={handleBackupImport} className="hidden" />
              </label>
            </div>
            <button type="submit" disabled={busy} className="px-5 py-2.5 rounded-xl bg-blue-900 text-white text-sm font-semibold disabled:opacity-50">
              Simpan Pengaturan
            </button>
          </div>
        </form>
      )}

      {subTab === 'staff' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form onSubmit={handleCreateProctor} className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <h3 className="font-display font-bold text-slate-900 text-sm flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-blue-900" />
              <span>Tambah Pengawas Ruang (Opsional)</span>
            </h3>
            <div className="space-y-3 text-sm">
              <input type="text" required placeholder="Nama Lengkap Pengawas" value={newProctor.fullName} onChange={(e) => setNewProctor({ ...newProctor, fullName: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-300" />
              <input type="text" required placeholder="Username login" value={newProctor.username} onChange={(e) => setNewProctor({ ...newProctor, username: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-300" />
              <input type="password" required placeholder="Kata sandi" value={newProctor.password} onChange={(e) => setNewProctor({ ...newProctor, password: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-300" />
              <div>
                <p className="text-xs font-semibold text-slate-700 mb-1.5">Batasi Akses pada Kelas:</p>
                <div className="flex flex-wrap gap-1.5">
                  {classes.map((c) => {
                    const checked = newProctor.assignedClassIds.includes(c.id);
                    return (
                      <label key={c.id} className={`px-2.5 py-1 rounded-lg border text-xs cursor-pointer ${checked ? 'bg-blue-50 border-blue-900 text-blue-900 font-semibold' : 'border-slate-200 text-slate-600'}`}>
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={checked}
                          onChange={(e) => setNewProctor((p) => ({
                            ...p,
                            assignedClassIds: e.target.checked ? [...p.assignedClassIds, c.id] : p.assignedClassIds.filter((id) => id !== c.id),
                          }))}
                        />
                        {c.name}
                      </label>
                    );
                  })}
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-slate-800">
                <input type="checkbox" checked={newProctor.canUnlockSessions} onChange={(e) => setNewProctor({ ...newProctor, canUnlockSessions: e.target.checked })} />
                <span>Izin khusus: boleh membuka sesi ujian yang terkunci</span>
              </label>
            </div>
            <button type="submit" className="w-full py-2.5 rounded-xl bg-blue-900 text-white text-sm font-semibold">
              Simpan Pengawas
            </button>
          </form>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display font-bold text-slate-900 text-sm">Daftar Akun Admin &amp; Pengawas ({staff.length})</h3>
              <div className="flex flex-wrap items-center gap-1.5">
                <a
                  href={withAuthTokenUrl('/api/admin/templates/staff.xlsx')}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Template</span>
                </a>
                <label className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer">
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Impor Excel</span>
                  <input type="file" accept=".xlsx,.xls" onChange={handleStaffExcelUpload} className="hidden" />
                </label>
                <a
                  href={staffExportUrl}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{selectedStaffIds.length > 0 ? `Ekspor (${selectedStaffIds.length})` : 'Ekspor'}</span>
                </a>
              </div>
            </div>

            {staffImportPreview && (
              <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200 space-y-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">
                    Pratinjau Impor Pengawas: {staffImportPreview.validCount}/{staffImportPreview.totalRows} valid
                  </span>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => setStaffImportPreview(null)} className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white font-semibold">
                      Batal
                    </button>
                    <button
                      type="button"
                      disabled={busy || staffImportPreview.validCount === 0}
                      onClick={handleCommitStaffImport}
                      className="px-3 py-1 rounded-lg bg-blue-900 text-white font-semibold disabled:opacity-50"
                    >
                      Simpan Valid
                    </button>
                  </div>
                </div>
                {staffImportPreview.issues.length > 0 && (
                  <div className="text-red-700 space-y-0.5 max-h-24 overflow-y-auto">
                    {staffImportPreview.issues.map((iss, i) => (
                      <p key={i}>Baris {iss.row} ({iss.column}): {iss.message}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {selectedStaffIds.length > 0 && (
              <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-blue-900">{selectedStaffIds.length} pengawas dipilih</span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setConfirmState({
                        title: 'Hapus Pengawas Terpilih',
                        message: `Hapus ${selectedStaffIds.length} akun pengawas terpilih secara permanen?`,
                        confirmLabel: `Hapus ${selectedStaffIds.length} Akun`,
                        action: async () => {
                          const res = await apiFetch<{ deletedCount: number }>('/api/admin/staff/bulk-delete', {
                            method: 'POST',
                            body: JSON.stringify({ ids: selectedStaffIds }),
                          });
                          setSelectedStaffIds([]);
                          setBanner({ type: 'ok', text: `${res.deletedCount} akun pengawas dihapus.` });
                          await loadSettingsData();
                        },
                      })
                    }
                    className="px-2.5 py-1 rounded-lg bg-red-700 text-white font-semibold"
                  >
                    Hapus Terpilih
                  </button>
                  <button type="button" onClick={() => setSelectedStaffIds([])} className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white font-semibold">
                    Bersihkan
                  </button>
                </div>
              </div>
            )}

            {selectableStaff.length > 0 && (
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 pb-1 border-b border-slate-100">
                <input
                  type="checkbox"
                  checked={allProctorsSelected}
                  onChange={(e) => setSelectedStaffIds(e.target.checked ? selectableStaff.map((s) => s.id) : [])}
                  className="w-4 h-4 rounded border-slate-300"
                />
                <span>Pilih Semua Pengawas</span>
              </label>
            )}

            <div className="divide-y divide-slate-100 text-sm">
              {staff.map((st) => {
                const isProctor = st.role === 'pengawas';
                let assignedCls: string[] = [];
                try {
                  assignedCls = JSON.parse(st.assigned_class_ids_json || '[]');
                } catch {
                  assignedCls = [];
                }
                return (
                  <div key={st.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      {isProctor ? (
                        <input
                          type="checkbox"
                          aria-label={`Pilih ${st.full_name}`}
                          checked={selectedStaffIds.includes(st.id)}
                          onChange={(e) =>
                            setSelectedStaffIds((prev) =>
                              e.target.checked ? [...prev, st.id] : prev.filter((id) => id !== st.id)
                            )
                          }
                          className="w-4 h-4 rounded border-slate-300"
                        />
                      ) : (
                        <span className="w-4" />
                      )}
                      <div>
                        <p className="font-semibold text-slate-900">
                          {st.full_name}{' '}
                          {!st.is_active && <span className="text-xs text-red-700 font-semibold">(Nonaktif)</span>}
                        </p>
                        <p className="text-xs text-slate-500 font-mono">
                          @{st.username} · Peran: {st.role} · Buka Kunci: {st.can_unlock_sessions ? 'Diizinkan' : 'Tidak'}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setEditingStaff({
                            id: st.id,
                            role: st.role,
                            username: st.username,
                            fullName: st.full_name,
                            password: '',
                            assignedClassIds: assignedCls,
                            canUnlockSessions: Boolean(st.can_unlock_sessions),
                            isActive: Boolean(st.is_active),
                          })
                        }
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                      {isProctor && (
                        <>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await apiFetch(`/api/admin/staff/${st.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ isActive: !st.is_active }),
                                });
                                await loadSettingsData();
                              } catch (err) {
                                setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal mengubah status pengawas.' });
                              }
                            }}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700"
                          >
                            {st.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmState({
                                title: 'Hapus Akun Pengawas',
                                message: `Hapus akun pengawas ${st.full_name} (@${st.username}) secara permanen?`,
                                confirmLabel: 'Ya, Hapus Akun',
                                action: async () => {
                                  await apiFetch(`/api/admin/staff/${st.id}`, { method: 'DELETE' });
                                  setBanner({ type: 'ok', text: `Akun pengawas ${st.full_name} dihapus.` });
                                  await loadSettingsData();
                                },
                              })
                            }
                            className="p-1.5 rounded-lg border border-red-200 hover:bg-red-50 text-red-700"
                            title="Hapus akun pengawas"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {subTab === 'logs' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display font-bold text-slate-900 text-sm">Log Pelanggaran &amp; Pembukaan Kunci (Tidak Dapat Diubah)</h3>
            <a
              href={violationExportUrl}
              className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5"
            >
              <Download className="w-4 h-4" />
              <span>{selectedViolationIds.length > 0 ? `Ekspor Log Terpilih (${selectedViolationIds.length})` : 'Ekspor Log Excel'}</span>
            </a>
          </div>

          <div className="bg-white border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-2xl overflow-hidden">
            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-slate-100 max-h-96 overflow-y-auto">
              {violationLogs.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">Belum ada catatan kejadian.</div>
              ) : (
                violationLogs.map((vl, idx) => {
                  const vlId = String(vl.id || idx);
                  const checked = selectedViolationIds.includes(vlId);
                  return (
                    <div key={vlId} className={`p-3.5 space-y-1.5 text-xs ${checked ? 'bg-blue-50/40' : ''}`}>
                      <div className="flex items-start justify-between gap-2">
                        <label className="flex items-start gap-2 min-w-0 font-semibold text-slate-900">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setSelectedViolationIds((prev) =>
                                e.target.checked ? [...prev, vlId] : prev.filter((id) => id !== vlId)
                              )
                            }
                            className="mt-0.5 w-4 h-4 rounded border-slate-300 shrink-0"
                          />
                          <span className="truncate">{String(vl.full_name)} ({String(vl.nis)})</span>
                        </label>
                        <span className="font-mono text-[11px] text-slate-500 shrink-0 tabular-nums">
                          {new Date(String(vl.server_timestamp)).toLocaleTimeString('id-ID')}
                        </span>
                      </div>
                      <p className="text-slate-600">{String(vl.exam_title)}</p>
                      <div className="flex items-center justify-between text-[11px] bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200/60">
                        <span className="font-semibold text-slate-800">{String(vl.event_type)} (#{String(vl.occurrence_number)})</span>
                        <span className="text-slate-600">{vl.admin_action ? `${vl.admin_action}: ${vl.action_notes}` : vl.triggered_lock ? 'Auto-Lock' : '-'}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600 sticky top-0">
                  <tr>
                    <th className="pl-4 pr-2 py-2.5 w-10">
                      <input
                        type="checkbox"
                        aria-label="Pilih semua log pelanggaran"
                        checked={allViolationsSelected}
                        onChange={(e) =>
                          setSelectedViolationIds(
                            e.target.checked ? violationLogs.map((v) => String(v.id || '')).filter(Boolean) : []
                          )
                        }
                        className="w-4 h-4 rounded border-slate-300"
                      />
                    </th>
                    <th className="px-4 py-2.5">Waktu Server</th>
                    <th className="px-4 py-2.5">Siswa</th>
                    <th className="px-4 py-2.5">Ujian</th>
                    <th className="px-4 py-2.5">Kejadian</th>
                    <th className="px-4 py-2.5">Tindakan Admin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {violationLogs.length === 0 ? (
                    <tr><td colSpan={6} className="p-6 text-center text-slate-500">Belum ada catatan kejadian.</td></tr>
                  ) : (
                    violationLogs.map((vl, idx) => {
                      const vlId = String(vl.id || idx);
                      const checked = selectedViolationIds.includes(vlId);
                      return (
                        <tr key={vlId} className={checked ? 'bg-blue-50/40' : ''}>
                          <td className="pl-4 pr-2 py-2.5">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setSelectedViolationIds((prev) =>
                                  e.target.checked ? [...prev, vlId] : prev.filter((id) => id !== vlId)
                                )
                              }
                              className="w-4 h-4 rounded border-slate-300"
                            />
                          </td>
                          <td className="px-4 py-2.5 font-mono tabular-nums">{new Date(String(vl.server_timestamp)).toLocaleString('id-ID')}</td>
                          <td className="px-4 py-2.5">{String(vl.full_name)} ({String(vl.nis)})</td>
                          <td className="px-4 py-2.5">{String(vl.exam_title)}</td>
                          <td className="px-4 py-2.5 font-semibold">{String(vl.event_type)} (#{String(vl.occurrence_number)})</td>
                          <td className="px-4 py-2.5">{vl.admin_action ? `${vl.admin_action}: ${vl.action_notes}` : vl.triggered_lock ? 'Auto-Lock' : '-'}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display font-bold text-slate-900 text-sm">Audit Log Sistem (Foto, Impor, Pengaturan, RBAC)</h3>
            <a
              href={auditExportUrl}
              className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5"
            >
              <Download className="w-4 h-4" />
              <span>{selectedAuditIds.length > 0 ? `Ekspor Audit Terpilih (${selectedAuditIds.length})` : 'Ekspor Audit Log (.xlsx)'}</span>
            </a>
          </div>
          <div className="bg-white border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-2xl overflow-hidden">
            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-slate-100 max-h-96 overflow-y-auto">
              {auditLogs.map((al, idx) => {
                const alId = String(al.id || idx);
                const checked = selectedAuditIds.includes(alId);
                return (
                  <div key={alId} className={`p-3.5 space-y-1.5 text-xs ${checked ? 'bg-blue-50/40' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <label className="flex items-start gap-2 min-w-0 font-mono font-bold text-blue-900">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setSelectedAuditIds((prev) =>
                              e.target.checked ? [...prev, alId] : prev.filter((id) => id !== alId)
                            )
                          }
                          className="mt-0.5 w-4 h-4 rounded border-slate-300 shrink-0"
                        />
                        <span className="truncate">{String(al.action)}</span>
                      </label>
                      <span className="font-mono text-[11px] text-slate-500 shrink-0 tabular-nums">
                        {new Date(String(al.server_timestamp)).toLocaleTimeString('id-ID')}
                      </span>
                    </div>
                    <p className="text-slate-700">{String(al.actor_name)} ({String(al.actor_role)})</p>
                    <p className="font-mono text-[11px] text-slate-500 truncate">{String(al.target_type)}:{String(al.target_id)}</p>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600 sticky top-0">
                  <tr>
                    <th className="pl-4 pr-2 py-2.5 w-10">
                      <input
                        type="checkbox"
                        aria-label="Pilih semua audit log"
                        checked={allAuditsSelected}
                        onChange={(e) =>
                          setSelectedAuditIds(
                            e.target.checked ? auditLogs.map((a) => String(a.id || '')).filter(Boolean) : []
                          )
                        }
                        className="w-4 h-4 rounded border-slate-300"
                      />
                    </th>
                    <th className="px-4 py-2.5">Waktu Server</th>
                    <th className="px-4 py-2.5">Aktor</th>
                    <th className="px-4 py-2.5">Aksi</th>
                    <th className="px-4 py-2.5">Target</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs.map((al, idx) => {
                    const alId = String(al.id || idx);
                    const checked = selectedAuditIds.includes(alId);
                    return (
                      <tr key={alId} className={checked ? 'bg-blue-50/40' : ''}>
                        <td className="pl-4 pr-2 py-2.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setSelectedAuditIds((prev) =>
                                e.target.checked ? [...prev, alId] : prev.filter((id) => id !== alId)
                              )
                            }
                            className="w-4 h-4 rounded border-slate-300"
                          />
                        </td>
                        <td className="px-4 py-2.5 font-mono tabular-nums">{new Date(String(al.server_timestamp)).toLocaleString('id-ID')}</td>
                        <td className="px-4 py-2.5">{String(al.actor_name)} ({String(al.actor_role)})</td>
                        <td className="px-4 py-2.5 font-mono font-bold text-blue-900">{String(al.action)}</td>
                        <td className="px-4 py-2.5 font-mono">{String(al.target_type)}:{String(al.target_id)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {subTab === 'qa' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="font-display font-bold text-slate-900">Verifikasi Fungsional &amp; Uji Beban 1.300 Peserta Serentak</h3>
              <p className="text-xs text-slate-600 mt-1">
                Menguji langsung keandalan mesin database, penilaian parsial, validasi foto, dan transaksi 1.300 peserta serentak secara nyata.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={runningQa}
                onClick={runFunctional}
                className="min-h-[42px] px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
              >
                <Shield className="w-4 h-4 text-blue-900" />
                <span>Jalankan Uji Fungsional</span>
              </button>
              <button
                type="button"
                disabled={runningQa}
                onClick={runLoadBenchmark}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-blue-900 hover:bg-blue-800 text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
              >
                <Play className="w-4 h-4" />
                <span>{runningQa ? 'Menjalankan Pengujian...' : 'Uji Beban 1.300 Peserta'}</span>
              </button>
            </div>
          </div>

          {funcReport && (
            <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-display font-bold text-slate-900 text-sm">Hasil Pengujian Fungsional</h4>
                <span className={`text-xs font-bold ${funcReport.failed === 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {funcReport.passed} / {funcReport.total} Lulus
                </span>
              </div>
              <div className="divide-y divide-slate-100 text-xs">
                {funcReport.results.map((r, i) => (
                  <div key={i} className="py-2.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {r.passed ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <XCircle className="w-4 h-4 text-red-600 shrink-0" />}
                      <span className="font-medium text-slate-800">{r.name}</span>
                    </div>
                    <span className="font-mono text-slate-500 tabular-nums">{r.durationMs} ms</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {loadReport && (
            <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-display font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Activity className="w-4 h-4 text-blue-900" />
                  <span>Hasil Pengukuran Beban Nyata 1.300 Peserta</span>
                </h4>
                <div className="text-xs font-mono tabular-nums text-slate-600">
                  RSS Memori Server: <strong>{loadReport.memoryRssMb} MB</strong> · Status:{' '}
                  <strong className={loadReport.passedCriteria ? 'text-emerald-700' : 'text-red-700'}>
                    {loadReport.passedCriteria ? 'MEMENUHI KRITERIA (0 gagal, 0 hilang)' : 'PERLU PERBAIKAN'}
                  </strong>
                </div>
              </div>

              {/* Mobile Load Stage Cards */}
              <div className="md:hidden divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                {loadReport.stages.map((st, idx) => (
                  <div key={idx} className="p-3.5 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">{st.stage}</span>
                      <span className="font-mono font-bold text-blue-900 tabular-nums">{st.opsPerSecond} ops/s</span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between text-[11px] font-mono text-slate-600 tabular-nums">
                      <span>{st.operations} ops · {st.durationMs} ms</span>
                      <span>P95: {st.p95LatencyMs} ms · Gagal: {st.failures}/{st.answerLossCount}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Load Stage Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                    <tr>
                      <th className="px-3 py-2.5">Tahap Simulasi</th>
                      <th className="px-3 py-2.5 text-right">Operasi</th>
                      <th className="px-3 py-2.5 text-right">Durasi Total</th>
                      <th className="px-3 py-2.5 text-right">Throughput</th>
                      <th className="px-3 py-2.5 text-right">P95 Latensi</th>
                      <th className="px-3 py-2.5 text-right">Gagal / Hilang</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loadReport.stages.map((st, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2.5 font-semibold text-slate-900">{st.stage}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">{st.operations}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">{st.durationMs} ms</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">{st.opsPerSecond} ops/s</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">{st.p95LatencyMs} ms</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                          {st.failures} / {st.answerLossCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
                {loadReport.notes.map((n, i) => <p key={i}>• {n}</p>)}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Edit Staff Modal (Bottom Sheet on Mobile) */}
      {editingStaff && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form onSubmit={handleUpdateStaff} className="bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 max-h-[92dvh] overflow-y-auto pb-safe">
            <div className="w-10 h-1 rounded-full bg-slate-300 mx-auto sm:hidden" />
            <h3 className="text-lg font-display font-bold text-slate-900">
              Edit Akun {editingStaff.role === 'admin' ? 'Admin' : 'Pengawas'}
            </h3>
            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Lengkap</label>
                <input
                  type="text"
                  required
                  value={editingStaff.fullName}
                  onChange={(e) => setEditingStaff({ ...editingStaff, fullName: e.target.value })}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-base sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Username Login</label>
                <input
                  type="text"
                  required
                  value={editingStaff.username}
                  onChange={(e) => setEditingStaff({ ...editingStaff, username: e.target.value })}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 font-mono text-base sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Kata Sandi Baru (Opsional, min 4 karakter)</label>
                <input
                  type="password"
                  placeholder="Kosongkan jika tidak mengubah kata sandi"
                  value={editingStaff.password}
                  onChange={(e) => setEditingStaff({ ...editingStaff, password: e.target.value })}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-base sm:text-sm"
                />
              </div>
              {editingStaff.role === 'pengawas' && (
                <>
                  <div>
                    <p className="text-xs font-semibold text-slate-700 mb-1.5">Batasi Akses pada Kelas:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {classes.map((c) => {
                        const checked = editingStaff.assignedClassIds.includes(c.id);
                        return (
                          <label key={c.id} className={`min-h-[36px] inline-flex items-center px-2.5 py-1 rounded-lg border text-xs cursor-pointer ${checked ? 'bg-blue-50 border-blue-900 text-blue-900 font-semibold' : 'border-slate-200 text-slate-600'}`}>
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={checked}
                              onChange={(e) =>
                                setEditingStaff((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        assignedClassIds: e.target.checked
                                          ? [...prev.assignedClassIds, c.id]
                                          : prev.assignedClassIds.filter((id) => id !== c.id),
                                      }
                                    : null
                                )
                              }
                            />
                            {c.name}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-800 min-h-[38px]">
                    <input
                      type="checkbox"
                      checked={editingStaff.canUnlockSessions}
                      onChange={(e) => setEditingStaff({ ...editingStaff, canUnlockSessions: e.target.checked })}
                    />
                    <span>Izin khusus: boleh membuka sesi ujian yang terkunci</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-800 min-h-[38px]">
                    <input
                      type="checkbox"
                      checked={editingStaff.isActive}
                      onChange={(e) => setEditingStaff({ ...editingStaff, isActive: e.target.checked })}
                    />
                    <span>Akun pengawas aktif</span>
                  </label>
                </>
              )}
            </div>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditingStaff(null)} className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium">
                Batal
              </button>
              <button type="submit" disabled={busy} className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-900 text-white text-sm font-semibold disabled:opacity-50">
                Simpan Perubahan
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
