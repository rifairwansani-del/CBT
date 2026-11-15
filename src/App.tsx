import { useCallback, useEffect, useState } from 'react';
import { apiFetch, clearAuthToken } from './lib/api.ts';
import { LoginView } from './components/LoginView.tsx';
import { StudentDashboard } from './components/student/StudentDashboard.tsx';
import { ExamRoom } from './components/student/ExamRoom.tsx';
import { AdminDashboard } from './components/admin/AdminDashboard.tsx';
import type { ActiveExamPayload, AuthUser, InstitutionBranding } from './types/cbt.ts';

const DEFAULT_BRANDING: InstitutionBranding = {
  name: 'SMA Negeri Unggul Cipta Jakarta',
  shortName: 'SMAN Unggul Cipta',
  address: 'Jl. Pendidikan Terpadu No. 18, Jakarta Selatan',
  timezone: 'Asia/Jakarta',
  logoEndpoint: '/api/branding/logo',
  academicYear: '2026/2027',
};

export default function App() {
  const [branding, setBranding] = useState<InstitutionBranding>(DEFAULT_BRANDING);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [activeExam, setActiveExam] = useState<{ payload: ActiveExamPayload; cameraStream: MediaStream | null } | null>(null);

  const fetchBranding = useCallback(async () => {
    try {
      const res = await apiFetch<{ institution: InstitutionBranding }>('/api/branding');
      if (res.institution) setBranding(res.institution);
    } catch {
      // keep default
    }
  }, []);

  useEffect(() => {
    Promise.all([
      fetchBranding(),
      apiFetch<{ user: AuthUser }>('/api/auth/me')
        .then((res) => setUser(res.user))
        .catch(() => setUser(null)),
    ]).finally(() => setBootstrapping(false));
  }, [fetchBranding]);

  useEffect(() => {
    const onUnauthorized = () => {
      clearAuthToken();
      setActiveExam((prev) => {
        if (prev?.cameraStream) {
          prev.cameraStream.getTracks().forEach((t) => t.stop());
        }
        return null;
      });
      setUser(null);
    };
    window.addEventListener('sinarcbt:unauthorized', onUnauthorized);
    return () => window.removeEventListener('sinarcbt:unauthorized', onUnauthorized);
  }, []);

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    clearAuthToken();
    if (activeExam?.cameraStream) {
      activeExam.cameraStream.getTracks().forEach((t) => t.stop());
    }
    setActiveExam(null);
    setUser(null);
  };

  if (bootstrapping) {
    return (
      <div className="min-h-screen bg-[#eef2f6] flex items-center justify-center p-6">
        <div className="text-center space-y-2.5">
          <div className="w-8 h-8 border-2 border-[#0e539a] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-medium text-slate-600">Memuat sistem ujian TKA...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginView branding={branding} onLoginSuccess={(loggedInUser) => setUser(loggedInUser)} />;
  }

  if (user.role === 'siswa') {
    if (activeExam) {
      return (
        <ExamRoom
          user={user}
          branding={branding}
          initialPayload={activeExam.payload}
          cameraStream={activeExam.cameraStream}
          onExitExam={() => {
            if (activeExam.cameraStream) {
              activeExam.cameraStream.getTracks().forEach((t) => t.stop());
            }
            setActiveExam(null);
          }}
        />
      );
    }

    return (
      <StudentDashboard
        user={user}
        branding={branding}
        onLogout={handleLogout}
        onEnterExam={(payload, cameraStream) => setActiveExam({ payload, cameraStream })}
      />
    );
  }

  return (
    <AdminDashboard
      user={user}
      branding={branding}
      onBrandingUpdated={fetchBranding}
      onLogout={handleLogout}
    />
  );
}
