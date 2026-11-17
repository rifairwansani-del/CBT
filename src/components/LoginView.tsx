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
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-indigo-50/70 to-emerald-50/70 flex flex-col justify-between relative overflow-x-hidden">
      {/* Multi-Hue Ambient Academic Canvas Backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle at 10% 15%, rgba(37, 99, 235, 0.14) 0%, transparent 42%), radial-gradient(circle at 88% 18%, rgba(139, 92, 246, 0.13) 0%, transparent 40%), radial-gradient(circle at 84% 84%, rgba(16, 185, 129, 0.13) 0%, transparent 44%), radial-gradient(circle at 14% 85%, rgba(245, 158, 11, 0.11) 0%, transparent 38%)',
        }}
      />

      {/* Vibrant Multi-Stop Institutional Header Bar */}
      <header className="relative z-10 bg-gradient-to-r from-blue-700 via-indigo-700 to-teal-600 text-white border-b border-indigo-900/30 px-4 sm:px-8 h-14 sm:h-16 flex items-center justify-between gap-6 shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          {!logoFailed ? (
            <img
              src={branding.logoEndpoint || '/api/branding/logo'}
              alt={`Logo ${branding.name}`}
              onError={() => setLogoFailed(true)}
              referrerPolicy="no-referrer"
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg object-contain bg-white p-0.5 shrink-0 shadow-xs"
            />
          ) : (
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-white text-indigo-700 flex items-center justify-center font-display font-bold text-xs shrink-0">
              TKA
            </div>
          )}
          <span className="font-display font-bold text-white text-sm sm:text-base truncate">
            {branding.name}
          </span>
        </div>
        <span className="text-xs text-sky-100 whitespace-nowrap shrink-0 tabular-nums hidden sm:inline">
          Portal CBT Terpadu · TA {branding.academicYear} · {branding.timezone}
        </span>
      </header>

      {/* Centered Unified Login Card */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-6 sm:px-8 sm:py-10">
        <div className="w-full max-w-lg bg-white rounded-2xl border border-indigo-200/80 shadow-[0_24px_60px_-15px_rgba(67,56,202,0.22)] overflow-hidden">
          <section className="flex flex-col justify-between bg-white relative">
            <div className="h-1.5 w-full bg-gradient-to-r from-blue-600 via-violet-500 via-amber-500 to-emerald-500" aria-hidden="true" />
            <div className="p-6 sm:p-10 flex-1 flex flex-col justify-between">
              <div>
                <div className="pb-5 border-b border-slate-100">
                  <p className="text-xs font-bold bg-gradient-to-r from-blue-700 via-indigo-600 to-teal-600 bg-clip-text text-transparent">
                    Computer-Based Test · Tes Kemampuan Akademik
                  </p>
                  <h1 className="text-2xl sm:text-[26px] font-display font-bold text-slate-900 tracking-tight mt-1 text-balance">
                    Masuk ke Portal Ujian
                  </h1>
                  <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                    Satu akses masuk untuk <strong className="font-semibold text-blue-700">Siswa</strong>,{' '}
                    <strong className="font-semibold text-violet-700">Admin</strong>, dan{' '}
                    <strong className="font-semibold text-teal-700">Pengawas</strong>. Sistem mengenali peran Anda secara otomatis.
                  </p>
                </div>

                {error && (
                  <div
                    className="mt-5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-start gap-2.5"
                    role="alert"
                  >
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-rose-600" />
                    <span>{error}</span>
                  </div>
                )}

                <form onSubmit={handleUnifiedSubmit} className="mt-6 space-y-4">
                  <div>
                    <label htmlFor="unified-id" className="block text-sm font-medium text-slate-700 mb-1.5">
                      NIS (Siswa) atau Username (Admin / Pengawas)
                    </label>
                    <div className="relative">
                      <UserCheck className="w-4 h-4 text-indigo-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="unified-id"
                        type="text"
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        placeholder="Contoh: 2026001 atau admin"
                        required
                        autoComplete="username"
                        className="w-full min-h-[48px] pl-10 pr-4 py-2.5 rounded-xl border border-indigo-200 bg-indigo-50/20 text-slate-900 font-mono text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-600 focus:bg-white transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="unified-secret" className="block text-sm font-medium text-slate-700 mb-1.5">
                      NISN (Siswa) atau Kata Sandi (Admin / Pengawas)
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-teal-600 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="unified-secret"
                        type={showSecret ? 'text' : 'password'}
                        value={secret}
                        onChange={(e) => setSecret(e.target.value)}
                        placeholder="Masukkan NISN atau kata sandi akun"
                        required
                        autoComplete="current-password"
                        className="w-full min-h-[48px] pl-10 pr-12 py-2.5 rounded-xl border border-teal-200 bg-teal-50/20 text-slate-900 font-mono text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/25 focus:border-teal-600 focus:bg-white transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSecret((v) => !v)}
                        aria-label={showSecret ? 'Sembunyikan NISN atau kata sandi' : 'Tampilkan NISN atau kata sandi'}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 min-w-[38px] min-h-[38px] flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-700 hover:bg-indigo-50 transition-colors"
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
                    className="w-full min-h-[48px] mt-1 px-5 py-3 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-teal-600 hover:from-blue-700 hover:via-indigo-700 hover:to-teal-700 active:scale-[0.99] disabled:opacity-60 text-white font-semibold text-sm sm:text-base flex items-center justify-center gap-2 whitespace-nowrap transition-all duration-150 shadow-md shadow-indigo-600/20"
                  >
                    <KeyRound className="w-4 h-4 shrink-0" />
                    <span>{loading ? 'Memverifikasi Akun...' : 'Masuk ke Portal'}</span>
                    <ArrowRight className="w-4 h-4 shrink-0" />
                  </button>
                </form>
              </div>

              {/* Collapsible Demo Account Quick-Fill */}
              <details className="mt-7 pt-4 border-t border-slate-100 group">
                <summary className="list-none cursor-pointer flex items-center justify-between text-xs font-semibold text-slate-600 hover:text-indigo-700 py-1.5">
                  <span className="inline-flex items-center gap-2">
                    <KeyRound className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                    <span>Isi Cepat Akun Uji (Siswa, Admin, &amp; Pengawas)</span>
                  </span>
                  <ChevronDown className="w-4 h-4 transition-transform duration-150 group-open:rotate-180" />
                </summary>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-3">
                  <button
                    type="button"
                    onClick={() => applyQuickFill('2026001', '0091234501')}
                    className="min-h-[44px] px-3 py-2 rounded-lg border border-sky-200 bg-sky-50 hover:bg-sky-100 text-xs font-semibold text-sky-950 text-left transition-colors flex items-center gap-2"
                  >
                    <GraduationCap className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                    <span className="truncate">Siswa XII-IPA-1 · 2026001</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => applyQuickFill('2026002', '0091234502')}
                    className="min-h-[44px] px-3 py-2 rounded-lg border border-teal-200 bg-teal-50 hover:bg-teal-100 text-xs font-semibold text-teal-950 text-left transition-colors flex items-center gap-2"
                  >
                    <GraduationCap className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                    <span className="truncate">Siswa XII-IPA-1 · 2026002</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => applyQuickFill('admin', 'AdminCbt#2026')}
                    className="min-h-[44px] px-3 py-2 rounded-lg border border-violet-200 bg-violet-50 hover:bg-violet-100 text-xs font-semibold text-violet-950 text-left transition-colors flex items-center gap-2"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-violet-600 shrink-0" />
                    <span className="truncate">Admin Utama</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => applyQuickFill('pengawas1', 'Pengawas#2026')}
                    className="min-h-[44px] px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100 text-xs font-semibold text-amber-950 text-left transition-colors flex items-center gap-2"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span className="truncate">Pengawas Ruang</span>
                  </button>
                </div>
                <p className="mt-2.5 text-[11px] text-slate-500">
                  Catatan uji peserta: PIN / Token Ujian default saat memulai tes adalah{' '}
                  <span className="font-mono font-semibold text-indigo-700 tabular-nums">123456</span>.
                </p>
              </details>
            </div>
          </section>
        </div>
      </main>

      {branding.address && (
        <footer className="relative z-10 text-center text-xs text-slate-500 pb-5 px-4">
          {branding.address}
        </footer>
      )}
    </div>
  );
};
