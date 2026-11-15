import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Clock,
  Eye,
  Lock,
  LockOpen,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Send,
  StopCircle,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import { apiFetch, withAuthTokenUrl } from '../../lib/api.ts';
import { StudentAvatar } from '../StudentAvatar.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import type { AuthUser, ChatMessageItem } from '../../types/cbt.ts';

interface ParticipantRow {
  studentId: string;
  nis: string;
  nisn: string;
  fullName: string;
  classId: string;
  className: string;
  photoUrl: string | null;
  sessionId: string | null;
  status: string;
  rawStatus: string;
  violationCount: number;
  proctoringCount: number;
  answeredCount: number;
  finalScore: number | null;
  lockReason: string | null;
  lastHeartbeatAt: string | null;
}

interface SessionDetailPayload {
  session: Record<string, unknown> & {
    id: string;
    exam_id: string;
    student_id: string;
    full_name: string;
    nis: string;
    class_name: string;
    photoUrl: string | null;
    status: string;
    lock_reason: string | null;
    violation_count: number;
    server_end_at: string;
  };
  violations: Array<{
    id: string;
    event_type: string;
    occurrence_number: number;
    triggered_lock: number;
    admin_action: string | null;
    action_notes: string | null;
    server_timestamp: string;
  }>;
  proctoring: Array<{
    id: string;
    indicator_type: string;
    confidence: number;
    note: string;
    review_status: string;
    server_timestamp: string;
  }>;
}

