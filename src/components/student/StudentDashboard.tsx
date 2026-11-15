import React, { useEffect, useState } from 'react';
import {
  Award,
  BookOpen,
  CalendarClock,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogOut,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Printer,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import { apiFetch, getDeviceFingerprint, withAuthTokenUrl } from '../../lib/api.ts';
import { formatBirthPlaceDate, formatGender } from '../../lib/format.ts';
import { generateStudentRaporPDF } from '../../lib/pdf.ts';
import { StudentAvatar } from '../StudentAvatar.tsx';
import type { ActiveExamPayload, AuthUser, InstitutionBranding, StudentExamSummary, StudentMessageItem } from '../../types/cbt.ts';

interface StudentDashboardProps {
  user: AuthUser;
  branding: InstitutionBranding;
  onLogout: () => void;
  onEnterExam: (payload: ActiveExamPayload, cameraStream: MediaStream | null) => void;
}

type StudentSection = 'ujian' | 'nilai';

export const StudentDashboard: React.FC<StudentDashboardProps> = ({
  user,
  branding,
  onLogout,
  onEnterExam,
}) => {
  const [activeTab, setActiveTab] = useState<StudentSection>('ujian');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [desktopSidebarVisible, setDesktopSidebarVisible] = useState(true);
  const [exams, setExams] = useState<StudentExamSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmExam, setConfirmExam] = useState<StudentExamSummary | null>(null);
  const [examPin, setExamPin] = useState('');
  const [showExamPin, setShowExamPin] = useState(false);
  const [startingExam, setStartingExam] = useState(false);
  const [cameraConsent, setCameraConsent] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [selectedResultExam, setSelectedResultExam] = useState<StudentExamSummary | null>(null);
  const [messages, setMessages] = useState<StudentMessageItem[]>([]);

  const loadDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const [dashRes, msgRes] = await Promise.all([
        apiFetch<{ exams: StudentExamSummary[] }>('/api/student/dashboard'),
        apiFetch<{ messages: StudentMessageItem[] }>('/api/student/messages').catch(() => ({ messages: [] })),
      ]);
      setExams(dashRes.exams);
      setMessages(msgRes.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat daftar ujian.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  // Real-time WebSocket listener for incoming messages / kesan and session reset notifications
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(withAuthTokenUrl(`${proto}//${window.location.host}/ws`));

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'student:message' && msg.message) {
          const item = msg.message as StudentMessageItem;
          setMessages((prev) => (prev.some((m) => m.id === item.id) ? prev : [item, ...prev]));
        } else if (msg.type === 'session:reset_exam') {
          loadDashboard();
        }
      } catch {
        // ignore parse error
      }
    };

    return () => {
      ws.close();
    };
  }, []);

  const markMessageRead = async (messageId: string) => {
    try {
      await apiFetch(`/api/student/messages/${messageId}/read`, { method: 'POST' });
      const nowIso = new Date().toISOString();
      setMessages((prev) =>
        prev.map((m) => (messageId === 'all' || m.id === messageId ? { ...m, is_read: 1, read_at: m.read_at || nowIso } : m))
      );
    } catch {
      // ignore read status sync error
    }
  };

  // Auto-hide drawer when Escape is pressed or when rotating/resizing between HP/Tablet and Desktop
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const handleResize = () => {
      setDrawerOpen(false);
    };
    mq.addEventListener('change', handleResize);
    return () => mq.removeEventListener('change', handleResize);
  }, []);

  const handleStartConfirmed = async (forceTakeover = false) => {
    if (!confirmExam) return;
    const cleanPin = examPin.trim();
    if (!cleanPin) {
      setStartError('PIN / Password Ujian / Token wajib diisi sebelum memulai tes.');
      return;
    }

    setStartingExam(true);
    setStartError(null);

    let cameraStream: MediaStream | null = null;
    if (confirmExam.proctoringEnabled && cameraConsent && navigator.mediaDevices?.getUserMedia) {
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' }, audio: false });
      } catch {
        cameraStream = null;
      }
    }

    try {
      const payload = await apiFetch<ActiveExamPayload>(`/api/student/exams/${confirmExam.id}/start`, {
        method: 'POST',
        body: JSON.stringify({
          pin: cleanPin,
          deviceFingerprint: getDeviceFingerprint(),
          forceTakeover,
        }),
      });
      setConfirmExam(null);
      setExamPin('');
      onEnterExam(payload, cameraStream);
    } catch (err) {
      if (cameraStream) {
        cameraStream.getTracks().forEach((t) => t.stop());
      }
      setStartError(err instanceof Error ? err.message : 'Gagal memulai sesi ujian.');
    } finally {
      setStartingExam(false);
    }
  };

  const ongoingAndUpcoming = exams.filter((e) => e.availability !== 'completed' && e.availability !== 'missed');
  const completedExams = exams.filter((e) => e.availability === 'completed' || e.availability === 'missed');
  const firstName = user.fullName.split(' ')[0] || user.fullName;
  const formattedBirthInfo = formatBirthPlaceDate(user.birthPlace, user.birthDate);
  const formattedGender = formatGender(user.gender);

  const navItems: Array<{ id: StudentSection; label: string; count: number; icon: React.ReactNode }> = [
    {
      id: 'ujian',
      label: 'Ikuti Ujian',
      count: ongoingAndUpcoming.length,
      icon: <BookOpen className="w-4 h-4 shrink-0" />,
    },
    {
      id: 'nilai',
      label: 'Cek Nilai & Rapor',
      count: completedExams.length,
      icon: <Award className="w-4 h-4 shrink-0" />,
    },
  ];

  const activePageTitle = navItems.find((item) => item.id === activeTab)?.label || 'Portal Peserta';

  const selectTab = (tab: StudentSection) => {
    setActiveTab(tab);
    // Auto-hide navigation drawer on HP & Tablet after selecting a menu item
    setDrawerOpen(false);
  };

  const renderSidebarBody = (onCloseMobile?: () => void) => (
    <div className="flex flex-col justify-between h-full">
      <div>
        {/* Brand Block */}
        <div className="h-16 px-4 sm:px-5 bg-[#0e539a] text-white border-b border-[#0a3e74] flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={branding.logoEndpoint || '/api/branding/logo'}
              alt={branding.shortName || branding.name}
              referrerPolicy="no-referrer"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              className="w-9 h-9 rounded-lg object-contain bg-white p-0.5 shrink-0"
            />
            <div className="min-w-0">
              <p className="font-display font-bold text-white text-sm truncate">
                {branding.shortName || branding.name}
              </p>
              <p className="text-[11px] text-blue-100 truncate">
                Portal Peserta TKA · {branding.academicYear}
              </p>
            </div>
          </div>
          {onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="Tutup menu navigasi"
              className="min-h-[40px] min-w-[40px] rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Left Navigation Links */}
        <nav aria-label="Navigasi peserta ujian" className="p-3 space-y-1">
          <p className="px-3 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Menu Peserta
          </p>
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => selectTab(item.id)}
                className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-lg text-sm font-medium flex items-center justify-between gap-2.5 transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#0e539a] text-white font-semibold shadow-xs'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </span>
                <span
                  className={`font-mono text-xs tabular-nums shrink-0 ${
                    active ? 'text-blue-100' : 'text-slate-400'
                  }`}
                >
                  {item.count}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Student Identity Footer & Logout */}
      <div className="p-4 border-t border-slate-100 space-y-3 bg-slate-50/70">
        <div className="flex items-center gap-3 min-w-0">
          <StudentAvatar photoUrl={user.photoUrl} fullName={user.fullName} size="sm" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-900 truncate">{user.fullName}</p>
            <p className="text-[11px] font-mono text-slate-500 truncate tabular-nums">
              NIS {user.nis} · {user.className}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 flex items-center justify-center gap-2 whitespace-nowrap shrink-0 transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span>Keluar</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#eef2f6] flex">
      {/* Desktop Left Sidebar (visible when expanded on lg+) */}
      {desktopSidebarVisible && (
        <aside
          aria-label="Sidebar navigasi peserta"
          className="hidden lg:flex w-[260px] bg-white border-r border-slate-200 flex-col shrink-0 sticky top-0 h-screen"
        >
          {renderSidebarBody()}
        </aside>
      )}

      {/* HP & Tablet Auto-Hide Left Navigation Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-[1px]"
            aria-hidden="true"
            onClick={() => setDrawerOpen(false)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Menu navigasi peserta"
            className="relative w-72 max-w-[85vw] bg-white h-full shadow-2xl flex flex-col justify-between z-10"
          >
            {renderSidebarBody(() => setDrawerOpen(false))}
          </aside>
        </div>
      )}

      {/* Main Viewport */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="sticky top-0 z-30 bg-[#0e539a] text-white lg:bg-white/95 lg:text-slate-900 backdrop-blur-md border-b border-[#0a3e74] lg:border-slate-200 h-14 sm:h-16 px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* HP & Tablet Drawer Toggle Button */}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Buka menu navigasi kiri"
              aria-expanded={drawerOpen}
              className="lg:hidden min-h-[42px] min-w-[42px] rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white flex items-center justify-center shrink-0 transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Desktop Sidebar Collapse / Expand Toggle */}
            <button
              type="button"
              onClick={() => setDesktopSidebarVisible((v) => !v)}
              aria-label={desktopSidebarVisible ? 'Sembunyikan navigasi kiri' : 'Tampilkan navigasi kiri'}
              title={desktopSidebarVisible ? 'Sembunyikan menu kiri' : 'Tampilkan menu kiri'}
              className="hidden lg:inline-flex min-h-[38px] min-w-[38px] rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 items-center justify-center shrink-0 transition-colors"
            >
              {desktopSidebarVisible ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
            </button>

            <img
              src={branding.logoEndpoint || '/api/branding/logo'}
              alt={branding.shortName || branding.name}
              referrerPolicy="no-referrer"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              className="lg:hidden w-8 h-8 rounded-lg object-contain bg-white p-0.5 shrink-0"
            />

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="hidden sm:inline text-xs font-medium text-blue-100 lg:text-slate-500 truncate max-w-[180px]">
                  {branding.shortName || branding.name}
                </span>
                <span className="hidden sm:inline text-xs text-white/40 lg:text-slate-300" aria-hidden="true">/</span>
                <h1 className="font-display font-bold text-white lg:text-slate-900 text-sm sm:text-base truncate">
                  {activePageTitle}
                </h1>
              </div>
              <p className="lg:hidden text-[11px] text-blue-100 truncate">
                {branding.shortName || branding.name}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div className="hidden xl:flex flex-col items-end text-right min-w-0 mr-1">
              <span className="text-xs font-semibold text-slate-800 whitespace-nowrap">
                {branding.name}
              </span>
              <span className="text-[11px] text-slate-500 whitespace-nowrap tabular-nums">
                TA {branding.academicYear} · {branding.timezone}
              </span>
            </div>
            <button
              type="button"
              onClick={loadDashboard}
              aria-label="Muat ulang daftar ujian"
              className="min-h-[38px] min-w-[38px] sm:px-3 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white lg:bg-white lg:hover:bg-slate-50 lg:border-slate-200 lg:text-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Segarkan</span>
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="lg:hidden min-h-[38px] px-2.5 sm:px-3 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">Keluar</span>
            </button>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-5 sm:py-7 pb-10 space-y-5 sm:space-y-6">
          {/* TKA Official Participant Data Confirmation Card */}
          <section className="bg-white border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-xl sm:rounded-2xl overflow-hidden">
            <div className="px-4 sm:px-6 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#0e539a]">
                Konfirmasi Data Peserta Ujian
              </span>
              <span className="text-xs text-slate-500 tabular-nums">
                TA {branding.academicYear}
              </span>
            </div>
            <div className="p-4 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-5">
              <div className="flex items-start sm:items-center gap-3.5 sm:gap-4 min-w-0 flex-1">
                <StudentAvatar photoUrl={user.photoUrl} fullName={user.fullName} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-[#0e539a]">
                    Halo, {firstName} · Pastikan data peserta sesuai kartu ujian
                  </p>
                  <h2 className="text-base sm:text-xl font-display font-bold text-slate-900 truncate mt-0.5">
                    {user.fullName}
                  </h2>

                  <dl className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:text-sm">
                    <div className="flex items-baseline gap-2 min-w-0">
                      <dt className="text-slate-500 shrink-0">NIS / NISN:</dt>
                      <dd className="font-mono font-medium text-slate-800 truncate tabular-nums">
                        {user.nis} / {user.nisn}
                      </dd>
                    </div>
                    <div className="flex items-baseline gap-2 min-w-0">
                      <dt className="text-slate-500 shrink-0">Kelas:</dt>
                      <dd className="font-semibold text-slate-900 truncate">{user.className}</dd>
                    </div>
                    <div className="flex items-baseline gap-2 min-w-0">
                      <dt className="text-slate-500 shrink-0">Jenis Kelamin:</dt>
                      <dd className="font-medium text-slate-800 truncate">{formattedGender}</dd>
                    </div>
                    <div className="flex items-baseline gap-2 min-w-0">
                      <dt className="text-slate-500 shrink-0">Alamat Email:</dt>
                      <dd className="font-medium text-slate-800 truncate">{user.email || 'Belum diisi'}</dd>
                    </div>
                    <div className="sm:col-span-2 flex items-baseline gap-2 min-w-0">
                      <dt className="text-slate-500 shrink-0">Tempat, Tgl Lahir:</dt>
                      <dd className="font-medium text-slate-800 truncate tabular-nums">
                        {formattedBirthInfo}
                      </dd>
                    </div>
                  </dl>

                  <p className="mt-2 text-[11px] text-slate-400">
                    Data identitas dan foto profil resmi dikelola khusus oleh panitia ujian sekolah.
                  </p>
                </div>
              </div>

              <div className="hidden sm:flex items-center gap-5 shrink-0 md:pl-5 md:border-l border-slate-200 text-right">
                <div>
                  <p className="text-xs text-slate-500">Tes Aktif</p>
                  <p className="text-xl font-display font-bold text-[#0e539a] tabular-nums">{ongoingAndUpcoming.length}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Riwayat Nilai</p>
                  <p className="text-xl font-display font-bold text-slate-900 tabular-nums">{completedExams.length}</p>
                </div>
              </div>
            </div>
          </section>

          {messages.length > 0 && (
            <section className="bg-white border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-xl sm:rounded-2xl overflow-hidden">
              <div className="px-4 sm:px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <MessageSquare className="w-4 h-4 text-[#0e539a] shrink-0" />
                  <h2 className="text-xs sm:text-sm font-display font-bold text-slate-900 truncate">
                    Pesan &amp; Catatan dari Panitia / Pengawas
                  </h2>
                </div>
                {messages.some((m) => !m.is_read) && (
                  <button
                    type="button"
                    onClick={() => markMessageRead('all')}
                    className="text-xs font-semibold text-[#0e539a] hover:underline whitespace-nowrap shrink-0"
                  >
                    Tandai Semua Dibaca ({messages.filter((m) => !m.is_read).length})
                  </button>
                )}
              </div>
              <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                {messages.slice(0, 6).map((m) => {
                  const categoryLabel =
                    m.category === 'peringatan'
                      ? 'Peringatan'
                      : m.category === 'instruksi'
                      ? 'Instruksi Teknis'
                      : m.category === 'kesan'
                      ? 'Kesan & Catatan'
                      : 'Pesan';
                  return (
                    <div
                      key={m.id}
                      className={`px-4 sm:px-6 py-3.5 flex flex-col sm:flex-row sm:items-start justify-between gap-2 ${
                        !m.is_read ? 'bg-sky-50/60' : 'bg-white'
                      }`}
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                          <span className={`font-semibold ${m.category === 'peringatan' ? 'text-amber-800' : 'text-[#0e539a]'}`}>
                            {categoryLabel}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-slate-700">{m.sender_name}</span>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">{new Date(m.created_at).toLocaleString('id-ID')}</span>
                          {!m.is_read && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-semibold text-[#0e539a]">Baru</span>
                            </>
                          )}
                        </div>
                        {m.title && <p className="text-xs sm:text-sm font-bold text-slate-900">{m.title}</p>}
                        <p className="text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-line">{m.message}</p>
                      </div>
                      {!m.is_read && (
                        <button
                          type="button"
                          onClick={() => markMessageRead(m.id)}
                          className="self-start min-h-[34px] px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 whitespace-nowrap shrink-0"
                        >
                          Tandai Dibaca
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {error && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
              {error}
            </div>
          )}

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2].map((i) => (
                <div key={i} className="h-44 rounded-xl bg-white border border-slate-200 animate-pulse p-6" />
              ))}
            </div>
          ) : activeTab === 'ujian' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base sm:text-lg font-display font-bold text-slate-900">
                  Daftar Tes &amp; Jadwal Ujian ({ongoingAndUpcoming.length})
                </h2>
              </div>

              {ongoingAndUpcoming.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-2">
                  <p className="text-sm font-semibold text-slate-800">Belum ada tes yang dijadwalkan saat ini</p>
                  <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                    Jadwal ujian untuk kelas {user.className} akan tampil otomatis di sini. Tekan tombol Segarkan bila panitia baru membuka sesi.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {ongoingAndUpcoming.map((exam) => (
                    <article
                      key={exam.id}
                      className="bg-white border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-xl p-5 flex flex-col justify-between gap-4"
                    >
                      <div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="font-semibold text-[#0e539a]">{exam.examType}</span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{exam.subjectName}</span>
                        </div>
                        <h3 className="mt-1.5 text-base sm:text-lg font-display font-bold text-slate-900 leading-snug">
                          {exam.title}
                        </h3>

                        <div className="mt-3 space-y-2 text-xs sm:text-sm text-slate-600">
                          <div className="flex items-center gap-2">
                            <CalendarClock className="w-4 h-4 text-slate-400 shrink-0" />
                            <span className="tabular-nums">
                              {new Date(exam.startAt).toLocaleString('id-ID')} ({exam.timezone})
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <BookOpen className="w-4 h-4 text-slate-400 shrink-0" />
                            <span className="tabular-nums">
                              {exam.questionCount} butir soal · Alokasi {exam.durationMinutes} menit
                            </span>
                          </div>
                        </div>

                        {exam.availability === 'locked' && (
                          <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2">
                            <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                            <span>
                              Sesi terkunci: {exam.session?.lockReason || 'Hubungi pengawas untuk membuka kunci.'}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <span className="text-xs font-medium text-slate-500">
                          {exam.availability === 'in_progress' && 'Sedang dikerjakan · Siap dilanjutkan'}
                          {exam.availability === 'locked' && 'Terkunci · Waktu tetap berjalan'}
                          {exam.availability === 'open' && 'Status Tes: Siap dikerjakan'}
                          {exam.availability === 'upcoming' && 'Menunggu jadwal dibuka'}
                        </span>

                        {exam.availability === 'open' || exam.availability === 'in_progress' || exam.availability === 'locked' ? (
                          <button
                            type="button"
                            onClick={() => {
                              setStartError(null);
                              setExamPin('');
                              setShowExamPin(false);
                              setCameraConsent(exam.proctoringEnabled);
                              setConfirmExam(exam);
                            }}
                            className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-lg bg-[#0e539a] hover:bg-[#0b437e] active:scale-[0.99] text-white text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition-all"
                          >
                            <Play className="w-4 h-4 shrink-0" />
                            <span>
                              {exam.availability === 'in_progress'
                                ? 'Lanjutkan Tes'
                                : exam.availability === 'locked'
                                ? 'Buka Sesi Terkunci'
                                : 'Mulai Tes'}
                            </span>
                          </button>
                        ) : (
                          <span className="text-xs font-semibold text-slate-400">Belum Dibuka</span>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Tab Cek Nilai & Riwayat */
            <div className="space-y-4">
              <h2 className="text-base sm:text-lg font-display font-bold text-slate-900">
                Riwayat &amp; Hasil Ujian ({completedExams.length})
              </h2>
              {completedExams.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-1.5">
                  <p className="text-sm font-semibold text-slate-800">Belum ada riwayat ujian yang selesai</p>
                  <p className="text-xs text-slate-500">Hasil ujian yang sudah dikumpulkan akan muncul di halaman ini.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {completedExams.map((exam) => (
                    <article key={exam.id} className="bg-white border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-xl p-5 flex flex-col justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="font-semibold text-[#0e539a]">{exam.examType}</span>
                          <span aria-hidden="true">·</span>
                          <span>{exam.subjectName}</span>
                        </div>
                        <h3 className="mt-1 text-base font-display font-bold text-slate-900">{exam.title}</h3>
                        <p className="mt-1 text-xs text-slate-500 tabular-nums">
                          {exam.session?.submittedAt
                            ? `Dikumpulkan: ${new Date(exam.session.submittedAt).toLocaleString('id-ID')}`
                            : `Batas akhir: ${new Date(exam.endAt).toLocaleString('id-ID')}`}
                        </p>

                        {exam.publicationPolicy === 'hidden' ? (
                          <div className="mt-4 p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center gap-2">
                            <Lock className="w-4 h-4 text-slate-400 shrink-0" />
                            <span>Nilai belum dipublikasikan oleh panitia lembaga.</span>
                          </div>
                        ) : exam.result ? (
                          <div className="mt-4 grid grid-cols-3 gap-2 p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-center">
                            <div>
                              <p className="text-[11px] text-slate-500">Nilai Akhir</p>
                              <p className="text-xl font-display font-bold text-[#0e539a] tabular-nums mt-0.5">
                                {exam.result.finalScore.toFixed(1)}
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] text-slate-500">B / P / S / K</p>
                              <p className="text-xs font-mono font-semibold text-slate-800 mt-2 tabular-nums">
                                {exam.result.correctCount}/{exam.result.partialCount}/{exam.result.wrongCount}/{exam.result.blankCount}
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] text-slate-500">Ketuntasan</p>
                              <p className={`text-xs font-bold mt-2 ${exam.result.passed ? 'text-emerald-700' : 'text-red-700'}`}>
                                {exam.result.passed ? 'Tuntas' : 'Belum'}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <p className="mt-4 text-xs text-slate-500">Tidak mengikuti sesi pada jadwal yang ditentukan.</p>
                        )}
                      </div>

                      {exam.result && exam.publicationPolicy !== 'hidden' && (
                        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedResultExam(exam)}
                            className="min-h-[42px] px-3.5 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Rincian</span>
                          </button>
                          {(exam.publicationPolicy === 'view_download' || exam.publicationPolicy === 'view_download_print') && (
                            <button
                              type="button"
                              onClick={() =>
                                generateStudentRaporPDF(
                                  {
                                    institution: branding,
                                    studentName: user.fullName,
                                    nis: user.nis || '',
                                    nisn: user.nisn,
                                    birthPlace: user.birthPlace,
                                    birthDate: user.birthDate,
                                    gender: user.gender,
                                    email: user.email,
                                    className: user.className || '',
                                    photoUrl: user.photoUrl,
                                    subjectName: exam.subjectName,
                                    examTitle: exam.title,
                                    examType: exam.examType,
                                    examDate: exam.session?.submittedAt || exam.endAt,
                                    finalScore: exam.result!.finalScore,
                                    rawPoints: exam.result!.rawPoints,
                                    maxPoints: exam.result!.maxPoints,
                                    correctCount: exam.result!.correctCount,
                                    partialCount: exam.result!.partialCount,
                                    wrongCount: exam.result!.wrongCount,
                                    blankCount: exam.result!.blankCount,
                                    passingScore: exam.passingScore,
                                    passed: exam.result!.passed,
                                  },
                                  'download'
                                )
                              }
                              className="min-h-[42px] px-3.5 py-2 rounded-lg bg-[#0e539a] hover:bg-[#0b437e] text-xs font-semibold text-white flex items-center gap-1.5 whitespace-nowrap"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Rapor PDF</span>
                            </button>
                          )}
                          {exam.publicationPolicy === 'view_download_print' && (
                            <button
                              type="button"
                              onClick={() =>
                                generateStudentRaporPDF(
                                  {
                                    institution: branding,
                                    studentName: user.fullName,
                                    nis: user.nis || '',
                                    nisn: user.nisn,
                                    birthPlace: user.birthPlace,
                                    birthDate: user.birthDate,
                                    gender: user.gender,
                                    email: user.email,
                                    className: user.className || '',
                                    photoUrl: user.photoUrl,
                                    subjectName: exam.subjectName,
                                    examTitle: exam.title,
                                    examType: exam.examType,
                                    examDate: exam.session?.submittedAt || exam.endAt,
                                    finalScore: exam.result!.finalScore,
                                    rawPoints: exam.result!.rawPoints,
                                    maxPoints: exam.result!.maxPoints,
                                    correctCount: exam.result!.correctCount,
                                    partialCount: exam.result!.partialCount,
                                    wrongCount: exam.result!.wrongCount,
                                    blankCount: exam.result!.blankCount,
                                    passingScore: exam.passingScore,
                                    passed: exam.result!.passed,
                                  },
                                  'print'
                                )
                              }
                              className="min-h-[42px] px-3.5 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1.5 whitespace-nowrap"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>Cetak</span>
                            </button>
                          )}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* TKA Pre-Exam Confirmation Sheet ("Konfirmasi Tes") */}
      {confirmExam && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white border border-slate-200 rounded-t-2xl sm:rounded-xl max-w-lg w-full overflow-hidden max-h-[92dvh] flex flex-col shadow-xl">
            <div className="bg-[#0e539a] text-white px-5 py-3.5 flex items-center justify-between gap-3 shrink-0">
              <h3 className="text-base font-display font-bold">
                Konfirmasi Tes
              </h3>
              <button
                type="button"
                onClick={() => setConfirmExam(null)}
                className="text-xs font-semibold text-blue-100 hover:text-white px-2 py-1 rounded"
              >
                Tutup
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleStartConfirmed(false);
              }}
              className="p-5 sm:p-6 pb-safe space-y-4 overflow-y-auto"
            >
              {/* Official Student Photo + Structured TKA Confirmation Rows */}
              <div className="flex items-start gap-3.5 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <StudentAvatar photoUrl={user.photoUrl} fullName={user.fullName} size="xl" />
                <div className="text-xs sm:text-sm space-y-1.5 min-w-0 flex-1">
                  <div>
                    <p className="text-[11px] text-slate-500">Nama Peserta</p>
                    <p className="font-display font-bold text-slate-900 truncate">{user.fullName}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-0.5">
                    <div>
                      <p className="text-[11px] text-slate-500">NIS / NISN</p>
                      <p className="font-mono text-xs text-slate-800 truncate tabular-nums">{user.nis} / {user.nisn}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-500">Kelas</p>
                      <p className="font-semibold text-xs text-slate-800 truncate">{user.className}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-500">Jenis Kelamin</p>
                      <p className="text-xs font-medium text-slate-800 truncate">{formattedGender}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-500">Alamat Email</p>
                      <p className="text-xs font-medium text-slate-800 truncate">{user.email || '-'}</p>
                    </div>
                  </div>
                  <div className="pt-0.5">
                    <p className="text-[11px] text-slate-500">Tempat, Tanggal Lahir</p>
                    <p className="text-xs font-medium text-slate-800 truncate tabular-nums">{formattedBirthInfo}</p>
                  </div>
                </div>
              </div>

              {/* TKA Test Summary Table */}
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-200 text-xs sm:text-sm">
                <div className="px-3.5 py-2.5 flex justify-between gap-3">
                  <span className="text-slate-500">Nama Tes</span>
                  <span className="font-semibold text-slate-900 text-right">{confirmExam.title}</span>
                </div>
                <div className="px-3.5 py-2.5 flex justify-between gap-3">
                  <span className="text-slate-500">Mata Pelajaran</span>
                  <span className="font-medium text-slate-800 text-right">{confirmExam.subjectName}</span>
                </div>
                <div className="px-3.5 py-2.5 flex justify-between gap-3">
                  <span className="text-slate-500">Jumlah Soal &amp; Alokasi Waktu</span>
                  <span className="font-mono font-semibold text-[#0e539a] text-right tabular-nums">
                    {confirmExam.questionCount} Soal · {confirmExam.durationMinutes} Menit
                  </span>
                </div>
              </div>

              {/* PIN / Password Ujian / Token Verification Input */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <label htmlFor="exam-start-pin" className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-800">
                  <KeyRound className="w-4 h-4 text-[#0e539a] shrink-0" />
                  <span>PIN / Password Ujian / Token</span>
                </label>
                <div className="relative">
                  <input
                    id="exam-start-pin"
                    type={showExamPin ? 'text' : 'password'}
                    value={examPin}
                    onChange={(e) => {
                      setExamPin(e.target.value);
                      if (startError) setStartError(null);
                    }}
                    placeholder="Masukkan PIN / Password Ujian / Token"
                    required
                    autoComplete="off"
                    autoFocus
                    className="w-full min-h-[46px] pl-3.5 pr-12 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 font-mono text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#0e539a]/20 focus:border-[#0e539a]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowExamPin((v) => !v)}
                    aria-label={showExamPin ? 'Sembunyikan PIN / Token' : 'Tampilkan PIN / Token'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 min-w-[38px] min-h-[38px] flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700"
                  >
                    {showExamPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">
                  {confirmExam.usesExamToken
                    ? 'Ujian ini menggunakan Token Khusus. Masukkan token ujian yang dibagikan oleh pengawas ruang.'
                    : 'Masukkan PIN / Password Ujian peserta yang diberikan oleh pengawas ruang atau panitia ujian.'}
                </p>
              </div>

              {/* Honest Rules & Notices */}
              <div className="space-y-2.5 text-xs text-slate-700 leading-relaxed">
                <div className="flex items-start gap-2.5">
                  <ClipboardCheck className="w-4 h-4 text-[#0e539a] shrink-0 mt-0.5" />
                  <span>Timer dihitung berdasarkan jam server. Perubahan jam perangkat tidak memengaruhi waktu ujian.</span>
                </div>
                {confirmExam.autoLockEnabled && (
                  <div className="flex items-start gap-2.5">
                    <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>
                      Penguncian otomatis aktif: perpindahan tab, halaman disembunyikan, atau kehilangan fokus dicatat server. Setelah {confirmExam.maxViolations} kejadian, sesi terkunci sementara waktu tetap berjalan.
                    </span>
                  </div>
                )}
                {confirmExam.proctoringEnabled && (
                  <div className="p-3 rounded-lg bg-sky-50 border border-sky-200 space-y-2">
                    <div className="flex items-start gap-2 text-slate-800">
                      <Camera className="w-4 h-4 text-[#0e539a] shrink-0 mt-0.5" />
                      <span>
                        Ujian ini mengaktifkan pengawasan kamera ringan. Indikator kamera hanya untuk peninjauan pengawas, bukan tuduhan otomatis.
                      </span>
                    </div>
                    <label className="flex items-center gap-2 font-medium text-[#0e539a] cursor-pointer min-h-[36px]">
                      <input
                        type="checkbox"
                        checked={cameraConsent}
                        onChange={(e) => setCameraConsent(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300"
                      />
                      <span>Izinkan akses kamera perangkat selama ujian berlangsung</span>
                    </label>
                  </div>
                )}
              </div>

              {startError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 space-y-2" role="alert">
                  <p>{startError}</p>
                  {startError.includes('perangkat/browser lain') && (
                    <button
                      type="button"
                      onClick={() => handleStartConfirmed(true)}
                      className="min-h-[40px] px-3 py-1.5 rounded-lg bg-red-700 text-white font-semibold"
                    >
                      Alihkan Sesi ke Perangkat Ini
                    </button>
                  )}
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setConfirmExam(null)}
                  className="w-full sm:w-auto min-h-[46px] px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={startingExam}
                  className="w-full sm:w-auto min-h-[46px] px-6 py-2.5 rounded-lg bg-[#0e539a] hover:bg-[#0b437e] disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{startingExam ? 'Menyiapkan Paket Soal...' : 'Mulai'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Result Detail Modal (Bottom sheet on HP) */}
      {selectedResultExam && selectedResultExam.result && (
        <div className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white border border-slate-200 rounded-t-2xl sm:rounded-xl max-w-md w-full overflow-hidden shadow-xl">
            <div className="bg-[#0e539a] text-white px-5 py-3.5 flex items-center justify-between">
              <h3 className="text-base font-display font-bold">Rincian Hasil Ujian</h3>
              <button
                type="button"
                onClick={() => setSelectedResultExam(null)}
                className="text-xs font-semibold text-blue-100 hover:text-white px-2 py-1"
              >
                Tutup
              </button>
            </div>
            <div className="p-5 sm:p-6 pb-safe space-y-4">
              <div>
                <p className="text-xs text-slate-500">{selectedResultExam.subjectName} · {selectedResultExam.examType}</p>
                <p className="text-base font-bold text-slate-900 mt-0.5">{selectedResultExam.title}</p>
              </div>
              <div className="divide-y divide-slate-100 text-sm">
                <div className="py-2.5 flex justify-between"><span className="text-slate-600">Nilai Akhir</span><span className="font-bold text-[#0e539a] tabular-nums">{selectedResultExam.result.finalScore.toFixed(2)}</span></div>
                <div className="py-2.5 flex justify-between"><span className="text-slate-600">Poin Diperoleh</span><span className="font-mono tabular-nums">{selectedResultExam.result.rawPoints} / {selectedResultExam.result.maxPoints}</span></div>
                <div className="py-2.5 flex justify-between"><span className="text-slate-600">Benar Penuh</span><span className="font-mono tabular-nums">{selectedResultExam.result.correctCount} soal</span></div>
                <div className="py-2.5 flex justify-between"><span className="text-slate-600">Skor Parsial</span><span className="font-mono tabular-nums">{selectedResultExam.result.partialCount} soal</span></div>
                <div className="py-2.5 flex justify-between"><span className="text-slate-600">Salah</span><span className="font-mono tabular-nums">{selectedResultExam.result.wrongCount} soal</span></div>
                <div className="py-2.5 flex justify-between"><span className="text-slate-600">Kosong</span><span className="font-mono tabular-nums">{selectedResultExam.result.blankCount} soal</span></div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-600">Status (KKM {selectedResultExam.passingScore})</span>
                  <span className={`font-bold ${selectedResultExam.result.passed ? 'text-emerald-700' : 'text-red-700'}`}>
                    {selectedResultExam.result.passed ? 'Tuntas' : 'Belum Tuntas'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
