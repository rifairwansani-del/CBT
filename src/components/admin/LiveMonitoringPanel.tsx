import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Eye,
  LockOpen,
  MessageSquare,
  RefreshCw,
  Send,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import { apiFetch, withAuthTokenUrl } from '../../lib/api.ts';
import { StudentAvatar } from '../StudentAvatar.tsx';
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

  // Detail & Chat & Camera Modal
  const [detail, setDetail] = useState<SessionDetailPayload | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessageItem[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [unlockNote, setUnlockNote] = useState('');
  const [actionBanner, setActionBanner] = useState<string | null>(null);

  // Live Camera Inspection (capped on server at max 6 concurrent)
  const [cameraSessionId, setCameraSessionId] = useState<string | null>(null);
  const [cameraStatusMsg, setCameraStatusMsg] = useState<string | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  const loadExams = async () => {
    try {
      const res = await apiFetch<{ exams: typeof exams }>('/api/monitor/exams');
      setExams(res.exams);
      if (!selectedExamId && res.exams[0]) {
        setSelectedExamId(res.exams[0].id);
      }
    } catch (err) {
      setActionBanner(err instanceof Error ? err.message : 'Gagal memuat daftar ujian.');
    }
  };

  const loadParticipants = async (examId: string) => {
    if (!examId) return;
    setLoading(true);
    try {
      const res = await apiFetch<{ stats: typeof stats; participants: ParticipantRow[] }>(`/api/monitor/exams/${examId}/participants`);
      setStats(res.stats);
      setParticipants(res.participants);
    } catch (err) {
      setActionBanner(err instanceof Error ? err.message : 'Gagal memuat peserta ujian.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExams();
  }, []);

  useEffect(() => {
    if (selectedExamId) loadParticipants(selectedExamId);
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
          // Only refresh if batch contains events for selectedExamId
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
      setActionBanner(err instanceof Error ? err.message : 'Gagal memuat detail peserta.');
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

  const handleUnlock = async (markTechnicalIssue: boolean) => {
    if (!detail) return;
    try {
      await apiFetch(`/api/monitor/sessions/${detail.session.id}/unlock`, {
        method: 'POST',
        body: JSON.stringify({ notes: unlockNote, markTechnicalIssue }),
      });
      setActionBanner('Kunci sesi berhasil dibuka kembali.');
      setUnlockNote('');
      const refreshed = await apiFetch<SessionDetailPayload>(`/api/monitor/sessions/${detail.session.id}/detail`);
      setDetail(refreshed);
      loadParticipants(selectedExamId);
    } catch (err) {
      setActionBanner(err instanceof Error ? err.message : 'Gagal membuka kunci.');
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
      setActionBanner(err instanceof Error ? err.message : 'Gagal mengirim pesan.');
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

  const currentExam = exams.find((e) => e.id === selectedExamId);

  return (
    <div className="space-y-6">
      {/* Exam Selector */}
      <div className="bg-white border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex-1">
          <label className="block text-xs font-semibold text-slate-500 mb-1">Ujian yang Dipantau (Real-Time)</label>
          <select
            value={selectedExamId}
            onChange={(e) => setSelectedExamId(e.target.value)}
            className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 bg-white text-base sm:text-sm font-semibold text-slate-900"
          >
            {exams.map((ex) => (
              <option key={ex.id} value={ex.id}>[{ex.exam_type}] {ex.title} — {ex.subject_name}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => loadParticipants(selectedExamId)}
          className="min-h-[44px] px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center justify-center gap-2 sm:self-end"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Segarkan</span>
        </button>
      </div>

      {/* Real-time Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: 'Total Peserta', val: stats.total, key: 'all', color: 'text-slate-900' },
          { label: 'Belum Login', val: stats.notLoggedIn, key: 'not_logged_in', color: 'text-slate-600' },
          { label: 'Sedang Ujian', val: stats.inProgress, key: 'in_progress', color: 'text-blue-900' },
          { label: 'Selesai', val: stats.submitted, key: 'submitted', color: 'text-emerald-700' },
          { label: 'Terkunci', val: stats.locked, key: 'locked', color: 'text-red-700' },
          { label: 'Terputus', val: stats.disconnected, key: 'disconnected', color: 'text-amber-700' },
          { label: 'Ada Indikator', val: stats.withIndicators, key: 'indicators', color: 'text-amber-800' },
        ].map((box) => (
          <button
            key={box.key}
            type="button"
            onClick={() => setStatusFilter(box.key)}
            className={`p-3.5 rounded-2xl border text-left transition-colors ${
              statusFilter === box.key
                ? 'bg-blue-50 border-blue-900'
                : 'bg-white border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:bg-slate-50'
            }`}
          >
            <p className="text-[11px] font-medium text-slate-500">{box.label}</p>
            <p className={`text-2xl font-display font-bold tabular-nums mt-0.5 ${box.color}`}>{box.val}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari nama atau NIS peserta..."
          className="min-h-[42px] px-3 rounded-xl border border-slate-300 bg-white text-base sm:text-sm flex-1 sm:max-w-xs"
        />
        <select
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          className="min-h-[42px] px-3 rounded-xl border border-slate-300 bg-white text-base sm:text-sm"
        >
          <option value="all">Semua Kelas</option>
          {uniqueClasses.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Participants List: Mobile Cards + Desktop Table */}
      <div className="bg-white border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-2xl overflow-hidden">
        {/* Mobile Cards */}
        <div className="md:hidden divide-y divide-slate-100">
          {filteredParticipants.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">Tidak ada peserta yang sesuai filter.</div>
          ) : (
            filteredParticipants.map((p) => (
              <div key={p.studentId} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
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

                {p.sessionId ? (
                  <button
                    type="button"
                    onClick={() => openDetail(p)}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center justify-center gap-1.5"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Periksa Sesi &amp; Chat</span>
                  </button>
                ) : (
                  <p className="text-xs text-slate-400 text-center py-1">Peserta belum memulai sesi ujian</p>
                )}
              </div>
            ))
          )}
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
              <tr>
                <th className="px-4 py-3">Peserta (Foto Resmi)</th>
                <th className="px-4 py-3">Kelas</th>
                <th className="px-4 py-3">Status Sesi</th>
                <th className="px-4 py-3">Terjawab</th>
                <th className="px-4 py-3">Indikator / Kejadian</th>
                <th className="px-4 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredParticipants.map((p) => (
                <tr key={p.studentId} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <StudentAvatar photoUrl={p.photoUrl} fullName={p.fullName} size="sm" />
                      <div>
                        <p className="font-semibold text-slate-900">{p.fullName}</p>
                        <p className="text-xs font-mono text-slate-500">{p.nis}</p>
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
                        {p.violationCount} log fokus · {p.proctoringCount} kamera
                      </span>
                    ) : (
                      <span className="text-slate-400">Normal</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {p.sessionId ? (
                      <button
                        type="button"
                        onClick={() => openDetail(p)}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Periksa &amp; Chat</span>
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">Belum mulai</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Participant Inspection, Unlock, Chat & Live Camera Drawer (Bottom Sheet on Mobile) */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-stretch justify-end">
          <div className="bg-white w-full sm:max-w-2xl h-[92dvh] sm:h-full rounded-t-3xl sm:rounded-none flex flex-col border-t sm:border-t-0 sm:border-l border-slate-200 overflow-hidden pb-safe">
            <div className="w-10 h-1 rounded-full bg-slate-300 mx-auto mt-2.5 sm:hidden" />
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <StudentAvatar photoUrl={detail.session.photoUrl} fullName={detail.session.full_name} size="md" />
                <div className="min-w-0">
                  <h3 className="font-display font-bold text-slate-900 text-base truncate">{detail.session.full_name}</h3>
                  <p className="text-xs font-mono text-slate-500 truncate">
                    NIS {detail.session.nis} · {detail.session.class_name} · {detail.session.status}
                  </p>
                </div>
              </div>
              <button type="button" onClick={closeDetail} className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {actionBanner && (
                <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs font-medium text-blue-900">
                  {actionBanner}
                </div>
              )}

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

              {/* Unlock & Force Actions */}
              {detail.session.status === 'locked' && (
                <section className="p-4 rounded-2xl border border-red-200 bg-red-50 space-y-3">
                  <p className="text-xs font-bold text-red-900">
                    Sesi Terkunci: {detail.session.lock_reason || 'Melebihi batas perpindahan fokus.'}
                  </p>
                  {(user.role === 'admin' || user.canUnlockSessions) ? (
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
                          onClick={() => handleUnlock(false)}
                          className="px-3.5 py-2 rounded-xl bg-blue-900 text-white text-xs font-semibold flex items-center gap-1.5"
                        >
                          <LockOpen className="w-3.5 h-3.5" />
                          <span>Buka Kunci Sesi</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUnlock(true)}
                          className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs font-semibold"
                        >
                          Buka &amp; Tandai Gangguan Teknis
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-red-800">Akun pengawas Anda tidak diberi izin khusus membuka sesi terkunci. Hubungi Admin Utama.</p>
                  )}
                </section>
              )}

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
                              setActionBanner(err instanceof Error ? err.message : 'Gagal memperbarui status tinjauan.');
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
    </div>
  );
};
