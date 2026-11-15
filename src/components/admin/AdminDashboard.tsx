import React, { useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  BookOpen,
  Calendar,
  LayoutDashboard,
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

  const allNavItems: Array<{ id: AdminSection; label: string; shortLabel: string; icon: React.ReactNode; adminOnly?: boolean }> = [
    { id: 'overview', label: 'Ringkasan Sistem', shortLabel: 'Beranda', icon: <LayoutDashboard className="w-4 h-4 shrink-0" />, adminOnly: true },
    { id: 'students', label: 'Siswa, Kelas & Foto', shortLabel: 'Siswa', icon: <Users className="w-4 h-4 shrink-0" /> },
    { id: 'exams', label: 'Ujian & Jadwal', shortLabel: 'Ujian', icon: <Calendar className="w-4 h-4 shrink-0" />, adminOnly: true },
    { id: 'questions', label: 'Bank Soal TKA', shortLabel: 'Soal', icon: <BookOpen className="w-4 h-4 shrink-0" />, adminOnly: true },
    { id: 'monitoring', label: 'Monitoring Real-Time', shortLabel: 'Pantau', icon: <Activity className="w-4 h-4 shrink-0" /> },
    { id: 'analytics', label: 'Analisis & Rapor PDF', shortLabel: 'Analisis', icon: <BarChart3 className="w-4 h-4 shrink-0" />, adminOnly: true },
    { id: 'settings', label: 'Pengaturan, Log & QA', shortLabel: 'Setelan', icon: <Settings className="w-4 h-4 shrink-0" />, adminOnly: true },
  ];
  const navItems = allNavItems.filter((item) => isAdmin || !item.adminOnly);

  const activeTitle = navItems.find((n) => n.id === section)?.label || 'Konsol CBT';
  const mobileQuickItems = isAdmin
    ? navItems.filter((n) => ['students', 'exams', 'questions', 'monitoring'].includes(n.id))
    : navItems;

  return (
    <div className="min-h-screen bg-[#eef2f6] flex">
      {/* Desktop Sidebar (260px) */}
      <aside
        aria-label="Sidebar navigasi konsol admin"
        className="hidden lg:flex w-[260px] bg-white border-r border-slate-200 flex-col justify-between shrink-0 sticky top-0 h-screen"
      >
        <div>
          <div className="h-16 px-5 bg-[#0e539a] text-white border-b border-[#0a3e74] flex items-center gap-3">
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
                {user.role === 'admin' ? 'Admin Utama' : 'Pengawas'} · {branding.academicYear}
              </p>
            </div>
          </div>

          <nav aria-label="Navigasi utama" className="p-3 space-y-1">
            {navItems.map((item) => {
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-nav-section={item.id}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setSection(item.id)}
                  className={`w-full min-h-[42px] px-3.5 py-2 rounded-lg text-sm font-medium flex items-center gap-3 transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[#0e539a] text-white font-semibold'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-slate-100 space-y-3">
          <div className="text-xs">
            <p className="font-semibold text-slate-900 truncate">{user.fullName}</p>
            <p className="text-slate-500 font-mono truncate">@{user.username}</p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 hover:bg-slate-100 text-xs font-semibold text-slate-700 flex items-center justify-center gap-2 whitespace-nowrap shrink-0 transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>Keluar</span>
          </button>
        </div>
      </aside>

      {/* Main Viewport */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header using InstitutionBranding prop */}
        <header className="sticky top-0 z-30 bg-[#0e539a] text-white lg:bg-white/95 lg:text-slate-900 backdrop-blur-md border-b border-[#0a3e74] lg:border-slate-200 h-14 sm:h-16 px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden min-h-[40px] min-w-[40px] rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white flex items-center justify-center shrink-0 transition-colors"
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
                <span className="hidden sm:inline text-xs font-medium text-blue-100 lg:text-slate-500 truncate max-w-[180px]">
                  {branding.shortName || branding.name}
                </span>
                <span className="hidden sm:inline text-xs text-white/40 lg:text-slate-300" aria-hidden="true">/</span>
                <h1 className="font-display font-bold text-white lg:text-slate-900 text-sm sm:text-base truncate">
                  {activeTitle}
                </h1>
              </div>
              <p className="lg:hidden text-[11px] text-blue-100 truncate">
                {branding.shortName || branding.name}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden md:flex flex-col items-end text-right min-w-0">
              <span className="text-xs font-semibold text-white lg:text-slate-800 whitespace-nowrap">
                {branding.name}
              </span>
              <span className="text-[11px] text-blue-100 lg:text-slate-500 whitespace-nowrap tabular-nums">
                TA {branding.academicYear} · {branding.timezone}
              </span>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="lg:hidden min-h-[38px] px-2.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-semibold text-white flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
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
              {/* TKA Console Welcome Card */}
              <section className="bg-white border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-xl sm:rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-[#0e539a]">
                    Konsol CBT Model TKA · {branding.name}
                  </p>
                  <h2 className="text-lg sm:text-xl font-display font-bold text-slate-900 mt-0.5">
                    Selamat datang, {user.fullName}
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-600 mt-1">
                    Kelola peserta didik, atur soal mana yang tampil saat ujian, pantau jalannya ujian secara langsung, dan unduh rapor.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setSection('questions')}
                    className="min-h-[42px] px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs sm:text-sm font-semibold text-slate-800 whitespace-nowrap"
                  >
                    Kelola Bank Soal
                  </button>
                  <button
                    type="button"
                    onClick={() => setSection('monitoring')}
                    className="min-h-[42px] px-4 py-2 rounded-lg bg-[#0e539a] hover:bg-[#0b437e] text-white text-xs sm:text-sm font-semibold whitespace-nowrap"
                  >
                    Pantau Ujian
                  </button>
                </div>
              </section>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                {[
                  { label: 'Peserta Didik Aktif', val: overview.totalStudents },
                  { label: 'Foto Resmi Terpasang', val: `${overview.photosUploaded} / ${overview.totalStudents}` },
                  { label: 'Butir Soal TKA', val: overview.totalQuestions },
                  { label: 'Ujian Terdaftar', val: overview.totalExams },
                  { label: 'Sesi Berlangsung', val: overview.activeSessions },
                  { label: 'Sesi Terkunci', val: overview.lockedSessions },
                  { label: 'Jumlah Kelas', val: overview.totalClasses },
                  { label: 'Mata Pelajaran', val: overview.totalSubjects },
                ].map((card) => (
                  <div key={card.label} className="bg-white border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.03)] rounded-xl p-4 sm:p-5">
                    <p className="text-xs font-medium text-slate-500">{card.label}</p>
                    <p className="text-xl sm:text-2xl font-display font-bold text-slate-900 tabular-nums mt-1.5">{card.val}</p>
                  </div>
                ))}
              </div>

              <div className="bg-white border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-xl p-5 sm:p-6 space-y-4">
                <h2 className="font-display font-bold text-slate-900 text-base">Akses Cepat Pengelolaan</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => setSection('monitoring')}
                    className="p-4 rounded-lg border border-slate-200 hover:border-[#0e539a] hover:bg-sky-50/40 text-left space-y-1 transition-colors"
                  >
                    <p className="font-semibold text-sm text-[#0e539a]">Buka Monitoring Real-Time</p>
                    <p className="text-xs text-slate-600 leading-relaxed">Pantau peserta, chat pengawas, buka kunci sesi, dan periksa kamera.</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSection('questions')}
                    className="p-4 rounded-lg border border-slate-200 hover:border-[#0e539a] hover:bg-sky-50/40 text-left space-y-1 transition-colors"
                  >
                    <p className="font-semibold text-sm text-[#0e539a]">Atur Bank Soal &amp; Tampilan Soal</p>
                    <p className="text-xs text-slate-600 leading-relaxed">Tentukan butir soal yang ditampilkan (Ya) atau disembunyikan (Tidak) pada ujian.</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSection('students')}
                    className="p-4 rounded-lg border border-slate-200 hover:border-[#0e539a] hover:bg-sky-50/40 text-left space-y-1 transition-colors"
                  >
                    <p className="font-semibold text-sm text-[#0e539a]">Kelola Siswa &amp; Foto Massal</p>
                    <p className="text-xs text-slate-600 leading-relaxed">Impor Excel siswa dan unggah ZIP foto resmi berdasarkan NIS.</p>
                  </button>
                </div>
              </div>
            </div>
          )}

          {section === 'monitoring' && <LiveMonitoringPanel user={user} />}
          {section === 'students' && <StudentsAndPhotosPanel isAdmin={isAdmin} />}
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
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200/80 pb-safe"
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
                  active ? 'text-[#0e539a]' : 'text-slate-500'
                }`}
              >
                {item.icon}
                <span className="truncate max-w-[68px]">{item.shortLabel}</span>
              </button>
            );
          })}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                ['overview', 'analytics', 'settings'].includes(section) ? 'text-[#0e539a]' : 'text-slate-500'
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
          <aside className="w-72 max-w-[85vw] bg-white h-full flex flex-col justify-between p-4 pb-safe shadow-2xl">
            <div>
              <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2.5 min-w-0">
                  <img
                    src={branding.logoEndpoint || '/api/branding/logo'}
                    alt={branding.shortName || branding.name}
                    referrerPolicy="no-referrer"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    className="w-8 h-8 rounded-lg object-contain border border-slate-200 bg-slate-50 shrink-0"
                  />
                  <div className="min-w-0">
                    <span className="font-display font-bold text-slate-900 text-sm block truncate">
                      {branding.shortName || branding.name}
                    </span>
                    <span className="text-[11px] text-slate-500 truncate block">{user.fullName}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Tutup menu navigasi"
                  className="min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav aria-label="Daftar menu seluler" className="mt-4 space-y-1">
                {navItems.map((item) => {
                  const active = section === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      onClick={() => { setSection(item.id); setMobileMenuOpen(false); }}
                      className={`w-full min-h-[46px] px-3.5 py-2.5 rounded-lg text-sm font-medium flex items-center gap-3 whitespace-nowrap transition-colors ${
                        active ? 'bg-[#0e539a] text-white font-semibold' : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {item.icon}
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="w-full min-h-[46px] rounded-xl border border-slate-200 hover:bg-slate-50 text-sm font-semibold text-slate-700 flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span>Keluar</span>
            </button>
          </aside>
          <div className="flex-1" onClick={() => setMobileMenuOpen(false)} aria-hidden="true" />
        </div>
      )}
    </div>
  );
};
