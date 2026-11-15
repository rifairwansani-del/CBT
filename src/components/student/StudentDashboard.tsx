import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Award,
  Bell,
  BellRing,
  BookOpen,
  CalendarClock,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogOut,
  Megaphone,
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

interface PushToastItem {
  id: string;
  kind: 'announcement' | 'warning' | 'upcoming_exam' | 'exam_opened';
  badge: string;
  title: string;
  body: string;
  createdAt: string;
  messageId?: string;
  examId?: string;
}

function formatCountdownShort(diffMs: number): string {
  const totalSec = Math.max(0, Math.ceil(diffMs / 1000));
  if (totalSec < 60) return `${totalSec} detik`;
  const totalMin = Math.ceil(diffMs / 60000);
  if (totalMin < 60) return `${totalMin} menit`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return mins > 0 ? `${hours} jam ${mins} menit` : `${hours} jam`;
}

function getMessageCategoryLabel(category: StudentMessageItem['category']): string {
  if (category === 'pengumuman') return 'Pengumuman Penting';
  if (category === 'peringatan') return 'Peringatan';
  if (category === 'instruksi') return 'Instruksi Teknis';
  if (category === 'kesan') return 'Kesan & Catatan';
  return 'Pesan';
}

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
  const [showStudentHistory, setShowStudentHistory] = useState(true);

  // Push notifications & server-synchronized clock
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [serverNowMs, setServerNowMs] = useState(() => Date.now());
  const [pushToasts, setPushToasts] = useState<PushToastItem[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [dismissedAlertKeys, setDismissedAlertKeys] = useState<string[]>([]);
  const [browserNotifPermission, setBrowserNotifPermission] = useState<NotificationPermission | 'unsupported'>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return window.Notification.permission;
  });

  const shownToastKeysRef = useRef<Set<string>>(new Set());
  const refreshedExamIdsRef = useRef<Set<string>>(new Set());
  const notifContainerRef = useRef<HTMLDivElement | null>(null);

  const sendBrowserNotification = useCallback((title: string, body: string, tag?: string) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (window.Notification.permission !== 'granted') return;
    try {
      new window.Notification(title, {
        body,
        tag,
        icon: branding.logoEndpoint || '/api/branding/logo',
      });
    } catch {
      // Ignore browser notification restrictions inside sandboxed iframes
    }
  }, [branding.logoEndpoint]);

  const enqueuePushToast = useCallback(
    (dedupKey: string, toast: Omit<PushToastItem, 'id'>, alsoBrowserPush = false) => {
      if (shownToastKeysRef.current.has(dedupKey)) return;
      shownToastKeysRef.current.add(dedupKey);
      const id = `toast_${dedupKey}_${Date.now()}`;
      setPushToasts((prev) => [{ ...toast, id }, ...prev].slice(0, 3));
      if (alsoBrowserPush) {
        sendBrowserNotification(toast.title, toast.body, dedupKey);
      }
      window.setTimeout(() => {
        setPushToasts((prev) => prev.filter((t) => t.id !== id));
      }, 11000);
    },
    [sendBrowserNotification]
  );

  const dismissPushToast = useCallback((toastId: string) => {
    setPushToasts((prev) => prev.filter((t) => t.id !== toastId));
  }, []);

  const requestBrowserPushPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setBrowserNotifPermission('unsupported');
      return;
    }
    try {
      const perm = await window.Notification.requestPermission();
      setBrowserNotifPermission(perm);
      if (perm === 'granted') {
        sendBrowserNotification(
          `${branding.shortName || branding.name} · Notifikasi Aktif`,
          'Anda akan menerima pemberitahuan saat pengumuman penting atau jadwal ujian tiba.',
          'push_enabled'
        );
      }
    } catch {
      // Ignore permission prompt errors in restricted environments
    }
  };

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dashRes, msgRes] = await Promise.all([
        apiFetch<{ serverTime?: string; exams: StudentExamSummary[]; showStudentHistory?: boolean }>('/api/student/dashboard'),
        apiFetch<{ messages: StudentMessageItem[] }>('/api/student/messages').catch(() => ({ messages: [] })),
      ]);
      if (dashRes.serverTime) {
        const parsedServerMs = Date.parse(dashRes.serverTime);
        if (!Number.isNaN(parsedServerMs)) {
          const offset = parsedServerMs - Date.now();
          setServerOffsetMs(offset);
          setServerNowMs(Date.now() + offset);
        }
      }
      const nextHistoryVisible = dashRes.showStudentHistory !== false;
      setShowStudentHistory(nextHistoryVisible);
      if (!nextHistoryVisible) {
        setActiveTab('ujian');
      }
      setExams(Array.isArray(dashRes.exams) ? dashRes.exams : []);
      setMessages(Array.isArray(msgRes.messages) ? msgRes.messages : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat daftar ujian.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // Real-time WebSocket listener with auto-reconnect for announcements, schedule updates, and session resets
  useEffect(() => {
    let active = true;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let attempt = 0;

    const connect = () => {
      if (!active) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(withAuthTokenUrl(`${proto}//${window.location.host}/ws`));

      ws.onopen = () => {
        if (attempt > 0) {
          loadDashboard();
        }
        attempt = 0;
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'student:message' && msg.message) {
            const item = msg.message as StudentMessageItem;
            setMessages((prev) => (prev.some((m) => m.id === item.id) ? prev : [item, ...prev]));
            enqueuePushToast(
              `ws_msg_${item.id}`,
              {
                kind: item.category === 'peringatan' ? 'warning' : 'announcement',
                badge: getMessageCategoryLabel(item.category),
                title: item.title || `${getMessageCategoryLabel(item.category)} dari ${item.sender_name}`,
                body: item.message,
                createdAt: item.created_at,
                messageId: item.id,
              },
              true
            );
          } else if (msg.type === 'session:reset_exam') {
            loadDashboard();
          } else if (msg.type === 'exam:schedule_updated') {
            loadDashboard();
            const examTitle = msg.title ? String(msg.title) : 'Jadwal Ujian';
            enqueuePushToast(
              `ws_sched_${msg.examId || 'all'}_${msg.timestamp || Date.now()}`,
              {
                kind: 'upcoming_exam',
                badge: 'Pembaruan Jadwal',
                title: `${examTitle} Diperbarui`,
                body: 'Panitia baru saja memperbarui jadwal atau pengaturan ujian Anda.',
                createdAt: msg.timestamp || new Date().toISOString(),
                examId: msg.examId ? String(msg.examId) : undefined,
              },
              true
            );
          }
        } catch {
          // ignore parse error
        }
      };

      ws.onclose = () => {
        if (!active) return;
        const delay = Math.min(15000, 2500 * Math.pow(2, attempt));
        attempt += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [enqueuePushToast, loadDashboard]);

  // Server-synchronized tick for upcoming exam countdowns
  useEffect(() => {
    const hasNearSchedule = exams.some((e) => {
      if (e.availability !== 'upcoming') return false;
      const diff = Date.parse(e.startAt) - (Date.now() + serverOffsetMs);
      return diff > 0 && diff <= 5 * 60 * 1000;
    });
    const intervalMs = hasNearSchedule ? 1000 : 15000;
    const timer = window.setInterval(() => {
      setServerNowMs(Date.now() + serverOffsetMs);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [exams, serverOffsetMs]);

  // Compute upcoming / soon-to-start exam schedule alerts (within 60 minutes) and open exams closing soon
  const scheduleNotifications = useMemo(() => {
    const alerts: Array<{
      key: string;
      exam: StudentExamSummary;
      kind: 'starting_soon' | 'closing_soon' | 'just_opened';
      diffMs: number;
      title: string;
      body: string;
    }> = [];

    for (const exam of exams) {
      if (exam.availability === 'upcoming') {
        const startMs = Date.parse(exam.startAt);
        if (!Number.isNaN(startMs)) {
          const diffMs = startMs - serverNowMs;
          if (diffMs > 0 && diffMs <= 60 * 60 * 1000) {
            alerts.push({
              key: `upcoming:${exam.id}:${exam.startAt}`,
              exam,
              kind: 'starting_soon',
              diffMs,
              title: `${exam.title} segera dimulai`,
              body: `Mulai dalam ${formatCountdownShort(diffMs)} (${new Date(exam.startAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} ${exam.timezone})`,
            });
          }
        }
      } else if (exam.availability === 'open') {
        const startMs = Date.parse(exam.startAt);
        const deadlineMs = Date.parse(exam.entryDeadlineAt);
        const sinceStartMs = serverNowMs - startMs;
        if (!Number.isNaN(startMs) && sinceStartMs >= 0 && sinceStartMs <= 5 * 60 * 1000) {
          alerts.push({
            key: `opened:${exam.id}:${exam.startAt}`,
            exam,
            kind: 'just_opened',
            diffMs: sinceStartMs,
            title: `${exam.title} sudah dibuka`,
            body: `Sesi masuk telah dibuka (${exam.durationMinutes} menit · ${exam.questionCount} soal).`,
          });
        } else if (!Number.isNaN(deadlineMs)) {
          const remainingEntryMs = deadlineMs - serverNowMs;
          if (remainingEntryMs > 0 && remainingEntryMs <= 30 * 60 * 1000) {
            alerts.push({
              key: `closing:${exam.id}:${exam.entryDeadlineAt}`,
              exam,
              kind: 'closing_soon',
              diffMs: remainingEntryMs,
              title: `Batas masuk ${exam.title} tersisa ${formatCountdownShort(remainingEntryMs)}`,
              body: `Segera mulai sebelum pukul ${new Date(exam.entryDeadlineAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} ${exam.timezone}.`,
            });
          }
        }
      }
    }

    return alerts.sort((a, b) => a.diffMs - b.diffMs);
  }, [exams, serverNowMs]);

  // Auto-refresh from server when an upcoming exam reaches its scheduled start time
  useEffect(() => {
    const newlyStarted = exams.filter(
      (e) =>
        e.availability === 'upcoming' &&
        !Number.isNaN(Date.parse(e.startAt)) &&
        Date.parse(e.startAt) <= serverNowMs &&
        !refreshedExamIdsRef.current.has(e.id)
    );
    if (newlyStarted.length > 0) {
      newlyStarted.forEach((e) => refreshedExamIdsRef.current.add(e.id));
      loadDashboard().then(() => {
        newlyStarted.forEach((e) => {
          enqueuePushToast(
            `exam_opened_${e.id}_${e.startAt}`,
            {
              kind: 'exam_opened',
              badge: 'Ujian Dimulai',
              title: `${e.title} Sudah Dibuka`,
              body: `Jadwal tes ${e.subjectName} telah tiba. Anda dapat langsung memulai ujian.`,
              createdAt: new Date().toISOString(),
              examId: e.id,
            },
            true
          );
        });
      });
    }
  }, [exams, serverNowMs, loadDashboard, enqueuePushToast]);

  // Push toast notifications for unread important announcements & imminent upcoming exams
  useEffect(() => {
    if (loading) return;
    const unreadImportant = messages.filter((m) => !m.is_read).slice(0, 2);
    for (const item of unreadImportant) {
      enqueuePushToast(`init_msg_${item.id}`, {
        kind: item.category === 'peringatan' ? 'warning' : 'announcement',
        badge: getMessageCategoryLabel(item.category),
        title: item.title || `${getMessageCategoryLabel(item.category)} dari ${item.sender_name}`,
        body: item.message,
        createdAt: item.created_at,
        messageId: item.id,
      });
    }

    for (const alert of scheduleNotifications) {
      const bucket =
        alert.kind === 'just_opened'
          ? 'opened'
          : alert.diffMs <= 5 * 60 * 1000
          ? '5m'
          : alert.diffMs <= 15 * 60 * 1000
          ? '15m'
          : '60m';
      enqueuePushToast(
        `sched_${alert.key}_${bucket}`,
        {
          kind: alert.kind === 'just_opened' ? 'exam_opened' : 'upcoming_exam',
          badge:
            alert.kind === 'just_opened'
              ? 'Ujian Dibuka'
              : alert.kind === 'closing_soon'
              ? 'Batas Masuk'
              : 'Segera Dimulai',
          title: alert.title,
          body: alert.body,
          createdAt: new Date(serverNowMs).toISOString(),
          examId: alert.exam.id,
        },
        bucket === '5m' || bucket === 'opened'
      );
    }
  }, [loading, messages, scheduleNotifications, serverNowMs, enqueuePushToast]);

  // Close notification popover on outside click or Escape
  useEffect(() => {
    if (!notifOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (notifContainerRef.current && !notifContainerRef.current.contains(event.target as Node)) {
        setNotifOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNotifOpen(false);
    };
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [notifOpen]);

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

  const navItems: Array<{
    id: StudentSection;
    label: string;
    count: number;
    icon: React.ReactNode;
    activeClass: string;
    idleIconClass: string;
  }> = [
    {
      id: 'ujian',
      label: 'Ikuti Ujian',
      count: ongoingAndUpcoming.length,
      icon: <BookOpen className="w-4 h-4 shrink-0" />,
      activeClass: 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm shadow-indigo-600/20',
      idleIconClass: 'text-indigo-600',
    },
    ...(showStudentHistory
      ? [
          {
            id: 'nilai' as StudentSection,
            label: 'Cek Nilai & Rapor',
            count: completedExams.length,
            icon: <Award className="w-4 h-4 shrink-0" />,
            activeClass: 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-sm shadow-emerald-600/20',
            idleIconClass: 'text-emerald-600',
          },
        ]
      : []),
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
        <div className="h-16 px-4 sm:px-5 bg-gradient-to-r from-blue-700 via-indigo-700 to-teal-600 text-white border-b border-indigo-900/20 flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-3 min-w-0">
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
                Portal Peserta TKA · {branding.academicYear}
              </p>
            </div>
          </div>
          {onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="Tutup menu navigasi"
              className="min-h-[40px] min-w-[40px] rounded-lg bg-white/15 hover:bg-white/25 text-white flex items-center justify-center shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Left Navigation Links */}
        <nav aria-label="Navigasi peserta ujian" className="p-3 space-y-1.5">
          <p className="px-3 pt-1 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-indigo-500">
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
                className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl text-sm font-medium flex items-center justify-between gap-2.5 transition-all whitespace-nowrap ${
                  active
                    ? `${item.activeClass} font-semibold`
                    : 'text-slate-700 hover:bg-slate-100/80'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <span className={active ? 'text-white' : item.idleIconClass}>{item.icon}</span>
                  <span className="truncate">{item.label}</span>
                </span>
                <span
                  className={`font-mono text-xs tabular-nums shrink-0 ${
                    active ? 'text-white/90' : 'text-slate-400'
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
      <div className="p-4 border-t border-indigo-100/80 space-y-3 bg-gradient-to-b from-slate-50/60 to-indigo-50/40">
        <div className="flex items-center gap-3 min-w-0">
          <StudentAvatar photoUrl={user.photoUrl} fullName={user.fullName} size="sm" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-900 truncate">{user.fullName}</p>
            <p className="text-[11px] font-mono text-indigo-700 truncate tabular-nums">
              NIS {user.nis} · {user.className}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="w-full min-h-[42px] px-3 rounded-xl border border-rose-200 bg-rose-50/70 hover:bg-rose-100 text-xs font-semibold text-rose-800 flex items-center justify-center gap-2 whitespace-nowrap shrink-0 transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span>Keluar</span>
        </button>
      </div>
    </div>
  );

  const openCardThemes = [
    {
      topBar: 'from-blue-600 via-indigo-600 to-cyan-500',
      border: 'border-indigo-200 hover:border-indigo-300',
      eyebrow: 'text-indigo-700',
      cta: 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700',
    },
    {
      topBar: 'from-violet-600 via-fuchsia-600 to-pink-500',
      border: 'border-violet-200 hover:border-violet-300',
      eyebrow: 'text-violet-700',
      cta: 'bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700',
    },
    {
      topBar: 'from-teal-500 via-emerald-500 to-cyan-500',
      border: 'border-teal-200 hover:border-teal-300',
      eyebrow: 'text-teal-700',
      cta: 'bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700',
    },
    {
      topBar: 'from-amber-500 via-orange-500 to-rose-500',
      border: 'border-amber-200 hover:border-amber-300',
      eyebrow: 'text-amber-700',
      cta: 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700',
    },
  ];

  const openConfirmModalForExam = (exam: StudentExamSummary) => {
    setStartError(null);
    setExamPin('');
    setShowExamPin(false);
    setCameraConsent(exam.proctoringEnabled);
    setConfirmExam(exam);
  };

  const unreadMessagesCount = messages.filter((m) => !m.is_read).length;
  const activeScheduleAlerts = scheduleNotifications.filter((a) => !dismissedAlertKeys.includes(a.key));
  const totalNotifBadgeCount = unreadMessagesCount + activeScheduleAlerts.length;

  return (
    <div className="min-h-screen flex">
      {/* Floating Push Notification Toast Stack (Top-Right) */}
      {pushToasts.length > 0 && (
        <div
          aria-live="polite"
          aria-label="Notifikasi push terbaru"
          className="fixed top-16 sm:top-20 right-3 sm:right-5 z-50 w-[calc(100vw-1.5rem)] max-w-sm space-y-2.5 pointer-events-none"
        >
          {pushToasts.map((toast) => {
            const accent =
              toast.kind === 'warning'
                ? 'border-amber-300 bg-white shadow-amber-900/10'
                : toast.kind === 'exam_opened'
                ? 'border-emerald-300 bg-white shadow-emerald-900/10'
                : toast.kind === 'upcoming_exam'
                ? 'border-indigo-300 bg-white shadow-indigo-900/10'
                : 'border-violet-300 bg-white shadow-violet-900/10';
            const bar =
              toast.kind === 'warning'
                ? 'bg-amber-500'
                : toast.kind === 'exam_opened'
                ? 'bg-emerald-500'
                : toast.kind === 'upcoming_exam'
                ? 'bg-indigo-600'
                : 'bg-violet-600';
            const badgeColor =
              toast.kind === 'warning'
                ? 'text-amber-800'
                : toast.kind === 'exam_opened'
                ? 'text-emerald-700'
                : toast.kind === 'upcoming_exam'
                ? 'text-indigo-700'
                : 'text-violet-700';
            const targetExam = toast.examId ? exams.find((e) => e.id === toast.examId) : undefined;

            return (
              <div
                key={toast.id}
                role="status"
                className={`pointer-events-auto rounded-2xl border shadow-xl overflow-hidden transition-all ${accent}`}
              >
                <div className={`h-1 w-full ${bar}`} aria-hidden="true" />
                <div className="p-3.5 sm:p-4 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center shrink-0 mt-0.5">
                    {toast.kind === 'announcement' ? (
                      <Megaphone className="w-4 h-4 text-violet-600" />
                    ) : toast.kind === 'warning' ? (
                      <ShieldAlert className="w-4 h-4 text-amber-600" />
                    ) : (
                      <Clock className="w-4 h-4 text-indigo-600" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[11px] font-bold uppercase tracking-wide ${badgeColor}`}>
                        {toast.badge}
                      </span>
                      <button
                        type="button"
                        onClick={() => dismissPushToast(toast.id)}
                        aria-label="Tutup notifikasi"
                        className="text-slate-400 hover:text-slate-700 p-0.5 rounded"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-xs sm:text-sm font-bold text-slate-900 leading-snug break-words">
                      {toast.title}
                    </p>
                    <p className="text-xs text-slate-600 leading-relaxed line-clamp-3 break-words">
                      {toast.body}
                    </p>
                    {(toast.messageId || (targetExam && (targetExam.availability === 'open' || targetExam.availability === 'in_progress'))) && (
                      <div className="pt-1 flex flex-wrap items-center gap-2">
                        {toast.messageId && (
                          <button
                            type="button"
                            onClick={() => {
                              markMessageRead(toast.messageId!);
                              dismissPushToast(toast.id);
                            }}
                            className="text-[11px] font-semibold text-violet-700 hover:underline"
                          >
                            Tandai Dibaca
                          </button>
                        )}
                        {targetExam && (targetExam.availability === 'open' || targetExam.availability === 'in_progress') && (
                          <button
                            type="button"
                            onClick={() => {
                              dismissPushToast(toast.id);
                              setActiveTab('ujian');
                              openConfirmModalForExam(targetExam);
                            }}
                            className="text-[11px] font-bold text-indigo-700 hover:underline"
                          >
                            {targetExam.availability === 'in_progress' ? 'Lanjutkan Tes →' : 'Mulai Tes →'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Desktop Left Sidebar (visible when expanded on lg+) */}
      {desktopSidebarVisible && (
        <aside
          aria-label="Sidebar navigasi peserta"
          className="hidden lg:flex w-[260px] bg-white/95 backdrop-blur-sm border-r border-indigo-100 flex-col shrink-0 sticky top-0 h-screen"
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
        <header className="sticky top-0 z-30 bg-gradient-to-r from-blue-700 via-indigo-700 to-teal-600 text-white lg:bg-none lg:bg-white/90 lg:text-slate-900 backdrop-blur-md border-b border-indigo-900/20 lg:border-indigo-100 h-14 sm:h-16 px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* HP & Tablet Drawer Toggle Button */}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Buka menu navigasi kiri"
              aria-expanded={drawerOpen}
              className="lg:hidden min-h-[42px] min-w-[42px] rounded-lg bg-white/15 hover:bg-white/25 border border-white/25 text-white flex items-center justify-center shrink-0 transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Desktop Sidebar Collapse / Expand Toggle */}
            <button
              type="button"
              onClick={() => setDesktopSidebarVisible((v) => !v)}
              aria-label={desktopSidebarVisible ? 'Sembunyikan navigasi kiri' : 'Tampilkan navigasi kiri'}
              title={desktopSidebarVisible ? 'Sembunyikan menu kiri' : 'Tampilkan menu kiri'}
              className="hidden lg:inline-flex min-h-[38px] min-w-[38px] rounded-lg border border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100 text-indigo-700 items-center justify-center shrink-0 transition-colors"
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
                <span className="hidden sm:inline text-xs font-medium text-sky-100 lg:text-indigo-600 truncate max-w-[180px]">
                  {branding.shortName || branding.name}
                </span>
                <span className="hidden sm:inline text-xs text-white/40 lg:text-slate-300" aria-hidden="true">/</span>
                <h1 className="font-display font-bold text-white lg:text-slate-900 text-sm sm:text-base truncate">
                  {activePageTitle}
                </h1>
              </div>
              <p className="lg:hidden text-[11px] text-sky-100 truncate">
                {branding.shortName || branding.name}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            <div className="hidden xl:flex flex-col items-end text-right min-w-0 mr-1">
              <span className="text-xs font-semibold text-slate-800 whitespace-nowrap">
                {branding.name}
              </span>
              <span className="text-[11px] text-slate-500 whitespace-nowrap tabular-nums">
                TA {branding.academicYear} · {branding.timezone}
              </span>
            </div>

            {/* Push Notification Center Trigger & Popover */}
            <div className="relative" ref={notifContainerRef}>
              <button
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                aria-label={`Notifikasi (${totalNotifBadgeCount} aktif)`}
                aria-expanded={notifOpen}
                className="relative min-h-[38px] min-w-[38px] sm:px-3 rounded-lg bg-white/15 hover:bg-white/25 border border-white/25 text-white lg:bg-amber-50 lg:hover:bg-amber-100 lg:border-amber-200 lg:text-amber-900 text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
              >
                {totalNotifBadgeCount > 0 ? (
                  <BellRing className="w-4 h-4 shrink-0" />
                ) : (
                  <Bell className="w-4 h-4 shrink-0" />
                )}
                <span className="hidden sm:inline">Notifikasi</span>
                {totalNotifBadgeCount > 0 && (
                  <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold tabular-nums flex items-center justify-center">
                    {totalNotifBadgeCount > 99 ? '99+' : totalNotifBadgeCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div
                  role="region"
                  aria-label="Pusat Notifikasi Peserta"
                  className="fixed sm:absolute left-3 right-3 sm:left-auto sm:right-0 top-16 sm:top-full sm:mt-2 sm:w-96 bg-white border border-indigo-200 rounded-2xl shadow-2xl overflow-hidden z-50 text-slate-900"
                >
                  <div className="px-4 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 text-white flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <BellRing className="w-4 h-4 shrink-0" />
                      <span className="text-xs sm:text-sm font-display font-bold truncate">
                        Notifikasi &amp; Pengingat Ujian
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setNotifOpen(false)}
                      aria-label="Tutup panel notifikasi"
                      className="p-1 rounded-lg hover:bg-white/15"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Native Browser Push Opt-In Strip */}
                  {browserNotifPermission !== 'unsupported' && (
                    <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-600">
                        {browserNotifPermission === 'granted'
                          ? 'Notifikasi push browser aktif'
                          : browserNotifPermission === 'denied'
                          ? 'Notifikasi browser diblokir di setelan peramban'
                          : 'Aktifkan notifikasi popup browser?'}
                      </span>
                      {browserNotifPermission === 'default' && (
                        <button
                          type="button"
                          onClick={requestBrowserPushPermission}
                          className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-semibold whitespace-nowrap shrink-0"
                        >
                          Aktifkan
                        </button>
                      )}
                    </div>
                  )}

                  <div className="max-h-[65vh] overflow-y-auto divide-y divide-slate-100">
                    {/* Upcoming / Closing Schedule Reminders */}
                    {activeScheduleAlerts.length > 0 && (
                      <div className="p-3 space-y-2 bg-amber-50/40">
                        <p className="px-1 text-[11px] font-bold uppercase tracking-wider text-amber-800">
                          Jadwal Ujian Terdekat
                        </p>
                        {activeScheduleAlerts.map((alert) => (
                          <div
                            key={alert.key}
                            className="p-3 rounded-xl bg-white border border-amber-200 space-y-1.5"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-xs font-bold text-slate-900">{alert.title}</p>
                              <button
                                type="button"
                                onClick={() => setDismissedAlertKeys((prev) => [...prev, alert.key])}
                                aria-label="Sembunyikan pengingat jadwal"
                                className="text-slate-400 hover:text-slate-700"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <p className="text-[11px] text-slate-600 leading-relaxed">{alert.body}</p>
                            {(alert.exam.availability === 'open' || alert.exam.availability === 'in_progress') && (
                              <button
                                type="button"
                                onClick={() => {
                                  setNotifOpen(false);
                                  setActiveTab('ujian');
                                  openConfirmModalForExam(alert.exam);
                                }}
                                className="text-[11px] font-bold text-emerald-700 hover:underline"
                              >
                                {alert.exam.availability === 'in_progress' ? 'Lanjutkan Ujian Sekarang →' : 'Mulai Ujian Sekarang →'}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Important Announcements & Messages */}
                    <div className="p-3 space-y-2">
                      <div className="px-1 flex items-center justify-between gap-2">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">
                          Pengumuman &amp; Pesan ({messages.length})
                        </p>
                        {unreadMessagesCount > 0 && (
                          <button
                            type="button"
                            onClick={() => markMessageRead('all')}
                            className="text-[11px] font-semibold text-indigo-600 hover:underline"
                          >
                            Tandai Semua Dibaca
                          </button>
                        )}
                      </div>

                      {messages.length === 0 && activeScheduleAlerts.length === 0 ? (
                        <p className="py-6 text-center text-xs text-slate-500">
                          Belum ada pengumuman atau jadwal ujian yang akan segera dimulai.
                        </p>
                      ) : messages.length === 0 ? (
                        <p className="py-3 text-center text-xs text-slate-500">
                          Belum ada pengumuman atau pesan baru dari panitia.
                        </p>
                      ) : (
                        messages.slice(0, 8).map((m) => (
                          <div
                            key={m.id}
                            className={`p-3 rounded-xl border ${
                              m.is_read
                                ? 'bg-white border-slate-100'
                                : 'bg-indigo-50/60 border-indigo-200'
                            } space-y-1`}
                          >
                            <div className="flex items-center justify-between gap-2 text-[11px]">
                              <span className="font-bold text-indigo-700">
                                {getMessageCategoryLabel(m.category)}
                              </span>
                              <span className="text-slate-400 tabular-nums">
                                {new Date(m.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            {m.title && <p className="text-xs font-bold text-slate-900">{m.title}</p>}
                            <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line">{m.message}</p>
                            {!m.is_read && (
                              <button
                                type="button"
                                onClick={() => markMessageRead(m.id)}
                                className="text-[11px] font-semibold text-indigo-700 hover:underline"
                              >
                                Tandai Dibaca
                              </button>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={loadDashboard}
              aria-label="Muat ulang daftar ujian"
              className="min-h-[38px] min-w-[38px] sm:px-3 rounded-lg bg-white/15 hover:bg-white/25 border border-white/25 text-white lg:bg-indigo-50 lg:hover:bg-indigo-100 lg:border-indigo-200 lg:text-indigo-800 text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Segarkan</span>
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="lg:hidden min-h-[38px] px-2.5 sm:px-3 rounded-lg bg-white/15 hover:bg-white/25 border border-white/25 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">Keluar</span>
            </button>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-5 sm:py-7 pb-10 space-y-5 sm:space-y-6">
          {/* Colorful Official Participant Data Confirmation Card */}
          <section className="bg-white border border-indigo-200/80 shadow-sm rounded-xl sm:rounded-2xl overflow-hidden">
            <div className="h-1.5 w-full bg-gradient-to-r from-sky-500 via-indigo-500 via-violet-500 to-emerald-500" aria-hidden="true" />
            <div className="px-4 sm:px-6 py-2.5 bg-gradient-to-r from-sky-50 via-indigo-50/70 to-emerald-50/70 border-b border-indigo-100 flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-indigo-800">
                Konfirmasi Data Peserta Ujian
              </span>
              <span className="text-xs font-medium text-teal-800 tabular-nums">
                TA {branding.academicYear}
              </span>
            </div>
            <div className="p-4 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
              <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-6 min-w-0 flex-1">
                <StudentAvatar
                  photoUrl={user.photoUrl}
                  fullName={user.fullName}
                  size="2xl"
                  className="mx-auto sm:mx-0 shadow-sm border-2 border-indigo-100"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-indigo-700">
                    Halo, {firstName} · Pastikan data peserta sesuai kartu ujian
                  </p>
                  <h2 className="text-lg sm:text-2xl font-display font-bold text-slate-900 mt-0.5 break-words">
                    {user.fullName}
                  </h2>

                  <dl className="mt-3 space-y-1.5 text-xs sm:text-sm">
                    <div className="flex flex-wrap sm:flex-nowrap items-baseline gap-x-2 gap-y-0.5">
                      <dt className="text-slate-500 sm:w-36 shrink-0">NIS / NISN:</dt>
                      <dd className="font-mono font-semibold text-indigo-900 tabular-nums break-all">
                        {user.nis} / {user.nisn}
                      </dd>
                    </div>
                    <div className="flex flex-wrap sm:flex-nowrap items-baseline gap-x-2 gap-y-0.5">
                      <dt className="text-slate-500 sm:w-36 shrink-0">Jenis Kelamin:</dt>
                      <dd className="font-medium text-slate-800">{formattedGender}</dd>
                    </div>
                    <div className="flex flex-wrap sm:flex-nowrap items-baseline gap-x-2 gap-y-0.5">
                      <dt className="text-slate-500 sm:w-36 shrink-0">Tempat, Tgl Lahir:</dt>
                      <dd className="font-medium text-slate-800 tabular-nums">
                        {formattedBirthInfo}
                      </dd>
                    </div>
                    <div className="flex flex-wrap sm:flex-nowrap items-baseline gap-x-2 gap-y-0.5">
                      <dt className="text-slate-500 sm:w-36 shrink-0">Kelas:</dt>
                      <dd className="font-semibold text-teal-800">{user.className}</dd>
                    </div>
                    <div className="flex flex-wrap sm:flex-nowrap items-baseline gap-x-2 gap-y-0.5">
                      <dt className="text-slate-500 sm:w-36 shrink-0">Alamat Email:</dt>
                      <dd className="font-medium text-slate-800 break-all">{user.email || 'Belum diisi'}</dd>
                    </div>
                  </dl>

                  <p className="mt-3 text-[11px] text-slate-400">
                    Data identitas dan foto profil resmi dikelola khusus oleh panitia ujian sekolah.
                  </p>
                </div>
              </div>

              <div className="hidden sm:flex items-center gap-3 shrink-0 lg:pl-5 lg:border-l border-indigo-100">
                <div className="px-4 py-2.5 rounded-xl bg-indigo-50 border border-indigo-200 text-center min-w-[92px]">
                  <p className="text-[11px] font-semibold text-indigo-700">Tes Aktif</p>
                  <p className="text-xl font-display font-bold text-indigo-950 tabular-nums mt-0.5">{ongoingAndUpcoming.length}</p>
                </div>
                {showStudentHistory && (
                  <div className="px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-center min-w-[92px]">
                    <p className="text-[11px] font-semibold text-emerald-700">Riwayat Nilai</p>
                    <p className="text-xl font-display font-bold text-emerald-950 tabular-nums mt-0.5">{completedExams.length}</p>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Upcoming / Imminent Exam Schedule Alert Strip */}
          {activeScheduleAlerts.length > 0 && (
            <section
              aria-label="Pengingat jadwal ujian segera dimulai"
              className="bg-gradient-to-r from-amber-50 via-orange-50/70 to-emerald-50/60 border border-amber-300/90 shadow-sm rounded-xl sm:rounded-2xl p-4 sm:p-5 space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Clock className="w-4 h-4 text-amber-700 shrink-0" />
                  <h2 className="text-xs sm:text-sm font-display font-bold text-amber-950 truncate">
                    Pengingat Jadwal Ujian Terdekat ({activeScheduleAlerts.length})
                  </h2>
                </div>
                {browserNotifPermission === 'default' && (
                  <button
                    type="button"
                    onClick={requestBrowserPushPermission}
                    className="text-[11px] font-semibold text-indigo-700 hover:underline whitespace-nowrap shrink-0"
                  >
                    Aktifkan Notifikasi Browser
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {activeScheduleAlerts.map((alert) => (
                  <div
                    key={alert.key}
                    className="p-3 rounded-xl bg-white/95 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-xs sm:text-sm font-bold text-slate-900">{alert.title}</p>
                      <p className="text-xs text-slate-600 mt-0.5">{alert.body}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {(alert.exam.availability === 'open' || alert.exam.availability === 'in_progress') && (
                        <button
                          type="button"
                          onClick={() => openConfirmModalForExam(alert.exam)}
                          className="min-h-[36px] px-3 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-semibold whitespace-nowrap"
                        >
                          {alert.exam.availability === 'in_progress' ? 'Lanjutkan Tes' : 'Mulai Tes'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setDismissedAlertKeys((prev) => [...prev, alert.key])}
                        aria-label="Sembunyikan pengingat"
                        className="min-h-[36px] min-w-[36px] rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500 flex items-center justify-center"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {messages.length > 0 && (
            <section className="bg-white border border-violet-200/80 shadow-sm rounded-xl sm:rounded-2xl overflow-hidden">
              <div className="px-4 sm:px-6 py-3 bg-gradient-to-r from-violet-50 via-fuchsia-50/60 to-sky-50 border-b border-violet-100 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <MessageSquare className="w-4 h-4 text-violet-600 shrink-0" />
                  <h2 className="text-xs sm:text-sm font-display font-bold text-violet-950 truncate">
                    Pengumuman, Pesan &amp; Catatan Panitia
                  </h2>
                </div>
                {messages.some((m) => !m.is_read) && (
                  <button
                    type="button"
                    onClick={() => markMessageRead('all')}
                    className="text-xs font-semibold text-violet-700 hover:underline whitespace-nowrap shrink-0"
                  >
                    Tandai Semua Dibaca ({messages.filter((m) => !m.is_read).length})
                  </button>
                )}
              </div>
              <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                {messages.slice(0, 6).map((m) => {
                  const categoryLabel = getMessageCategoryLabel(m.category);
                  const rowTint = !m.is_read
                    ? m.category === 'peringatan'
                      ? 'bg-amber-50/70'
                      : m.category === 'pengumuman'
                      ? 'bg-rose-50/60'
                      : m.category === 'kesan'
                      ? 'bg-violet-50/60'
                      : m.category === 'instruksi'
                      ? 'bg-teal-50/60'
                      : 'bg-sky-50/60'
                    : 'bg-white';
                  const categoryColor =
                    m.category === 'peringatan'
                      ? 'text-amber-800'
                      : m.category === 'pengumuman'
                      ? 'text-rose-700'
                      : m.category === 'kesan'
                      ? 'text-violet-700'
                      : m.category === 'instruksi'
                      ? 'text-teal-700'
                      : 'text-indigo-700';
                  return (
                    <div
                      key={m.id}
                      className={`px-4 sm:px-6 py-3.5 flex flex-col sm:flex-row sm:items-start justify-between gap-2 ${rowTint}`}
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                          <span className={`font-bold ${categoryColor}`}>
                            {categoryLabel}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-slate-700">{m.sender_name}</span>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">{new Date(m.created_at).toLocaleString('id-ID')}</span>
                          {!m.is_read && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-bold text-rose-600">Baru</span>
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
                          className="self-start min-h-[34px] px-3 rounded-lg border border-violet-200 bg-white hover:bg-violet-50 text-xs font-semibold text-violet-800 whitespace-nowrap shrink-0"
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
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm">
              {error}
            </div>
          )}

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2].map((i) => (
                <div key={i} className="h-44 rounded-xl bg-white border border-indigo-100 animate-pulse p-6" />
              ))}
            </div>
          ) : activeTab === 'ujian' || !showStudentHistory ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base sm:text-lg font-display font-bold text-slate-900">
                  Daftar Tes &amp; Jadwal Ujian ({ongoingAndUpcoming.length})
                </h2>
              </div>

              {ongoingAndUpcoming.length === 0 ? (
                <div className="bg-white border border-indigo-100 rounded-xl p-8 text-center space-y-2">
                  <p className="text-sm font-semibold text-slate-800">Belum ada tes yang dijadwalkan saat ini</p>
                  <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                    Jadwal ujian untuk kelas {user.className} akan tampil otomatis di sini. Tekan tombol Segarkan bila panitia baru membuka sesi.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {ongoingAndUpcoming.map((exam, idx) => {
                    const baseTheme = openCardThemes[idx % openCardThemes.length];
                    const topBar =
                      exam.availability === 'locked'
                        ? 'from-rose-600 to-red-500'
                        : exam.availability === 'in_progress'
                        ? 'from-cyan-500 to-teal-600'
                        : exam.availability === 'upcoming'
                        ? 'from-amber-400 to-orange-500'
                        : baseTheme.topBar;
                    const cardBorder =
                      exam.availability === 'locked'
                        ? 'border-rose-200'
                        : exam.availability === 'in_progress'
                        ? 'border-teal-200'
                        : exam.availability === 'upcoming'
                        ? 'border-amber-200'
                        : baseTheme.border;
                    const ctaClass =
                      exam.availability === 'locked'
                        ? 'bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-700 hover:to-red-700'
                        : exam.availability === 'in_progress'
                        ? 'bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-700 hover:to-teal-700'
                        : baseTheme.cta;
                    const eyebrowColor =
                      exam.availability === 'locked'
                        ? 'text-rose-700'
                        : exam.availability === 'in_progress'
                        ? 'text-teal-700'
                        : exam.availability === 'upcoming'
                        ? 'text-amber-700'
                        : baseTheme.eyebrow;

                    return (
                      <article
                        key={exam.id}
                        className={`bg-white border ${cardBorder} shadow-sm rounded-2xl overflow-hidden flex flex-col justify-between transition-all`}
                      >
                        <div>
                          <div className={`h-1.5 w-full bg-gradient-to-r ${topBar}`} aria-hidden="true" />
                          <div className="p-5 pb-4">
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                              <span className={`font-bold ${eyebrowColor}`}>{exam.examType}</span>
                              <span aria-hidden="true">·</span>
                              <span className="truncate font-medium text-slate-700">{exam.subjectName}</span>
                            </div>
                            <h3 className="mt-1.5 text-base sm:text-lg font-display font-bold text-slate-900 leading-snug">
                              {exam.title}
                            </h3>

                            <div className="mt-3 space-y-2 text-xs sm:text-sm text-slate-600">
                              <div className="flex items-center gap-2">
                                <CalendarClock className="w-4 h-4 text-indigo-500 shrink-0" />
                                <span className="tabular-nums">
                                  {new Date(exam.startAt).toLocaleString('id-ID')} ({exam.timezone})
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <BookOpen className="w-4 h-4 text-teal-600 shrink-0" />
                                <span className="tabular-nums">
                                  {exam.questionCount} butir soal · Alokasi {exam.durationMinutes} menit
                                </span>
                              </div>
                            </div>

                            {exam.availability === 'locked' && (
                              <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
                                <Lock className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                                <span>
                                  Sesi terkunci: {exam.session?.lockReason || 'Hubungi pengawas untuk membuka kunci.'}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="px-5 py-3.5 bg-slate-50/70 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <span className="text-xs font-semibold text-slate-600">
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
                              className={`w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-xl ${ctaClass} active:scale-[0.99] text-white text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition-all shadow-sm`}
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
                            <span className="text-xs font-semibold text-amber-700">Belum Dibuka</span>
                          )}
                        </div>
                      </article>
                    );
                  })}
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
                <div className="bg-white border border-emerald-100 rounded-xl p-8 text-center space-y-1.5">
                  <p className="text-sm font-semibold text-slate-800">Belum ada riwayat ujian yang selesai</p>
                  <p className="text-xs text-slate-500">Hasil ujian yang sudah dikumpulkan akan muncul di halaman ini.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {completedExams.map((exam) => {
                    const topGradient =
                      exam.publicationPolicy === 'hidden'
                        ? 'from-indigo-500 to-violet-500'
                        : exam.result?.passed
                        ? 'from-emerald-500 to-teal-500'
                        : 'from-amber-500 to-orange-500';
                    return (
                      <article key={exam.id} className="bg-white border border-slate-200/90 shadow-sm rounded-2xl overflow-hidden flex flex-col justify-between">
                        <div>
                          <div className={`h-1.5 w-full bg-gradient-to-r ${topGradient}`} aria-hidden="true" />
                          <div className="p-5 pb-4">
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                              <span className="font-bold text-emerald-700">{exam.examType}</span>
                              <span aria-hidden="true">·</span>
                              <span className="font-medium text-slate-700">{exam.subjectName}</span>
                            </div>
                            <h3 className="mt-1 text-base font-display font-bold text-slate-900">{exam.title}</h3>
                            <p className="mt-1 text-xs text-slate-500 tabular-nums">
                              {exam.session?.submittedAt
                                ? `Dikumpulkan: ${new Date(exam.session.submittedAt).toLocaleString('id-ID')}`
                                : `Batas akhir: ${new Date(exam.endAt).toLocaleString('id-ID')}`}
                            </p>

                            {exam.publicationPolicy === 'hidden' ? (
                              <div className="mt-4 p-3.5 rounded-xl bg-indigo-50/60 border border-indigo-200 text-xs text-indigo-900 flex items-center gap-2">
                                <Lock className="w-4 h-4 text-indigo-500 shrink-0" />
                                <span>Nilai belum dipublikasikan oleh panitia lembaga.</span>
                              </div>
                            ) : exam.result ? (
                              <div className="mt-4 grid grid-cols-3 gap-2 p-3.5 rounded-xl bg-gradient-to-br from-sky-50 via-indigo-50/70 to-emerald-50/80 border border-indigo-200/80 text-center">
                                <div>
                                  <p className="text-[11px] font-medium text-indigo-700">Nilai Akhir</p>
                                  <p className="text-xl font-display font-bold text-indigo-950 tabular-nums mt-0.5">
                                    {exam.result.finalScore.toFixed(1)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[11px] font-medium text-slate-600">B / P / S / K</p>
                                  <p className="text-xs font-mono font-semibold text-slate-800 mt-2 tabular-nums">
                                    {exam.result.correctCount}/{exam.result.partialCount}/{exam.result.wrongCount}/{exam.result.blankCount}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[11px] font-medium text-slate-600">Ketuntasan</p>
                                  <p className={`text-xs font-bold mt-2 ${exam.result.passed ? 'text-emerald-700' : 'text-rose-700'}`}>
                                    {exam.result.passed ? 'Tuntas' : 'Belum'}
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <p className="mt-4 text-xs text-slate-500">Tidak mengikuti sesi pada jadwal yang ditentukan.</p>
                            )}
                          </div>
                        </div>

                        {exam.result && exam.publicationPolicy !== 'hidden' && (
                          <div className="px-5 py-3.5 bg-slate-50/70 border-t border-slate-100 flex flex-wrap items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedResultExam(exam)}
                              className="min-h-[42px] px-3.5 py-2 rounded-xl border border-indigo-200 bg-white hover:bg-indigo-50 text-xs font-semibold text-indigo-800 flex items-center gap-1.5 whitespace-nowrap"
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
                                className="min-h-[42px] px-3.5 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-xs font-semibold text-white flex items-center gap-1.5 whitespace-nowrap shadow-xs"
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
                                className="min-h-[42px] px-3.5 py-2 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-xs font-semibold text-emerald-900 flex items-center gap-1.5 whitespace-nowrap"
                              >
                                <Printer className="w-3.5 h-3.5" />
                                <span>Cetak</span>
                              </button>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* TKA Pre-Exam Confirmation Sheet ("Konfirmasi Tes") */}
      {confirmExam && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white border border-indigo-200 rounded-t-2xl sm:rounded-2xl max-w-lg w-full overflow-hidden max-h-[92dvh] flex flex-col shadow-2xl">
            <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-teal-600 text-white px-5 py-3.5 flex items-center justify-between gap-3 shrink-0">
              <h3 className="text-base font-display font-bold">
                Konfirmasi Tes
              </h3>
              <button
                type="button"
                onClick={() => setConfirmExam(null)}
                className="text-xs font-semibold text-sky-100 hover:text-white px-2 py-1 rounded"
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
              <div className="flex flex-col sm:flex-row sm:items-start gap-4 p-4 rounded-xl bg-gradient-to-br from-sky-50 via-indigo-50/50 to-teal-50/50 border border-indigo-200/80">
                <StudentAvatar photoUrl={user.photoUrl} fullName={user.fullName} size="xl" className="mx-auto sm:mx-0 shadow-xs border-2 border-indigo-100" />
                <div className="text-xs sm:text-sm space-y-1.5 min-w-0 flex-1">
                  <div>
                    <p className="text-[11px] text-indigo-700 font-semibold">Nama Peserta</p>
                    <p className="font-display font-bold text-slate-900 text-sm sm:text-base break-words">{user.fullName}</p>
                  </div>
                  <dl className="space-y-1 pt-0.5 text-xs">
                    <div className="flex flex-wrap sm:flex-nowrap items-baseline gap-x-2">
                      <dt className="text-slate-500 sm:w-28 shrink-0">NIS / NISN:</dt>
                      <dd className="font-mono font-semibold text-slate-800 tabular-nums break-all">{user.nis} / {user.nisn}</dd>
                    </div>
                    <div className="flex flex-wrap sm:flex-nowrap items-baseline gap-x-2">
                      <dt className="text-slate-500 sm:w-28 shrink-0">Jenis Kelamin:</dt>
                      <dd className="font-medium text-slate-800">{formattedGender}</dd>
                    </div>
                    <div className="flex flex-wrap sm:flex-nowrap items-baseline gap-x-2">
                      <dt className="text-slate-500 sm:w-28 shrink-0">Tempat, Tgl Lahir:</dt>
                      <dd className="font-medium text-slate-800 tabular-nums">{formattedBirthInfo}</dd>
                    </div>
                    <div className="flex flex-wrap sm:flex-nowrap items-baseline gap-x-2">
                      <dt className="text-slate-500 sm:w-28 shrink-0">Kelas:</dt>
                      <dd className="font-semibold text-teal-800">{user.className}</dd>
                    </div>
                    <div className="flex flex-wrap sm:flex-nowrap items-baseline gap-x-2">
                      <dt className="text-slate-500 sm:w-28 shrink-0">Alamat Email:</dt>
                      <dd className="font-medium text-slate-800 break-all">{user.email || '-'}</dd>
                    </div>
                  </dl>
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
                  <span className="font-mono font-bold text-indigo-700 text-right tabular-nums">
                    {confirmExam.questionCount} Soal · {confirmExam.durationMinutes} Menit
                  </span>
                </div>
              </div>

              {/* PIN / Password Ujian / Token Verification Input */}
              <div className="p-3.5 rounded-xl bg-gradient-to-br from-indigo-50 to-sky-50 border border-indigo-200 space-y-1.5">
                <label htmlFor="exam-start-pin" className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-indigo-950">
                  <KeyRound className="w-4 h-4 text-indigo-600 shrink-0" />
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
                    className="w-full min-h-[46px] pl-3.5 pr-12 py-2.5 rounded-lg border border-indigo-300 bg-white text-slate-900 font-mono text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowExamPin((v) => !v)}
                    aria-label={showExamPin ? 'Sembunyikan PIN / Token' : 'Tampilkan PIN / Token'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 min-w-[38px] min-h-[38px] flex items-center justify-center rounded-md text-slate-400 hover:text-indigo-700"
                  >
                    {showExamPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-indigo-900/80">
                  {confirmExam.usesExamToken
                    ? 'Ujian ini menggunakan Token Khusus. Masukkan token ujian yang dibagikan oleh pengawas ruang.'
                    : 'Masukkan PIN / Password Ujian peserta yang diberikan oleh pengawas ruang atau panitia ujian.'}
                </p>
              </div>

              {/* Honest Rules & Notices */}
              <div className="space-y-2.5 text-xs text-slate-700 leading-relaxed">
                <div className="flex items-start gap-2.5">
                  <ClipboardCheck className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
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
                  <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 space-y-2">
                    <div className="flex items-start gap-2 text-slate-800">
                      <Camera className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                      <span>
                        Ujian ini mengaktifkan pengawasan kamera ringan. Indikator kamera hanya untuk peninjauan pengawas, bukan tuduhan otomatis.
                      </span>
                    </div>
                    <label className="flex items-center gap-2 font-medium text-sky-900 cursor-pointer min-h-[36px]">
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
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 space-y-2" role="alert">
                  <p>{startError}</p>
                  {startError.includes('perangkat/browser lain') && (
                    <button
                      type="button"
                      onClick={() => handleStartConfirmed(true)}
                      className="min-h-[40px] px-3 py-1.5 rounded-lg bg-rose-700 text-white font-semibold"
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
                  className="w-full sm:w-auto min-h-[46px] px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={startingExam}
                  className="w-full sm:w-auto min-h-[46px] px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-teal-600 hover:from-blue-700 hover:via-indigo-700 hover:to-teal-700 disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-sm"
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
          <div className="bg-white border border-emerald-200 rounded-t-2xl sm:rounded-2xl max-w-md w-full overflow-hidden shadow-2xl">
            <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 text-white px-5 py-3.5 flex items-center justify-between">
              <h3 className="text-base font-display font-bold">Rincian Hasil Ujian</h3>
              <button
                type="button"
                onClick={() => setSelectedResultExam(null)}
                className="text-xs font-semibold text-emerald-100 hover:text-white px-2 py-1"
              >
                Tutup
              </button>
            </div>
            <div className="p-5 sm:p-6 pb-safe space-y-4">
              <div>
                <p className="text-xs font-semibold text-teal-700">{selectedResultExam.subjectName} · {selectedResultExam.examType}</p>
                <p className="text-base font-bold text-slate-900 mt-0.5">{selectedResultExam.title}</p>
              </div>
              <div className="divide-y divide-slate-100 text-sm">
                <div className="py-2.5 flex justify-between"><span className="text-slate-600">Nilai Akhir</span><span className="font-bold text-indigo-700 tabular-nums">{selectedResultExam.result.finalScore.toFixed(2)}</span></div>
                <div className="py-2.5 flex justify-between"><span className="text-slate-600">Poin Diperoleh</span><span className="font-mono tabular-nums">{selectedResultExam.result.rawPoints} / {selectedResultExam.result.maxPoints}</span></div>
                <div className="py-2.5 flex justify-between"><span className="text-slate-600">Benar Penuh</span><span className="font-mono text-emerald-700 font-semibold tabular-nums">{selectedResultExam.result.correctCount} soal</span></div>
                <div className="py-2.5 flex justify-between"><span className="text-slate-600">Skor Parsial</span><span className="font-mono text-amber-700 font-semibold tabular-nums">{selectedResultExam.result.partialCount} soal</span></div>
                <div className="py-2.5 flex justify-between"><span className="text-slate-600">Salah</span><span className="font-mono text-rose-700 font-semibold tabular-nums">{selectedResultExam.result.wrongCount} soal</span></div>
                <div className="py-2.5 flex justify-between"><span className="text-slate-600">Kosong</span><span className="font-mono tabular-nums">{selectedResultExam.result.blankCount} soal</span></div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-600">Status (KKM {selectedResultExam.passingScore})</span>
                  <span className={`font-bold ${selectedResultExam.result.passed ? 'text-emerald-700' : 'text-rose-700'}`}>
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
