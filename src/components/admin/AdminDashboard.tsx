import React, { useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  BookOpen,
  Calendar,
  Camera,
  GraduationCap,
  Layers,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  Settings,
  Users,
  X,
} from 'lucide-react';
import { apiFetch } from '../../lib/api.ts';
import type { AuthUser, InstitutionBranding } from '../../types/cbt.ts';
import { StudentsAndPhotosPanel } from './StudentsAndPhotosPanel.tsx';
import { QuestionBankPanel } from './QuestionBankPanel.tsx';
import { ExamsAndSchedulesPanel } from './ExamsAndSchedulesPanel.tsx';
import { LiveMonitoringPanel } from './LiveMonitoringPanel.tsx';
import { AnalyticsAndReportsPanel } from './AnalyticsAndReportsPanel.tsx';
import { SystemSettingsAndAuditPanel } from './SystemSettingsAndAuditPanel.tsx';

interface AdminDashboardProps {
  user: AuthUser;
  branding: InstitutionBranding;
  onBrandingUpdated: () => void;
  onLogout: () => void;
}

type AdminSection = 'overview' | 'monitoring' | 'students' | 'questions' | 'exams' | 'analytics' | 'settings';

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  user,
  branding,
  onBrandingUpdated,
  onLogout,
}) => {
  const isAdmin = user.role === 'admin';
  const [section, setSection] = useState<AdminSection>(isAdmin ? 'overview' : 'monitoring');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [overview, setOverview] = useState({
    totalStudents: 0,
    totalClasses: 0,
    totalSubjects: 0,
    totalQuestions: 0,
    totalExams: 0,
    activeSessions: 0,
    lockedSessions: 0,
    photosUploaded: 0,
  });

  useEffect(() => {
    apiFetch<typeof overview>('/api/admin/overview').then(setOverview).catch(() => {});
  }, [section]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen]);

  const allNavItems: Array<{
    id: AdminSection;
    label: string;
    shortLabel: string;
    icon: React.ReactNode;
    activeClass: string;
    idleIconClass: string;
    mobileActiveText: string;
    adminOnly?: boolean;
  }> = [
    {
      id: 'overview',
      label: 'Ringkasan Sistem',
      shortLabel: 'Beranda',
      icon: <LayoutDashboard className="w-4 h-4 shrink-0" />,
      activeClass: 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-sm shadow-indigo-600/20',
      idleIconClass: 'text-indigo-600',
      mobileActiveText: 'text-indigo-700',
      adminOnly: true,
    },
    {
      id: 'students',
      label: 'Siswa, Kelas & Foto',
      shortLabel: 'Siswa',
      icon: <Users className="w-4 h-4 shrink-0" />,
      activeClass: 'bg-gradient-to-r from-sky-600 to-cyan-600 text-white shadow-sm shadow-sky-600/20',
      idleIconClass: 'text-sky-600',
      mobileActiveText: 'text-sky-700',
    },
    {
      id: 'exams',
      label: 'Ujian & Jadwal',
      shortLabel: 'Ujian',
      icon: <Calendar className="w-4 h-4 shrink-0" />,
      activeClass: 'bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-sm shadow-violet-600/20',
      idleIconClass: 'text-violet-600',
      mobileActiveText: 'text-violet-700',
      adminOnly: true,
    },
    {
      id: 'questions',
      label: 'Bank Soal TKA',
      shortLabel: 'Soal',
      icon: <BookOpen className="w-4 h-4 shrink-0" />,
      activeClass: 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-sm shadow-amber-600/20',
      idleIconClass: 'text-amber-600',
      mobileActiveText: 'text-amber-700',
      adminOnly: true,
    },
    {
      id: 'monitoring',
      label: 'Monitoring Real-Time',
      shortLabel: 'Pantau',
      icon: <Activity className="w-4 h-4 shrink-0" />,
      activeClass: 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-sm shadow-emerald-600/20',
      idleIconClass: 'text-emerald-600',
      mobileActiveText: 'text-emerald-700',
    },
    {
      id: 'analytics',
      label: 'Analisis & Rapor PDF',
      shortLabel: 'Analisis',
      icon: <BarChart3 className="w-4 h-4 shrink-0" />,
      activeClass: 'bg-gradient-to-r from-rose-600 to-pink-600 text-white shadow-sm shadow-rose-600/20',
      idleIconClass: 'text-rose-600',
      mobileActiveText: 'text-rose-700',
      adminOnly: true,
    },
    {
      id: 'settings',
      label: 'Pengaturan, Log & QA',
      shortLabel: 'Setelan',
      icon: <Settings className="w-4 h-4 shrink-0" />,
      activeClass: 'bg-gradient-to-r from-teal-700 to-cyan-700 text-white shadow-sm shadow-teal-700/20',
      idleIconClass: 'text-teal-700',
      mobileActiveText: 'text-teal-700',
      adminOnly: true,
    },
  ];
  const navItems = allNavItems.filter((item) => isAdmin || !item.adminOnly);

  const activeItem = navItems.find((n) => n.id === section);
  const activeTitle = activeItem?.label || 'Konsol CBT';
  const mobileQuickItems = isAdmin
    ? navItems.filter((n) => ['students', 'exams', 'questions', 'monitoring'].includes(n.id))
    : navItems;

  return (
    <div className="min-h-screen flex">
      {/* Desktop Sidebar (260px) */}
      <aside
        aria-label="Sidebar navigasi konsol admin"
        className="hidden lg:flex w-[260px] bg-white/95 backdrop-blur-sm border-r border-indigo-100 flex-col justify-between shrink-0 sticky top-0 h-screen"
      >
        <div>
          <div className="h-16 px-5 bg-gradient-to-r from-blue-700 via-indigo-700 to-teal-600 text-white border-b border-indigo-900/20 flex items-center gap-3">
            <img
              src={branding.logoEndpoint || '/api/branding/logo'}
              alt={branding.shortName || branding.name}
              referrerPolicy="no-referrer"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              className="w-9 h-9 rounded-lg object-contain bg-white p-0.5 shrink-0 shadow-xs"
            />
            <div className="min-w-0">
              <p className="font-display font-bold text-white text-sm truncate">
                {branding.shortName || branding.name}
              </p>
              <p className="text-[11px] text-sky-100 truncate">
                {user.role === 'admin' ? 'Admin Utama' : 'Pengawas'} · {branding.academicYear}
              </p>
            </div>
          </div>

          <nav aria-label="Navigasi utama" className="p-3 space-y-1.5">
            {navItems.map((item) => {
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-nav-section={item.id}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setSection(item.id)}
                  className={`w-full min-h-[42px] px-3.5 py-2 rounded-xl text-sm font-medium flex items-center gap-3 transition-all whitespace-nowrap ${
                    active
                      ? `${item.activeClass} font-semibold`
                      : 'text-slate-700 hover:bg-slate-100/80'
                  }`}
                >
                  <span className={active ? 'text-white' : item.idleIconClass}>{item.icon}</span>
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-indigo-100/80 space-y-3 bg-gradient-to-b from-slate-50/50 to-indigo-50/40">
          <div className="text-xs">
            <p className="font-semibold text-slate-900 truncate">{user.fullName}</p>
            <p className="text-indigo-700 font-mono truncate">@{user.username}</p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="w-full min-h-[42px] px-3 rounded-xl border border-rose-200 bg-rose-50/60 hover:bg-rose-100 text-xs font-semibold text-rose-800 flex items-center justify-center gap-2 whitespace-nowrap shrink-0 transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>Keluar</span>
          </button>
        </div>
      </aside>

      {/* Main Viewport */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header using InstitutionBranding prop */}
        <header className="sticky top-0 z-30 bg-gradient-to-r from-blue-700 via-indigo-700 to-teal-600 text-white lg:bg-none lg:bg-white/90 lg:text-slate-900 backdrop-blur-md border-b border-indigo-900/20 lg:border-indigo-100 h-14 sm:h-16 px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden min-h-[40px] min-w-[40px] rounded-lg bg-white/15 hover:bg-white/25 border border-white/25 text-white flex items-center justify-center shrink-0 transition-colors"
              aria-label="Buka menu navigasi"
            >
              <Menu className="w-5 h-5" />
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
                <span className="hidden sm:inline text-xs font-medium text-sky-100 lg:text-indigo-600 truncate max-w-[180px]">
                  {branding.shortName || branding.name}
                </span>
                <span className="hidden sm:inline text-xs text-white/40 lg:text-slate-300" aria-hidden="true">/</span>
                <h1 className="font-display font-bold text-white lg:text-slate-900 text-sm sm:text-base truncate">
                  {activeTitle}
                </h1>
              </div>
              <p className="lg:hidden text-[11px] text-sky-100 truncate">
                {branding.shortName || branding.name}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden md:flex flex-col items-end text-right min-w-0">
              <span className="text-xs font-semibold text-white lg:text-slate-800 whitespace-nowrap">
                {branding.name}
              </span>
              <span className="text-[11px] text-sky-100 lg:text-slate-500 whitespace-nowrap tabular-nums">
                TA {branding.academicYear} · {branding.timezone}
              </span>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="lg:hidden min-h-[38px] px-2.5 rounded-lg bg-white/15 hover:bg-white/25 border border-white/25 text-xs font-semibold text-white flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
              aria-label="Keluar dari konsol"
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              <span>Keluar</span>
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-4 sm:p-6 pb-24 lg:pb-8 max-w-7xl w-full mx-auto">
          {section === 'overview' && isAdmin && (
            <div className="space-y-6">
              {/* Vibrant Multi-Hue TKA Console Welcome Banner */}
              <section className="relative overflow-hidden bg-gradient-to-r from-blue-700 via-indigo-700 to-teal-600 text-white shadow-lg shadow-indigo-900/10 rounded-xl sm:rounded-2xl p-5 sm:p-7 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -top-16 -right-12 w-56 h-56 rounded-full bg-amber-400/20 blur-2xl"
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -bottom-16 left-1/3 w-56 h-56 rounded-full bg-cyan-300/20 blur-2xl"
                />
                <div className="relative z-10">
                  <p className="text-xs font-bold text-amber-300">
                    Konsol CBT Model TKA · {branding.name}
                  </p>
                  <h2 className="text-lg sm:text-2xl font-display font-bold text-white mt-0.5">
                    Selamat datang, {user.fullName}
                  </h2>
                  <p className="text-xs sm:text-sm text-sky-100 mt-1 max-w-2xl leading-relaxed">
                    Kelola peserta didik, atur soal mana yang tampil saat ujian, pantau jalannya ujian secara langsung, dan unduh rapor.
                  </p>
                </div>
                <div className="relative z-10 flex flex-wrap gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setSection('questions')}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs sm:text-sm font-bold whitespace-nowrap transition-colors shadow-sm"
                  >
                    Kelola Bank Soal
                  </button>
                  <button
                    type="button"
                    onClick={() => setSection('monitoring')}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs sm:text-sm font-bold whitespace-nowrap transition-colors shadow-sm"
                  >
                    Pantau Ujian
                  </button>
                </div>
              </section>

              {/* 8 Color-Coded KPI Stat Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                {[
                  {
                    label: 'Peserta Didik Aktif',
                    val: overview.totalStudents,
                    icon: <Users className="w-4 h-4" />,
                    cardBg: 'bg-sky-50/90 border-sky-200',
                    iconBg: 'bg-sky-600 text-white',
                    valColor: 'text-sky-950',
                  },
                  {
                    label: 'Foto Resmi Terpasang',
                    val: `${overview.photosUploaded} / ${overview.totalStudents}`,
                    icon: <Camera className="w-4 h-4" />,
                    cardBg: 'bg-teal-50/90 border-teal-200',
                    iconBg: 'bg-teal-600 text-white',
                    valColor: 'text-teal-950',
                  },
                  {
                    label: 'Butir Soal TKA',
                    val: overview.totalQuestions,
                    icon: <BookOpen className="w-4 h-4" />,
                    cardBg: 'bg-amber-50/90 border-amber-200',
                    iconBg: 'bg-amber-500 text-slate-950',
                    valColor: 'text-amber-950',
                  },
                  {
                    label: 'Ujian Terdaftar',
                    val: overview.totalExams,
                    icon: <Calendar className="w-4 h-4" />,
                    cardBg: 'bg-violet-50/90 border-violet-200',
                    iconBg: 'bg-violet-600 text-white',
                    valColor: 'text-violet-950',
                  },
                  {
                    label: 'Sesi Berlangsung',
                    val: overview.activeSessions,
                    icon: <Activity className="w-4 h-4" />,
                    cardBg: 'bg-emerald-50/90 border-emerald-200',
                    iconBg: 'bg-emerald-600 text-white',
                    valColor: 'text-emerald-950',
                  },
                  {
                    label: 'Sesi Terkunci',
                    val: overview.lockedSessions,
                    icon: <Lock className="w-4 h-4" />,
                    cardBg: 'bg-rose-50/90 border-rose-200',
                    iconBg: 'bg-rose-600 text-white',
                    valColor: 'text-rose-950',
                  },
                  {
                    label: 'Jumlah Kelas',
                    val: overview.totalClasses,
                    icon: <GraduationCap className="w-4 h-4" />,
                    cardBg: 'bg-indigo-50/90 border-indigo-200',
                    iconBg: 'bg-indigo-600 text-white',
                    valColor: 'text-indigo-950',
                  },
                  {
                    label: 'Mata Pelajaran',
                    val: overview.totalSubjects,
                    icon: <Layers className="w-4 h-4" />,
                    cardBg: 'bg-orange-50/90 border-orange-200',
                    iconBg: 'bg-orange-600 text-white',
                    valColor: 'text-orange-950',
                  },
                ].map((card) => (
                  <div
                    key={card.label}
                    className={`border rounded-xl p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col justify-between gap-3 ${card.cardBg}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-700 leading-snug">{card.label}</p>
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 shadow-xs ${card.iconBg}`}>
                        {card.icon}
                      </span>
                    </div>
                    <p className={`text-xl sm:text-2xl font-display font-bold tabular-nums ${card.valColor}`}>
                      {card.val}
                    </p>
                  </div>
                ))}
              </div>

              {/* 3 Distinct Colorful Quick Action Cards */}
              <div className="bg-white/95 border border-indigo-100 shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-2xl p-5 sm:p-6 space-y-4">
                <h2 className="font-display font-bold text-slate-900 text-base">Akses Cepat Pengelolaan</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  <button
                    type="button"
                    onClick={() => setSection('monitoring')}
                    className="p-4 rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50/80 hover:border-emerald-400 hover:shadow-sm text-left space-y-1.5 transition-all"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
                        <Activity className="w-4 h-4" />
                      </span>
                      <p className="font-bold text-sm text-emerald-950">Buka Monitoring Real-Time</p>
                    </div>
                    <p className="text-xs text-emerald-900/80 leading-relaxed">
                      Pantau peserta, kirim pesan/kesan, kunci &amp; buka kunci sesi, reset ujian, dan periksa kamera.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSection('questions')}
                    className="p-4 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50/80 hover:border-amber-400 hover:shadow-sm text-left space-y-1.5 transition-all"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg bg-amber-500 text-slate-950 flex items-center justify-center shrink-0">
                        <BookOpen className="w-4 h-4" />
                      </span>
                      <p className="font-bold text-sm text-amber-950">Atur Bank Soal &amp; Tampilan Soal</p>
                    </div>
                    <p className="text-xs text-amber-900/80 leading-relaxed">
                      Tentukan butir soal yang ditampilkan (Ya) atau disembunyikan (Tidak) pada ujian.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSection('students')}
                    className="p-4 rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 to-indigo-50/80 hover:border-sky-400 hover:shadow-sm text-left space-y-1.5 transition-all"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg bg-sky-600 text-white flex items-center justify-center shrink-0">
                        <Users className="w-4 h-4" />
                      </span>
                      <p className="font-bold text-sm text-sky-950">Kelola Siswa, PIN &amp; Foto Massal</p>
                    </div>
                    <p className="text-xs text-sky-900/80 leading-relaxed">
                      Atur PIN ujian semua atau siswa tertentu, impor data siswa, dan unggah foto resmi.
                    </p>
                  </button>
                </div>
              </div>
            </div>
          )}

          {section === 'monitoring' && <LiveMonitoringPanel user={user} />}
          {section === 'students' && <StudentsAndPhotosPanel isAdmin={isAdmin} branding={branding} />}
          {section === 'questions' && isAdmin && <QuestionBankPanel />}
          {section === 'exams' && isAdmin && <ExamsAndSchedulesPanel />}
          {section === 'analytics' && isAdmin && <AnalyticsAndReportsPanel branding={branding} />}
          {section === 'settings' && isAdmin && (
            <SystemSettingsAndAuditPanel branding={branding} onBrandingUpdated={onBrandingUpdated} />
          )}
        </main>
      </div>

      {/* Mobile Bottom Quick-Nav Bar (<=56px height) */}
      <nav
        aria-label="Navigasi cepat seluler"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-indigo-100 pb-safe"
      >
        <div className={`grid ${isAdmin ? 'grid-cols-5' : 'grid-cols-2'} h-14`}>
          {mobileQuickItems.map((item) => {
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => setSection(item.id)}
                className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                  active ? item.mobileActiveText : 'text-slate-500'
                }`}
              >
                <span className={active ? item.idleIconClass : 'text-slate-400'}>{item.icon}</span>
                <span className="truncate max-w-[68px]">{item.shortLabel}</span>
              </button>
            );
          })}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                ['overview', 'analytics', 'settings'].includes(section) ? 'text-indigo-700' : 'text-slate-500'
              }`}
            >
              <Menu className="w-4 h-4 shrink-0" />
              <span>Lainnya</span>
            </button>
          )}
        </div>
      </nav>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Menu navigasi konsol admin"
          className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-sm lg:hidden flex"
        >
          <aside className="w-72 max-w-[85vw] bg-white h-full flex flex-col justify-between pb-safe shadow-2xl overflow-hidden">
            <div>
              <div className="p-4 bg-gradient-to-r from-blue-700 via-indigo-700 to-teal-600 text-white flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <img
                    src={branding.logoEndpoint || '/api/branding/logo'}
                    alt={branding.shortName || branding.name}
                    referrerPolicy="no-referrer"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    className="w-8 h-8 rounded-lg object-contain bg-white p-0.5 shrink-0"
                  />
                  <div className="min-w-0">
                    <span className="font-display font-bold text-white text-sm block truncate">
                      {branding.shortName || branding.name}
                    </span>
                    <span className="text-[11px] text-sky-100 truncate block">{user.fullName}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Tutup menu navigasi"
                  className="min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center text-white bg-white/15 hover:bg-white/25 shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav aria-label="Daftar menu seluler" className="p-3 space-y-1.5">
                {navItems.map((item) => {
                  const active = section === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      onClick={() => { setSection(item.id); setMobileMenuOpen(false); }}
                      className={`w-full min-h-[46px] px-3.5 py-2.5 rounded-xl text-sm font-medium flex items-center gap-3 whitespace-nowrap transition-all ${
                        active ? `${item.activeClass} font-semibold` : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className={active ? 'text-white' : item.idleIconClass}>{item.icon}</span>
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
            <div className="p-4 border-t border-slate-100">
              <button
                type="button"
                onClick={onLogout}
                className="w-full min-h-[46px] rounded-xl border border-rose-200 bg-rose-50/70 hover:bg-rose-100 text-sm font-semibold text-rose-800 flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                <span>Keluar</span>
              </button>
            </div>
          </aside>
          <div className="flex-1" onClick={() => setMobileMenuOpen(false)} aria-hidden="true" />
        </div>
      )}
    </div>
  );
};
