import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Edit3,
  FileArchive,
  FileSpreadsheet,
  KeyRound,
  Lock,
  LockOpen,
  MessageSquare,
  Plus,
  RotateCcw,
  Search,
  Send,
  Trash2,
  Upload,
} from 'lucide-react';
import { apiFetch, withAuthTokenUrl } from '../../lib/api.ts';
import { formatBirthPlaceDate, formatGender } from '../../lib/format.ts';
import { StudentAvatar } from '../StudentAvatar.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';

interface ClassItem {
  id: string;
  name: string;
  grade_level: string;
  academic_year: string;
  student_count: number;
}

interface SubjectItem {
  id: string;
  code: string;
  name: string;
  passing_grade: number;
}

interface StudentRow {
  id: string;
  nis: string;
  nisn: string;
  pin_display: string;
  full_name: string;
  birth_place: string;
  birth_date: string;
  gender: string;
  email: string;
  photo_link: string;
  class_id: string;
  class_name: string;
  hasPhoto: boolean;
  photoUrl: string | null;
  photo_updated_at: string | null;
  is_active: number;
}

interface BulkPhotoPreview {
  previewId: string;
  totalFiles: number;
  matchedCount: number;
  errorCount: number;
  entries: Array<{
    entryName: string;
    baseName: string;
    nisCandidate: string;
    status: string;
    reason?: string;
    studentName?: string;
    className?: string;
    previewBase64?: string;
  }>;
}

interface StudentImportPreview {
  previewId: string;
  totalRows: number;
  validCount: number;
  errorCount: number;
  rows: Array<{
    row: number;
    nis: string;
    nisn: string;
    fullName: string;
    birthPlace: string;
    birthDate: string;
    gender: string;
    email: string;
    photoLink: string;
    className: string;
    pin: string;
    valid: boolean;
    errors: string[];
  }>;
  issues: Array<{ row: number; column: string; message: string }>;
}

interface GenericImportPreview {
  previewId: string;
  totalRows: number;
  validCount: number;
  errorCount: number;
  issues: Array<{ row: number; column: string; message: string }>;
}

