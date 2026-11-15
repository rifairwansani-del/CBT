import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  Eye,
  EyeOff,
  GraduationCap,
  KeyRound,
  Lock,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { apiFetch, getDeviceFingerprint, setAuthToken } from '../lib/api.ts';
import type { AuthUser, InstitutionBranding } from '../types/cbt.ts';

interface LoginViewProps {
  branding: InstitutionBranding;
  onLoginSuccess: (user: AuthUser) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ branding, onLoginSuccess }) => {
  const [identifier, setIdentifier] = useState('');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  const handleUnifiedSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string; user: AuthUser }>('/api/auth/unified-login', {
        method: 'POST',
        body: JSON.stringify({
          identifier: identifier.trim(),
          secret: secret.trim(),
          deviceFingerprint: getDeviceFingerprint(),
        }),
      });
      if (res.token) setAuthToken(res.token);
      onLoginSuccess(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal masuk ke sistem CBT.');
    } finally {
      setLoading(false);
    }
  };

  const applyQuickFill = (nextId: string, nextSecret: string) => {
    setIdentifier(nextId);
    setSecret(nextSecret);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#edf2f7] flex flex-col justify-between relative overflow-x-hidden">
      {/* Subtle Ambient Academic Canvas Backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle at 12% 18%, rgba(14, 83, 154, 0.08) 0%, transparent 45%), radial-gradient(circle at 88% 82%, rgba(15, 41, 74, 0.07) 0%, transparent 48%)',
        }}
      />

      {/* Clean Institutional Header Bar */}
      <header className="relative z-10 bg-[#0e539a] text-white border-b border-[#0a3e74] px-4 sm:px-8 h-14 sm:h-16 flex items-center justify-between gap-6">
        <div className="flex items-center gap-3 min-w-0">
          {!logoFailed ? (
            <img
              src={branding.logoEndpoint || '/api/branding/logo'}
              alt={`Logo ${branding.name}`}
              onError={() => setLogoFailed(true)}
              referrerPolicy="no-referrer"
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg object-contain bg-white p-0.5 shrink-0"
            />
          ) : (
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-white text-[#0e539a] flex items-center justify-center font-display font-bold text-xs shrink-0">
              TKA
            </div>
          )}
          <span className="font-display font-bold text-white text-sm sm:text-base truncate">
            {branding.name}
          </span>
        </div>
        <span className="text-xs text-blue-100 whitespace-nowrap shrink-0 tabular-nums hidden sm:inline">
          Portal CBT Terpadu · TA {branding.academicYear} · {branding.timezone}
        </span>
      </header>

      {/* Main Cohesive Split-Canvas Unified Login */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-6 sm:px-8 sm:py-10">
        <div className="w-full max-w-5xl bg-white rounded-2xl border border-slate-200/90 shadow-[0_24px_60px_-15px_rgba(14,83,154,0.16)] overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch">
          {/* Right Column on Desktop, First on Mobile: Unified Login Form */}
          <section className="order-1 lg:order-2 lg:col-span-6 p-6 sm:p-10 flex flex-col justify-between bg-white">
            <div>
              <div className="pb-5 border-b border-slate-100">
                <p className="text-xs font-semibold text-[#0e539a]">
                  Computer-Based Test · Tes Kemampuan Akademik
                </p>
                <h1 className="text-2xl sm:text-[26px] font-display font-bold text-slate-900 tracking-tight mt-1 text-balance">
                  Masuk ke Portal Ujian
                </h1>
                <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                  Satu akses masuk untuk <strong className="font-semibold text-slate-800">Siswa</strong>,{' '}
                  <strong className="font-semibold text-slate-800">Admin</strong>, dan{' '}
                  <strong className="font-semibold text-slate-800">Pengawas</strong>. Sistem mengenali peran Anda secara otomatis.
                </p>
              </div>

              {error && (
                <div
                  className="mt-5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm flex items-start gap-2.5"
                  role="alert"
                >
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleUnifiedSubmit} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="unified-id" className="block text-sm font-medium text-slate-700 mb-1.5">
                    NIS (Siswa) atau Username (Admin / Pengawas)
                  </label>
                  <div className="relative">
                    <UserCheck className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="unified-id"
                      type="text"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder="Contoh: 2026001 atau admin"
                      required
                      autoComplete="username"
                      className="w-full min-h-[48px] pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-900 font-mono text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#0e539a]/20 focus:border-[#0e539a] transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="unified-secret" className="block text-sm font-medium text-slate-700 mb-1.5">
                    NISN (Siswa) atau Kata Sandi (Admin / Pengawas)
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="unified-secret"
                      type={showSecret ? 'text' : 'password'}
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      placeholder="Masukkan NISN atau kata sandi akun"
                      required
                      autoComplete="current-password"
                      className="w-full min-h-[48px] pl-10 pr-12 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-900 font-mono text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#0e539a]/20 focus:border-[#0e539a] transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret((v) => !v)}
                      aria-label={showSecret ? 'Sembunyikan NISN atau kata sandi' : 'Tampilkan NISN atau kata sandi'}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 min-w-[38px] min-h-[38px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                    >
                      {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <p className="text-xs text-slate-500 leading-relaxed">
                  Untuk peserta ujian, PIN / Password Ujian / Token diinputkan pada tahap Konfirmasi Tes saat akan memulai ujian.
                </p>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full min-h-[48px] mt-1 px-5 py-3 rounded-xl bg-[#0e539a] hover:bg-[#0a3e74] active:scale-[0.99] disabled:opacity-60 text-white font-semibold text-sm sm:text-base flex items-center justify-center gap-2 whitespace-nowrap transition-all duration-150 shadow-sm"
                >
                  <KeyRound className="w-4 h-4 shrink-0" />
                  <span>{loading ? 'Memverifikasi Akun...' : 'Masuk ke Portal'}</span>
                  <ArrowRight className="w-4 h-4 shrink-0" />
                </button>
              </form>
            </div>

            {/* Collapsible Demo Account Quick-Fill */}
            <details className="mt-7 pt-4 border-t border-slate-100 group">
              <summary className="list-none cursor-pointer flex items-center justify-between text-xs font-semibold text-slate-500 hover:text-slate-800 py-1.5">
                <span className="inline-flex items-center gap-2">
                  <KeyRound className="w-3.5 h-3.5 text-[#0e539a] shrink-0" />
                  <span>Isi Cepat Akun Uji (Siswa, Admin, &amp; Pengawas)</span>
                </span>
                <ChevronDown className="w-4 h-4 transition-transform duration-150 group-open:rotate-180" />
              </summary>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => applyQuickFill('2026001', '0091234501')}
                  className="min-h-[44px] px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 text-xs font-medium text-slate-700 text-left transition-colors flex items-center gap-2"
                >
                  <GraduationCap className="w-3.5 h-3.5 text-[#0e539a] shrink-0" />
                  <span className="truncate">Siswa XII-IPA-1 · 2026001</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyQuickFill('2026002', '0091234502')}
                  className="min-h-[44px] px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 text-xs font-medium text-slate-700 text-left transition-colors flex items-center gap-2"
                >
                  <GraduationCap className="w-3.5 h-3.5 text-[#0e539a] shrink-0" />
                  <span className="truncate">Siswa XII-IPA-1 · 2026002</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyQuickFill('admin', 'AdminCbt#2026')}
                  className="min-h-[44px] px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 text-xs font-medium text-slate-700 text-left transition-colors flex items-center gap-2"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-[#0f294a] shrink-0" />
                  <span className="truncate">Admin Utama</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyQuickFill('pengawas1', 'Pengawas#2026')}
                  className="min-h-[44px] px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 text-xs font-medium text-slate-700 text-left transition-colors flex items-center gap-2"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-[#0f294a] shrink-0" />
                  <span className="truncate">Pengawas Ruang</span>
                </button>
              </div>
              <p className="mt-2.5 text-[11px] text-slate-500">
                Catatan uji peserta: PIN / Token Ujian default saat memulai tes adalah{' '}
                <span className="font-mono font-semibold text-slate-700 tabular-nums">123456</span>.
              </p>
            </details>
          </section>

          {/* Left Column on Desktop, Second on Mobile: Atmospheric TKA Academic Showcase */}
          <section className="order-2 lg:order-1 lg:col-span-6 relative bg-[#0c2342] text-white p-6 sm:p-10 flex flex-col justify-between overflow-hidden">
            {/* Subtle Architectural Grid & Lighting Depth */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-20"
              style={{
                backgroundImage:
                  'linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 1px)',
                backgroundSize: '32px 32px',
              }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full bg-[#1b6ec2]/30 blur-3xl"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-sky-400/15 blur-3xl"
            />

            <div className="relative z-10">
              <p className="text-xs font-semibold text-sky-300 tracking-wide">
                Portal Terpadu CBT Model TKA
              </p>
              <h2 className="mt-2 text-2xl sm:text-[28px] font-display font-bold leading-snug text-balance">
                Satu Pintu Masuk untuk Peserta, Pengawas, &amp; Admin
              </h2>
              <p className="mt-3 text-sm text-blue-100/90 leading-relaxed max-w-md">
                Terintegrasi penuh untuk pelaksanaan ujian berbasis komputer di ponsel, tablet, maupun komputer dengan penyimpanan jawaban otomatis dan monitoring waktu nyata.
              </p>

              {/* Editorial 01 / 02 / 03 Role Guide */}
              <div className="mt-7 sm:mt-8 border-t border-white/15 divide-y divide-white/10">
                <div className="py-3.5 flex items-start gap-3.5">
                  <span className="font-mono text-xs font-semibold text-sky-300 tabular-nums pt-0.5 shrink-0">
                    01.
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">Peserta Ujian (Siswa)</p>
                    <p className="text-xs text-blue-100/80 mt-0.5 leading-relaxed">
                      Masuk dengan <span className="font-mono text-sky-200">NIS</span> dan{' '}
                      <span className="font-mono text-sky-200">NISN</span>, periksa foto resmi, lalu inputkan PIN / Token saat memulai tes.
                    </p>
                  </div>
                </div>
                <div className="py-3.5 flex items-start gap-3.5">
                  <span className="font-mono text-xs font-semibold text-sky-300 tabular-nums pt-0.5 shrink-0">
                    02.
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">Pengawas Ruang</p>
                    <p className="text-xs text-blue-100/80 mt-0.5 leading-relaxed">
                      Masuk dengan akun pengawas untuk memantau peserta aktif, log pelanggaran, kamera ringan, dan membuka sesi terkunci.
                    </p>
                  </div>
                </div>
                <div className="py-3.5 flex items-start gap-3.5">
                  <span className="font-mono text-xs font-semibold text-sky-300 tabular-nums pt-0.5 shrink-0">
                    03.
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">Admin Lembaga</p>
                    <p className="text-xs text-blue-100/80 mt-0.5 leading-relaxed">
                      Kelola peserta, unggah foto resmi, susun bank soal model TKA, atur jadwal ujian, dan ekspor rapor penilaian.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative z-10 mt-6 pt-4 border-t border-white/15 flex flex-wrap items-center justify-between gap-2 text-xs text-blue-100/75">
              <span>{branding.address}</span>
              <span className="font-mono tabular-nums text-sky-200/80 sm:hidden">
                TA {branding.academicYear}
              </span>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};
