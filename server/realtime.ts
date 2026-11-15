import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyToken } from './auth.ts';
import type { AuthContext } from './types.ts';

interface ConnectedClient {
  ws: WebSocket;
  auth: AuthContext;
  sessionId?: string;
  examId?: string;
}

class RealtimeHub {
  private wss: WebSocketServer | null = null;
  private clients = new Set<ConnectedClient>();
  private adminClients = new Set<ConnectedClient>();
  private studentSessions = new Map<string, ConnectedClient>(); // sessionId -> client
  private studentAccounts = new Map<string, Set<ConnectedClient>>(); // studentId -> clients
  private activeCameraStreams = new Map<string, Set<string>>(); // sessionId -> set of admin userIds watching
  private pendingMonitorEvents: Array<Record<string, unknown>> = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly MAX_CONCURRENT_STREAMS = 6;

  attach(server: HttpServer) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      try {
        const url = new URL(req.url || '/', 'http://localhost');
        const token = url.searchParams.get('token') || this.extractCookieToken(req.headers.cookie);
        const auth = verifyToken(token);
        if (!auth) {
          ws.close(4001, 'Unauthorized');
          return;
        }

        const sessionId = url.searchParams.get('sessionId') || undefined;
        const examId = url.searchParams.get('examId') || undefined;
        const client: ConnectedClient = { ws, auth, sessionId, examId };
        this.clients.add(client);

        if (auth.role === 'admin' || auth.role === 'pengawas') {
          this.adminClients.add(client);
          ws.send(JSON.stringify({
            type: 'connected',
            role: auth.role,
            activeStreamCount: this.getTotalActiveStreamCount(),
            maxStreams: this.MAX_CONCURRENT_STREAMS,
          }));
        } else if (auth.role === 'siswa') {
          if (auth.studentId) {
            if (!this.studentAccounts.has(auth.studentId)) {
              this.studentAccounts.set(auth.studentId, new Set());
            }
            this.studentAccounts.get(auth.studentId)!.add(client);
          }
          if (sessionId) {
            this.studentSessions.set(sessionId, client);
            ws.send(JSON.stringify({ type: 'connected', role: 'siswa', sessionId }));
          } else {
            ws.send(JSON.stringify({ type: 'connected', role: 'siswa' }));
          }
        }

        ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString());
            this.handleIncomingMessage(client, msg);
          } catch {
            // ignore malformed JSON
          }
        });

        ws.on('close', () => {
          this.clients.delete(client);
          this.adminClients.delete(client);
          if (client.auth.studentId) {
            const set = this.studentAccounts.get(client.auth.studentId);
            if (set) {
              set.delete(client);
              if (set.size === 0) this.studentAccounts.delete(client.auth.studentId);
            }
          }
          if (client.sessionId && this.studentSessions.get(client.sessionId) === client) {
            this.studentSessions.delete(client.sessionId);
            this.activeCameraStreams.delete(client.sessionId);
            this.queueMonitorUpdate({
              kind: 'student_connection',
              sessionId: client.sessionId,
              connectionStatus: 'offline',
              timestamp: new Date().toISOString(),
            });
          }
          // Clean up any camera streams watched by this admin
          if (client.auth.role === 'admin' || client.auth.role === 'pengawas') {
            for (const [sid, watchers] of this.activeCameraStreams.entries()) {
              if (watchers.delete(client.auth.userId) && watchers.size === 0) {
                this.activeCameraStreams.delete(sid);
                this.sendToStudent(sid, { type: 'camera:stop_stream' });
              }
            }
          }
        });
      } catch {
        ws.close(4000, 'Bad connection');
      }
    });

    // Batch monitor updates every 1.2s to protect DB & clients at 1,300 concurrency
    this.flushTimer = setInterval(() => this.flushMonitorUpdates(), 1200);
  }

  private extractCookieToken(cookieHeader?: string): string | undefined {
    if (!cookieHeader) return undefined;
    const match = cookieHeader.match(/sinarcbt_session=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : undefined;
  }

  private getTotalActiveStreamCount(): number {
    return this.activeCameraStreams.size;
  }

  private handleIncomingMessage(client: ConnectedClient, msg: Record<string, unknown>) {
    const type = String(msg.type || '');

    // WebRTC Camera Signaling (Targeted, Capped at MAX_CONCURRENT_STREAMS)
    if (type === 'camera:request_stream' && (client.auth.role === 'admin' || client.auth.role === 'pengawas')) {
      const targetSessionId = String(msg.sessionId || '');
      if (!targetSessionId) return;

      if (!this.activeCameraStreams.has(targetSessionId) && this.activeCameraStreams.size >= this.MAX_CONCURRENT_STREAMS) {
        client.ws.send(JSON.stringify({
          type: 'camera:error',
          sessionId: targetSessionId,
          message: `Batas maksimal ${this.MAX_CONCURRENT_STREAMS} stream kamera aktif bersamaan tercapai. Tutup stream lain terlebih dahulu.`,
        }));
        return;
      }

      const studentClient = this.studentSessions.get(targetSessionId);
      if (!studentClient || studentClient.ws.readyState !== WebSocket.OPEN) {
        client.ws.send(JSON.stringify({
          type: 'camera:unavailable',
          sessionId: targetSessionId,
          message: 'Siswa sedang offline atau halaman ujian tidak terhubung.',
        }));
        return;
      }

      if (!this.activeCameraStreams.has(targetSessionId)) {
        this.activeCameraStreams.set(targetSessionId, new Set());
      }
      this.activeCameraStreams.get(targetSessionId)!.add(client.auth.userId);

      studentClient.ws.send(JSON.stringify({
        type: 'camera:start_stream',
        requesterId: client.auth.userId,
      }));
      return;
    }

    if (type === 'camera:stop_stream' && (client.auth.role === 'admin' || client.auth.role === 'pengawas')) {
      const targetSessionId = String(msg.sessionId || '');
      const watchers = this.activeCameraStreams.get(targetSessionId);
      if (watchers) {
        watchers.delete(client.auth.userId);
        if (watchers.size === 0) {
          this.activeCameraStreams.delete(targetSessionId);
          this.sendToStudent(targetSessionId, { type: 'camera:stop_stream' });
        }
      }
      return;
    }

    if (type === 'webrtc:offer' && client.auth.role === 'siswa' && client.sessionId) {
      this.broadcastToAdmins({
        type: 'webrtc:offer',
        sessionId: client.sessionId,
        sdp: msg.sdp,
      });
      return;
    }

    if (type === 'webrtc:answer' && (client.auth.role === 'admin' || client.auth.role === 'pengawas')) {
      const targetSessionId = String(msg.sessionId || '');
      this.sendToStudent(targetSessionId, {
        type: 'webrtc:answer',
        requesterId: client.auth.userId,
        sdp: msg.sdp,
      });
      return;
    }

    if (type === 'webrtc:ice') {
      if (client.auth.role === 'siswa' && client.sessionId) {
        this.broadcastToAdmins({
          type: 'webrtc:ice',
          sessionId: client.sessionId,
          candidate: msg.candidate,
        });
      } else if (client.auth.role === 'admin' || client.auth.role === 'pengawas') {
        const targetSessionId = String(msg.sessionId || '');
        this.sendToStudent(targetSessionId, {
          type: 'webrtc:ice',
          candidate: msg.candidate,
        });
      }
      return;
    }

    if (type === 'camera:status' && client.auth.role === 'siswa' && client.sessionId) {
      this.broadcastToAdmins({
        type: 'camera:status',
        sessionId: client.sessionId,
        available: Boolean(msg.available),
        reason: msg.reason ? String(msg.reason) : undefined,
      });
    }
  }

  sendToStudent(sessionId: string, payload: Record<string, unknown>) {
    const client = this.studentSessions.get(sessionId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(payload));
    }
  }

  sendToStudentAccount(studentId: string, payload: Record<string, unknown>) {
    const set = this.studentAccounts.get(studentId);
    if (!set) return;
    const data = JSON.stringify(payload);
    for (const client of set) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  broadcastToStudents(payload: Record<string, unknown>) {
    const data = JSON.stringify(payload);
    for (const clients of this.studentAccounts.values()) {
      for (const client of clients) {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(data);
        }
      }
    }
  }

  broadcastToAdmins(payload: Record<string, unknown>) {
    const data = JSON.stringify(payload);
    for (const admin of this.adminClients) {
      if (admin.ws.readyState === WebSocket.OPEN) {
        admin.ws.send(data);
      }
    }
  }

  queueMonitorUpdate(event: Record<string, unknown>) {
    this.pendingMonitorEvents.push(event);
    // Critical lock/violation/chat alerts are flushed immediately
    if (event.priority === 'high') {
      this.flushMonitorUpdates();
    }
  }

  private flushMonitorUpdates() {
    if (this.pendingMonitorEvents.length === 0) return;
    const batch = this.pendingMonitorEvents.splice(0, 500);
    this.broadcastToAdmins({
      type: 'monitor:batch',
      events: batch,
      serverTime: new Date().toISOString(),
    });
  }

  close() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.wss?.close();
  }
}

export const realtimeHub = new RealtimeHub();
