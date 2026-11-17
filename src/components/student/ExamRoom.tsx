import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Flag,
  Grid,
  Lock,
  Maximize2,
  MessageSquare,
  Send,
  ShieldAlert,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  apiFetch,
  loadOfflineAnswerQueue,
  saveOfflineAnswerQueue,
  withAuthTokenUrl,
  type QueuedAnswerItem,
} from '../../lib/api.ts';
import {
  DEFAULT_VIOLATION_POLICY_CLIENT,
  desktopSiren,
  detectClientDeviceInfo,
  detectRootOrEmulatorClient,
  getViolationLabel,
} from '../../lib/violationCatalog.ts';
import { MathRenderer } from '../MathRenderer.tsx';
import { StudentAvatar } from '../StudentAvatar.tsx';
import type { ActiveExamPayload, AuthUser, ChatMessageItem, InstitutionBranding } from '../../types/cbt.ts';

interface ExamRoomProps {
  user: AuthUser;
  branding?: InstitutionBranding;
  initialPayload: ActiveExamPayload;
  cameraStream: MediaStream | null;
  onExitExam: () => void;
}

type SaveStatus = 'saved' | 'pending' | 'failed';
type FontScale = 'sm' | 'base' | 'lg';

export const ExamRoom: React.FC<ExamRoomProps> = ({
  user,
  branding,
  initialPayload,
  cameraStream,
  onExitExam,
}) => {
  const { session, questions } = initialPayload;
  const [currentIdx, setCurrentIdx] = useState(0);
  const [fontScale, setFontScale] = useState<FontScale>('base');
  const [answers, setAnswers] = useState<Record<string, { answer: unknown; isDoubtful: boolean; version: number }>>(() => {
    const merged: Record<string, { answer: unknown; isDoubtful: boolean; version: number }> = {};
    for (const [qId, val] of Object.entries(initialPayload.answers)) {
      merged[qId] = { answer: val.answer, isDoubtful: val.isDoubtful, version: val.version };
    }
    // Reconcile any unsynced offline local queue items with higher version
    const queued = loadOfflineAnswerQueue(session.id);
    for (const [qId, qItem] of Object.entries(queued)) {
      if (!merged[qId] || qItem.clientVersion >= merged[qId].version) {
        merged[qId] = { answer: qItem.answer, isDoubtful: qItem.isDoubtful, version: qItem.clientVersion };
      }
    }
    return merged;
  });

  // Server-authoritative clock offset (ms)
  const [serverEndAt, setServerEndAt] = useState(session.serverEndAt);
  const [clockOffsetMs, setClockOffsetMs] = useState(() => new Date(initialPayload.serverTime).getTime() - Date.now());
  const [remainingSec, setRemainingSec] = useState(() => {
    const endMs = new Date(session.serverEndAt).getTime();
    const serverNow = new Date(initialPayload.serverTime).getTime();
    return Math.max(0, Math.floor((endMs - serverNow) / 1000));
  });

  const [sessionStatus, setSessionStatus] = useState(session.status);
  const [lockReason, setLockReason] = useState<string | null>(session.lockReason);
  const [lockedUntil, setLockedUntil] = useState<string | null>(session.lockedUntil ?? null);
  const [lockCountdownSec, setLockCountdownSec] = useState<number | null>(null);
  const [violationCount, setViolationCount] = useState(session.violationCount);
  const [violationPoints, setViolationPoints] = useState(session.violationPoints ?? 0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [pendingQueueCount, setPendingQueueCount] = useState(() => Object.keys(loadOfflineAnswerQueue(session.id)).length);
  const [liveNotice, setLiveNotice] = useState<{ title: string; text: string; tone: 'info' | 'warn' } | null>(null);
  const [nonPunitiveToast, setNonPunitiveToast] = useState<string | null>(null);
  const [desktopRedAlert, setDesktopRedAlert] = useState<{ eventType: string; message: string; pointsAdded: number } | null>(null);
  const [cameraBlockedReason, setCameraBlockedReason] = useState<string | null>(null);
  const [isFullscreenActive, setIsFullscreenActive] = useState(() => Boolean(typeof document !== 'undefined' && document.fullscreenElement));

  const [showNavigator, setShowNavigator] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Chat with proctor
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessageItem[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [unreadChat, setUnreadChat] = useState(0);

  const [activeCameraStream, setActiveCameraStream] = useState<MediaStream | null>(cameraStream);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const syncInFlightRef = useRef(false);
  const lastEventTimesRef = useRef<Record<string, number>>({});
  const awayStartedAtRef = useRef<number | null>(null);
  const lastAwayLogIdRef = useRef<string | null>(null);
  const intentionalExitRef = useRef(false);
  const wifiOfflineTimerRef = useRef<number | null>(null);
  const rootCheckedRef = useRef(false);
  const cameraDownReportedRef = useRef(false);
  const cameraCoveredReportedRef = useRef(false);

  const policy = useMemo(() => initialPayload.violationPolicy || DEFAULT_VIOLATION_POLICY_CLIENT, [initialPayload.violationPolicy]);
  const deviceInfo = useMemo(() => detectClientDeviceInfo(), []);

  const showToastNotice = useCallback((msg: string) => {
    setNonPunitiveToast(msg);
  }, []);

  useEffect(() => {
    if (!nonPunitiveToast) return;
    const t = window.setTimeout(() => setNonPunitiveToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [nonPunitiveToast]);

  // Sync cameraStream prop into local state & attach to video element
  useEffect(() => {
    setActiveCameraStream(cameraStream);
  }, [cameraStream]);

  useEffect(() => {
    if (videoRef.current && activeCameraStream) {
      videoRef.current.srcObject = activeCameraStream;
    }
  }, [activeCameraStream]);

  useEffect(() => {
    return () => {
      desktopSiren.stop();
      if (activeCameraStream) {
        activeCameraStream.getTracks().forEach((t) => t.stop());
      }
      pcRef.current?.close();
    };
  }, [activeCameraStream]);

  const requestCameraRecovery = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' }, audio: false });
      setActiveCameraStream(stream);
      cameraDownReportedRef.current = false;
      cameraCoveredReportedRef.current = false;
      setCameraBlockedReason(null);
    } catch {
      showToastNotice('Izin kamera masih ditolak atau perangkat kamera belum tersambung.');
    }
  };

  // Flush pending offline answer queue to server
  const flushAnswerQueue = useCallback(async () => {
    if (syncInFlightRef.current || sessionStatus === 'locked' || sessionStatus === 'submitted' || sessionStatus === 'expired') {
      return;
    }
    const queue = loadOfflineAnswerQueue(session.id);
    const items = Object.values(queue);
    if (items.length === 0) {
      setSaveStatus('saved');
      setPendingQueueCount(0);
      return;
    }

    syncInFlightRef.current = true;
    setSaveStatus('pending');
    try {
      const res = await apiFetch<{ serverTime: string; savedCount: number }>(`/api/student/sessions/${session.id}/answers`, {
        method: 'POST',
        body: JSON.stringify({ items }),
      });
      setClockOffsetMs(new Date(res.serverTime).getTime() - Date.now());
      // Remove synced items whose version hasn't changed while request was in-flight
      const latestQueue = loadOfflineAnswerQueue(session.id);
      for (const sent of items) {
        if (latestQueue[sent.questionId]?.clientVersion === sent.clientVersion) {
          delete latestQueue[sent.questionId];
        }
      }
      saveOfflineAnswerQueue(session.id, latestQueue);
      const remaining = Object.keys(latestQueue).length;
      setPendingQueueCount(remaining);
      setSaveStatus(remaining > 0 ? 'pending' : 'saved');
      setIsOnline(true);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 423) {
        setSessionStatus('locked');
      } else if (status === 409) {
        onExitExam();
      } else {
        setSaveStatus('failed');
        setIsOnline(false);
      }
    } finally {
      syncInFlightRef.current = false;
    }
  }, [session.id, sessionStatus, onExitExam]);

  // Trigger debounced sync whenever answers update or network recovers
  useEffect(() => {
    const timer = setTimeout(() => {
      flushAnswerQueue();
    }, 600);
    return () => clearTimeout(timer);
  }, [answers, flushAnswerQueue]);

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      flushAnswerQueue();
    };
    const onOffline = () => {
      setIsOnline(false);
      setSaveStatus('pending');
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [flushAnswerQueue]);

  // Server-synced countdown timer
  useEffect(() => {
    const interval = setInterval(() => {
      const serverNowMs = Date.now() + clockOffsetMs;
      const endMs = new Date(serverEndAt).getTime();
      const secs = Math.max(0, Math.floor((endMs - serverNowMs) / 1000));
      setRemainingSec(secs);
      if (secs === 0 && (sessionStatus === 'in_progress' || sessionStatus === 'locked')) {
        // Trigger server auto-expire check
        apiFetch(`/api/student/sessions/${session.id}/heartbeat`, { method: 'POST' })
          .then((res: unknown) => {
            const r = res as { status?: string };
            if (r.status === 'expired' || r.status === 'submitted') {
              onExitExam();
            }
          })
          .catch(() => {});
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [clockOffsetMs, serverEndAt, session.id, sessionStatus, onExitExam]);

  // Periodic heartbeat every 15s (checks auto-unlock, manual unlock status & syncs server clock)
  const triggerHeartbeat = useCallback(async () => {
    try {
      const res = await apiFetch<{
        serverTime: string;
        serverEndAt?: string;
        status: string;
        lockReason: string | null;
        lockedUntil?: string | null;
        violationCount: number;
        violationPoints?: number;
      }>(`/api/student/sessions/${session.id}/heartbeat`, { method: 'POST' });
      setClockOffsetMs(new Date(res.serverTime).getTime() - Date.now());
      if (res.serverEndAt) setServerEndAt(res.serverEndAt);
      setSessionStatus(res.status);
      setLockReason(res.lockReason);
      setLockedUntil(res.lockedUntil ?? null);
      setViolationCount(res.violationCount);
      if (typeof res.violationPoints === 'number') setViolationPoints(res.violationPoints);
      setIsOnline(true);
      if (res.status === 'expired' || res.status === 'submitted') {
        intentionalExitRef.current = true;
        onExitExam();
      }
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 404) {
        saveOfflineAnswerQueue(session.id, {});
        intentionalExitRef.current = true;
        onExitExam();
        return;
      }
      setIsOnline(false);
    }
  }, [session.id, onExitExam]);

  useEffect(() => {
    const hb = setInterval(() => {
      triggerHeartbeat();
    }, 15000);
    return () => clearInterval(hb);
  }, [triggerHeartbeat]);

  // Auto-Unlock Countdown Timer while locked
  useEffect(() => {
    if (sessionStatus !== 'locked' || !lockedUntil) {
      setLockCountdownSec(null);
      return;
    }
    let autoTriggered = false;
    const updateCountdown = () => {
      const serverNowMs = Date.now() + clockOffsetMs;
      const targetMs = new Date(lockedUntil).getTime();
      const secs = Math.max(0, Math.ceil((targetMs - serverNowMs) / 1000));
      setLockCountdownSec(secs);
      if (secs <= 0 && !autoTriggered) {
        autoTriggered = true;
        triggerHeartbeat();
      }
    };
    updateCountdown();
    const t = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(t);
  }, [sessionStatus, lockedUntil, clockOffsetMs, triggerHeartbeat]);

  // WebSocket for instant lock/unlock/reset/time-extension, chat, and WebRTC camera stream requests
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = withAuthTokenUrl(`${proto}//${window.location.host}/ws?sessionId=${encodeURIComponent(session.id)}&examId=${encodeURIComponent(session.examId)}`);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = async (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'session:locked') {
          setSessionStatus('locked');
          setLockReason(msg.lockReason || 'Sesi dikunci sementara oleh pengawas/admin.');
          if (msg.lockedUntil !== undefined) setLockedUntil(msg.lockedUntil || null);
        } else if (msg.type === 'session:unlocked') {
          setSessionStatus('in_progress');
          setLockReason(null);
          setLockedUntil(null);
          setLockCountdownSec(null);
          if (msg.autoUnlocked) {
            showToastNotice('Kunci sesi Anda telah terbuka secara otomatis. Silakan lanjutkan ujian dengan tertib.');
          }
          flushAnswerQueue();
        } else if (msg.type === 'session:reset_violations') {
          setViolationCount(0);
          setViolationPoints(0);
          setLockReason(null);
          setLockedUntil(null);
          if (msg.status) setSessionStatus(msg.status);
          setLiveNotice({
            title: 'Pelanggaran Direset',
            text: msg.notes || 'Catatan pelanggaran Anda telah direset oleh admin/pengawas.',
            tone: 'info',
          });
          flushAnswerQueue();
        } else if (msg.type === 'session:time_extended' && msg.serverEndAt) {
          setServerEndAt(String(msg.serverEndAt));
          setLiveNotice({
            title: 'Waktu Ujian Ditambah',
            text: `Alokasi waktu ujian Anda ditambah +${msg.extraMinutes || 0} menit oleh pengawas/admin.`,
            tone: 'info',
          });
        } else if (msg.type === 'session:reset_exam') {
          saveOfflineAnswerQueue(session.id, {});
          intentionalExitRef.current = true;
          onExitExam();
        } else if (msg.type === 'session:force_submitted') {
          intentionalExitRef.current = true;
          onExitExam();
        } else if (msg.type === 'student:message' && msg.message) {
          const item = msg.message as { title?: string; message: string; sender_name?: string; category?: string };
          setLiveNotice({
            title: item.title || `Pesan dari ${item.sender_name || 'Pengawas'}`,
            text: item.message,
            tone: item.category === 'peringatan' ? 'warn' : 'info',
          });
        } else if (msg.type === 'chat:new' && msg.message) {
          setChatMessages((prev) => (prev.some((m) => m.id === msg.message.id) ? prev : [...prev, msg.message]));
          if (!showChat && msg.message.sender_role !== 'siswa') {
            setUnreadChat((c) => c + 1);
          }
        } else if (msg.type === 'camera:start_stream') {
          if (!activeCameraStream) {
            ws.send(JSON.stringify({ type: 'camera:status', available: false, reason: 'Kamera tidak diaktifkan atau tidak tersedia pada perangkat siswa.' }));
            return;
          }
          const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
          pcRef.current = pc;
          activeCameraStream.getTracks().forEach((track) => pc.addTrack(track, activeCameraStream));
          pc.onicecandidate = (e) => {
            if (e.candidate && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'webrtc:ice', candidate: e.candidate }));
            }
          };
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          ws.send(JSON.stringify({ type: 'webrtc:offer', sdp: offer }));
        } else if (msg.type === 'webrtc:answer' && pcRef.current && msg.sdp) {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        } else if (msg.type === 'webrtc:ice' && pcRef.current && msg.candidate) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate));
        } else if (msg.type === 'camera:stop_stream') {
          pcRef.current?.close();
          pcRef.current = null;
        }
      } catch {
        // ignore parse/RTC errors
      }
    };

    return () => {
      ws.close();
    };
  }, [session.id, session.examId, activeCameraStream, flushAnswerQueue, onExitExam, showChat, showToastNotice]);

  // Load initial chat history
  useEffect(() => {
    apiFetch<{ messages: ChatMessageItem[] }>(`/api/chat/${session.examId}/${user.id}`)
      .then((res) => setChatMessages(res.messages))
      .catch(() => {});
  }, [session.examId, user.id]);

  // Report structured device-aware violation to backend
  const reportObservedEvent = useCallback(
    async (
      eventType: string,
      details: Record<string, unknown> = {},
      options?: { trackAway?: boolean; debounceMs?: number }
    ): Promise<string | null> => {
      if (eventType === 'tombol_back') {
        showToastNotice('Tombol Kembali (Back) ditolak selama ujian berlangsung dan tidak dihitung sebagai pelanggaran.');
        return null;
      }

      const now = Date.now();
      const debounceMs = options?.debounceMs ?? 2200;
      const prevTs = lastEventTimesRef.current[eventType] || 0;
      if (now - prevTs < debounceMs) return null;
      lastEventTimesRef.current[eventType] = now;

      if (sessionStatus === 'locked' || sessionStatus === 'submitted' || sessionStatus === 'expired') {
        return null;
      }

      if (options?.trackAway && !awayStartedAtRef.current) {
        awayStartedAtRef.current = now;
      }

      try {
        const res = await apiFetch<{
          id?: string | null;
          ignored?: boolean;
          status: string;
          violationCount: number;
          violationPoints?: number;
          locked: boolean;
          lockReason: string | null;
          lockedUntil?: string | null;
          isExcused?: boolean;
          excuseReason?: string | null;
          pointsAdded?: number;
          triggerSirenRedScreen?: boolean;
        }>(`/api/student/sessions/${session.id}/violations`, {
          method: 'POST',
          body: JSON.stringify({
            eventType,
            deviceType: deviceInfo.deviceType,
            deviceBrand: deviceInfo.deviceBrand,
            details: { ...details, osLabel: deviceInfo.osLabel, isNativeXambro: deviceInfo.isNativeXambro },
          }),
        });

        if (res.ignored) return null;

        setViolationCount(res.violationCount);
        if (typeof res.violationPoints === 'number') setViolationPoints(res.violationPoints);
        if (options?.trackAway && res.id) {
          lastAwayLogIdRef.current = res.id;
        }

        if (res.isExcused && res.excuseReason) {
          showToastNotice(`Kejadian "${getViolationLabel(eventType)}" tercatat namun ${res.excuseReason}.`);
        }

        // Desktop Red Screen + Siren Alert for Keluar dari jendela ujian (Alt+Tab / Minimize / Blur)
        if (!res.isExcused && res.triggerSirenRedScreen && deviceInfo.deviceType === 'desktop') {
          setDesktopRedAlert({
            eventType,
            message: `Terdeteksi ${getViolationLabel(eventType)} pada perangkat Desktop. Segera kembali fokus ke jendela ujian!`,
            pointsAdded: res.pointsAdded ?? 0,
          });
          desktopSiren.start(10000);
        }

        if (res.locked) {
          setSessionStatus('locked');
          setLockReason(res.lockReason);
          setLockedUntil(res.lockedUntil ?? null);
        }

        return res.id ?? null;
      } catch {
        return null;
      }
    },
    [deviceInfo, session.id, sessionStatus, showToastNotice]
  );

  // Flush away duration when student returns to active window/tab
  const flushAwayDuration = useCallback(async () => {
    const startedAt = awayStartedAtRef.current;
    const logId = lastAwayLogIdRef.current;
    awayStartedAtRef.current = null;
    lastAwayLogIdRef.current = null;
    if (!startedAt || !logId) return;
    const durationSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    try {
      await apiFetch(`/api/student/sessions/${session.id}/violations/${logId}/duration`, {
        method: 'PATCH',
        body: JSON.stringify({ durationSeconds }),
      });
    } catch {
      // ignore if offline
    }
  }, [session.id]);

  // Tombol Back Blocker (never counts as a violation — strictly rejected cleanly)
  useEffect(() => {
    if (policy.blockBackNavigation === false || sessionStatus !== 'in_progress') return;
    try {
      window.history.pushState({ cbtBackGuard: true }, '', window.location.href);
    } catch {
      // ignore history errors
    }

    const onPopState = () => {
      try {
        window.history.pushState({ cbtBackGuard: true }, '', window.location.href);
      } catch {
        // ignore
      }
      showToastNotice('Tombol Kembali (Back) ditolak selama ujian berlangsung dan tidak dihitung sebagai pelanggaran.');
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.altKey && e.key === 'ArrowLeft') || e.key === 'BrowserBack') {
        e.preventDefault();
        showToastNotice('Tombol Kembali (Back) ditolak selama ujian berlangsung dan tidak dihitung sebagai pelanggaran.');
      }
    };

    window.addEventListener('popstate', onPopState);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [policy.blockBackNavigation, sessionStatus, showToastNotice]);

  // Root / Emulator detection on Android launch
  useEffect(() => {
    if (rootCheckedRef.current || sessionStatus !== 'in_progress') return;
    rootCheckedRef.current = true;
    const check = detectRootOrEmulatorClient();
    if (check.suspicious) {
      reportObservedEvent('perangkat_root_atau_emulator', { reasons: check.reasons }, { debounceMs: 60000 });
    }
  }, [sessionStatus, reportObservedEvent]);

  // Device-aware focus, visibility, fullscreen, split-screen, refresh, and native Xambro bridge listeners
  useEffect(() => {
    if (!session.autoLockEnabled) return;

    const onVisibility = () => {
      if (document.hidden) {
        const eventType =
          deviceInfo.deviceType === 'android'
            ? 'keluar_aplikasi'
            : deviceInfo.deviceType === 'ios_ipad' || deviceInfo.deviceType === 'mobile_web'
            ? 'meninggalkan_halaman_ujian'
            : 'keluar_jendela_ujian';
        reportObservedEvent(eventType, { hidden: true, source: 'visibilitychange' }, { trackAway: true });
      } else {
        flushAwayDuration();
      }
    };

    const onBlur = () => {
      if (document.hidden) return;
      const eventType =
        deviceInfo.deviceType === 'android'
          ? 'jendela_lain_di_atas_aplikasi'
          : deviceInfo.deviceType === 'desktop'
          ? 'keluar_jendela_ujian'
          : 'meninggalkan_halaman_ujian';
      reportObservedEvent(eventType, { hasFocus: false, source: 'window_blur' }, { trackAway: true });
    };

    const onFocus = () => {
      if (!document.hidden) {
        flushAwayDuration();
      }
    };

    const onFullscreen = () => {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreenActive(active);
      if (session.requireFullscreen && !active && (deviceInfo.deviceType === 'desktop' || deviceInfo.deviceType !== 'android' || !deviceInfo.isNativeXambro)) {
        reportObservedEvent('keluar_fullscreen', { fullscreen: false });
      }
    };

    // Split screen / floating window check (Android & Web/iPad)
    const onResize = () => {
      if (sessionStatus !== 'in_progress') return;
      const availW = window.screen?.availWidth || window.innerWidth;
      const availH = window.screen?.availHeight || window.innerHeight;
      if (availW <= 0 || availH <= 0) return;

      const isAndroidOrTouch = deviceInfo.deviceType === 'android' || deviceInfo.deviceType === 'ios_ipad' || deviceInfo.deviceType === 'mobile_web';
      if (!isAndroidOrTouch) return;

      const widthRatio = window.innerWidth / availW;
      const heightRatio = window.innerHeight / availH;
      const areaRatio = (window.innerWidth * window.innerHeight) / (availW * availH);

      // Side-by-side split screen or small floating popup window
      if ((widthRatio < 0.7 || heightRatio < 0.62) && areaRatio < 0.66) {
        reportObservedEvent(
          'layar_terbagi_split_screen',
          {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            availWidth: availW,
            availHeight: availH,
          },
          { debounceMs: 5000 }
        );
      }
    };

    // Desktop & Web refresh / close page beacon
    const onUnloadOrHide = () => {
      if (intentionalExitRef.current || sessionStatus !== 'in_progress') return;
      if (deviceInfo.deviceType === 'android' && deviceInfo.isNativeXambro) return;
      try {
        fetch(withAuthTokenUrl(`/api/student/sessions/${session.id}/violations`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventType: 'tutup_atau_refresh_halaman',
            deviceType: deviceInfo.deviceType,
            deviceBrand: deviceInfo.deviceBrand,
            details: { source: 'beforeunload_pagehide' },
          }),
          keepalive: true,
        }).catch(() => {});
      } catch {
        // ignore keepalive failure on unload
      }
    };

    // Native Xambro / Android WebView bridge event hook
    const onXambroBridgeEvent = (evt: Event) => {
      const custom = evt as CustomEvent<{ eventType?: string; type?: string; details?: Record<string, unknown> }>;
      const rawType = custom.detail?.eventType || custom.detail?.type;
      if (!rawType) return;
      if (rawType === 'tombol_back') {
        showToastNotice('Tombol Kembali (Back) ditolak sistem dan tidak pernah dihitung sebagai pelanggaran.');
        return;
      }
      const isAway = rawType === 'keluar_aplikasi' || rawType === 'tombol_home';
      reportObservedEvent(rawType, custom.detail?.details || { source: 'xambro_bridge' }, {
        trackAway: isAway,
        debounceMs: rawType === 'tombol_home' ? 1200 : 2000,
      });
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('fullscreenchange', onFullscreen);
    window.addEventListener('resize', onResize);
    window.addEventListener('pagehide', onUnloadOrHide);
    window.addEventListener('beforeunload', onUnloadOrHide);
    window.addEventListener('xambro:event', onXambroBridgeEvent);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('fullscreenchange', onFullscreen);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pagehide', onUnloadOrHide);
      window.removeEventListener('beforeunload', onUnloadOrHide);
      window.removeEventListener('xambro:event', onXambroBridgeEvent);
    };
  }, [
    session.autoLockEnabled,
    session.requireFullscreen,
    session.id,
    sessionStatus,
    deviceInfo,
    reportObservedEvent,
    flushAwayDuration,
    showToastNotice,
  ]);

  // Exam WiFi Disconnect (> 10s grace) & Network Type Change Monitoring (Android & Desktop)
  useEffect(() => {
    if (!session.requireExamWifi || sessionStatus !== 'in_progress') return;
    const graceMs = Math.max(5, policy.wifiDisconnectGraceSeconds || 10) * 1000;

    const handleOfflineCheck = () => {
      if (wifiOfflineTimerRef.current) return;
      wifiOfflineTimerRef.current = window.setTimeout(() => {
        wifiOfflineTimerRef.current = null;
        if (!navigator.onLine) {
          reportObservedEvent(
            'keluar_wifi_ujian',
            { reason: 'offline_timeout', graceSeconds: graceMs / 1000, allowedWifiSsid: session.allowedWifiSsid || '' },
            { debounceMs: 12000 }
          );
        }
      }, graceMs);
    };

    const handleBackOnline = () => {
      if (wifiOfflineTimerRef.current) {
        window.clearTimeout(wifiOfflineTimerRef.current);
        wifiOfflineTimerRef.current = null;
      }
    };

    type NetworkInfoLike = { type?: string; effectiveType?: string; addEventListener?: (t: string, cb: () => void) => void; removeEventListener?: (t: string, cb: () => void) => void };
    const conn = (navigator as unknown as { connection?: NetworkInfoLike }).connection;
    const onConnChange = () => {
      if (conn?.type && conn.type !== 'wifi' && conn.type !== 'ethernet' && conn.type !== 'unknown') {
        reportObservedEvent(
          'keluar_wifi_ujian',
          { reason: 'network_type_switched', connectionType: conn.type, allowedWifiSsid: session.allowedWifiSsid || '' },
          { debounceMs: 10000 }
        );
      }
    };

    window.addEventListener('offline', handleOfflineCheck);
    window.addEventListener('online', handleBackOnline);
    conn?.addEventListener?.('change', onConnChange);
    if (!navigator.onLine) handleOfflineCheck();

    return () => {
      window.removeEventListener('offline', handleOfflineCheck);
      window.removeEventListener('online', handleBackOnline);
      conn?.removeEventListener?.('change', onConnChange);
      handleBackOnline();
    };
  }, [session.requireExamWifi, session.allowedWifiSsid, sessionStatus, policy.wifiDisconnectGraceSeconds, reportObservedEvent]);

  // Camera Enforcement & Lightweight On-Device AI Proctoring Analyzer
  useEffect(() => {
    const needsCamera = Boolean(session.requireCamera || session.proctoring.enabled);
    if (!needsCamera) return;

    let consecutiveDarkOrMissing = 0;
    let consecutiveNoFace = 0;
    const tolerance = Math.max(2, session.proctoring.tolerance || 4);

    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');

    const FaceDetectorCtor = (window as unknown as { FaceDetector?: new (opts?: unknown) => { detect: (el: HTMLVideoElement) => Promise<unknown[]> } }).FaceDetector;
    const detector = FaceDetectorCtor ? new FaceDetectorCtor({ fastMode: true, maxDetectedFaces: 4 }) : null;

    const timer = setInterval(async () => {
      if (sessionStatus !== 'in_progress') return;

      const track = activeCameraStream?.getVideoTracks()[0];
      if (!activeCameraStream || !track || track.readyState !== 'live' || track.muted) {
        if (session.requireCamera) {
          setCameraBlockedReason('Kamera tidak aktif atau dicabut. Aktifkan kembali kamera untuk membuka soal ujian.');
          if (!cameraDownReportedRef.current) {
            cameraDownReportedRef.current = true;
            reportObservedEvent('kamera_mati_atau_dicabut', { reason: !activeCameraStream ? 'no_stream' : track?.muted ? 'muted' : 'ended' }, { debounceMs: 6000 });
          }
        }
        if (session.proctoring.enabled) {
          apiFetch(`/api/student/sessions/${session.id}/proctoring`, {
            method: 'POST',
            body: JSON.stringify({
              indicatorType: 'kamera_terhenti',
              confidence: 0.9,
              note: 'Stream kamera perangkat terhenti atau dibisukan.',
            }),
          }).catch(() => {});
        }
        return;
      }

      cameraDownReportedRef.current = false;
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;

      // Always run luminance check so covered lens ("Kamera tertutup") blocks questions on Android/Desktop
      let isDarkFrame = false;
      if (ctx) {
        try {
          ctx.drawImage(video, 0, 0, 160, 120);
          const frame = ctx.getImageData(0, 0, 160, 120).data;
          let lumSum = 0;
          for (let i = 0; i < frame.length; i += 16) {
            lumSum += 0.299 * frame[i] + 0.587 * frame[i + 1] + 0.114 * frame[i + 2];
          }
          const avgLum = lumSum / (frame.length / 16);
          if (avgLum < 12) {
            isDarkFrame = true;
          }
        } catch {
          // ignore canvas read error
        }
      }

      if (isDarkFrame) {
        consecutiveDarkOrMissing++;
        if (consecutiveDarkOrMissing >= 2) {
          setCameraBlockedReason('Lensa kamera depan tertutup atau terlalu gelap. Soal ditutup sementara sampai kamera terlihat kembali.');
          if (!cameraCoveredReportedRef.current) {
            cameraCoveredReportedRef.current = true;
            reportObservedEvent('kamera_tertutup', { avgLuminance: 'low', deviceType: deviceInfo.deviceType }, { debounceMs: 6000 });
          }
          if (session.proctoring.enabled) {
            apiFetch(`/api/student/sessions/${session.id}/proctoring`, {
              method: 'POST',
              body: JSON.stringify({
                indicatorType: 'kamera_gelap_atau_tertutup',
                confidence: 0.85,
                note: 'Lensa kamera tertutup atau pencahayaan sangat gelap.',
              }),
            }).catch(() => {});
          }
        }
        return;
      }

      // Camera visible again -> automatically unblock questions
      consecutiveDarkOrMissing = 0;
      cameraCoveredReportedRef.current = false;
      setCameraBlockedReason(null);

      // Optional face indicator when AI proctoring is enabled (non-punitive indicator only)
      if (session.proctoring.enabled && detector) {
        try {
          const faces = await detector.detect(video);
          if (faces.length === 0) {
            consecutiveNoFace++;
            if (consecutiveNoFace >= tolerance) {
              consecutiveNoFace = 0;
              apiFetch(`/api/student/sessions/${session.id}/proctoring`, {
                method: 'POST',
                body: JSON.stringify({
                  indicatorType: 'wajah_tidak_terlihat',
                  confidence: 0.72,
                  note: 'Deteksi ringan perangkat: wajah tidak terdeteksi selama beberapa interval berturut-turut.',
                }),
              }).catch(() => {});
            }
          } else if (faces.length > 1) {
            consecutiveNoFace = 0;
            apiFetch(`/api/student/sessions/${session.id}/proctoring`, {
              method: 'POST',
              body: JSON.stringify({
                indicatorType: 'lebih_dari_satu_wajah',
                confidence: 0.78,
                note: `Terdeteksi ${faces.length} wajah di frame kamera untuk peninjauan pengawas.`,
              }),
            }).catch(() => {});
          } else {
            consecutiveNoFace = 0;
          }
        } catch {
          // ignore FaceDetector failure
        }
      }
    }, 2500);

    return () => clearInterval(timer);
  }, [session.requireCamera, session.proctoring, session.id, activeCameraStream, sessionStatus, deviceInfo.deviceType, reportObservedEvent]);

  const currentQuestion = questions[currentIdx];

  const updateAnswer = (questionId: string, newAnswer: unknown, doubtfulOverride?: boolean) => {
    if (sessionStatus === 'locked') return;
    setAnswers((prev) => {
      const curr = prev[questionId] || { answer: null, isDoubtful: false, version: 0 };
      const nextVersion = curr.version + 1;
      const nextIsDoubtful = doubtfulOverride !== undefined ? doubtfulOverride : curr.isDoubtful;

      const queue = loadOfflineAnswerQueue(session.id);
      queue[questionId] = {
        questionId,
        answer: newAnswer,
        isDoubtful: nextIsDoubtful,
        clientVersion: nextVersion,
        updatedAt: new Date().toISOString(),
      };
      saveOfflineAnswerQueue(session.id, queue);
      setPendingQueueCount(Object.keys(queue).length);
      setSaveStatus('pending');

      return {
        ...prev,
        [questionId]: { answer: newAnswer, isDoubtful: nextIsDoubtful, version: nextVersion },
      };
    });
  };

  const toggleDoubtful = () => {
    if (!currentQuestion) return;
    const curr = answers[currentQuestion.id];
    updateAnswer(currentQuestion.id, curr?.answer ?? null, !curr?.isDoubtful);
  };

  const isQuestionAnswered = (qId: string): boolean => {
    const val = answers[qId]?.answer;
    if (val === null || val === undefined) return false;
    if (typeof val === 'string') return val.trim().length > 0;
    if (Array.isArray(val)) return val.length > 0;
    if (typeof val === 'object') return Object.values(val as Record<string, unknown>).some((v) => Boolean(v));
    return false;
  };

  const statsSummary = useMemo(() => {
    let answered = 0;
    let doubtful = 0;
    let empty = 0;
    for (const q of questions) {
      if (answers[q.id]?.isDoubtful) doubtful++;
      if (isQuestionAnswered(q.id)) answered++;
      else empty++;
    }
    return { answered, doubtful, empty };
  }, [questions, answers]);

  const formatTimer = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleSubmitExam = async () => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      // Must confirm all offline answers reached server before submitting!
      await flushAnswerQueue();
      const remainingQueue = Object.keys(loadOfflineAnswerQueue(session.id)).length;
      if (remainingQueue > 0 || !navigator.onLine) {
        setSubmitError(
          `Masih ada ${remainingQueue} jawaban menunggu sinkronisasi atau koneksi terputus. Pastikan koneksi tersambung dan status menjadi "Tersimpan di server" sebelum mengumpulkan.`
        );
        setSubmitting(false);
        return;
      }

      intentionalExitRef.current = true;
      await apiFetch(`/api/student/sessions/${session.id}/submit`, { method: 'POST' });
      onExitExam();
    } catch (err) {
      intentionalExitRef.current = false;
      setSubmitError(err instanceof Error ? err.message : 'Gagal mengumpulkan ujian.');
      setSubmitting(false);
    }
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const msg = chatInput.trim();
    if (!msg) return;
    setChatInput('');
    try {
      const res = await apiFetch<{ message: ChatMessageItem }>(`/api/chat/${session.examId}/${user.id}`, {
        method: 'POST',
        body: JSON.stringify({ message: msg, sessionId: session.id }),
      });
      setChatMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
    } catch {
      setChatInput(msg);
    }
  };

  const getQuestionChoiceTag = (q: ActiveExamPayload['questions'][number]): string | null => {
    const val = answers[q.id]?.answer;
    if (q.questionType === 'pg_tunggal' && typeof val === 'string') {
      const opts = q.options as Array<{ id: string; displayLabel: string }>;
      return opts.find((o) => o.id === val)?.displayLabel || null;
    }
    if (isQuestionAnswered(q.id)) return '✓';
    return null;
  };

  const stemSizeClass =
    fontScale === 'sm'
      ? 'text-sm leading-relaxed'
      : fontScale === 'lg'
      ? 'text-base sm:text-lg leading-relaxed'
      : 'text-sm sm:text-base leading-relaxed';

  return (
    <div className="min-h-screen flex flex-col">
      {/* TKA Vibrant Multi-Stop Header Bar */}
      <header className="sticky top-0 z-30 bg-gradient-to-r from-blue-800 via-indigo-700 to-teal-700 text-white border-b border-indigo-900/30 px-3 sm:px-6 h-14 flex items-center justify-between gap-2.5 shadow-sm">
        <div className="flex items-center gap-2.5 min-w-0">
          {branding?.logoEndpoint && (
            <img
              src={branding.logoEndpoint}
              alt={branding.shortName}
              referrerPolicy="no-referrer"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              className="hidden sm:block w-8 h-8 rounded-lg object-contain bg-white p-0.5 shrink-0 shadow-xs"
            />
          )}
          <StudentAvatar photoUrl={user.photoUrl} fullName={user.fullName} size="sm" className="border-white/50" />
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-display font-bold text-white truncate">
              {user.fullName} <span className="hidden sm:inline font-mono font-normal text-sky-100">· {user.nis}</span>
            </p>
            <div className="flex items-center gap-1.5 text-[11px] text-sky-100 truncate">
              <span className="truncate">{session.subjectName}</span>
              <span className="md:hidden" aria-hidden="true">·</span>
              <span
                className={`md:hidden font-semibold shrink-0 ${
                  !isOnline ? 'text-rose-200' : saveStatus === 'saved' ? 'text-emerald-200' : 'text-amber-200'
                }`}
              >
                {!isOnline
                  ? 'Terputus'
                  : saveStatus === 'saved'
                  ? 'Tersimpan'
                  : saveStatus === 'pending'
                  ? `Antre (${pendingQueueCount})`
                  : 'Lokal'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Desktop Save & Connection Status */}
          <div className="hidden md:flex items-center gap-2 text-xs text-sky-100">
            <span className={`flex items-center gap-1 font-medium ${isOnline ? 'text-emerald-200' : 'text-rose-200'}`}>
              {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              <span>{isOnline ? 'Terhubung' : 'Terputus'}</span>
            </span>
            <span aria-hidden="true" className="text-white/35">·</span>
            <span className={`font-medium ${
              saveStatus === 'saved' ? 'text-white' : saveStatus === 'pending' ? 'text-amber-200' : 'text-rose-200'
            }`}>
              {saveStatus === 'saved' && 'Tersimpan di server'}
              {saveStatus === 'pending' && `Sinkronisasi (${pendingQueueCount})`}
              {saveStatus === 'failed' && 'Disimpan lokal'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowNavigator(true)}
            className="lg:hidden min-h-[36px] px-2.5 rounded-lg bg-white/15 hover:bg-white/25 border border-white/25 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
            aria-label="Buka daftar soal"
          >
            <Grid className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Daftar Soal</span>
          </button>

          {/* Authoritative Server Timer */}
          <div
            className={`px-2.5 sm:px-3 py-1.5 rounded-lg border font-mono text-xs sm:text-sm font-bold tabular-nums flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              remainingSec < 300
                ? 'bg-rose-600 border-rose-300 text-white'
                : 'bg-slate-950/35 border-white/25 text-amber-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span>{formatTimer(remainingSec)}</span>
          </div>
        </div>
      </header>

      {/* Live Notice Banner from Admin/Pengawas */}
      {liveNotice && (
        <div className="w-full max-w-6xl mx-auto px-3 sm:px-6 pt-3">
          <div
            className={`p-3.5 rounded-xl border flex items-start justify-between gap-3 text-xs sm:text-sm shadow-xs ${
              liveNotice.tone === 'warn'
                ? 'bg-amber-50 border-amber-300 text-amber-950'
                : 'bg-gradient-to-r from-violet-50 via-indigo-50 to-sky-50 border-indigo-200 text-slate-900'
            }`}
          >
            <div className="min-w-0">
              <p className="font-display font-bold">{liveNotice.title}</p>
              <p className="mt-0.5 leading-relaxed">{liveNotice.text}</p>
            </div>
            <button
              type="button"
              onClick={() => setLiveNotice(null)}
              className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 shrink-0"
            >
              Tutup
            </button>
          </div>
        </div>
      )}

      {/* Fullscreen Recovery Banner if required and exited */}
      {session.requireFullscreen && !isFullscreenActive && sessionStatus === 'in_progress' && (
        <div className="w-full max-w-6xl mx-auto px-3 sm:px-6 pt-3">
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold">Ujian ini mewajibkan mode layar penuh (Fullscreen). Segera kembalikan ke layar penuh.</span>
            <button
              type="button"
              onClick={() => {
                document.documentElement.requestFullscreen?.().catch(() => {});
              }}
              className="px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-semibold inline-flex items-center gap-1.5"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Masuk Layar Penuh</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Responsive TKA Exam Area */}
      <div className="flex-1 w-full max-w-6xl mx-auto p-3 sm:p-6 pb-24 grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6">
        {/* TKA Crisp White Question Sheet with Colorful Header Accent */}
        <section className="relative lg:col-span-8 bg-white border border-indigo-200/80 shadow-sm rounded-2xl overflow-hidden flex flex-col justify-between">
          {/* Camera Covered / Disconnected Question Shield */}
          {cameraBlockedReason && (
            <div className="absolute inset-0 z-20 bg-slate-900/95 backdrop-blur-md flex items-center justify-center p-6 text-center">
              <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 border border-amber-300 shadow-2xl">
                <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
                  <CameraOff className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-display font-bold text-slate-900">Soal Ditutup Sementara</h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">{cameraBlockedReason}</p>
                <div className="flex flex-wrap justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={requestCameraRecovery}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-blue-900 hover:bg-blue-800 text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Aktifkan Ulang Kamera</span>
                  </button>
                </div>
              </div>
            </div>
          )}
          {currentQuestion ? (
            <div>
              <div className="h-1 w-full bg-gradient-to-r from-blue-600 via-indigo-500 via-violet-500 to-teal-500" aria-hidden="true" />
              {/* TKA Question Sheet Toolbar Strip: SOAL NO. + Font Scale */}
              <div className="px-4 sm:px-6 py-3 bg-gradient-to-r from-sky-50 via-indigo-50/70 to-teal-50/70 border-b border-indigo-100 flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex items-center rounded-lg overflow-hidden border border-indigo-600 shrink-0 shadow-xs">
                    <span className="px-2.5 py-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[11px] font-bold tracking-wide">
                      SOAL NO.
                    </span>
                    <span className="px-2.5 py-1 bg-white text-indigo-800 font-mono text-sm font-bold tabular-nums">
                      {currentIdx + 1} / {questions.length}
                    </span>
                  </div>
                  <div className="min-w-0 text-xs text-slate-600 truncate">
                    <span
                      className={`font-bold ${
                        currentQuestion.questionType === 'pg_tunggal'
                          ? 'text-indigo-700'
                          : currentQuestion.questionType === 'pg_kompleks'
                          ? 'text-violet-700'
                          : currentQuestion.questionType === 'benar_salah'
                          ? 'text-teal-700'
                          : 'text-amber-700'
                      }`}
                    >
                      {currentQuestion.questionType === 'pg_tunggal' && 'Pilihan Ganda'}
                      {currentQuestion.questionType === 'pg_kompleks' && 'Pilihan Ganda Kompleks'}
                      {currentQuestion.questionType === 'benar_salah' && 'Benar / Salah'}
                      {currentQuestion.questionType === 'menjodohkan' && 'Menjodohkan'}
                    </span>
                    {currentQuestion.topic && (
                      <>
                        <span aria-hidden="true" className="mx-1.5 text-slate-300">·</span>
                        <span>{currentQuestion.topic}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* TKA Font Size Adjuster (A- / A / A+) */}
                <div className="flex items-center gap-1 p-0.5 bg-white border border-indigo-200 rounded-lg shrink-0" role="group" aria-label="Ukuran huruf soal">
                  <button
                    type="button"
                    onClick={() => setFontScale('sm')}
                    aria-label="Perkecil huruf soal"
                    className={`min-h-[30px] px-2 rounded text-xs font-semibold transition-colors ${
                      fontScale === 'sm' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-indigo-50'
                    }`}
                  >
                    A-
                  </button>
                  <button
                    type="button"
                    onClick={() => setFontScale('base')}
                    aria-label="Ukuran huruf normal"
                    className={`min-h-[30px] px-2 rounded text-xs font-semibold transition-colors ${
                      fontScale === 'base' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-indigo-50'
                    }`}
                  >
                    A
                  </button>
                  <button
                    type="button"
                    onClick={() => setFontScale('lg')}
                    aria-label="Perbesar huruf soal"
                    className={`min-h-[30px] px-2 rounded text-xs font-semibold transition-colors ${
                      fontScale === 'lg' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-indigo-50'
                    }`}
                  >
                    A+
                  </button>
                </div>
              </div>

              <div className="p-4 sm:p-6 space-y-5">
                {/* Stem + Math + Media + Table */}
                <div className={`${stemSizeClass} text-slate-900 space-y-4`}>
                  <MathRenderer content={currentQuestion.stemHtml} />

                  {currentQuestion.mediaPath && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 inline-block max-w-full">
                      <img
                        src={withAuthTokenUrl(currentQuestion.mediaPath)}
                        alt={`Ilustrasi soal nomor ${currentIdx + 1}`}
                        referrerPolicy="no-referrer"
                        className="max-h-72 w-auto rounded object-contain mx-auto"
                      />
                    </div>
                  )}

                  {currentQuestion.tableData && (
                    <div className="overflow-x-auto border border-indigo-200 rounded-lg">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-indigo-50 text-indigo-950 font-semibold">
                          <tr>
                            {currentQuestion.tableData.headers.map((h, i) => (
                              <th key={i} className="px-3 py-2 border-b border-indigo-200">
                                <MathRenderer content={h} />
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {currentQuestion.tableData.rows.map((row, rIdx) => (
                            <tr key={rIdx} className="hover:bg-slate-50">
                              {row.map((cell, cIdx) => (
                                <td key={cIdx} className="px-3 py-2 tabular-nums">
                                  <MathRenderer content={cell} />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Answer Input Area per Question Type */}
                <div className="pt-2 space-y-2.5 border-t border-slate-100">
                  {currentQuestion.questionType === 'pg_tunggal' &&
                    (currentQuestion.options as Array<{ id: string; displayLabel: string; text: string }>).map((opt) => {
                      const selected = answers[currentQuestion.id]?.answer === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => updateAnswer(currentQuestion.id, opt.id)}
                          className={`w-full min-h-[50px] p-3.5 rounded-xl border text-left flex items-start gap-3.5 transition-all active:scale-[0.995] ${
                            selected
                              ? 'bg-indigo-50/90 border-indigo-600 text-slate-900 shadow-[0_0_0_1px_rgba(79,70,229,0.2)]'
                              : 'bg-white border-slate-200 hover:bg-sky-50/40 hover:border-indigo-200 text-slate-800'
                          }`}
                        >
                          <span
                            className={`w-7 h-7 rounded-full border flex items-center justify-center font-mono text-xs font-bold shrink-0 mt-0.5 transition-colors ${
                              selected
                                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 border-indigo-600 text-white'
                                : 'bg-white border-slate-300 text-slate-700'
                            }`}
                          >
                            {opt.displayLabel}
                          </span>
                          <span className={`${stemSizeClass} pt-0.5`}>
                            <MathRenderer content={opt.text} />
                          </span>
                        </button>
                      );
                    })}

                  {currentQuestion.questionType === 'pg_kompleks' && (
                    <div className="space-y-2.5">
                      <p className="text-xs font-semibold text-violet-700">Pilih semua jawaban yang benar (dapat lebih dari satu):</p>
                      {(currentQuestion.options as Array<{ id: string; displayLabel: string; text: string }>).map((opt) => {
                        const currentArr = Array.isArray(answers[currentQuestion.id]?.answer)
                          ? (answers[currentQuestion.id]?.answer as string[])
                          : [];
                        const checked = currentArr.includes(opt.id);
                        const toggle = () => {
                          const next = checked ? currentArr.filter((x) => x !== opt.id) : [...currentArr, opt.id];
                          updateAnswer(currentQuestion.id, next);
                        };
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={toggle}
                            className={`w-full min-h-[48px] p-3.5 rounded-xl border text-left flex items-start gap-3 transition-colors ${
                              checked
                                ? 'bg-violet-50/90 border-violet-600 text-slate-900'
                                : 'bg-white border-slate-200 hover:bg-violet-50/30 hover:border-violet-200 text-slate-800'
                            }`}
                          >
                            <span
                              className={`w-6 h-6 mt-0.5 rounded border flex items-center justify-center text-xs font-bold shrink-0 ${
                                checked ? 'bg-violet-600 border-violet-600 text-white' : 'bg-white border-slate-300 text-transparent'
                              }`}
                            >
                              ✓
                            </span>
                            <span className={stemSizeClass}>
                              <MathRenderer content={opt.text} />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {currentQuestion.questionType === 'benar_salah' && (
                    <div className="border border-teal-200 rounded-xl overflow-hidden">
                      <div className="hidden sm:grid sm:grid-cols-12 bg-teal-50 border-b border-teal-200 text-xs font-bold text-teal-950">
                        <div className="col-span-8 px-4 py-2.5">Pernyataan</div>
                        <div className="col-span-2 px-2 py-2.5 text-center border-l border-teal-200">Benar</div>
                        <div className="col-span-2 px-2 py-2.5 text-center border-l border-teal-200">Salah</div>
                      </div>
                      <div className="divide-y divide-slate-200">
                        {(currentQuestion.options as Array<{ id: string; text: string }>).map((stmt, sIdx) => {
                          const currMap =
                            (answers[currentQuestion.id]?.answer as Record<string, string> | undefined) || {};
                          const val = currMap[stmt.id] || '';
                          const setStmtVal = (choice: 'B' | 'S') => {
                            updateAnswer(currentQuestion.id, { ...currMap, [stmt.id]: choice });
                          };
                          return (
                            <div key={stmt.id} className="bg-white sm:grid sm:grid-cols-12 sm:items-stretch">
                              <div className={`sm:col-span-8 p-3.5 sm:px-4 flex gap-2 text-slate-800 ${stemSizeClass}`}>
                                <span className="font-mono text-xs text-teal-700 pt-1 tabular-nums">{sIdx + 1}.</span>
                                <MathRenderer content={stmt.text} />
                              </div>
                              {/* Mobile buttons */}
                              <div className="px-3.5 pb-3.5 flex items-center gap-2 sm:hidden">
                                <button
                                  type="button"
                                  onClick={() => setStmtVal('B')}
                                  className={`flex-1 min-h-[44px] px-4 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                                    val === 'B'
                                      ? 'bg-emerald-600 border-emerald-600 text-white'
                                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-emerald-50'
                                  }`}
                                >
                                  Benar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setStmtVal('S')}
                                  className={`flex-1 min-h-[44px] px-4 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                                    val === 'S'
                                      ? 'bg-rose-600 border-rose-600 text-white'
                                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-rose-50'
                                  }`}
                                >
                                  Salah
                                </button>
                              </div>
                              {/* Desktop TKA table radio cells */}
                              <div className="hidden sm:flex sm:col-span-2 items-center justify-center border-l border-slate-200 p-2">
                                <button
                                  type="button"
                                  aria-label={`Pernyataan ${sIdx + 1}: Benar`}
                                  onClick={() => setStmtVal('B')}
                                  className={`w-9 h-9 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-colors ${
                                    val === 'B'
                                      ? 'bg-emerald-600 border-emerald-600 text-white'
                                      : 'bg-white border-slate-300 text-transparent hover:border-emerald-500'
                                  }`}
                                >
                                  ✓
                                </button>
                              </div>
                              <div className="hidden sm:flex sm:col-span-2 items-center justify-center border-l border-slate-200 p-2">
                                <button
                                  type="button"
                                  aria-label={`Pernyataan ${sIdx + 1}: Salah`}
                                  onClick={() => setStmtVal('S')}
                                  className={`w-9 h-9 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-colors ${
                                    val === 'S'
                                      ? 'bg-rose-600 border-rose-600 text-white'
                                      : 'bg-white border-slate-300 text-transparent hover:border-rose-500'
                                  }`}
                                >
                                  ✓
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {currentQuestion.questionType === 'menjodohkan' && (() => {
                    const opts = currentQuestion.options as {
                      left: Array<{ id: string; text: string }>;
                      right: Array<{ id: string; text: string }>;
                    };
                    const currMap =
                      (answers[currentQuestion.id]?.answer as Record<string, string> | undefined) || {};
                    return (
                      <div className="space-y-3">
                        <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 text-xs text-slate-700 space-y-1.5">
                          <p className="font-bold text-amber-950">Daftar Pilihan Kolom Kanan:</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {opts.right.map((r, rIdx) => (
                              <div key={r.id} className="flex items-center gap-1.5">
                                <span className="font-mono font-bold text-amber-700">{String.fromCharCode(65 + rIdx)}.</span>
                                <MathRenderer content={r.text} />
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="border border-amber-200 rounded-xl divide-y divide-slate-200">
                          {opts.left.map((leftItem, lIdx) => (
                            <div key={leftItem.id} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white">
                              <div className={`${stemSizeClass} text-slate-900 flex gap-2`}>
                                <span className="font-mono text-xs text-amber-700 pt-1 tabular-nums">{lIdx + 1}.</span>
                                <MathRenderer content={leftItem.text} />
                              </div>
                              <select
                                value={currMap[leftItem.id] || ''}
                                onChange={(e) => {
                                  updateAnswer(currentQuestion.id, {
                                    ...currMap,
                                    [leftItem.id]: e.target.value,
                                  });
                                }}
                                className="min-h-[44px] px-3 py-2 rounded-lg border border-amber-300 bg-white text-sm text-slate-900 sm:w-56 shrink-0 focus:outline-none focus:border-amber-600"
                              >
                                <option value="">-- Pilih Pasangan --</option>
                                {opts.right.map((r, rIdx) => (
                                  <option key={r.id} value={r.id}>
                                    {String.fromCharCode(65 + rIdx)}. {r.text.replace(/\$/g, '')}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-6">
              <p className="text-slate-500 text-sm">Memuat soal...</p>
            </div>
          )}
        </section>

        {/* Desktop Sidebar: Colorful TKA Daftar Soal Grid + Camera Preview */}
        <aside className="hidden lg:flex lg:col-span-4 flex-col gap-4">
          <div className="bg-white border border-indigo-200/80 rounded-2xl overflow-hidden shadow-sm">
            <div className="bg-gradient-to-r from-indigo-700 via-blue-700 to-teal-600 text-white px-4 py-3 flex items-center justify-between">
              <h2 className="text-sm font-display font-bold">Daftar Soal</h2>
              <span className="text-xs font-mono text-sky-100">{session.packageCode}</span>
            </div>

            <div className="p-4 space-y-4">
              <div className="grid grid-cols-5 gap-2">
                {questions.map((q, idx) => {
                  const answered = isQuestionAnswered(q.id);
                  const doubtful = Boolean(answers[q.id]?.isDoubtful);
                  const active = idx === currentIdx;
                  const choiceTag = getQuestionChoiceTag(q);
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => setCurrentIdx(idx)}
                      className={`relative min-h-[42px] rounded-xl font-mono text-xs font-bold border transition-all tabular-nums ${
                        active
                          ? 'ring-2 ring-teal-500 ring-offset-2 border-teal-600'
                          : ''
                      } ${
                        doubtful
                          ? 'bg-amber-400 border-amber-500 text-slate-950'
                          : answered
                          ? 'bg-indigo-600 border-indigo-700 text-white'
                          : 'bg-white border-slate-300 text-slate-700 hover:bg-indigo-50'
                      }`}
                    >
                      <span>{idx + 1}</span>
                      {choiceTag && (
                        <span
                          className={`absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center border ${
                            doubtful
                              ? 'bg-slate-900 text-white border-amber-300'
                              : 'bg-white text-indigo-700 border-indigo-600'
                          }`}
                        >
                          {choiceTag}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* TKA Color Legend + Counts */}
              <div className="pt-3 border-t border-slate-100 grid grid-cols-3 gap-2 text-[11px] text-slate-600">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-indigo-600 shrink-0" />
                  <span className="tabular-nums">Dijawab ({statsSummary.answered})</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-amber-400 border border-amber-500 shrink-0" />
                  <span className="tabular-nums">Ragu ({statsSummary.doubtful})</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-white border border-slate-300 shrink-0" />
                  <span className="tabular-nums">Kosong ({statsSummary.empty})</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowSubmitModal(true)}
                className="w-full min-h-[44px] rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all shadow-xs"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Selesai &amp; Kumpulkan</span>
              </button>
            </div>
          </div>

          {(session.proctoring.enabled || session.requireCamera) && (
            <div className="bg-white border border-teal-200 rounded-2xl p-4 space-y-2 shadow-sm">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <Camera className="w-4 h-4 text-teal-600" />
                  <span>{session.requireCamera ? 'Kamera Wajib Ujian' : 'Kamera Pengawasan'}</span>
                </span>
                <span className={activeCameraStream && !cameraBlockedReason ? 'font-semibold text-emerald-700' : 'text-amber-700 font-semibold'}>
                  {cameraBlockedReason ? 'Tertutup/Terhenti' : activeCameraStream ? 'Aktif' : 'Tidak Aktif'}
                </span>
              </div>
              {activeCameraStream ? (
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-36 rounded-xl object-cover bg-slate-900"
                />
              ) : (
                <div className="h-24 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center text-xs text-slate-500 text-center px-3">
                  Kamera tidak tersedia atau izin ditolak. Status ini tercatat untuk pengawas.
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* Hidden video ref on mobile if camera enabled */}
      {(session.proctoring.enabled || session.requireCamera) && activeCameraStream && (
        <video ref={videoRef} autoPlay muted playsInline className="hidden lg:hidden" />
      )}

      {/* TKA Triad Bottom Navigation Bar (Mobile & Desktop) */}
      <footer className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-indigo-100 px-3 sm:px-6 py-2 pb-safe">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={currentIdx === 0}
            onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
            className="min-h-[44px] px-3 sm:px-4 rounded-xl border border-indigo-200 bg-indigo-50/60 hover:bg-indigo-100 disabled:opacity-40 text-indigo-900 text-xs sm:text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
          >
            <ChevronLeft className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Soal Sebelumnya</span>
            <span className="sm:hidden">Sebelumnya</span>
          </button>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={toggleDoubtful}
              className={`min-h-[44px] px-3 sm:px-4 rounded-xl border text-xs sm:text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                currentQuestion && answers[currentQuestion.id]?.isDoubtful
                  ? 'bg-amber-400 border-amber-500 text-slate-950 font-bold'
                  : 'bg-amber-50 border-amber-300 hover:bg-amber-100 text-amber-950'
              }`}
            >
              <Flag className="w-4 h-4 shrink-0" />
              <span>Ragu-ragu</span>
            </button>

            <button
              type="button"
              onClick={() => { setShowChat(true); setUnreadChat(0); }}
              className="min-h-[44px] px-3 rounded-xl border border-teal-200 bg-teal-50/60 hover:bg-teal-100 text-teal-900 text-xs sm:text-sm font-semibold flex items-center gap-1.5 relative whitespace-nowrap shrink-0 transition-colors"
              aria-label="Chat Pengawas"
            >
              <MessageSquare className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">Chat Pengawas</span>
              {unreadChat > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold">
                  {unreadChat}
                </span>
              )}
            </button>
          </div>

          {currentIdx < questions.length - 1 ? (
            <button
              type="button"
              onClick={() => setCurrentIdx((i) => Math.min(questions.length - 1, i + 1))}
              className="min-h-[44px] px-3.5 sm:px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors shadow-xs"
            >
              <span className="hidden sm:inline">Soal Berikutnya</span>
              <span className="sm:hidden">Berikutnya</span>
              <ChevronRight className="w-4 h-4 shrink-0" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowSubmitModal(true)}
              className="min-h-[44px] px-3.5 sm:px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors shadow-xs"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Selesai</span>
            </button>
          )}
        </div>
      </footer>

      {/* Mobile/Tablet TKA Question Navigator Drawer */}
      {showNavigator && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md overflow-hidden max-h-[85vh] flex flex-col shadow-2xl">
            <div className="bg-gradient-to-r from-indigo-700 via-blue-700 to-teal-600 text-white px-5 py-3.5 flex items-center justify-between">
              <div>
                <h3 className="font-display font-bold text-sm">Daftar Soal</h3>
                <p className="text-[11px] text-sky-100 font-mono">{session.packageCode}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowNavigator(false)}
                aria-label="Tutup daftar soal"
                className="p-1.5 text-sky-100 hover:text-white rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-5 gap-2">
                {questions.map((q, idx) => {
                  const answered = isQuestionAnswered(q.id);
                  const doubtful = Boolean(answers[q.id]?.isDoubtful);
                  const choiceTag = getQuestionChoiceTag(q);
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => { setCurrentIdx(idx); setShowNavigator(false); }}
                      className={`relative min-h-[44px] rounded-xl font-mono text-sm font-bold border tabular-nums ${
                        idx === currentIdx ? 'ring-2 ring-teal-500 ring-offset-2 border-teal-600' : ''
                      } ${
                        doubtful
                          ? 'bg-amber-400 border-amber-500 text-slate-950'
                          : answered
                          ? 'bg-indigo-600 border-indigo-700 text-white'
                          : 'bg-white border-slate-300 text-slate-700'
                      }`}
                    >
                      <span>{idx + 1}</span>
                      {choiceTag && (
                        <span
                          className={`absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center border ${
                            doubtful
                              ? 'bg-slate-900 text-white border-amber-300'
                              : 'bg-white text-indigo-700 border-indigo-600'
                          }`}
                        >
                          {choiceTag}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-between text-xs text-slate-600 pt-2 border-t border-slate-100 tabular-nums">
                <span className="font-semibold text-indigo-700">Dijawab: {statsSummary.answered}</span>
                <span className="font-semibold text-amber-700">Ragu: {statsSummary.doubtful}</span>
                <span>Kosong: {statsSummary.empty}</span>
              </div>
              <button
                type="button"
                onClick={() => { setShowNavigator(false); setShowSubmitModal(true); }}
                className="w-full min-h-[48px] rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-semibold text-sm"
              >
                Selesai &amp; Kumpulkan Ujian
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TKA Submit Confirmation Modal (Bottom sheet on HP) */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white border border-emerald-200 rounded-t-2xl sm:rounded-2xl max-w-md w-full overflow-hidden shadow-2xl">
            <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-blue-600 text-white px-5 py-3.5">
              <h3 className="text-base font-display font-bold">Konfirmasi Tes Selesai</h3>
            </div>
            <div className="p-5 sm:p-6 pb-safe space-y-4">
              <div className="p-4 rounded-xl bg-gradient-to-br from-sky-50 via-indigo-50/70 to-emerald-50 border border-indigo-200 text-sm space-y-1.5">
                <div className="flex justify-between"><span>Total Soal</span><span className="font-mono font-bold tabular-nums">{questions.length}</span></div>
                <div className="flex justify-between"><span>Sudah Dijawab</span><span className="font-mono font-bold text-indigo-700 tabular-nums">{statsSummary.answered}</span></div>
                <div className="flex justify-between"><span>Ditandai Ragu-ragu</span><span className="font-mono font-bold text-amber-700 tabular-nums">{statsSummary.doubtful}</span></div>
                <div className="flex justify-between"><span>Belum Dijawab</span><span className="font-mono font-bold text-rose-700 tabular-nums">{statsSummary.empty}</span></div>
              </div>

              {statsSummary.empty > 0 && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Masih ada {statsSummary.empty} soal kosong. Setelah dikumpulkan, Anda tidak dapat mengubah jawaban lagi.</span>
                </div>
              )}

              {submitError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
                  {submitError}
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSubmitModal(false)}
                  className="w-full sm:w-auto min-h-[46px] px-4 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Kembali Mengerjakan
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleSubmitExam}
                  className="w-full sm:w-auto min-h-[46px] px-5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:opacity-60 text-white text-sm font-semibold"
                >
                  {submitting ? 'Menyinkronkan & Mengumpulkan...' : 'Selesai'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Non-punitive toast (Back button blocked / Brand exception notice) */}
      {nonPunitiveToast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 max-w-md w-[92%] bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl border border-slate-700 flex items-center justify-between gap-3 text-xs">
          <span>{nonPunitiveToast}</span>
          <button
            type="button"
            onClick={() => setNonPunitiveToast(null)}
            className="text-slate-300 hover:text-white font-semibold shrink-0"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Desktop Red Screen + Siren Alert Overlay (Alt+Tab / Minimize / Blur) */}
      {desktopRedAlert && sessionStatus === 'in_progress' && (
        <div className="fixed inset-0 z-50 bg-red-700/95 backdrop-blur-sm flex items-center justify-center p-4 animate-pulse">
          <div className="bg-white border-4 border-red-900 rounded-2xl max-w-md w-full p-6 space-y-4 text-center shadow-2xl">
            <div className="w-14 h-14 rounded-2xl bg-red-100 text-red-700 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-display font-bold text-red-900">PERINGATAN KEAMANAN LAYAR</h2>
            <p className="text-sm text-slate-700 leading-relaxed">{desktopRedAlert.message}</p>
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900 space-y-1 font-mono tabular-nums">
              <p>Poin Pelanggaran Sesi: {violationPoints} / {session.maxViolations}</p>
              <p>Kejadian Tercatat: {violationCount}x (+{desktopRedAlert.pointsAdded} poin)</p>
            </div>
            <button
              type="button"
              onClick={() => {
                desktopSiren.stop();
                setDesktopRedAlert(null);
              }}
              className="w-full min-h-[46px] rounded-xl bg-red-700 hover:bg-red-800 text-white text-sm font-bold inline-flex items-center justify-center gap-2"
            >
              <VolumeX className="w-4 h-4" />
              <span>Matikan Sirene &amp; Kembali ke Ujian</span>
            </button>
          </div>
        </div>
      )}

      {/* Auto-Lock Overlay (Keeps timer running on server, shows Auto-Unlock Countdown & allows Proctor Chat) */}
      {sessionStatus === 'locked' && (
        <div className="fixed inset-0 z-40 bg-slate-900/90 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-rose-200 rounded-2xl max-w-md w-full p-6 space-y-4 text-center shadow-2xl">
            <div className="w-14 h-14 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center mx-auto">
              <Lock className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-display font-bold text-slate-900">Sesi Ujian Terkunci Sementara</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              {lockReason || 'Sistem mengamati perpindahan fokus atau pelanggaran melebihi batas kebijakan ujian.'}
            </p>
            <div className="p-3 rounded-xl bg-rose-50/70 border border-rose-200 text-xs text-slate-700 space-y-1.5">
              <p>Jawaban Anda yang sudah tersimpan tetap aman dan tidak dihapus.</p>
              <p className="font-semibold text-rose-700 tabular-nums">
                Perhatian: Waktu ujian tetap berjalan ({formatTimer(remainingSec)} tersisa).
              </p>
              <p className="font-mono text-slate-600 tabular-nums">
                Kejadian: {violationCount}x · Akumulasi Poin: {violationPoints} / {session.maxViolations}
              </p>
              {lockCountdownSec !== null && (
                <div className="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-950 font-semibold tabular-nums">
                  Kunci terbuka otomatis dalam {formatTimer(lockCountdownSec)}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => { setShowChat(true); setUnreadChat(0); }}
              className="w-full min-h-[48px] rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-sm font-semibold flex items-center justify-center gap-2"
            >
              <MessageSquare className="w-4 h-4" />
              <span>Hubungi Pengawas untuk Membuka Kunci</span>
            </button>
          </div>
        </div>
      )}

      {/* Student-Proctor Chat Drawer (z-50 so accessible even when locked) */}
      {showChat && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex justify-end">
          <div className="bg-white w-full max-w-md h-full flex flex-col border-l border-indigo-200 shadow-2xl">
            <div className="p-4 bg-gradient-to-r from-indigo-700 via-blue-700 to-teal-600 text-white flex items-center justify-between">
              <div>
                <h3 className="font-display font-bold text-sm">Bantuan Pengawas Ujian</h3>
                <p className="text-xs text-sky-100">Pesan hanya diterima oleh admin &amp; pengawas ruang</p>
              </div>
              <button type="button" onClick={() => setShowChat(false)} aria-label="Tutup chat" className="p-2 text-sky-100 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
              {chatMessages.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-8">
                  Belum ada pesan. Sampaikan kendala teknis atau permohonan buka kunci kepada pengawas di sini.
                </p>
              ) : (
                chatMessages.map((m) => {
                  const isMe = m.sender_role === 'siswa';
                  return (
                    <div key={m.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                      <span className="text-[10px] text-slate-500 mb-1">
                        {m.sender_name} · {new Date(m.server_timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <div
                        className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-xs sm:text-sm ${
                          isMe
                            ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-br-sm'
                            : 'bg-white border border-teal-200 text-slate-800 rounded-bl-sm'
                        }`}
                      >
                        {m.message}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <form onSubmit={handleSendChat} className="p-3 border-t border-indigo-100 bg-white flex items-center gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Tulis pesan untuk pengawas..."
                className="flex-1 min-h-[44px] px-3.5 rounded-xl border border-indigo-200 text-sm focus:outline-none focus:border-indigo-600"
              />
              <button
                type="submit"
                aria-label="Kirim pesan"
                className="min-h-[44px] min-w-[44px] px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white flex items-center justify-center"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