export const StudentsAndPhotosPanel: React.FC<{ isAdmin: boolean }> = ({ isAdmin }) => {
  const [subTab, setSubTab] = useState<'students' | 'photos' | 'classes'>('students');
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Selection states
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);

  // Add / Edit Student Modal
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [newStu, setNewStu] = useState({
    nis: '',
    nisn: '',
    fullName: '',
    birthPlace: '',
    birthDate: '',
    gender: '',
    email: '',
    photoLink: '',
    classId: '',
    pin: '123456',
  });
  const [editingStudent, setEditingStudent] = useState<{
    id: string;
    nis: string;
    nisn: string;
    fullName: string;
    birthPlace: string;
    birthDate: string;
    gender: string;
    email: string;
    photoLink: string;
    classId: string;
    isActive: boolean;
    resetPin: string;
  } | null>(null);

  // Add / Edit Class & Subject
  const [newClass, setNewClass] = useState({ name: '', gradeLevel: '12', academicYear: '2026/2027' });
  const [editingClass, setEditingClass] = useState<{
    id: string;
    name: string;
    gradeLevel: string;
    academicYear: string;
  } | null>(null);

  const [newSubject, setNewSubject] = useState({ code: '', name: '', passingGrade: 75 });
  const [editingSubject, setEditingSubject] = useState<{
    id: string;
    code: string;
    name: string;
    passingGrade: number;
  } | null>(null);

  // Previews & Dialogs
  const [studentImportPreview, setStudentImportPreview] = useState<StudentImportPreview | null>(null);
  const [classImportPreview, setClassImportPreview] = useState<GenericImportPreview | null>(null);
  const [subjectImportPreview, setSubjectImportPreview] = useState<GenericImportPreview | null>(null);
  const [bulkPhotoPreview, setBulkPhotoPreview] = useState<BulkPhotoPreview | null>(null);
  const [showPinConfigModal, setShowPinConfigModal] = useState(false);
  const [pinConfigScope, setPinConfigScope] = useState<'all' | 'class' | 'selected'>('all');
  const [pinConfigClassId, setPinConfigClassId] = useState('');
  const [pinConfigStudentIds, setPinConfigStudentIds] = useState<string[]>([]);
  const [pinConfigSearch, setPinConfigSearch] = useState('');
  const [pinConfigMode, setPinConfigMode] = useState<'custom' | 'random'>('custom');
  const [pinConfigValue, setPinConfigValue] = useState('123456');
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [msgScope, setMsgScope] = useState<'all' | 'class' | 'selected'>('all');
  const [msgClassId, setMsgClassId] = useState('');
  const [msgStudentIds, setMsgStudentIds] = useState<string[]>([]);
  const [msgSearch, setMsgSearch] = useState('');
  const [msgCategory, setMsgCategory] = useState<'pesan' | 'peringatan' | 'instruksi' | 'kesan'>('pesan');
  const [msgTitle, setMsgTitle] = useState('');
  const [msgBody, setMsgBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    action: () => Promise<void>;
  } | null>(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [cRes, sRes, stRes] = await Promise.all([
        apiFetch<{ classes: ClassItem[] }>('/api/admin/classes'),
        apiFetch<{ subjects: SubjectItem[] }>('/api/admin/subjects'),
        apiFetch<{ students: StudentRow[] }>('/api/admin/students'),
      ]);
      setClasses(cRes.classes);
      setSubjects(sRes.subjects);
      setStudents(stRes.students);
      setSelectedStudentIds((prev) => prev.filter((id) => stRes.students.some((s) => s.id === id)));
      setSelectedClassIds((prev) => prev.filter((id) => cRes.classes.some((c) => c.id === id)));
      setSelectedSubjectIds((prev) => prev.filter((id) => sRes.subjects.some((s) => s.id === id)));
      if (!newStu.classId && cRes.classes[0]) {
        setNewStu((prev) => ({ ...prev, classId: cRes.classes[0].id }));
      }
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal memuat data.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const filteredStudents = students.filter((s) => {
    const matchClass = classFilter === 'all' || s.class_id === classFilter;
    const q = search.trim().toLowerCase();
    const matchSearch =
      !q ||
      s.full_name.toLowerCase().includes(q) ||
      s.nis.toLowerCase().includes(q) ||
      s.nisn.toLowerCase().includes(q) ||
      (s.email || '').toLowerCase().includes(q);
    return matchClass && matchSearch;
  });

  const allVisibleStudentsSelected =
    filteredStudents.length > 0 && filteredStudents.every((s) => selectedStudentIds.includes(s.id));
  const allClassesSelected = classes.length > 0 && classes.every((c) => selectedClassIds.includes(c.id));
  const allSubjectsSelected = subjects.length > 0 && subjects.every((s) => selectedSubjectIds.includes(s.id));

  const toggleAllVisibleStudents = (checked: boolean) => {
    const visibleIds = filteredStudents.map((s) => s.id);
    if (checked) {
      setSelectedStudentIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    } else {
      setSelectedStudentIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    }
  };

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanner(null);
    try {
      await apiFetch('/api/admin/students', { method: 'POST', body: JSON.stringify(newStu) });
      setShowAddStudent(false);
      setNewStu({
        nis: '',
        nisn: '',
        fullName: '',
        birthPlace: '',
        birthDate: '',
        gender: '',
        email: '',
        photoLink: '',
        classId: classes[0]?.id || '',
        pin: '123456',
      });
      setBanner({ type: 'ok', text: 'Siswa baru berhasil ditambahkan.' });
      await loadAll();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal menambah siswa.' });
    }
  };

  const handleUpdateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudent) return;
    setBusy(true);
    setBanner(null);
    try {
      await apiFetch(`/api/admin/students/${editingStudent.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          nis: editingStudent.nis,
          nisn: editingStudent.nisn,
          fullName: editingStudent.fullName,
          birthPlace: editingStudent.birthPlace,
          birthDate: editingStudent.birthDate,
          gender: editingStudent.gender,
          email: editingStudent.email,
          photoLink: editingStudent.photoLink,
          classId: editingStudent.classId,
          isActive: editingStudent.isActive,
          resetPin: editingStudent.resetPin.trim() || undefined,
        }),
      });
      setEditingStudent(null);
      setBanner({ type: 'ok', text: 'Data siswa berhasil diperbarui.' });
      await loadAll();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal memperbarui data siswa.' });
    } finally {
      setBusy(false);
    }
  };

  const handleResetPin = async (stu: StudentRow) => {
    const nextPin = String(Math.floor(100000 + Math.random() * 900000));
    try {
      await apiFetch(`/api/admin/students/${stu.id}`, {
        method: 'PUT',
        body: JSON.stringify({ nis: stu.nis, resetPin: nextPin }),
      });
      setBanner({ type: 'ok', text: `PIN siswa ${stu.full_name} (${stu.nis}) direset menjadi ${nextPin}.` });
      await loadAll();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal mereset PIN.' });
    }
  };

  const openPinConfigModal = (defaultScope: 'all' | 'class' | 'selected' = 'all') => {
    setPinConfigScope(defaultScope);
    setPinConfigClassId(classFilter !== 'all' ? classFilter : classes[0]?.id || '');
    setPinConfigStudentIds(selectedStudentIds.length > 0 ? [...selectedStudentIds] : []);
    setPinConfigSearch('');
    setPinConfigMode('custom');
    setPinConfigValue('123456');
    setShowPinConfigModal(true);
  };

  const generateRandomTokenString = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  };

  const handleSaveBulkPinConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setBanner(null);
    try {
      const res = await apiFetch<{ updatedCount: number; mode: string }>('/api/admin/students/bulk-pin', {
        method: 'POST',
        body: JSON.stringify({
          scope: pinConfigScope,
          classId: pinConfigScope === 'class' ? pinConfigClassId : undefined,
          studentIds: pinConfigScope === 'selected' ? pinConfigStudentIds : undefined,
          mode: pinConfigMode,
          pinValue: pinConfigMode === 'custom' ? pinConfigValue.trim() : undefined,
        }),
      });
      setShowPinConfigModal(false);
      setBanner({
        type: 'ok',
        text:
          res.mode === 'custom'
            ? `PIN / Token ujian "${pinConfigValue.trim()}" berhasil diterapkan untuk ${res.updatedCount} siswa.`
            : `PIN acak baru berhasil dibuat untuk ${res.updatedCount} siswa.`,
      });
      await loadAll();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal mengatur PIN / Token siswa.' });
    } finally {
      setBusy(false);
    }
  };

  const handleBulkStudentAccountAction = async (
    action: 'lock_account' | 'unlock_account' | 'reset_access',
    targetIds: string[]
  ) => {
    if (targetIds.length === 0) return;
    setBusy(true);
    setBanner(null);
    try {
      const res = await apiFetch<{ updatedCount: number }>('/api/admin/students/bulk-action', {
        method: 'POST',
        body: JSON.stringify({
          action,
          scope: 'selected',
          studentIds: targetIds,
        }),
      });
      const label =
        action === 'lock_account'
          ? `${res.updatedCount} akun siswa berhasil dikunci (dinonaktifkan).`
          : action === 'unlock_account'
          ? `${res.updatedCount} akun siswa berhasil dibuka kuncinya (diaktifkan & reset blokir login).`
          : `Akses login & batas salah PIN untuk ${res.updatedCount} siswa berhasil direset.`;
      setBanner({ type: 'ok', text: label });
      await loadAll();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal memproses aksi akun siswa.' });
    } finally {
      setBusy(false);
    }
  };

  const openSendMessageModal = (defaultScope: 'all' | 'class' | 'selected' = 'all', presetStudentIds?: string[]) => {
    const resolvedScope = !isAdmin && defaultScope === 'all' ? 'class' : defaultScope;
    setMsgScope(resolvedScope);
    setMsgClassId(classFilter !== 'all' ? classFilter : classes[0]?.id || '');
    setMsgStudentIds(presetStudentIds ? [...presetStudentIds] : [...selectedStudentIds]);
    setMsgSearch('');
    setMsgCategory('pesan');
    setMsgTitle('');
    setMsgBody('');
    setShowMessageModal(true);
  };

  const handleSendStudentMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!msgBody.trim()) return;
    setBusy(true);
    setBanner(null);
    try {
      const res = await apiFetch<{ sentCount: number }>('/api/admin/messages/send', {
        method: 'POST',
        body: JSON.stringify({
          scope: msgScope,
          classId: msgScope === 'class' ? msgClassId : undefined,
          studentIds: msgScope === 'selected' ? msgStudentIds : undefined,
          category: msgCategory,
          title: msgTitle.trim() || undefined,
          message: msgBody.trim(),
        }),
      });
      setShowMessageModal(false);
      setBanner({ type: 'ok', text: `Pesan / kesan berhasil dikirim ke ${res.sentCount} siswa.` });
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal mengirim pesan ke siswa.' });
    } finally {
      setBusy(false);
    }
  };

  const handleStudentExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setBanner(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const preview = await apiFetch<StudentImportPreview>('/api/admin/students/import-preview', {
        method: 'POST',
        body: fd,
      });
      setStudentImportPreview(preview);
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal memproses Excel siswa.' });
    } finally {
      setBusy(false);
    }
  };

  const handleCommitStudentImport = async () => {
    if (!studentImportPreview) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ importedCount: number }>('/api/admin/students/import-commit', {
        method: 'POST',
        body: JSON.stringify({ previewId: studentImportPreview.previewId }),
      });
      setStudentImportPreview(null);
      setBanner({ type: 'ok', text: `${res.importedCount} data siswa valid berhasil diimpor.` });
      await loadAll();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal menyimpan impor.' });
    } finally {
      setBusy(false);
    }
  };

  const handleClassExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setBanner(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const preview = await apiFetch<GenericImportPreview>('/api/admin/classes/import-preview', {
        method: 'POST',
        body: fd,
      });
      setClassImportPreview(preview);
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal memproses Excel kelas.' });
    } finally {
      setBusy(false);
    }
  };

  const handleCommitClassImport = async () => {
    if (!classImportPreview) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ importedCount: number }>('/api/admin/classes/import-commit', {
        method: 'POST',
        body: JSON.stringify({ previewId: classImportPreview.previewId }),
      });
      setClassImportPreview(null);
      setBanner({ type: 'ok', text: `${res.importedCount} kelas valid berhasil diimpor.` });
      await loadAll();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal menyimpan impor kelas.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSubjectExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setBanner(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const preview = await apiFetch<GenericImportPreview>('/api/admin/subjects/import-preview', {
        method: 'POST',
        body: fd,
      });
      setSubjectImportPreview(preview);
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal memproses Excel mapel.' });
    } finally {
      setBusy(false);
    }
  };

  const handleCommitSubjectImport = async () => {
    if (!subjectImportPreview) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ importedCount: number }>('/api/admin/subjects/import-commit', {
        method: 'POST',
        body: JSON.stringify({ previewId: subjectImportPreview.previewId }),
      });
      setSubjectImportPreview(null);
      setBanner({ type: 'ok', text: `${res.importedCount} mata pelajaran valid berhasil diimpor.` });
      await loadAll();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal menyimpan impor mapel.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSinglePhotoUpload = async (studentId: string, file: File) => {
    setBusy(true);
    setBanner(null);
    try {
      const fd = new FormData();
      fd.append('photo', file);
      await apiFetch(`/api/admin/photos/student/${studentId}`, { method: 'POST', body: fd });
      setBanner({ type: 'ok', text: 'Foto resmi siswa berhasil diperbarui dan dicatat dalam audit log.' });
      await loadAll();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal mengunggah foto.' });
    } finally {
      setBusy(false);
    }
  };

  const handleBulkZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setBanner(null);
    try {
      const fd = new FormData();
      fd.append('zipFile', file);
      const preview = await apiFetch<BulkPhotoPreview>('/api/admin/photos/bulk-preview', {
        method: 'POST',
        body: fd,
      });
      setBulkPhotoPreview(preview);
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal membaca ZIP foto.' });
    } finally {
      setBusy(false);
    }
  };

  const handleCommitBulkPhotos = async () => {
    if (!bulkPhotoPreview) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ savedCount: number }>('/api/admin/photos/bulk-commit', {
        method: 'POST',
        body: JSON.stringify({ previewId: bulkPhotoPreview.previewId }),
      });
      setBulkPhotoPreview(null);
      setBanner({ type: 'ok', text: `${res.savedCount} foto resmi siswa berhasil disimpan dari arsip ZIP.` });
      await loadAll();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal menyimpan foto massal.' });
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

  const studentExportUrl = withAuthTokenUrl(
    `/api/admin/students/export.xlsx${selectedStudentIds.length > 0 ? `?ids=${encodeURIComponent(selectedStudentIds.join(','))}` : ''}`
  );
  const classExportUrl = withAuthTokenUrl(
    `/api/admin/classes/export.xlsx${selectedClassIds.length > 0 ? `?ids=${encodeURIComponent(selectedClassIds.join(','))}` : ''}`
  );
  const subjectExportUrl = withAuthTokenUrl(
    `/api/admin/subjects/export.xlsx${selectedSubjectIds.length > 0 ? `?ids=${encodeURIComponent(selectedSubjectIds.join(','))}` : ''}`
  );

  return (
    <div className="space-y-6">
      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex p-1 bg-slate-200/70 rounded-xl overflow-x-auto no-scrollbar max-w-full">
          <button
            type="button"
            onClick={() => setSubTab('students')}
            className={`min-h-[38px] px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap ${
              subTab === 'students' ? 'bg-white text-blue-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Data Siswa ({students.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('photos')}
            className={`min-h-[38px] px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap ${
              subTab === 'photos' ? 'bg-white text-blue-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Foto Resmi Siswa
          </button>
          <button
            type="button"
            onClick={() => setSubTab('classes')}
            className={`min-h-[38px] px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap ${
              subTab === 'classes' ? 'bg-white text-blue-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Kelas &amp; Mata Pelajaran
          </button>
        </div>
      </div>

      {banner && (
        <div
          className={`p-3.5 rounded-xl border text-sm flex items-center gap-2 ${
            banner.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {banner.type === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span>{banner.text}</span>
        </div>
      )}

      {subTab === 'students' && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="bg-white border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-1">
              <div className="relative flex-1 sm:max-w-xs">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari nama, NIS, atau NISN..."
                  className="w-full min-h-[42px] pl-9 pr-3 rounded-xl border border-slate-300 text-base sm:text-sm"
                />
              </div>
              <select
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                className="min-h-[42px] px-3 rounded-xl border border-slate-300 bg-white text-base sm:text-sm"
              >
                <option value="all">Semua Kelas</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => openSendMessageModal(selectedStudentIds.length > 0 ? 'selected' : isAdmin ? 'all' : 'class')}
                className="min-h-[40px] px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-[#0e539a] flex items-center gap-1.5"
              >
                <MessageSquare className="w-4 h-4" />
                <span>Kirim Pesan / Kesan</span>
              </button>
              {isAdmin && (
                <>
                  <a
                    href={withAuthTokenUrl('/api/admin/templates/students.xlsx')}
                    className="min-h-[40px] px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5"
                  >
                    <Download className="w-4 h-4" />
                    <span>Template Excel</span>
                  </a>
                  <label className="min-h-[40px] px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer">
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>Impor Excel</span>
                    <input type="file" accept=".xlsx,.xls" onChange={handleStudentExcelUpload} className="hidden" />
                  </label>
                  <a
                    href={studentExportUrl}
                    className="min-h-[40px] px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5"
                  >
                    <Download className="w-4 h-4" />
                    <span>{selectedStudentIds.length > 0 ? `Ekspor Terpilih (${selectedStudentIds.length})` : 'Ekspor Semua'}</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => openPinConfigModal(selectedStudentIds.length > 0 ? 'selected' : 'all')}
                    className="min-h-[40px] px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5"
                  >
                    <KeyRound className="w-4 h-4 text-[#0e539a]" />
                    <span>Atur PIN / Token</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddStudent(true)}
                    className="min-h-[40px] px-4 py-2 rounded-xl bg-blue-900 hover:bg-blue-800 text-white text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Tambah Siswa</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Selection Action Bar */}
          {isAdmin && selectedStudentIds.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs sm:text-sm font-semibold text-blue-900">
                {selectedStudentIds.length} siswa dipilih
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleBulkStudentAccountAction('lock_account', selectedStudentIds)}
                  className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white border border-amber-300 hover:bg-amber-50 text-xs font-semibold text-amber-900 inline-flex items-center gap-1.5"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Kunci Akun</span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleBulkStudentAccountAction('unlock_account', selectedStudentIds)}
                  className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white border border-blue-200 hover:bg-blue-100/50 text-xs font-semibold text-blue-900 inline-flex items-center gap-1.5"
                >
                  <LockOpen className="w-3.5 h-3.5" />
                  <span>Buka Kunci</span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleBulkStudentAccountAction('reset_access', selectedStudentIds)}
                  className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white border border-blue-200 hover:bg-blue-100/50 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Akses</span>
                </button>
                <button
                  type="button"
                  onClick={() => openSendMessageModal('selected', selectedStudentIds)}
                  className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#0e539a] hover:bg-[#0b437e] text-white text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Kirim Pesan</span>
                </button>
                <button
                  type="button"
                  onClick={() => openPinConfigModal('selected')}
                  className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white border border-blue-200 hover:bg-blue-100/50 text-xs font-semibold text-blue-900 inline-flex items-center gap-1.5"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Atur PIN / Token</span>
                </button>
                <a
                  href={studentExportUrl}
                  className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white border border-blue-200 hover:bg-blue-100/50 text-xs font-semibold text-blue-900 inline-flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Ekspor (.xlsx)</span>
                </a>
                <button
                  type="button"
                  onClick={() =>
                    setConfirmState({
                      title: 'Hapus Siswa Terpilih',
                      message: `Anda akan menghapus permanen ${selectedStudentIds.length} data siswa beserta sesi dan fotonya. Lanjutkan?`,
                      confirmLabel: `Hapus ${selectedStudentIds.length} Siswa`,
                      action: async () => {
                        const res = await apiFetch<{ deletedCount: number }>('/api/admin/students/bulk-delete', {
                          method: 'POST',
                          body: JSON.stringify({ ids: selectedStudentIds }),
                        });
                        setSelectedStudentIds([]);
                        setBanner({ type: 'ok', text: `${res.deletedCount} data siswa berhasil dihapus.` });
                        await loadAll();
                      },
                    })
                  }
                  className="min-h-[38px] px-3 py-1.5 rounded-xl bg-red-700 hover:bg-red-800 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Hapus Terpilih</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedStudentIds([])}
                  className="min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700"
                >
                  Bersihkan Pilihan
                </button>
              </div>
            </div>
          )}

          {/* Excel Import Preview */}
          {studentImportPreview && (
            <div className="bg-white border border-blue-200 rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display font-bold text-slate-900">Pratinjau Impor Data Siswa Excel</h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Total {studentImportPreview.totalRows} baris · Valid: {studentImportPreview.validCount} · Bermasalah: {studentImportPreview.errorCount}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStudentImportPreview(null)}
                    className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700"
                  >
                    Batalkan Impor
                  </button>
                  <button
                    type="button"
                    disabled={busy || studentImportPreview.validCount === 0}
                    onClick={handleCommitStudentImport}
                    className="px-4 py-2 rounded-xl bg-blue-900 text-white text-xs font-semibold disabled:opacity-50"
                  >
                    Simpan {studentImportPreview.validCount} Siswa Valid
                  </button>
                </div>
              </div>
              {studentImportPreview.issues.length > 0 && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 max-h-40 overflow-y-auto space-y-1">
                  {studentImportPreview.issues.map((iss, i) => (
                    <p key={i}>Baris {iss.row} (Kolom {iss.column}): {iss.message}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Students List: Mobile Cards (md:hidden) + Desktop Table (hidden md:block) */}
          <div className="bg-white border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-2xl overflow-hidden">
            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {isAdmin && filteredStudents.length > 0 && (
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      aria-label="Pilih semua siswa tampil"
                      checked={allVisibleStudentsSelected}
                      onChange={(e) => toggleAllVisibleStudents(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-900"
                    />
                    <span>Pilih Semua ({filteredStudents.length})</span>
                  </label>
                </div>
              )}
              {loading ? (
                <div className="p-8 text-center text-sm text-slate-500">Memuat data siswa...</div>
              ) : filteredStudents.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">Tidak ada siswa yang sesuai filter.</div>
              ) : (
                filteredStudents.map((stu) => {
                  const isChecked = selectedStudentIds.includes(stu.id);
                  return (
                    <div key={stu.id} className={`p-4 space-y-3 ${isChecked ? 'bg-blue-50/40' : ''}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          {isAdmin && (
                            <input
                              type="checkbox"
                              aria-label={`Pilih ${stu.full_name}`}
                              checked={isChecked}
                              onChange={(e) => {
                                setSelectedStudentIds((prev) =>
                                  e.target.checked ? [...prev, stu.id] : prev.filter((id) => id !== stu.id)
                                );
                              }}
                              className="w-4 h-4 rounded border-slate-300 text-blue-900 shrink-0"
                            />
                          )}
                          <StudentAvatar photoUrl={stu.photoUrl} fullName={stu.full_name} size="sm" />
                          <div className="min-w-0">
                            <p className="font-semibold text-sm text-slate-900 truncate">{stu.full_name}</p>
                            <p className="text-xs font-mono text-slate-500 tabular-nums">
                              NIS {stu.nis} · {stu.class_name}
                            </p>
                          </div>
                        </div>
                        <span className={`text-xs font-semibold shrink-0 ${stu.is_active ? 'text-emerald-700' : 'text-red-700'}`}>
                          {stu.is_active ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </div>

                      <div className="space-y-1 text-xs text-slate-600 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200/60">
                        <div className="flex items-center justify-between font-mono tabular-nums">
                          <span>NISN: {stu.nisn}</span>
                          <span>PIN: <strong className="text-slate-900">{stu.pin_display}</strong></span>
                        </div>
                        <p className="text-[11px] text-slate-600 truncate">
                          {formatGender(stu.gender)} · TTL: {formatBirthPlaceDate(stu.birth_place, stu.birth_date)}
                        </p>
                        {stu.email && (
                          <p className="text-[11px] text-slate-600 truncate">
                            Email: {stu.email}
                          </p>
                        )}
                      </div>

                      {isAdmin && (
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setEditingStudent({
                                id: stu.id,
                                nis: stu.nis,
                                nisn: stu.nisn,
                                fullName: stu.full_name,
                                birthPlace: stu.birth_place || '',
                                birthDate: stu.birth_date || '',
                                gender: stu.gender || '',
                                email: stu.email || '',
                                photoLink: stu.photo_link || '',
                                classId: stu.class_id,
                                isActive: Boolean(stu.is_active),
                                resetPin: '',
                              })
                            }
                            className="min-h-[40px] px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center justify-center gap-1.5"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleResetPin(stu)}
                            className="min-h-[40px] px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700"
                          >
                            Reset PIN
                          </button>
                          <button
                            type="button"
                            onClick={() => handleBulkStudentAccountAction(stu.is_active ? 'lock_account' : 'unlock_account', [stu.id])}
                            className="min-h-[40px] px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center justify-center gap-1.5"
                          >
                            {stu.is_active ? <Lock className="w-3.5 h-3.5 text-amber-700" /> : <LockOpen className="w-3.5 h-3.5 text-blue-900" />}
                            <span>{stu.is_active ? 'Kunci Akun' : 'Buka Kunci'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openSendMessageModal('selected', [stu.id])}
                            className="min-h-[40px] px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-[#0e539a] inline-flex items-center justify-center gap-1.5"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            <span>Pesan</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmState({
                                title: 'Hapus Siswa',
                                message: `Hapus siswa ${stu.full_name} (${stu.nis}) beserta seluruh riwayat ujian dan fotonya?`,
                                confirmLabel: 'Ya, Hapus Siswa',
                                action: async () => {
                                  await apiFetch(`/api/admin/students/${stu.id}`, { method: 'DELETE' });
                                  setBanner({ type: 'ok', text: `Siswa ${stu.full_name} berhasil dihapus.` });
                                  await loadAll();
                                },
                              })
                            }
                            className="col-span-2 min-h-[40px] px-3 rounded-xl border border-red-200 hover:bg-red-50 text-xs font-semibold text-red-700 inline-flex items-center justify-center gap-1.5"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Hapus</span>
                          </button>
                        </div>
                      )}
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
                    {isAdmin && (
                      <th className="pl-4 pr-2 py-3 w-10">
                        <input
                          type="checkbox"
                          aria-label="Pilih semua siswa tampil"
                          checked={allVisibleStudentsSelected}
                          onChange={(e) => toggleAllVisibleStudents(e.target.checked)}
                          className="w-4 h-4 rounded border-slate-300 text-blue-900"
                        />
                      </th>
                    )}
                    <th className="px-4 py-3">Peserta</th>
                    <th className="px-4 py-3">NIS / NISN</th>
                    <th className="px-4 py-3">L/P &amp; TTL</th>
                    <th className="px-4 py-3">Alamat Email</th>
                    <th className="px-4 py-3">Kelas</th>
                    <th className="px-4 py-3">PIN Ujian</th>
                    <th className="px-4 py-3">Status</th>
                    {isAdmin && <th className="px-4 py-3 text-right">Aksi</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr><td colSpan={isAdmin ? 9 : 7} className="p-8 text-center text-slate-500">Memuat data siswa...</td></tr>
                  ) : filteredStudents.length === 0 ? (
                    <tr><td colSpan={isAdmin ? 9 : 7} className="p-8 text-center text-slate-500">Tidak ada siswa yang sesuai filter.</td></tr>
                  ) : (
                    filteredStudents.map((stu) => {
                      const isChecked = selectedStudentIds.includes(stu.id);
                      return (
                        <tr key={stu.id} className={`hover:bg-slate-50/70 ${isChecked ? 'bg-blue-50/40' : ''}`}>
                          {isAdmin && (
                            <td className="pl-4 pr-2 py-3">
                              <input
                                type="checkbox"
                                aria-label={`Pilih ${stu.full_name}`}
                                checked={isChecked}
                                onChange={(e) => {
                                  setSelectedStudentIds((prev) =>
                                    e.target.checked ? [...prev, stu.id] : prev.filter((id) => id !== stu.id)
                                  );
                                }}
                                className="w-4 h-4 rounded border-slate-300 text-blue-900"
                              />
                            </td>
                          )}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <StudentAvatar photoUrl={stu.photoUrl} fullName={stu.full_name} size="sm" />
                              <div>
                                <p className="font-semibold text-slate-900">{stu.full_name}</p>
                                <p className="text-[11px] text-slate-500">
                                  {stu.hasPhoto ? 'Foto resmi tersedia' : 'Avatar standar'}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs tabular-nums text-slate-700">
                            <div>{stu.nis}</div>
                            <div className="text-slate-400">{stu.nisn}</div>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-700 tabular-nums">
                            <div className="font-medium text-slate-900">{formatGender(stu.gender)}</div>
                            <div className="text-[11px] text-slate-500">{formatBirthPlaceDate(stu.birth_place, stu.birth_date)}</div>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-700 max-w-[220px]">
                            <div className="truncate">{stu.email || <span className="text-slate-400">Belum ada email</span>}</div>
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-800">{stu.class_name}</td>
                          <td className="px-4 py-3 font-mono text-xs tabular-nums">{stu.pin_display}</td>
                          <td className="px-4 py-3 text-xs font-semibold">
                            <span className={stu.is_active ? 'text-emerald-700' : 'text-red-700'}>
                              {stu.is_active ? 'Aktif' : 'Nonaktif'}
                            </span>
                          </td>
                          {isAdmin && (
                            <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() =>
                                  setEditingStudent({
                                    id: stu.id,
                                    nis: stu.nis,
                                    nisn: stu.nisn,
                                    fullName: stu.full_name,
                                    birthPlace: stu.birth_place || '',
                                    birthDate: stu.birth_date || '',
                                    gender: stu.gender || '',
                                    email: stu.email || '',
                                    photoLink: stu.photo_link || '',
                                    classId: stu.class_id,
                                    isActive: Boolean(stu.is_active),
                                    resetPin: '',
                                  })
                                }
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-xs font-medium text-slate-800 inline-flex items-center gap-1"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                <span>Edit</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleResetPin(stu)}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-xs font-medium text-slate-700"
                              >
                                Reset PIN
                              </button>
                              <button
                                type="button"
                                onClick={() => handleBulkStudentAccountAction(stu.is_active ? 'lock_account' : 'unlock_account', [stu.id])}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-xs font-medium text-slate-700 inline-flex items-center gap-1"
                              >
                                {stu.is_active ? <Lock className="w-3.5 h-3.5 text-amber-700" /> : <LockOpen className="w-3.5 h-3.5 text-blue-900" />}
                                <span>{stu.is_active ? 'Kunci' : 'Buka Kunci'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => openSendMessageModal('selected', [stu.id])}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-xs font-medium text-[#0e539a] inline-flex items-center gap-1"
                              >
                                <MessageSquare className="w-3.5 h-3.5" />
                                <span>Pesan</span>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmState({
                                    title: 'Hapus Siswa',
                                    message: `Hapus siswa ${stu.full_name} (${stu.nis}) beserta seluruh riwayat ujian dan fotonya?`,
                                    confirmLabel: 'Ya, Hapus Siswa',
                                    action: async () => {
                                      await apiFetch(`/api/admin/students/${stu.id}`, { method: 'DELETE' });
                                      setBanner({ type: 'ok', text: `Siswa ${stu.full_name} berhasil dihapus.` });
                                      await loadAll();
                                    },
                                  })
                                }
                                className="px-2.5 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 text-xs font-medium text-red-700 inline-flex items-center gap-1"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Hapus</span>
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {subTab === 'photos' && (
        <div className="space-y-5">
          {/* Dedicated Bulk Photo ZIP Card */}
          <section className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-display font-bold text-slate-900">
                Pengelolaan Foto Resmi Siswa (Terpisah dari Impor Data)
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 mt-1">
                Hanya Admin yang dapat mengunggah, mengganti, atau menghapus foto siswa. Unggah arsip ZIP berisi file JPG/PNG dengan nama file sesuai NIS (misal: <span className="font-mono">2026001.jpg</span>).
              </p>
            </div>
            {isAdmin && (
              <label className="min-h-[44px] px-4 py-2.5 rounded-xl bg-blue-900 hover:bg-blue-800 text-white text-xs sm:text-sm font-semibold flex items-center gap-2 cursor-pointer shrink-0">
                <FileArchive className="w-4 h-4" />
                <span>Unggah Massal ZIP</span>
                <input type="file" accept=".zip" onChange={handleBulkZipUpload} className="hidden" />
              </label>
            )}
          </section>

          {/* Bulk ZIP Preview Before Save */}
          {bulkPhotoPreview && (
            <section className="bg-white border border-blue-200 rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display font-bold text-slate-900">Pratinjau Pencocokan Foto ZIP Sebelum Disimpan</h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Total berkas: {bulkPhotoPreview.totalFiles} · Cocok NIS: {bulkPhotoPreview.matchedCount} · Bermasalah: {bulkPhotoPreview.errorCount}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setBulkPhotoPreview(null)}
                    className="px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    disabled={busy || bulkPhotoPreview.matchedCount === 0}
                    onClick={handleCommitBulkPhotos}
                    className="px-4 py-2 rounded-xl bg-blue-900 text-white text-xs font-semibold disabled:opacity-50"
                  >
                    Simpan {bulkPhotoPreview.matchedCount} Foto Cocok
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-96 overflow-y-auto">
                {bulkPhotoPreview.entries.map((entry, idx) => (
                  <div key={idx} className="p-3 rounded-xl border border-slate-200 flex items-center gap-3 bg-slate-50">
                    {entry.previewBase64 ? (
                      <img src={entry.previewBase64} alt={entry.baseName} className="w-12 h-12 rounded-lg object-cover border border-slate-200 shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-red-100 text-red-700 flex items-center justify-center text-xs font-bold shrink-0">ERR</div>
                    )}
                    <div className="min-w-0 text-xs">
                      <p className="font-mono font-bold text-slate-900 truncate">{entry.baseName}</p>
                      {entry.status === 'matched' ? (
                        <p className="text-emerald-700 font-medium truncate">
                          Cocok: {entry.studentName} ({entry.className})
                        </p>
                      ) : (
                        <p className="text-red-700">{entry.reason}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Individual Photo Management Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredStudents.map((stu) => (
              <div key={stu.id} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <StudentAvatar photoUrl={stu.photoUrl} fullName={stu.full_name} size="lg" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{stu.full_name}</p>
                    <p className="text-xs font-mono text-slate-600">{stu.nis} · {stu.class_name}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {stu.hasPhoto ? 'Foto resmi terpasang' : 'Menggunakan avatar standar'}
                    </p>
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <label className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1 cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      <span>{stu.hasPhoto ? 'Ganti' : 'Unggah'}</span>
                      <input
                        type="file"
                        accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (f) handleSinglePhotoUpload(stu.id, f);
                        }}
                        className="hidden"
                      />
                    </label>
                    {stu.hasPhoto && (
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmState({
                            title: 'Hapus Foto Siswa',
                            message: `Hapus foto resmi untuk ${stu.full_name} (${stu.nis})?`,
                            confirmLabel: 'Hapus Foto',
                            action: async () => {
                              await apiFetch(`/api/admin/photos/student/${stu.id}`, { method: 'DELETE' });
                              setBanner({ type: 'ok', text: 'Foto siswa dihapus.' });
                              await loadAll();
                            },
                          })
                        }
                        className="px-2.5 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 text-xs font-semibold text-red-700 flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Hapus</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {subTab === 'classes' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Classes */}
          <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display font-bold text-slate-900">Daftar Kelas ({classes.length})</h3>
              {isAdmin && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <a
                    href={withAuthTokenUrl('/api/admin/templates/classes.xlsx')}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Template</span>
                  </a>
                  <label className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer">
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    <span>Impor</span>
                    <input type="file" accept=".xlsx,.xls" onChange={handleClassExcelUpload} className="hidden" />
                  </label>
                  <a
                    href={classExportUrl}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{selectedClassIds.length > 0 ? `Ekspor (${selectedClassIds.length})` : 'Ekspor'}</span>
                  </a>
                </div>
              )}
            </div>

            {classImportPreview && (
              <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200 space-y-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">
                    Pratinjau Impor Kelas: {classImportPreview.validCount}/{classImportPreview.totalRows} valid
                  </span>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => setClassImportPreview(null)} className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white font-semibold">
                      Batal
                    </button>
                    <button
                      type="button"
                      disabled={busy || classImportPreview.validCount === 0}
                      onClick={handleCommitClassImport}
                      className="px-3 py-1 rounded-lg bg-blue-900 text-white font-semibold disabled:opacity-50"
                    >
                      Simpan Valid
                    </button>
                  </div>
                </div>
                {classImportPreview.issues.length > 0 && (
                  <div className="text-red-700 space-y-0.5 max-h-24 overflow-y-auto">
                    {classImportPreview.issues.map((iss, i) => (
                      <p key={i}>Baris {iss.row} ({iss.column}): {iss.message}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {isAdmin && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await apiFetch('/api/admin/classes', { method: 'POST', body: JSON.stringify(newClass) });
                    setNewClass({ name: '', gradeLevel: '12', academicYear: '2026/2027' });
                    setBanner({ type: 'ok', text: 'Kelas baru berhasil ditambahkan.' });
                    await loadAll();
                  } catch (err) {
                    setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal menambah kelas.' });
                  }
                }}
                className="flex flex-wrap gap-2"
              >
                <input
                  type="text"
                  required
                  placeholder="Nama kelas (misal XII-IPS-1)"
                  value={newClass.name}
                  onChange={(e) => setNewClass({ ...newClass, name: e.target.value })}
                  className="flex-1 min-w-[140px] px-3 py-2 rounded-xl border border-slate-300 text-sm"
                />
                <select
                  value={newClass.gradeLevel}
                  onChange={(e) => setNewClass({ ...newClass, gradeLevel: e.target.value })}
                  className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm"
                >
                  <option value="10">Tingkat 10</option>
                  <option value="11">Tingkat 11</option>
                  <option value="12">Tingkat 12</option>
                </select>
                <button type="submit" className="px-4 py-2 rounded-xl bg-blue-900 text-white text-xs font-semibold">
                  Tambah Kelas
                </button>
              </form>
            )}

            {isAdmin && selectedClassIds.length > 0 && (
              <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-blue-900">{selectedClassIds.length} kelas dipilih</span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setConfirmState({
                        title: 'Hapus Kelas Terpilih',
                        message: `Hapus ${selectedClassIds.length} kelas terpilih? Kelas yang masih memiliki siswa akan dilewati otomatis.`,
                        confirmLabel: 'Hapus Terpilih',
                        action: async () => {
                          const res = await apiFetch<{ deletedCount: number; skipped: string[] }>('/api/admin/classes/bulk-delete', {
                            method: 'POST',
                            body: JSON.stringify({ ids: selectedClassIds }),
                          });
                          setSelectedClassIds([]);
                          const skippedMsg = res.skipped.length > 0 ? ` Dilewati (masih ada siswa): ${res.skipped.join(', ')}.` : '';
                          setBanner({ type: 'ok', text: `${res.deletedCount} kelas berhasil dihapus.${skippedMsg}` });
                          await loadAll();
                        },
                      })
                    }
                    className="px-2.5 py-1 rounded-lg bg-red-700 text-white font-semibold"
                  >
                    Hapus Terpilih
                  </button>
                  <button type="button" onClick={() => setSelectedClassIds([])} className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white font-semibold">
                    Bersihkan
                  </button>
                </div>
              </div>
            )}

            {isAdmin && classes.length > 0 && (
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 pb-1 border-b border-slate-100">
                <input
                  type="checkbox"
                  checked={allClassesSelected}
                  onChange={(e) => setSelectedClassIds(e.target.checked ? classes.map((c) => c.id) : [])}
                  className="w-4 h-4 rounded border-slate-300"
                />
                <span>Pilih Semua Kelas</span>
              </label>
            )}

            <div className="divide-y divide-slate-100 text-sm">
              {classes.map((c) => (
                <div key={c.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {isAdmin && (
                      <input
                        type="checkbox"
                        aria-label={`Pilih kelas ${c.name}`}
                        checked={selectedClassIds.includes(c.id)}
                        onChange={(e) =>
                          setSelectedClassIds((prev) =>
                            e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)
                          )
                        }
                        className="w-4 h-4 rounded border-slate-300 shrink-0"
                      />
                    )}
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-900">{c.name}</span>
                      <span className="text-xs text-slate-500 ml-2">Tingkat {c.grade_level} · {c.academic_year}</span>
                      <span className="block sm:inline font-mono text-xs text-slate-500 sm:ml-2 tabular-nums">({c.student_count} siswa)</span>
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setEditingClass({
                            id: c.id,
                            name: c.name,
                            gradeLevel: c.grade_level,
                            academicYear: c.academic_year,
                          })
                        }
                        className="px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700"
                        title="Edit kelas"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmState({
                            title: 'Hapus Kelas',
                            message: `Hapus kelas ${c.name}? Kelas yang masih memiliki siswa tidak dapat dihapus.`,
                            confirmLabel: 'Ya, Hapus Kelas',
                            action: async () => {
                              await apiFetch(`/api/admin/classes/${c.id}`, { method: 'DELETE' });
                              setBanner({ type: 'ok', text: `Kelas ${c.name} berhasil dihapus.` });
                              await loadAll();
                            },
                          })
                        }
                        className="p-1.5 rounded-lg border border-red-200 hover:bg-red-50 text-red-700"
                        title="Hapus kelas"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Subjects */}
          <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display font-bold text-slate-900">Mata Pelajaran &amp; KKM ({subjects.length})</h3>
              {isAdmin && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <a
                    href={withAuthTokenUrl('/api/admin/templates/subjects.xlsx')}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Template</span>
                  </a>
                  <label className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer">
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    <span>Impor</span>
                    <input type="file" accept=".xlsx,.xls" onChange={handleSubjectExcelUpload} className="hidden" />
                  </label>
                  <a
                    href={subjectExportUrl}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{selectedSubjectIds.length > 0 ? `Ekspor (${selectedSubjectIds.length})` : 'Ekspor'}</span>
                  </a>
                </div>
              )}
            </div>

            {subjectImportPreview && (
              <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200 space-y-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">
                    Pratinjau Impor Mapel: {subjectImportPreview.validCount}/{subjectImportPreview.totalRows} valid
                  </span>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => setSubjectImportPreview(null)} className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white font-semibold">
                      Batal
                    </button>
                    <button
                      type="button"
                      disabled={busy || subjectImportPreview.validCount === 0}
                      onClick={handleCommitSubjectImport}
                      className="px-3 py-1 rounded-lg bg-blue-900 text-white font-semibold disabled:opacity-50"
                    >
                      Simpan Valid
                    </button>
                  </div>
                </div>
                {subjectImportPreview.issues.length > 0 && (
                  <div className="text-red-700 space-y-0.5 max-h-24 overflow-y-auto">
                    {subjectImportPreview.issues.map((iss, i) => (
                      <p key={i}>Baris {iss.row} ({iss.column}): {iss.message}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {isAdmin && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await apiFetch('/api/admin/subjects', { method: 'POST', body: JSON.stringify(newSubject) });
                    setNewSubject({ code: '', name: '', passingGrade: 75 });
                    setBanner({ type: 'ok', text: 'Mata pelajaran berhasil ditambahkan.' });
                    await loadAll();
                  } catch (err) {
                    setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal menambah mapel.' });
                  }
                }}
                className="flex flex-wrap gap-2"
              >
                <input
                  type="text"
                  required
                  placeholder="Kode (BIO)"
                  value={newSubject.code}
                  onChange={(e) => setNewSubject({ ...newSubject, code: e.target.value })}
                  className="w-24 px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono uppercase"
                />
                <input
                  type="text"
                  required
                  placeholder="Nama mata pelajaran"
                  value={newSubject.name}
                  onChange={(e) => setNewSubject({ ...newSubject, name: e.target.value })}
                  className="flex-1 min-w-[140px] px-3 py-2 rounded-xl border border-slate-300 text-sm"
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={newSubject.passingGrade}
                  onChange={(e) => setNewSubject({ ...newSubject, passingGrade: Number(e.target.value) })}
                  className="w-20 px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono"
                  title="KKM"
                />
                <button type="submit" className="px-4 py-2 rounded-xl bg-blue-900 text-white text-xs font-semibold">
                  Tambah Mapel
                </button>
              </form>
            )}

            {isAdmin && selectedSubjectIds.length > 0 && (
              <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-blue-900">{selectedSubjectIds.length} mapel dipilih</span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setConfirmState({
                        title: 'Hapus Mata Pelajaran Terpilih',
                        message: `Hapus ${selectedSubjectIds.length} mata pelajaran terpilih? Mapel yang masih dipakai ujian atau bank soal akan dilewati.`,
                        confirmLabel: 'Hapus Terpilih',
                        action: async () => {
                          const res = await apiFetch<{ deletedCount: number; skipped: string[] }>('/api/admin/subjects/bulk-delete', {
                            method: 'POST',
                            body: JSON.stringify({ ids: selectedSubjectIds }),
                          });
                          setSelectedSubjectIds([]);
                          const skippedMsg = res.skipped.length > 0 ? ` Dilewati (sedang digunakan): ${res.skipped.join(', ')}.` : '';
                          setBanner({ type: 'ok', text: `${res.deletedCount} mata pelajaran dihapus.${skippedMsg}` });
                          await loadAll();
                        },
                      })
                    }
                    className="px-2.5 py-1 rounded-lg bg-red-700 text-white font-semibold"
                  >
                    Hapus Terpilih
                  </button>
                  <button type="button" onClick={() => setSelectedSubjectIds([])} className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white font-semibold">
                    Bersihkan
                  </button>
                </div>
              </div>
            )}

            {isAdmin && subjects.length > 0 && (
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 pb-1 border-b border-slate-100">
                <input
                  type="checkbox"
                  checked={allSubjectsSelected}
                  onChange={(e) => setSelectedSubjectIds(e.target.checked ? subjects.map((s) => s.id) : [])}
                  className="w-4 h-4 rounded border-slate-300"
                />
                <span>Pilih Semua Mata Pelajaran</span>
              </label>
            )}

            <div className="divide-y divide-slate-100 text-sm">
              {subjects.map((s) => (
                <div key={s.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {isAdmin && (
                      <input
                        type="checkbox"
                        aria-label={`Pilih mapel ${s.name}`}
                        checked={selectedSubjectIds.includes(s.id)}
                        onChange={(e) =>
                          setSelectedSubjectIds((prev) =>
                            e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                          )
                        }
                        className="w-4 h-4 rounded border-slate-300 shrink-0"
                      />
                    )}
                    <div className="min-w-0">
                      <span className="font-mono text-xs font-bold text-blue-900 mr-2">{s.code}</span>
                      <span className="font-semibold text-slate-900">{s.name}</span>
                      <span className="font-mono text-xs text-slate-500 ml-2 tabular-nums">KKM {s.passing_grade}</span>
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setEditingSubject({
                            id: s.id,
                            code: s.code,
                            name: s.name,
                            passingGrade: s.passing_grade,
                          })
                        }
                        className="px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmState({
                            title: 'Hapus Mata Pelajaran',
                            message: `Hapus mata pelajaran ${s.name} (${s.code})?`,
                            confirmLabel: 'Ya, Hapus Mapel',
                            action: async () => {
                              await apiFetch(`/api/admin/subjects/${s.id}`, { method: 'DELETE' });
                              setBanner({ type: 'ok', text: `Mata pelajaran ${s.name} dihapus.` });
                              await loadAll();
                            },
                          })
                        }
                        className="p-1.5 rounded-lg border border-red-200 hover:bg-red-50 text-red-700"
                        title="Hapus mata pelajaran"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Add Student Modal (Bottom Sheet on Mobile) */}
      {showAddStudent && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form onSubmit={handleCreateStudent} className="bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 max-h-[92dvh] overflow-y-auto pb-safe">
            <div className="w-10 h-1 rounded-full bg-slate-300 mx-auto sm:hidden" />
            <h3 className="text-lg font-display font-bold text-slate-900">Tambah Peserta Didik Baru</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">NIS</label>
                <input
                  type="text"
                  required
                  value={newStu.nis}
                  onChange={(e) => setNewStu({ ...newStu, nis: e.target.value })}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-base sm:text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">NISN</label>
                <input
                  type="text"
                  required
                  value={newStu.nisn}
                  onChange={(e) => setNewStu({ ...newStu, nisn: e.target.value })}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-base sm:text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Lengkap</label>
                <input
                  type="text"
                  required
                  value={newStu.fullName}
                  onChange={(e) => setNewStu({ ...newStu, fullName: e.target.value })}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-base sm:text-sm"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Jenis Kelamin</label>
                  <select
                    value={newStu.gender}
                    onChange={(e) => setNewStu({ ...newStu, gender: e.target.value })}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm"
                  >
                    <option value="">-- Pilih Jenis Kelamin --</option>
                    <option value="L">Laki-laki</option>
                    <option value="P">Perempuan</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Alamat Email</label>
                  <input
                    type="email"
                    placeholder="siswa@sekolah.sch.id"
                    value={newStu.email}
                    onChange={(e) => setNewStu({ ...newStu, email: e.target.value })}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-base sm:text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tempat Lahir</label>
                  <input
                    type="text"
                    placeholder="Contoh: Jakarta"
                    value={newStu.birthPlace}
                    onChange={(e) => setNewStu({ ...newStu, birthPlace: e.target.value })}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-base sm:text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tanggal Lahir</label>
                  <input
                    type="date"
                    value={newStu.birthDate}
                    onChange={(e) => setNewStu({ ...newStu, birthDate: e.target.value })}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-base sm:text-sm tabular-nums"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Link Foto (Opsional)</label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={newStu.photoLink}
                  onChange={(e) => setNewStu({ ...newStu, photoLink: e.target.value })}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-base sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Kelas</label>
                <select
                  value={newStu.classId}
                  onChange={(e) => setNewStu({ ...newStu, classId: e.target.value })}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm"
                >
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">PIN Ujian Awal</label>
                <input
                  type="text"
                  required
                  value={newStu.pin}
                  onChange={(e) => setNewStu({ ...newStu, pin: e.target.value })}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-base sm:text-sm font-mono"
                />
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAddStudent(false)} className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium">
                Batal
              </button>
              <button type="submit" className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-900 text-white text-sm font-semibold">
                Simpan Siswa
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Student Modal (Bottom Sheet on Mobile) */}
      {editingStudent && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form onSubmit={handleUpdateStudent} className="bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 max-h-[92dvh] overflow-y-auto pb-safe">
            <div className="w-10 h-1 rounded-full bg-slate-300 mx-auto sm:hidden" />
            <h3 className="text-lg font-display font-bold text-slate-900">Edit Data Siswa</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">NIS</label>
                <input
                  type="text"
                  required
                  value={editingStudent.nis}
                  onChange={(e) => setEditingStudent({ ...editingStudent, nis: e.target.value })}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-base sm:text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">NISN</label>
                <input
                  type="text"
                  required
                  value={editingStudent.nisn}
                  onChange={(e) => setEditingStudent({ ...editingStudent, nisn: e.target.value })}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-base sm:text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Lengkap</label>
                <input
                  type="text"
                  required
                  value={editingStudent.fullName}
                  onChange={(e) => setEditingStudent({ ...editingStudent, fullName: e.target.value })}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-base sm:text-sm"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Jenis Kelamin</label>
                  <select
                    value={editingStudent.gender}
                    onChange={(e) => setEditingStudent({ ...editingStudent, gender: e.target.value })}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm"
                  >
                    <option value="">-- Pilih Jenis Kelamin --</option>
                    <option value="L">Laki-laki</option>
                    <option value="P">Perempuan</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Alamat Email</label>
                  <input
                    type="email"
                    placeholder="siswa@sekolah.sch.id"
                    value={editingStudent.email}
                    onChange={(e) => setEditingStudent({ ...editingStudent, email: e.target.value })}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-base sm:text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tempat Lahir</label>
                  <input
                    type="text"
                    placeholder="Contoh: Jakarta"
                    value={editingStudent.birthPlace}
                    onChange={(e) => setEditingStudent({ ...editingStudent, birthPlace: e.target.value })}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-base sm:text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tanggal Lahir</label>
                  <input
                    type="date"
                    value={editingStudent.birthDate}
                    onChange={(e) => setEditingStudent({ ...editingStudent, birthDate: e.target.value })}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-base sm:text-sm tabular-nums"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Link Foto (Opsional)</label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={editingStudent.photoLink}
                  onChange={(e) => setEditingStudent({ ...editingStudent, photoLink: e.target.value })}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-base sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Kelas</label>
                <select
                  value={editingStudent.classId}
                  onChange={(e) => setEditingStudent({ ...editingStudent, classId: e.target.value })}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm"
                >
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Ganti PIN Ujian (Opsional)</label>
                <input
                  type="text"
                  placeholder="Kosongkan jika PIN tidak diubah"
                  value={editingStudent.resetPin}
                  onChange={(e) => setEditingStudent({ ...editingStudent, resetPin: e.target.value })}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-base sm:text-sm font-mono"
                />
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 pt-1 min-h-[38px]">
                <input
                  type="checkbox"
                  checked={editingStudent.isActive}
                  onChange={(e) => setEditingStudent({ ...editingStudent, isActive: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-300"
                />
                <span>Akun siswa aktif (dapat login ujian)</span>
              </label>
            </div>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditingStudent(null)} className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium">
                Batal
              </button>
              <button type="submit" disabled={busy} className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-900 text-white text-sm font-semibold disabled:opacity-50">
                Simpan Perubahan
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Class Modal (Bottom Sheet on Mobile) */}
      {editingClass && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await apiFetch(`/api/admin/classes/${editingClass.id}`, {
                  method: 'PUT',
                  body: JSON.stringify({
                    name: editingClass.name,
                    gradeLevel: editingClass.gradeLevel,
                    academicYear: editingClass.academicYear,
                  }),
                });
                setEditingClass(null);
                setBanner({ type: 'ok', text: 'Data kelas berhasil diperbarui.' });
                await loadAll();
              } catch (err) {
                setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal memperbarui kelas.' });
              } finally {
                setBusy(false);
              }
            }}
            className="bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 max-h-[92dvh] overflow-y-auto pb-safe"
          >
            <div className="w-10 h-1 rounded-full bg-slate-300 mx-auto sm:hidden" />
            <h3 className="text-lg font-display font-bold text-slate-900">Edit Kelas</h3>
            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Kelas</label>
                <input
                  type="text"
                  required
                  value={editingClass.name}
                  onChange={(e) => setEditingClass({ ...editingClass, name: e.target.value })}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-base sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Tingkat</label>
                <select
                  value={editingClass.gradeLevel}
                  onChange={(e) => setEditingClass({ ...editingClass, gradeLevel: e.target.value })}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-base sm:text-sm"
                >
                  <option value="10">Tingkat 10</option>
                  <option value="11">Tingkat 11</option>
                  <option value="12">Tingkat 12</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Tahun Ajaran</label>
                <input
                  type="text"
                  required
                  value={editingClass.academicYear}
                  onChange={(e) => setEditingClass({ ...editingClass, academicYear: e.target.value })}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 font-mono text-base sm:text-sm"
                />
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditingClass(null)} className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium">
                Batal
              </button>
              <button type="submit" disabled={busy} className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-900 text-white text-sm font-semibold disabled:opacity-50">
                Simpan Perubahan
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Subject Modal (Bottom Sheet on Mobile) */}
      {editingSubject && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await apiFetch(`/api/admin/subjects/${editingSubject.id}`, {
                  method: 'PUT',
                  body: JSON.stringify({
                    code: editingSubject.code,
                    name: editingSubject.name,
                    passingGrade: editingSubject.passingGrade,
                  }),
                });
                setEditingSubject(null);
                setBanner({ type: 'ok', text: 'Mata pelajaran berhasil diperbarui.' });
                await loadAll();
              } catch (err) {
                setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal memperbarui mapel.' });
              } finally {
                setBusy(false);
              }
            }}
            className="bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 max-h-[92dvh] overflow-y-auto pb-safe"
          >
            <div className="w-10 h-1 rounded-full bg-slate-300 mx-auto sm:hidden" />
            <h3 className="text-lg font-display font-bold text-slate-900">Edit Mata Pelajaran</h3>
            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Kode Mapel</label>
                <input
                  type="text"
                  required
                  value={editingSubject.code}
                  onChange={(e) => setEditingSubject({ ...editingSubject, code: e.target.value.toUpperCase() })}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 font-mono uppercase text-base sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Mata Pelajaran</label>
                <input
                  type="text"
                  required
                  value={editingSubject.name}
                  onChange={(e) => setEditingSubject({ ...editingSubject, name: e.target.value })}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-base sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">KKM</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  required
                  value={editingSubject.passingGrade}
                  onChange={(e) => setEditingSubject({ ...editingSubject, passingGrade: Number(e.target.value) })}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 font-mono text-base sm:text-sm"
                />
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditingSubject(null)} className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium">
                Batal
              </button>
              <button type="submit" disabled={busy} className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-900 text-white text-sm font-semibold disabled:opacity-50">
                Simpan Perubahan
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Bulk / Targeted PIN & Token Settings Modal */}
      {showPinConfigModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form
            onSubmit={handleSaveBulkPinConfig}
            className="bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl max-w-lg w-full p-5 sm:p-6 space-y-4 max-h-[92dvh] overflow-y-auto pb-safe"
          >
            <div className="w-10 h-1 rounded-full bg-slate-300 mx-auto sm:hidden" />
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <h3 className="text-lg font-display font-bold text-slate-900 flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-[#0e539a]" />
                <span>Pengaturan PIN / Token Siswa</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowPinConfigModal(false)}
                className="min-h-[36px] px-2.5 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100"
              >
                Tutup
              </button>
            </div>

            <div className="space-y-4 text-sm">
              <div>
                <p className="text-xs font-semibold text-slate-700 mb-2">Sasaran Peserta</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setPinConfigScope('all')}
                    className={`min-h-[42px] px-3 py-2 rounded-xl border text-xs font-semibold text-left transition-colors ${
                      pinConfigScope === 'all'
                        ? 'bg-blue-50 border-[#0e539a] text-[#0e539a]'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Semua Siswa ({students.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPinConfigScope('class')}
                    className={`min-h-[42px] px-3 py-2 rounded-xl border text-xs font-semibold text-left transition-colors ${
                      pinConfigScope === 'class'
                        ? 'bg-blue-50 border-[#0e539a] text-[#0e539a]'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Kelas Tertentu
                  </button>
                  <button
                    type="button"
                    onClick={() => setPinConfigScope('selected')}
                    className={`min-h-[42px] px-3 py-2 rounded-xl border text-xs font-semibold text-left transition-colors ${
                      pinConfigScope === 'selected'
                        ? 'bg-blue-50 border-[#0e539a] text-[#0e539a]'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Siswa Tertentu ({pinConfigStudentIds.length})
                  </button>
                </div>
              </div>

              {pinConfigScope === 'class' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Pilih Kelas</label>
                  <select
                    value={pinConfigClassId}
                    onChange={(e) => setPinConfigClassId(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm"
                  >
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.student_count} siswa)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {pinConfigScope === 'selected' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-semibold text-slate-700">
                      Pilih Siswa Tertentu ({pinConfigStudentIds.length} dipilih)
                    </label>
                    <div className="flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => setPinConfigStudentIds(students.map((s) => s.id))}
                        className="text-[#0e539a] font-semibold hover:underline"
                      >
                        Pilih Semua
                      </button>
                      <button
                        type="button"
                        onClick={() => setPinConfigStudentIds([])}
                        className="text-slate-500 font-semibold hover:underline"
                      >
                        Kosongkan
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={pinConfigSearch}
                    onChange={(e) => setPinConfigSearch(e.target.value)}
                    placeholder="Cari nama atau NIS siswa..."
                    className="w-full min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-300 text-xs"
                  />
                  <div className="max-h-44 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                    {students
                      .filter((s) => {
                        const q = pinConfigSearch.trim().toLowerCase();
                        return !q || s.full_name.toLowerCase().includes(q) || s.nis.toLowerCase().includes(q);
                      })
                      .map((s) => {
                        const checked = pinConfigStudentIds.includes(s.id);
                        return (
                          <label
                            key={s.id}
                            className="px-3 py-2 flex items-center justify-between gap-2 text-xs cursor-pointer hover:bg-slate-50"
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  setPinConfigStudentIds((prev) =>
                                    e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                                  )
                                }
                                className="w-4 h-4 rounded border-slate-300 shrink-0"
                              />
                              <span className="font-medium text-slate-800 truncate">{s.full_name}</span>
                            </span>
                            <span className="font-mono text-[11px] text-slate-500 shrink-0 tabular-nums">
                              {s.nis} · {s.class_name}
                            </span>
                          </label>
                        );
                      })}
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-slate-700 mb-2">Metode PIN / Token</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPinConfigMode('custom')}
                    className={`min-h-[42px] px-3 py-2 rounded-xl border text-xs font-semibold text-left transition-colors ${
                      pinConfigMode === 'custom'
                        ? 'bg-blue-50 border-[#0e539a] text-[#0e539a]'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Satu PIN / Token Seragam
                  </button>
                  <button
                    type="button"
                    onClick={() => setPinConfigMode('random')}
                    className={`min-h-[42px] px-3 py-2 rounded-xl border text-xs font-semibold text-left transition-colors ${
                      pinConfigMode === 'random'
                        ? 'bg-blue-50 border-[#0e539a] text-[#0e539a]'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Acak Unik per Siswa (6 Digit)
                  </button>
                </div>
              </div>

              {pinConfigMode === 'custom' ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nilai PIN / Token Ujian (Min. 4 Karakter)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      minLength={4}
                      maxLength={32}
                      value={pinConfigValue}
                      onChange={(e) => setPinConfigValue(e.target.value)}
                      placeholder="Contoh: 123456 atau TKA2026"
                      className="flex-1 min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-base sm:text-sm font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setPinConfigValue(generateRandomTokenString())}
                      className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 whitespace-nowrap shrink-0"
                    >
                      Acak Token
                    </button>
                  </div>
                </div>
              ) : (
                <p className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-relaxed">
                  Sistem akan membuatkan PIN angka 6 digit yang berbeda-beda untuk setiap siswa pada sasaran terpilih. Daftar PIN masing-masing tetap dapat dilihat pada kolom PIN Ujian.
                </p>
              )}
            </div>

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowPinConfigModal(false)}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={busy || (pinConfigScope === 'selected' && pinConfigStudentIds.length === 0)}
                className="min-h-[44px] px-5 py-2 rounded-xl bg-[#0e539a] hover:bg-[#0b437e] text-white text-sm font-semibold disabled:opacity-50"
              >
                {busy ? 'Menyimpan...' : 'Terapkan PIN / Token'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Send Message / Kesan Modal */}
      {showMessageModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form onSubmit={handleSendStudentMessage} className="bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl max-w-lg w-full p-5 sm:p-6 pb-safe space-y-4 shadow-xl max-h-[92dvh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-display font-bold text-slate-900">Kirim Pesan &amp; Kesan ke Siswa</h3>
              <button type="button" onClick={() => setShowMessageModal(false)} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Tutup</button>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold text-slate-700 mb-2">Sasaran Penerima</p>
                <div className={`grid grid-cols-1 ${isAdmin ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-2`}>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => setMsgScope('all')}
                      className={`min-h-[42px] px-3 py-2 rounded-xl border text-xs font-semibold text-left transition-colors ${
                        msgScope === 'all' ? 'bg-blue-50 border-[#0e539a] text-[#0e539a]' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      Semua Siswa ({students.length})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setMsgScope('class')}
                    className={`min-h-[42px] px-3 py-2 rounded-xl border text-xs font-semibold text-left transition-colors ${
                      msgScope === 'class' ? 'bg-blue-50 border-[#0e539a] text-[#0e539a]' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Kelas Tertentu
                  </button>
                  <button
                    type="button"
                    onClick={() => setMsgScope('selected')}
                    className={`min-h-[42px] px-3 py-2 rounded-xl border text-xs font-semibold text-left transition-colors ${
                      msgScope === 'selected' ? 'bg-blue-50 border-[#0e539a] text-[#0e539a]' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Siswa Tertentu ({msgStudentIds.length})
                  </button>
                </div>
              </div>

              {msgScope === 'class' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Pilih Kelas Tujuan</label>
                  <select
                    required
                    value={msgClassId}
                    onChange={(e) => setMsgClassId(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm"
                  >
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.student_count} siswa)</option>
                    ))}
                  </select>
                </div>
              )}

              {msgScope === 'selected' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700">Pilih Siswa ({msgStudentIds.length} dipilih)</span>
                    <button type="button" onClick={() => setMsgStudentIds([])} className="text-slate-500 font-semibold hover:underline">
                      Kosongkan
                    </button>
                  </div>
                  <input
                    type="text"
                    value={msgSearch}
                    onChange={(e) => setMsgSearch(e.target.value)}
                    placeholder="Cari nama atau NIS siswa..."
                    className="w-full min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-300 text-xs"
                  />
                  <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                    {students
                      .filter((s) => {
                        const q = msgSearch.trim().toLowerCase();
                        return !q || s.full_name.toLowerCase().includes(q) || s.nis.toLowerCase().includes(q);
                      })
                      .map((s) => {
                        const checked = msgStudentIds.includes(s.id);
                        return (
                          <label key={s.id} className="px-3 py-2 flex items-center justify-between gap-2 text-xs cursor-pointer hover:bg-slate-50">
                            <span className="flex items-center gap-2 min-w-0">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  setMsgStudentIds((prev) => (e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)))
                                }
                                className="w-4 h-4 rounded border-slate-300 shrink-0"
                              />
                              <span className="font-medium text-slate-800 truncate">{s.full_name}</span>
                            </span>
                            <span className="font-mono text-[11px] text-slate-500 shrink-0 tabular-nums">{s.nis} · {s.class_name}</span>
                          </label>
                        );
                      })}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Kategori</label>
                  <select
                    value={msgCategory}
                    onChange={(e) => setMsgCategory(e.target.value as 'pesan' | 'peringatan' | 'instruksi' | 'kesan')}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm"
                  >
                    <option value="pesan">Pesan / Pengumuman</option>
                    <option value="instruksi">Instruksi Teknis</option>
                    <option value="peringatan">Peringatan / Teguran</option>
                    <option value="kesan">Kesan &amp; Catatan</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Judul Singkat (Opsional)</label>
                  <input
                    type="text"
                    maxLength={120}
                    value={msgTitle}
                    onChange={(e) => setMsgTitle(e.target.value)}
                    placeholder="Contoh: Pengumuman Ruang Ujian"
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Isi Pesan / Kesan</label>
                <textarea
                  required
                  rows={4}
                  maxLength={1000}
                  value={msgBody}
                  onChange={(e) => setMsgBody(e.target.value)}
                  placeholder="Tulis pesan, arahan, peringatan, atau kesan untuk siswa..."
                  className="w-full p-3 rounded-xl border border-slate-300 text-sm"
                />
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setShowMessageModal(false)} className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium">
                Batal
              </button>
              <button
                type="submit"
                disabled={busy || !msgBody.trim() || (msgScope === 'selected' && msgStudentIds.length === 0)}
                className="min-h-[44px] px-5 py-2 rounded-xl bg-[#0e539a] hover:bg-[#0b437e] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                <span>{busy ? 'Mengirim...' : 'Kirim Pesan'}</span>
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
