const AUTH_TOKEN_KEY = 'sinarcbt_auth_token';

export function getAuthToken(): string | null {
  try {
    return sessionStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string) {
  try {
    sessionStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
    // ignore storage quota errors
  }
}

export function clearAuthToken() {
  try {
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function withAuthTokenUrl(url: string): string {
  const token = getAuthToken();
  if (!token) return url;
  if (!url.startsWith('/api/') && !url.startsWith('/ws') && !url.startsWith('ws')) {
    return url;
  }
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

export function getDeviceFingerprint(): string {
  const key = 'sinarcbt_device_fp';
  let fp = localStorage.getItem(key);
  if (!fp) {
    fp = `dev_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    localStorage.setItem(key, fp);
  }
  return fp;
}

export async function apiFetch<T = unknown>(url: string, options: RequestInit = {}): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };
  if (!isFormData && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const token = getAuthToken();
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers,
  });

  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || 'Respons server tidak valid.' };
  }

  if (!res.ok) {
    if (
      res.status === 401 &&
      !url.includes('/api/auth/unified-login') &&
      !url.includes('/api/auth/student-login') &&
      !url.includes('/api/auth/staff-login')
    ) {
      clearAuthToken();
      if (!url.includes('/api/auth/me') && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('sinarcbt:unauthorized'));
      }
    }
    const err = new Error(String(data.error || `Permintaan gagal (${res.status})`)) as Error & { status?: number; code?: string };
    err.status = res.status;
    err.code = data.code ? String(data.code) : undefined;
    throw err;
  }

  return data as T;
}

// Offline resilient local answer queue keyed by sessionId
export interface QueuedAnswerItem {
  questionId: string;
  answer: unknown;
  isDoubtful: boolean;
  clientVersion: number;
  updatedAt: string;
}

export function loadOfflineAnswerQueue(sessionId: string): Record<string, QueuedAnswerItem> {
  try {
    const raw = localStorage.getItem(`sinarcbt_queue_${sessionId}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveOfflineAnswerQueue(sessionId: string, queue: Record<string, QueuedAnswerItem>) {
  try {
    if (Object.keys(queue).length === 0) {
      localStorage.removeItem(`sinarcbt_queue_${sessionId}`);
    } else {
      localStorage.setItem(`sinarcbt_queue_${sessionId}`, JSON.stringify(queue));
    }
  } catch {
    // ignore quota error
  }
}