export const LiveMonitoringPanel: React.FC<{ user: AuthUser }> = ({ user }) => {
  const [exams, setExams] = useState<Array<{ id: string; title: string; exam_type: string; subject_name: string; allow_camera_stream: number }>>([]);
  const [selectedExamId, setSelectedExamId] = useState('');
  const [stats, setStats] = useState({ total: 0, notLoggedIn: 0, inProgress: 0, submitted: 0, locked: 0, disconnected: 0, withIndicators: 0 });
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [classFilter, setClassFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  // Selection for bulk monitoring & messaging
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);

  // Detail & Chat & Camera Modal
  const [detail, setDetail] = useState<SessionDetailPayload | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessageItem[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [unlockNote, setUnlockNote] = useState('');
  const [actionBanner, setActionBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  // Action Modals (Lock, Reset, Extend Time, Send Message/Kesan)
  const [lockModal, setLockModal] = useState<{
    targetLabel: string;
    sessionIds: string[];
    reason: string;
  } | null>(null);

  const [resetModal, setResetModal] = useState<{
    targetLabel: string;
    sessionIds: string[];
    mode: 'violations' | 'full_session';
    notes: string;
  } | null>(null);

  const [extendModal, setExtendModal] = useState<{
    targetLabel: string;
    sessionIds: string[];
    extraMinutes: number;
  } | null>(null);

  const [messageModal, setMessageModal] = useState<{
    scope: 'exam' | 'selected';
    studentIds: string[];
    targetLabel: string;
    category: 'pesan' | 'pengumuman' | 'peringatan' | 'instruksi' | 'kesan';
    title: string;
    message: string;
  } | null>(null);

  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    action: () => Promise<void>;
  } | null>(null);

  // Live Camera Inspection (capped on server at max 6 concurrent)
  const [cameraSessionId, setCameraSessionId] = useState<string | null>(null);
  const [cameraStatusMsg, setCameraStatusMsg] = useState<string | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  const canUnlockOrReset = user.role === 'admin' || Boolean(user.canUnlockSessions);

  const loadExams = async () => {
    try {
      const res = await apiFetch<{ exams?: typeof exams }>('/api/monitor/exams');
      const nextExams = Array.isArray(res?.exams) ? res.exams : [];
      setExams(nextExams);
      if (!selectedExamId && nextExams[0]) {
        setSelectedExamId(nextExams[0].id);
      }
    } catch (err) {
      setActionBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal memuat daftar ujian.' });
    }
  };

  const loadParticipants = async (examId: string) => {
    if (!examId) return;
    setLoading(true);
    try {
      const res = await apiFetch<{ stats?: typeof stats; participants?: ParticipantRow[] }>(`/api/monitor/exams/${examId}/participants`);
      const nextParticipants = Array.isArray(res?.participants) ? res.participants : [];
      if (res?.stats) setStats(res.stats);
      setParticipants(nextParticipants);
      setSelectedStudentIds((prev) => prev.filter((id) => nextParticipants.some((p) => p.studentId === id)));
    } catch (err) {
      setActionBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal memuat peserta ujian.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExams();
  }, []);

  useEffect(() => {
    if (selectedExamId) {
      setSelectedStudentIds([]);
      loadParticipants(selectedExamId);
    }
  }, [selectedExamId]);

  // Real-time WebSocket listener for throttled monitor updates, chat, & WebRTC camera signaling
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(withAuthTokenUrl(`${proto}//${window.location.host}/ws`));
    wsRef.current = ws;

    ws.onmessage = async (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'monitor:batch' && selectedExamId) {
          const relevant = (msg.events as Array<{ examId?: string }>).some((e) => e.examId === selectedExamId);
          if (relevant) {
            loadParticipants(selectedExamId);
          }
        } else if (msg.type === 'chat:new' && msg.message) {
          if (detail && msg.message.recipient_student_id === detail.session.student_id) {
            setChatMessages((prev) => (prev.some((m) => m.id === msg.message.id) ? prev : [...prev, msg.message]));
          }
        } else if (msg.type === 'camera:error' || msg.type === 'camera:unavailable' || (msg.type === 'camera:status' && !msg.available)) {
          setCameraStatusMsg(msg.message || msg.reason || 'Kamera tidak tersedia pada perangkat siswa.');
        } else if (msg.type === 'webrtc:offer' && msg.sdp && cameraSessionId === msg.sessionId) {
          const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
          pcRef.current = pc;
          pc.ontrack = (e) => {
            if (remoteVideoRef.current && e.streams[0]) {
              remoteVideoRef.current.srcObject = e.streams[0];
              setCameraStatusMsg(null);
            }
          };
          pc.onicecandidate = (e) => {
            if (e.candidate && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'webrtc:ice', sessionId: msg.sessionId, candidate: e.candidate }));
            }
          };
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          ws.send(JSON.stringify({ type: 'webrtc:answer', sessionId: msg.sessionId, sdp: answer }));
        } else if (msg.type === 'webrtc:ice' && pcRef.current && msg.candidate && cameraSessionId === msg.sessionId) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate));
        }
      } catch {
        // ignore parse/WebRTC error
      }
    };

    return () => {
      pcRef.current?.close();
      ws.close();
    };
  }, [selectedExamId, detail, cameraSessionId]);

  const refreshDetailIfOpen = async (sessionId: string) => {
    if (!detail || detail.session.id !== sessionId) return;
    try {
      const refreshed = await apiFetch<SessionDetailPayload>(`/api/monitor/sessions/${sessionId}/detail`);
      setDetail(refreshed);
    } catch {
      setDetail(null);
    }
  };

  const openDetail = async (p: ParticipantRow) => {
    setActionBanner(null);
    if (!p.sessionId) return;
    try {
      const [dRes, cRes] = await Promise.all([
        apiFetch<SessionDetailPayload>(`/api/monitor/sessions/${p.sessionId}/detail`),
        apiFetch<{ messages: ChatMessageItem[] }>(`/api/chat/${selectedExamId}/${p.studentId}`),
      ]);
      setDetail(dRes);
      setChatMessages(cRes.messages);
    } catch (err) {
      setActionBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal memuat detail peserta.' });
    }
  };

  const closeDetail = () => {
    if (cameraSessionId) {
      wsRef.current?.send(JSON.stringify({ type: 'camera:stop_stream', sessionId: cameraSessionId }));
      pcRef.current?.close();
      pcRef.current = null;
      setCameraSessionId(null);
      setCameraStatusMsg(null);
    }
    setDetail(null);
  };

  const requestCameraStream = (sessionId: string) => {
    setCameraSessionId(sessionId);
    setCameraStatusMsg('Menghubungi perangkat peserta (stream dibatasi maksimal 6 kamera bersamaan)...');
    wsRef.current?.send(JSON.stringify({ type: 'camera:request_stream', sessionId }));
  };

  const stopCameraStream = () => {
    if (cameraSessionId) {
      wsRef.current?.send(JSON.stringify({ type: 'camera:stop_stream', sessionId: cameraSessionId }));
    }
    pcRef.current?.close();
    pcRef.current = null;
    setCameraSessionId(null);
    setCameraStatusMsg(null);
  };

  const handleUnlockSingle = async (sessionId: string, markTechnicalIssue: boolean, customNote?: string) => {
    setBusyAction(true);
    try {
      await apiFetch(`/api/monitor/sessions/${sessionId}/unlock`, {
        method: 'POST',
        body: JSON.stringify({ notes: customNote ?? unlockNote, markTechnicalIssue }),
      });
      setActionBanner({ type: 'ok', text: 'Kunci sesi berhasil dibuka kembali.' });
      setUnlockNote('');
      await refreshDetailIfOpen(sessionId);
      await loadParticipants(selectedExamId);
    } catch (err) {
      setActionBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal membuka kunci.' });
    } finally {
      setBusyAction(false);
    }
  };

  const handleSubmitLockModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lockModal || lockModal.sessionIds.length === 0) return;
    setBusyAction(true);
    try {
      if (lockModal.sessionIds.length === 1) {
        await apiFetch(`/api/monitor/sessions/${lockModal.sessionIds[0]}/lock`, {
          method: 'POST',
          body: JSON.stringify({ reason: lockModal.reason.trim() || undefined }),
        });
        setActionBanner({ type: 'ok', text: `Sesi ${lockModal.targetLabel} berhasil dikunci.` });
        await refreshDetailIfOpen(lockModal.sessionIds[0]);
      } else {
        const res = await apiFetch<{ affectedCount: number }>(`/api/monitor/exams/${selectedExamId}/bulk-action`, {
          method: 'POST',
          body: JSON.stringify({
            action: 'lock',
            sessionIds: lockModal.sessionIds,
            notes: lockModal.reason.trim() || undefined,
          }),
        });
        setActionBanner({ type: 'ok', text: `${res.affectedCount} sesi peserta berhasil dikunci.` });
      }
      setLockModal(null);
      await loadParticipants(selectedExamId);
    } catch (err) {
      setActionBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal mengunci sesi.' });
    } finally {
      setBusyAction(false);
    }
  };

  const handleSubmitResetModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetModal || resetModal.sessionIds.length === 0) return;
    setBusyAction(true);
    try {
      if (resetModal.sessionIds.length === 1) {
        const sid = resetModal.sessionIds[0];
        await apiFetch(`/api/monitor/sessions/${sid}/reset`, {
          method: 'POST',
          body: JSON.stringify({ mode: resetModal.mode, notes: resetModal.notes.trim() || undefined }),
        });
        setActionBanner({
          type: 'ok',
          text:
            resetModal.mode === 'full_session'
              ? `Sesi ujian ${resetModal.targetLabel} direset dari awal.`
              : `Pelanggaran & kunci sesi ${resetModal.targetLabel} berhasil direset.`,
        });
        if (resetModal.mode === 'full_session' && detail?.session.id === sid) {
          closeDetail();
        } else {
          await refreshDetailIfOpen(sid);
        }
      } else {
        const res = await apiFetch<{ affectedCount: number }>(`/api/monitor/exams/${selectedExamId}/bulk-action`, {
          method: 'POST',
          body: JSON.stringify({
            action: resetModal.mode === 'full_session' ? 'reset_session' : 'reset_violations',
            sessionIds: resetModal.sessionIds,
            notes: resetModal.notes.trim() || undefined,
          }),
        });
        setActionBanner({
          type: 'ok',
          text:
            resetModal.mode === 'full_session'
              ? `${res.affectedCount} sesi ujian direset dari awal.`
              : `${res.affectedCount} sesi berhasil direset pelanggaran & kuncinya.`,
        });
      }
      setResetModal(null);
      await loadParticipants(selectedExamId);
    } catch (err) {
      setActionBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal mereset sesi.' });
    } finally {
      setBusyAction(false);
    }
  };

  const handleSubmitExtendModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extendModal || extendModal.sessionIds.length === 0) return;
    setBusyAction(true);
    try {
      if (extendModal.sessionIds.length === 1) {
        const sid = extendModal.sessionIds[0];
        await apiFetch(`/api/monitor/sessions/${sid}/extend-time`, {
          method: 'POST',
          body: JSON.stringify({ extraMinutes: extendModal.extraMinutes }),
        });
        setActionBanner({ type: 'ok', text: `Waktu ujian ${extendModal.targetLabel} ditambah ${extendModal.extraMinutes} menit.` });
        await refreshDetailIfOpen(sid);
      } else {
        const res = await apiFetch<{ affectedCount: number }>(`/api/monitor/exams/${selectedExamId}/bulk-action`, {
          method: 'POST',
          body: JSON.stringify({
            action: 'extend_time',
            sessionIds: extendModal.sessionIds,
            extraMinutes: extendModal.extraMinutes,
          }),
        });
        setActionBanner({ type: 'ok', text: `Waktu ujian ditambah ${extendModal.extraMinutes} menit untuk ${res.affectedCount} sesi.` });
      }
      setExtendModal(null);
      await loadParticipants(selectedExamId);
    } catch (err) {
      setActionBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal menambah waktu ujian.' });
    } finally {
      setBusyAction(false);
    }
  };

  const handleSendDirectMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageModal || !messageModal.message.trim()) return;
    setBusyAction(true);
    try {
      const res = await apiFetch<{ sentCount: number }>('/api/admin/messages/send', {
        method: 'POST',
        body: JSON.stringify({
          scope: messageModal.scope,
          examId: selectedExamId || undefined,
          studentIds: messageModal.scope === 'selected' ? messageModal.studentIds : undefined,
          category: messageModal.category,
          title: messageModal.title.trim() || undefined,
          message: messageModal.message.trim(),
        }),
      });
      setActionBanner({ type: 'ok', text: `Pesan berhasil dikirim ke ${res.sentCount} peserta.` });
      setMessageModal(null);
      if (detail) {
        const cRes = await apiFetch<{ messages: ChatMessageItem[] }>(`/api/chat/${detail.session.exam_id}/${detail.session.student_id}`).catch(() => null);
        if (cRes) setChatMessages(cRes.messages);
      }
    } catch (err) {
      setActionBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal mengirim pesan ke peserta.' });
    } finally {
      setBusyAction(false);
    }
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !chatInput.trim()) return;
    try {
      const res = await apiFetch<{ message: ChatMessageItem }>(`/api/chat/${detail.session.exam_id}/${detail.session.student_id}`, {
        method: 'POST',
        body: JSON.stringify({ message: chatInput.trim(), sessionId: detail.session.id }),
      });
      setChatInput('');
      setChatMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
    } catch (err) {
      setActionBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal mengirim pesan.' });
    }
  };

  const uniqueClasses = Array.from(new Set(participants.map((p) => p.className)));
  const filteredParticipants = participants.filter((p) => {
    const matchStatus =
      statusFilter === 'all' ||
      (statusFilter === 'indicators' ? p.violationCount > 0 || p.proctoringCount > 0 : p.status === statusFilter);
    const matchClass = classFilter === 'all' || p.className === classFilter;
    const q = search.trim().toLowerCase();
    const matchQ = !q || p.fullName.toLowerCase().includes(q) || p.nis.includes(q);
    return matchStatus && matchClass && matchQ;
  });

  const allVisibleSelected =
    filteredParticipants.length > 0 && filteredParticipants.every((p) => selectedStudentIds.includes(p.studentId));
  const toggleAllVisible = (checked: boolean) => {
    const visibleIds = filteredParticipants.map((p) => p.studentId);
    if (checked) {
      setSelectedStudentIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    } else {
      setSelectedStudentIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    }
  };

  const selectedRows = participants.filter((p) => selectedStudentIds.includes(p.studentId));
  const selectedSessionIds = selectedRows.map((p) => p.sessionId).filter(Boolean) as string[];
  const selectedActiveSessionIds = selectedRows
    .filter((p) => p.sessionId && (p.rawStatus === 'in_progress' || p.status === 'disconnected'))
    .map((p) => p.sessionId!) as string[];
  const selectedLockedSessionIds = selectedRows
    .filter((p) => p.sessionId && p.rawStatus === 'locked')
    .map((p) => p.sessionId!) as string[];
  const selectedOpenSessionIds = selectedRows
    .filter((p) => p.sessionId && p.rawStatus !== 'submitted' && p.rawStatus !== 'expired')
    .map((p) => p.sessionId!) as string[];

  const currentExam = exams.find((e) => e.id === selectedExamId);

  return (
    <div className="space-y-5">
      {/* Exam Selector + Broadcast Message Button */}
      <div className="bg-white border border-indigo-100 shadow-sm rounded-2xl p-4 flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div className="flex-1 min-w-0">
          <label className="block text-xs font-bold text-emerald-700 mb-1">Ujian yang Dipantau (Real-Time)</label>
          <select
            value={selectedExamId}
            onChange={(e) => setSelectedExamId(e.target.value)}
            className="w-full min-h-[44px] px-3 rounded-xl border border-indigo-200 bg-indigo-50/20 text-base sm:text-sm font-semibold text-slate-900 focus:outline-none focus:border-indigo-600"
          >
            {exams.map((ex) => (
              <option key={ex.id} value={ex.id}>[{ex.exam_type}] {ex.title} — {ex.subject_name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={!selectedExamId || participants.length === 0}
            onClick={() =>
              setMessageModal({
                scope: selectedStudentIds.length > 0 ? 'selected' : 'exam',
                studentIds: selectedStudentIds,
                targetLabel:
                  selectedStudentIds.length > 0
                    ? `${selectedStudentIds.length} peserta terpilih`
                    : `Semua peserta ujian (${participants.length})`,
                category: 'pesan',
                title: '',
                message: '',
              })
            }
            className="min-h-[44px] px-4 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap shadow-xs"
          >
            <MessageSquare className="w-4 h-4 shrink-0" />
            <span>Kirim Pesan / Kesan</span>
          </button>
          <button
            type="button"
            onClick={() => loadParticipants(selectedExamId)}
            className="min-h-[44px] px-4 rounded-xl border border-teal-200 bg-teal-50/60 hover:bg-teal-100 text-xs font-semibold text-teal-900 flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Segarkan</span>
          </button>
        </div>
      </div>

      {actionBanner && !detail && (
        <div
          className={`p-3.5 rounded-xl border text-xs sm:text-sm flex items-center justify-between gap-3 ${
            actionBanner.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <span>{actionBanner.text}</span>
          <button type="button" onClick={() => setActionBanner(null)} className="text-xs font-semibold underline shrink-0">
            Tutup
          </button>
        </div>
      )}

      {/* Color-Coded Real-time Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          {
            label: 'Total Peserta',
            val: stats.total,
            key: 'all',
            idleBox: 'bg-indigo-50/80 border-indigo-200 hover:bg-indigo-100/70',
            activeBox: 'bg-gradient-to-br from-indigo-600 to-blue-600 border-indigo-700 text-white shadow-sm',
            idleLabel: 'text-indigo-700',
            idleVal: 'text-indigo-950',
          },
          {
            label: 'Belum Login',
            val: stats.notLoggedIn,
            key: 'not_logged_in',
            idleBox: 'bg-slate-50 border-slate-200 hover:bg-slate-100',
            activeBox: 'bg-slate-700 border-slate-800 text-white shadow-sm',
            idleLabel: 'text-slate-600',
            idleVal: 'text-slate-800',
          },
          {
            label: 'Sedang Ujian',
            val: stats.inProgress,
            key: 'in_progress',
            idleBox: 'bg-sky-50/85 border-sky-200 hover:bg-sky-100/70',
            activeBox: 'bg-gradient-to-br from-sky-600 to-cyan-600 border-sky-700 text-white shadow-sm',
            idleLabel: 'text-sky-700',
            idleVal: 'text-sky-950',
          },
          {
            label: 'Selesai',
            val: stats.submitted,
            key: 'submitted',
            idleBox: 'bg-emerald-50/85 border-emerald-200 hover:bg-emerald-100/70',
            activeBox: 'bg-gradient-to-br from-emerald-600 to-teal-600 border-emerald-700 text-white shadow-sm',
            idleLabel: 'text-emerald-700',
            idleVal: 'text-emerald-950',
          },
          {
            label: 'Terkunci',
            val: stats.locked,
            key: 'locked',
            idleBox: 'bg-rose-50/85 border-rose-200 hover:bg-rose-100/70',
            activeBox: 'bg-gradient-to-br from-rose-600 to-red-600 border-rose-700 text-white shadow-sm',
            idleLabel: 'text-rose-700',
            idleVal: 'text-rose-950',
          },
          {
            label: 'Terputus',
            val: stats.disconnected,
            key: 'disconnected',
            idleBox: 'bg-amber-50/85 border-amber-200 hover:bg-amber-100/70',
            activeBox: 'bg-gradient-to-br from-amber-500 to-orange-600 border-amber-600 text-white shadow-sm',
            idleLabel: 'text-amber-800',
            idleVal: 'text-amber-950',
          },
          {
            label: 'Ada Indikator',
            val: stats.withIndicators,
            key: 'indicators',
            idleBox: 'bg-violet-50/85 border-violet-200 hover:bg-violet-100/70',
            activeBox: 'bg-gradient-to-br from-violet-600 to-purple-600 border-violet-700 text-white shadow-sm',
            idleLabel: 'text-violet-700',
            idleVal: 'text-violet-950',
          },
        ].map((box) => {
          const isActiveFilter = statusFilter === box.key;
          return (
            <button
              key={box.key}
              type="button"
              onClick={() => setStatusFilter(box.key)}
              className={`p-3.5 rounded-2xl border text-left transition-all ${
                isActiveFilter ? box.activeBox : box.idleBox
              }`}
            >
              <p className={`text-[11px] font-semibold ${isActiveFilter ? 'text-white/90' : box.idleLabel}`}>
                {box.label}
              </p>
              <p className={`text-2xl font-display font-bold tabular-nums mt-0.5 ${isActiveFilter ? 'text-white' : box.idleVal}`}>
                {box.val}
              </p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari nama atau NIS peserta..."
          className="min-h-[42px] px-3 rounded-xl border border-indigo-200 bg-white text-base sm:text-sm flex-1 sm:max-w-xs focus:outline-none focus:border-indigo-500"
        />
        <select
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          className="min-h-[42px] px-3 rounded-xl border border-indigo-200 bg-white text-base sm:text-sm focus:outline-none focus:border-indigo-500"
        >
          <option value="all">Semua Kelas</option>
          {uniqueClasses.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Bulk Action Bar for Selected Participants */}
      {selectedStudentIds.length > 0 && (
        <div className="bg-gradient-to-r from-indigo-50 via-sky-50 to-violet-50 border border-indigo-200 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs sm:text-sm font-semibold text-indigo-950 tabular-nums">
            {selectedStudentIds.length} peserta dipilih
            <span className="text-indigo-700 font-normal ml-2">
              ({selectedSessionIds.length} memiliki sesi ujian)
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={selectedActiveSessionIds.length === 0}
              onClick={() =>
                setLockModal({
                  targetLabel: `${selectedActiveSessionIds.length} sesi aktif terpilih`,
                  sessionIds: selectedActiveSessionIds,
                  reason: '',
                })
              }
              className="min-h-[38px] px-3 py-1.5 rounded-xl bg-amber-100 border border-amber-300 hover:bg-amber-200 disabled:opacity-45 text-xs font-semibold text-amber-950 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Kunci ({selectedActiveSessionIds.length})</span>
            </button>
            {canUnlockOrReset && (
              <button
                type="button"
                disabled={selectedLockedSessionIds.length === 0 || busyAction}
                onClick={async () => {
                  setBusyAction(true);
                  try {
                    const res = await apiFetch<{ affectedCount: number }>(`/api/monitor/exams/${selectedExamId}/bulk-action`, {
                      method: 'POST',
                      body: JSON.stringify({ action: 'unlock', sessionIds: selectedLockedSessionIds }),
                    });
                    setActionBanner({ type: 'ok', text: `${res.affectedCount} sesi terkunci berhasil dibuka.` });
                    await loadParticipants(selectedExamId);
                  } catch (err) {
                    setActionBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal membuka kunci massal.' });
                  } finally {
                    setBusyAction(false);
                  }
                }}
                className="min-h-[38px] px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-45 text-xs font-semibold text-white inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <LockOpen className="w-3.5 h-3.5" />
                <span>Buka Kunci ({selectedLockedSessionIds.length})</span>
              </button>
            )}
            {canUnlockOrReset && (
              <button
                type="button"
                disabled={selectedSessionIds.length === 0}
                onClick={() =>
                  setResetModal({
                    targetLabel: `${selectedSessionIds.length} sesi terpilih`,
                    sessionIds: selectedSessionIds,
                    mode: 'violations',
                    notes: '',
                  })
                }
                className="min-h-[38px] px-3 py-1.5 rounded-xl bg-indigo-100 border border-indigo-300 hover:bg-indigo-200 disabled:opacity-45 text-xs font-semibold text-indigo-950 inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset ({selectedSessionIds.length})</span>
              </button>
            )}
            <button
              type="button"
              disabled={selectedOpenSessionIds.length === 0}
              onClick={() =>
                setExtendModal({
                  targetLabel: `${selectedOpenSessionIds.length} sesi berlangsung`,
                  sessionIds: selectedOpenSessionIds,
                  extraMinutes: 10,
                })
              }
              className="min-h-[38px] px-3 py-1.5 rounded-xl bg-cyan-100 border border-cyan-300 hover:bg-cyan-200 disabled:opacity-45 text-xs font-semibold text-cyan-950 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>+Waktu</span>
            </button>
            <button
              type="button"
              disabled={selectedOpenSessionIds.length === 0}
              onClick={() =>
                setConfirmState({
                  title: 'Paksa Kumpulkan Sesi Terpilih',
                  message: `Selesaikan dan nilai langsung ${selectedOpenSessionIds.length} sesi yang sedang aktif/terkunci?`,
                  confirmLabel: `Kumpulkan ${selectedOpenSessionIds.length} Sesi`,
                  action: async () => {
                    const res = await apiFetch<{ affectedCount: number }>(`/api/monitor/exams/${selectedExamId}/bulk-action`, {
                      method: 'POST',
                      body: JSON.stringify({ action: 'force_submit', sessionIds: selectedOpenSessionIds }),
                    });
                    setActionBanner({ type: 'ok', text: `${res.affectedCount} sesi dikumpulkan & dinilai.` });
                    await loadParticipants(selectedExamId);
                  },
                })
              }
              className="min-h-[38px] px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-45 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <StopCircle className="w-3.5 h-3.5" />
              <span>Paksa Kumpulkan</span>
            </button>
            <button
              type="button"
              onClick={() =>
                setMessageModal({
                  scope: 'selected',
                  studentIds: selectedStudentIds,
                  targetLabel: `${selectedStudentIds.length} peserta terpilih`,
                  category: 'pesan',
                  title: '',
                  message: '',
                })
              }
              className="min-h-[38px] px-3 py-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Kirim Pesan</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedStudentIds([])}
              className="min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 whitespace-nowrap"
            >
              Batal Pilih
            </button>
          </div>
        </div>
      )}

      {/* Participants List: Mobile Cards + Desktop Table */}
      <div className="bg-white border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-2xl overflow-hidden">
        {/* Mobile Cards */}
        <div className="md:hidden divide-y divide-slate-100">
          {filteredParticipants.length > 0 && (
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={(e) => toggleAllVisible(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-900"
                />
                <span>Pilih Semua ({filteredParticipants.length})</span>
              </label>
            </div>
          )}
          {filteredParticipants.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">Tidak ada peserta yang sesuai filter.</div>
          ) : (
            filteredParticipants.map((p) => {
              const isChecked = selectedStudentIds.includes(p.studentId);
              const isActive = p.rawStatus === 'in_progress';
              const isLocked = p.rawStatus === 'locked';
              const isFinished = p.rawStatus === 'submitted' || p.rawStatus === 'expired';
              return (
                <div key={p.studentId} className={`p-4 space-y-3 ${isChecked ? 'bg-blue-50/40' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        aria-label={`Pilih ${p.fullName}`}
                        checked={isChecked}
                        onChange={(e) => {
                          setSelectedStudentIds((prev) =>
                            e.target.checked ? [...prev, p.studentId] : prev.filter((id) => id !== p.studentId)
                          );
                        }}
                        className="w-4 h-4 rounded border-slate-300 text-blue-900 shrink-0"
                      />
                      <StudentAvatar photoUrl={p.photoUrl} fullName={p.fullName} size="sm" />
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-slate-900 truncate">{p.fullName}</p>
                        <p className="text-xs font-mono text-slate-500 tabular-nums">{p.nis} · {p.className}</p>
                      </div>
                    </div>
                    <span className="text-xs font-semibold shrink-0">
                      {p.status === 'not_logged_in' && <span className="text-slate-500">Belum Login</span>}
                      {p.status === 'in_progress' && <span className="text-blue-900">Sedang Ujian</span>}
                      {p.status === 'locked' && <span className="text-red-700">Terkunci</span>}
                      {p.status === 'disconnected' && <span className="text-amber-700">Terputus</span>}
                      {(p.status === 'submitted' || p.status === 'expired') && <span className="text-emerald-700">Selesai</span>}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-600 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200/60 tabular-nums">
                    <span>Terjawab: <strong className="font-mono text-slate-900">{p.answeredCount} butir</strong></span>
                    <span>
                      {p.violationCount > 0 || p.proctoringCount > 0 ? (
                        <strong className="text-amber-800">{p.violationCount} log · {p.proctoringCount} kamera</strong>
                      ) : (
                        <span className="text-slate-400">Normal</span>
                      )}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {p.sessionId && (
                      <button
                        type="button"
                        onClick={() => openDetail(p)}
                        className="min-h-[40px] px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center justify-center gap-1.5"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Periksa</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setMessageModal({
                          scope: 'selected',
                          studentIds: [p.studentId],
                          targetLabel: `${p.fullName} (${p.nis})`,
                          category: 'pesan',
                          title: '',
                          message: '',
                        })
                      }
                      className="min-h-[40px] px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-[#0e539a] inline-flex items-center justify-center gap-1.5"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>Pesan</span>
                    </button>
                    {p.sessionId && isActive && (
                      <button
                        type="button"
                        onClick={() =>
                          setLockModal({
                            targetLabel: p.fullName,
                            sessionIds: [p.sessionId!],
                            reason: '',
                          })
                        }
                        className="min-h-[40px] px-3 rounded-xl border border-amber-300 bg-amber-50/70 text-xs font-semibold text-amber-900 inline-flex items-center justify-center gap-1.5"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        <span>Kunci</span>
                      </button>
                    )}
                    {p.sessionId && isLocked && canUnlockOrReset && (
                      <button
                        type="button"
                        onClick={() => handleUnlockSingle(p.sessionId!, false, 'Dibuka langsung dari panel monitoring')}
                        className="min-h-[40px] px-3 rounded-xl bg-blue-900 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                      >
                        <LockOpen className="w-3.5 h-3.5" />
                        <span>Buka Kunci</span>
                      </button>
                    )}
                    {p.sessionId && canUnlockOrReset && (
                      <button
                        type="button"
                        onClick={() =>
                          setResetModal({
                            targetLabel: p.fullName,
                            sessionIds: [p.sessionId!],
                            mode: isFinished ? 'full_session' : 'violations',
                            notes: '',
                          })
                        }
                        className="min-h-[40px] px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center justify-center gap-1.5"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Reset</span>
                      </button>
                    )}
                    {p.sessionId && !isFinished && (
                      <button
                        type="button"
                        onClick={() =>
                          setExtendModal({
                            targetLabel: p.fullName,
                            sessionIds: [p.sessionId!],
                            extraMinutes: 10,
                          })
                        }
                        className="min-h-[40px] px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center justify-center gap-1.5"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        <span>+Waktu</span>
                      </button>
                    )}
                  </div>
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
                <th className="pl-4 pr-2 py-3 w-10">
                  <input
                    type="checkbox"
                    aria-label="Pilih semua peserta tampil"
                    checked={allVisibleSelected}
                    onChange={(e) => toggleAllVisible(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-900"
                  />
                </th>
                <th className="px-4 py-3">Peserta (Foto Resmi)</th>
                <th className="px-4 py-3">Kelas</th>
                <th className="px-4 py-3">Status Sesi</th>
                <th className="px-4 py-3">Terjawab</th>
                <th className="px-4 py-3">Indikator / Kejadian</th>
                <th className="px-4 py-3 text-right">Aksi Admin / Pengawas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredParticipants.map((p) => {
                const isChecked = selectedStudentIds.includes(p.studentId);
                const isActive = p.rawStatus === 'in_progress';
                const isLocked = p.rawStatus === 'locked';
                const isFinished = p.rawStatus === 'submitted' || p.rawStatus === 'expired';
                return (
                  <tr key={p.studentId} className={`hover:bg-slate-50/70 ${isChecked ? 'bg-blue-50/40' : ''}`}>
                    <td className="pl-4 pr-2 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Pilih ${p.fullName}`}
                        checked={isChecked}
                        onChange={(e) => {
                          setSelectedStudentIds((prev) =>
                            e.target.checked ? [...prev, p.studentId] : prev.filter((id) => id !== p.studentId)
                          );
                        }}
                        className="w-4 h-4 rounded border-slate-300 text-blue-900"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <StudentAvatar photoUrl={p.photoUrl} fullName={p.fullName} size="sm" />
                        <div>
                          <p className="font-semibold text-slate-900">{p.fullName}</p>
                          <p className="text-xs font-mono text-slate-500 tabular-nums">{p.nis}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700 font-medium">{p.className}</td>
                    <td className="px-4 py-3 text-xs font-semibold">
                      {p.status === 'not_logged_in' && <span className="text-slate-500">Belum Login</span>}
                      {p.status === 'in_progress' && <span className="text-blue-900">Sedang Ujian</span>}
                      {p.status === 'locked' && <span className="text-red-700">Terkunci</span>}
                      {p.status === 'disconnected' && <span className="text-amber-700">Koneksi Terputus</span>}
                      {(p.status === 'submitted' || p.status === 'expired') && <span className="text-emerald-700">Selesai</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">{p.answeredCount} butir</td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">
                      {p.violationCount > 0 || p.proctoringCount > 0 ? (
                        <span className="text-amber-800 font-semibold">
                          {p.violationCount} log · {p.proctoringCount} kamera
                        </span>
                      ) : (
                        <span className="text-slate-400">Normal</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap">
                        {p.sessionId && isActive && (
                          <button
                            type="button"
                            onClick={() =>
                              setLockModal({
                                targetLabel: p.fullName,
                                sessionIds: [p.sessionId!],
                                reason: '',
                              })
                            }
                            className="px-2.5 py-1.5 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-xs font-semibold text-amber-900 inline-flex items-center gap-1"
                            title="Kunci sementara sesi peserta"
                          >
                            <Lock className="w-3.5 h-3.5" />
                            <span>Kunci</span>
                          </button>
                        )}
                        {p.sessionId && isLocked && canUnlockOrReset && (
                          <button
                            type="button"
                            onClick={() => handleUnlockSingle(p.sessionId!, false, 'Dibuka langsung dari panel monitoring')}
                            className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1"
                            title="Buka kunci sesi"
                          >
                            <LockOpen className="w-3.5 h-3.5" />
                            <span>Buka Kunci</span>
                          </button>
                        )}
                        {p.sessionId && canUnlockOrReset && (
                          <button
                            type="button"
                            onClick={() =>
                              setResetModal({
                                targetLabel: p.fullName,
                                sessionIds: [p.sessionId!],
                                mode: isFinished ? 'full_session' : 'violations',
                                notes: '',
                              })
                            }
                            className="px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100 text-xs font-semibold text-indigo-900 inline-flex items-center gap-1"
                            title="Reset pelanggaran atau ulang sesi dari awal"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Reset</span>
                          </button>
                        )}
                        {p.sessionId && !isFinished && (
                          <button
                            type="button"
                            onClick={() =>
                              setExtendModal({
                                targetLabel: p.fullName,
                                sessionIds: [p.sessionId!],
                                extraMinutes: 10,
                              })
                            }
                            className="px-2.5 py-1.5 rounded-lg border border-cyan-200 bg-cyan-50/70 hover:bg-cyan-100 text-xs font-semibold text-cyan-900 inline-flex items-center gap-1"
                            title="Tambah alokasi waktu ujian"
                          >
                            <Clock className="w-3.5 h-3.5" />
                            <span>+Waktu</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setMessageModal({
                              scope: 'selected',
                              studentIds: [p.studentId],
                              targetLabel: `${p.fullName} (${p.nis})`,
                              category: 'pesan',
                              title: '',
                              message: '',
                            })
                          }
                          className="px-2.5 py-1.5 rounded-lg border border-violet-200 bg-violet-50/70 hover:bg-violet-100 text-xs font-semibold text-violet-900 inline-flex items-center gap-1"
                          title="Kirim pesan atau kesan ke peserta"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>Pesan</span>
                        </button>
                        {p.sessionId && (
                          <button
                            type="button"
                            onClick={() => openDetail(p)}
                            className="px-2.5 py-1.5 rounded-lg border border-sky-200 bg-sky-50/70 hover:bg-sky-100 text-xs font-semibold text-sky-900 inline-flex items-center gap-1"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Periksa</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Participant Inspection, Lock/Unlock/Reset/Time, Chat & Live Camera Drawer */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-stretch justify-end">
          <div className="bg-white w-full sm:max-w-2xl h-[92dvh] sm:h-full rounded-t-3xl sm:rounded-none flex flex-col border-t sm:border-t-0 sm:border-l border-slate-200 overflow-hidden pb-safe">
            <div className="w-10 h-1 rounded-full bg-slate-300 mx-auto mt-2.5 sm:hidden" />
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <StudentAvatar photoUrl={detail.session.photoUrl} fullName={detail.session.full_name} size="md" />
                <div className="min-w-0">
                  <h3 className="font-display font-bold text-slate-900 text-base truncate">{detail.session.full_name}</h3>
                  <p className="text-xs font-mono text-slate-500 truncate tabular-nums">
                    NIS {detail.session.nis} · {detail.session.class_name} · {detail.session.status} · {detail.session.violation_count || 0} log
                  </p>
                </div>
              </div>
              <button type="button" onClick={closeDetail} className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {actionBanner && (
                <div
                  className={`p-3 rounded-xl border text-xs font-medium ${
                    actionBanner.type === 'ok'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-red-50 border-red-200 text-red-900'
                  }`}
                >
                  {actionBanner.text}
                </div>
              )}

              {/* Session Control Actions (Lock, Unlock, Reset, Extend Time, Force Submit, Message) */}
              <section className="p-4 rounded-2xl border border-slate-200 bg-white space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-display font-bold text-slate-900">Tindakan Admin &amp; Pengawas pada Sesi Ini</h4>
                  <span className="text-xs font-mono text-slate-500 tabular-nums">
                    Batas akhir: {new Date(detail.session.server_end_at).toLocaleTimeString('id-ID')}
                  </span>
                </div>

                {detail.session.status === 'locked' && (
                  <div className="p-3 rounded-xl border border-red-200 bg-red-50 space-y-2.5">
                    <p className="text-xs font-bold text-red-900">
                      Sesi Terkunci: {detail.session.lock_reason || 'Melebihi batas perpindahan fokus.'}
                    </p>
                    {canUnlockOrReset ? (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={unlockNote}
                          onChange={(e) => setUnlockNote(e.target.value)}
                          placeholder="Catatan pembukaan kunci / klarifikasi gangguan teknis..."
                          className="w-full px-3 py-2 rounded-xl border border-red-200 bg-white text-xs"
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busyAction}
                            onClick={() => handleUnlockSingle(detail.session.id, false)}
                            className="min-h-[38px] px-3.5 py-2 rounded-xl bg-blue-900 text-white text-xs font-semibold flex items-center gap-1.5"
                          >
                            <LockOpen className="w-3.5 h-3.5" />
                            <span>Buka Kunci Sesi</span>
                          </button>
                          <button
                            type="button"
                            disabled={busyAction}
                            onClick={() => handleUnlockSingle(detail.session.id, true)}
                            className="min-h-[38px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs font-semibold"
                          >
                            Buka &amp; Tandai Gangguan Teknis
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-red-800">Akun pengawas Anda tidak diberi izin khusus membuka sesi terkunci. Hubungi Admin Utama.</p>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {detail.session.status !== 'locked' && detail.session.status !== 'submitted' && detail.session.status !== 'expired' && (
                    <button
                      type="button"
                      onClick={() =>
                        setLockModal({
                          targetLabel: detail.session.full_name,
                          sessionIds: [detail.session.id],
                          reason: '',
                        })
                      }
                      className="min-h-[38px] px-3 py-1.5 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-xs font-semibold text-amber-900 inline-flex items-center gap-1.5"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Kunci Sesi</span>
                    </button>
                  )}

                  {canUnlockOrReset && (
                    <button
                      type="button"
                      onClick={() =>
                        setResetModal({
                          targetLabel: detail.session.full_name,
                          sessionIds: [detail.session.id],
                          mode: detail.session.status === 'submitted' || detail.session.status === 'expired' ? 'full_session' : 'violations',
                          notes: '',
                        })
                      }
                      className="min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reset Sesi / Pelanggaran</span>
                    </button>
                  )}

                  {detail.session.status !== 'submitted' && detail.session.status !== 'expired' && (
                    <button
                      type="button"
                      onClick={() =>
                        setExtendModal({
                          targetLabel: detail.session.full_name,
                          sessionIds: [detail.session.id],
                          extraMinutes: 10,
                        })
                      }
                      className="min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5"
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>Tambah Waktu (+Menit)</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      setMessageModal({
                        scope: 'selected',
                        studentIds: [detail.session.student_id],
                        targetLabel: `${detail.session.full_name} (${detail.session.nis})`,
                        category: 'pesan',
                        title: '',
                        message: '',
                      })
                    }
                    className="min-h-[38px] px-3 py-1.5 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 text-xs font-semibold text-[#0e539a] inline-flex items-center gap-1.5"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Kirim Pesan / Kesan</span>
                  </button>

                  {detail.session.status !== 'submitted' && detail.session.status !== 'expired' && (
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmState({
                          title: 'Paksa Kumpulkan Ujian',
                          message: `Akhiri paksa sesi ujian ${detail.session.full_name} sekarang dan hitung nilainya?`,
                          confirmLabel: 'Ya, Paksa Kumpulkan',
                          action: async () => {
                            await apiFetch(`/api/monitor/sessions/${detail.session.id}/force-submit`, { method: 'POST' });
                            setActionBanner({ type: 'ok', text: `Sesi ${detail.session.full_name} berhasil dikumpulkan paksa.` });
                            await refreshDetailIfOpen(detail.session.id);
                            await loadParticipants(selectedExamId);
                          },
                        })
                      }
                      className="min-h-[38px] px-3 py-1.5 rounded-xl bg-red-700 hover:bg-red-800 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                    >
                      <StopCircle className="w-3.5 h-3.5" />
                      <span>Paksa Kumpulkan</span>
                    </button>
                  )}
                </div>
              </section>

              {/* Live Camera Inspection vs Official Reference Photo */}
              <section className="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-display font-bold text-slate-900 flex items-center gap-1.5">
                      <Camera className="w-4 h-4 text-blue-900" />
                      <span>Pemeriksaan Kamera Terpilih &amp; Foto Referensi Resmi</span>
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Foto resmi sebagai referensi visual. Indikator kamera tidak pernah dijadikan tuduhan kecurangan otomatis.
                    </p>
                  </div>
                  {currentExam?.allow_camera_stream ? (
                    cameraSessionId ? (
                      <button
                        type="button"
                        onClick={stopCameraStream}
                        className="px-3 py-1.5 rounded-lg bg-red-700 text-white text-xs font-semibold flex items-center gap-1.5"
                      >
                        <VideoOff className="w-3.5 h-3.5" />
                        <span>Tutup Stream</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => requestCameraStream(detail.session.id)}
                        className="px-3 py-1.5 rounded-lg bg-blue-900 text-white text-xs font-semibold flex items-center gap-1.5"
                      >
                        <Video className="w-3.5 h-3.5" />
                        <span>Lihat Kamera Langsung</span>
                      </button>
                    )
                  ) : (
                    <span className="text-xs text-slate-400">Live kamera nonaktif pada ujian ini</span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white border border-slate-200 rounded-xl p-2 text-center">
                    <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Foto Profil Resmi</p>
                    <div className="flex justify-center">
                      <StudentAvatar photoUrl={detail.session.photoUrl} fullName={detail.session.full_name} size="xl" />
                    </div>
                  </div>
                  <div className="bg-slate-900 rounded-xl p-2 text-center flex flex-col justify-between min-h-[140px]">
                    <p className="text-[11px] font-semibold text-slate-300">Kamera Langsung Peserta</p>
                    {cameraSessionId ? (
                      <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-28 object-cover rounded-lg mt-1" />
                    ) : (
                      <p className="text-xs text-slate-400 my-auto px-2">Klik "Lihat Kamera Langsung" untuk meminta stream peserta ini.</p>
                    )}
                    {cameraStatusMsg && <p className="text-[11px] text-amber-300 mt-1">{cameraStatusMsg}</p>}
                  </div>
                </div>
              </section>

              {/* Observed Violation Logs */}
              <section className="space-y-2">
                <h4 className="text-sm font-display font-bold text-slate-900">Catatan Kejadian Browser Teramati ({detail.violations.length})</h4>
                {detail.violations.length === 0 ? (
                  <p className="text-xs text-slate-500">Belum ada kejadian teramati.</p>
                ) : (
                  <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 text-xs">
                    {detail.violations.map((v) => (
                      <div key={v.id} className="p-3 flex justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-800">{v.event_type}</p>
                          {v.action_notes && <p className="text-slate-500 mt-0.5">Catatan: {v.action_notes}</p>}
                        </div>
                        <span className="font-mono text-slate-500 shrink-0 tabular-nums">
                          {new Date(v.server_timestamp).toLocaleTimeString('id-ID')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* AI Proctoring Indicators */}
              <section className="space-y-2">
                <h4 className="text-sm font-display font-bold text-slate-900">Indikator Peninjauan Kamera ({detail.proctoring.length})</h4>
                {detail.proctoring.length === 0 ? (
                  <p className="text-xs text-slate-500">Tidak ada indikator kamera.</p>
                ) : (
                  <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 text-xs">
                    {detail.proctoring.map((pe) => (
                      <div key={pe.id} className="p-3 flex items-center justify-between gap-2">
                        <div>
                          <p className="font-semibold text-amber-900 flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>{pe.indicator_type}</span>
                          </p>
                          <p className="text-slate-600 mt-0.5">{pe.note}</p>
                        </div>
                        <select
                          value={pe.review_status}
                          onChange={async (e) => {
                            try {
                              await apiFetch(`/api/monitor/proctoring/${pe.id}/review`, {
                                method: 'POST',
                                body: JSON.stringify({ reviewStatus: e.target.value }),
                              });
                              const refreshed = await apiFetch<SessionDetailPayload>(`/api/monitor/sessions/${detail.session.id}/detail`);
                              setDetail(refreshed);
                            } catch (err) {
                              setActionBanner({ type: 'err', text: err instanceof Error ? err.message : 'Gagal memperbarui status tinjauan.' });
                            }
                          }}
                          className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-[11px]"
                        >
                          <option value="unreviewed">Belum Ditinjau</option>
                          <option value="cleared">Wajar / Abaikan</option>
                          <option value="confirmed_technical">Kendala Teknis</option>
                          <option value="noted_for_review">Perlu Perhatian</option>
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Live Chat with Student */}
              <section className="border border-slate-200 rounded-2xl overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2 text-xs font-bold text-slate-800">
                  <MessageSquare className="w-4 h-4 text-blue-900" />
                  <span>Chat Bantuan dengan Peserta</span>
                </div>
                <div className="p-3 space-y-2 max-h-48 overflow-y-auto bg-white">
                  {chatMessages.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4">Belum ada riwayat chat.</p>
                  ) : (
                    chatMessages.map((m) => (
                      <div key={m.id} className={`text-xs flex flex-col ${m.sender_role !== 'siswa' ? 'items-end' : 'items-start'}`}>
                        <span className="text-[10px] text-slate-400">{m.sender_name}</span>
                        <div className={`px-3 py-1.5 rounded-xl max-w-[85%] ${
                          m.sender_role !== 'siswa' ? 'bg-blue-900 text-white' : 'bg-slate-100 text-slate-800'
                        }`}>
                          {m.message}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <form onSubmit={handleSendChat} className="p-2.5 border-t border-slate-200 bg-slate-50 flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Balas pesan peserta..."
                    className="flex-1 min-h-[42px] px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-base sm:text-xs"
                  />
                  <button type="submit" className="min-h-[42px] px-3.5 py-1.5 rounded-xl bg-blue-900 text-white text-xs font-semibold flex items-center gap-1">
                    <Send className="w-3.5 h-3.5" />
                    <span>Kirim</span>
                  </button>
                </form>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Lock Session */}
      {lockModal && (
        <div className="fixed inset-0 z-[60] bg-slate-900/55 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form onSubmit={handleSubmitLockModal} className="bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl max-w-md w-full p-5 sm:p-6 pb-safe space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base sm:text-lg font-display font-bold text-slate-900">Kunci Sesi Peserta</h3>
              <button type="button" onClick={() => setLockModal(null)} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Tutup</button>
            </div>
            <p className="text-xs sm:text-sm text-slate-600">
              Sasaran: <strong className="text-slate-900">{lockModal.targetLabel}</strong>. Layar pengerjaan soal peserta akan langsung terkunci sampai dibuka kembali oleh admin/pengawas.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Alasan Penguncian (Opsional)</label>
              <input
                type="text"
                value={lockModal.reason}
                onChange={(e) => setLockModal({ ...lockModal, reason: e.target.value })}
                placeholder="Contoh: Verifikasi identitas atau pelanggaran tata tertib ruang"
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm"
              />
            </div>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
              <button type="button" onClick={() => setLockModal(null)} className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-sm font-medium">Batal</button>
              <button type="submit" disabled={busyAction} className="min-h-[44px] px-5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-sm font-semibold disabled:opacity-50">
                {busyAction ? 'Mengunci...' : 'Kunci Sekarang'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Reset Session / Violations */}
      {resetModal && (
        <div className="fixed inset-0 z-[60] bg-slate-900/55 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form onSubmit={handleSubmitResetModal} className="bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl max-w-lg w-full p-5 sm:p-6 pb-safe space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base sm:text-lg font-display font-bold text-slate-900">Reset Sesi Ujian</h3>
              <button type="button" onClick={() => setResetModal(null)} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Tutup</button>
            </div>
            <p className="text-xs sm:text-sm text-slate-600">
              Sasaran: <strong className="text-slate-900">{resetModal.targetLabel}</strong>
            </p>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setResetModal({ ...resetModal, mode: 'violations' })}
                className={`w-full p-3.5 rounded-xl border text-left transition-colors ${
                  resetModal.mode === 'violations' ? 'bg-blue-50 border-[#0e539a]' : 'bg-white border-slate-200 hover:bg-slate-50'
                }`}
              >
                <p className="text-xs sm:text-sm font-semibold text-slate-900">Reset Pelanggaran &amp; Buka Kunci (Pertahankan Jawaban)</p>
                <p className="text-xs text-slate-500 mt-0.5">Menghitung ulang jumlah pelanggaran menjadi 0 dan membuka kunci sesi bila waktu masih tersedia.</p>
              </button>
              <button
                type="button"
                onClick={() => setResetModal({ ...resetModal, mode: 'full_session' })}
                className={`w-full p-3.5 rounded-xl border text-left transition-colors ${
                  resetModal.mode === 'full_session' ? 'bg-red-50 border-red-700' : 'bg-white border-slate-200 hover:bg-slate-50'
                }`}
              >
                <p className="text-xs sm:text-sm font-semibold text-red-900">Reset Ujian dari Awal (Hapus Sesi &amp; Nilai)</p>
                <p className="text-xs text-red-700 mt-0.5">Menghapus sesi, jawaban, dan skor ujian ini agar peserta dapat mengulang tes dari awal.</p>
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Catatan Audit (Opsional)</label>
              <input
                type="text"
                value={resetModal.notes}
                onChange={(e) => setResetModal({ ...resetModal, notes: e.target.value })}
                placeholder="Contoh: Kendala jaringan / peserta diizinkan mengulang"
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm"
              />
            </div>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
              <button type="button" onClick={() => setResetModal(null)} className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-sm font-medium">Batal</button>
              <button
                type="submit"
                disabled={busyAction}
                className={`min-h-[44px] px-5 rounded-xl text-white text-sm font-semibold disabled:opacity-50 ${
                  resetModal.mode === 'full_session' ? 'bg-red-700 hover:bg-red-800' : 'bg-[#0e539a] hover:bg-[#0b437e]'
                }`}
              >
                {busyAction ? 'Memproses...' : resetModal.mode === 'full_session' ? 'Reset Ujian dari Awal' : 'Reset Pelanggaran'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Extend Time (+Minutes) */}
      {extendModal && (
        <div className="fixed inset-0 z-[60] bg-slate-900/55 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form onSubmit={handleSubmitExtendModal} className="bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl max-w-md w-full p-5 sm:p-6 pb-safe space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base sm:text-lg font-display font-bold text-slate-900">Tambah Waktu Ujian</h3>
              <button type="button" onClick={() => setExtendModal(null)} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Tutup</button>
            </div>
            <p className="text-xs sm:text-sm text-slate-600">
              Sasaran: <strong className="text-slate-900">{extendModal.targetLabel}</strong>
            </p>
            <div className="flex flex-wrap gap-2">
              {[5, 10, 15, 30].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setExtendModal({ ...extendModal, extraMinutes: m })}
                  className={`min-h-[40px] px-3.5 rounded-xl border text-xs font-semibold tabular-nums ${
                    extendModal.extraMinutes === m ? 'bg-blue-50 border-[#0e539a] text-[#0e539a]' : 'bg-white border-slate-200 text-slate-700'
                  }`}
                >
                  +{m} Menit
                </button>
              ))}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Tambahan Menit (1–180)</label>
              <input
                type="number"
                min={1}
                max={180}
                required
                value={extendModal.extraMinutes}
                onChange={(e) => setExtendModal({ ...extendModal, extraMinutes: Number(e.target.value) })}
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono tabular-nums"
              />
            </div>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
              <button type="button" onClick={() => setExtendModal(null)} className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-sm font-medium">Batal</button>
              <button type="submit" disabled={busyAction} className="min-h-[44px] px-5 rounded-xl bg-[#0e539a] hover:bg-[#0b437e] text-white text-sm font-semibold disabled:opacity-50">
                {busyAction ? 'Menambah...' : `Tambah +${extendModal.extraMinutes} Menit`}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Send Message / Kesan to Students */}
      {messageModal && (
        <div className="fixed inset-0 z-[60] bg-slate-900/55 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form onSubmit={handleSendDirectMessage} className="bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl max-w-lg w-full p-5 sm:p-6 pb-safe space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base sm:text-lg font-display font-bold text-slate-900">Kirim Pesan &amp; Kesan ke Peserta</h3>
              <button type="button" onClick={() => setMessageModal(null)} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Tutup</button>
            </div>
            <p className="text-xs sm:text-sm text-slate-600">
              Tujuan: <strong className="text-slate-900">{messageModal.targetLabel}</strong>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Kategori</label>
                <select
                  value={messageModal.category}
                  onChange={(e) => setMessageModal({ ...messageModal, category: e.target.value as 'pesan' | 'pengumuman' | 'peringatan' | 'instruksi' | 'kesan' })}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm"
                >
                  <option value="pengumuman">Pengumuman Penting</option>
                  <option value="pesan">Pesan / Informasi</option>
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
                  value={messageModal.title}
                  onChange={(e) => setMessageModal({ ...messageModal, title: e.target.value })}
                  placeholder="Contoh: Info Waktu Ujian"
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
                value={messageModal.message}
                onChange={(e) => setMessageModal({ ...messageModal, message: e.target.value })}
                placeholder="Tulis pesan, instruksi, teguran, atau kesan untuk peserta..."
                className="w-full p-3 rounded-xl border border-slate-300 text-sm"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Pesan langsung tampil di dasbor peserta dan ruang ujian secara real-time.
              </p>
            </div>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
              <button type="button" onClick={() => setMessageModal(null)} className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-sm font-medium">Batal</button>
              <button type="submit" disabled={busyAction || !messageModal.message.trim()} className="min-h-[44px] px-5 rounded-xl bg-[#0e539a] hover:bg-[#0b437e] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50">
                <Send className="w-4 h-4" />
                <span>{busyAction ? 'Mengirim...' : 'Kirim Sekarang'}</span>
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
        busy={busyAction}
        onCancel={() => setConfirmState(null)}
        onConfirm={async () => {
          if (!confirmState) return;
          setBusyAction(true);
          try {
            await confirmState.action();
            setConfirmState(null);
          } catch (err) {
            setActionBanner({ type: 'err', text: err instanceof Error ? err.message : 'Operasi gagal.' });
            setConfirmState(null);
          } finally {
            setBusyAction(false);
          }
        }}
      />
    </div>
  );
};
