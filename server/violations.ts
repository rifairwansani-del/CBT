import crypto from 'node:crypto';
import { db, writeAuditLog } from './db.ts';
import type {
  GadgetBrandException,
  ViolationDeviceScope,
  ViolationPolicySettings,
  ViolationRuleConfig,
  ViolationRuleMode,
} from '../src/types/cbt.ts';

export const DEFAULT_VIOLATION_RULES: ViolationRuleConfig[] = [
  {
    code: 'keluar_aplikasi',
    label: 'Keluar dari aplikasi',
    devices: 'Android',
    description:
      'Berpindah aplikasi, menekan tombol Recent, mematikan layar, atau menerima panggilan telepon. Lama waktu keluar ikut tercatat.',
    enabled: true,
    mode: 'add_points',
    points: 1,
    autoUnlockMinutes: 3,
  },
  {
    code: 'tombol_home',
    label: 'Menekan tombol Home',
    devices: 'Android',
    description:
      'Selalu disertai kejadian Keluar dari aplikasi. Secara bawaan hanya dicatat (0 poin) kecuali diubah oleh admin.',
    enabled: true,
    mode: 'record_only',
    points: 0,
    autoUnlockMinutes: 0,
  },
  {
    code: 'jendela_lain_di_atas_aplikasi',
    label: 'Jendela lain di atas Xambro',
    devices: 'Android',
    description:
      'Menarik panel notifikasi, membuka gelembung chat (chat bubble), atau aplikasi mengambang (floating apps).',
    enabled: true,
    mode: 'add_points',
    points: 1,
    autoUnlockMinutes: 3,
  },
  {
    code: 'layar_terbagi_split_screen',
    label: 'Layar terbagi / mengambang (Split screen)',
    devices: 'Android & Web/iPad',
    description: 'Membuka aplikasi ujian berdampingan atau dalam mode jendela mengambang dengan aplikasi lain.',
    enabled: true,
    mode: 'add_points',
    points: 1,
    autoUnlockMinutes: 3,
  },
  {
    code: 'sematan_layar_dilepas',
    label: 'Sematan layar (Screen pinning) dilepas',
    devices: 'Android',
    description: 'Siswa melepas sematan layar (Screen pinning) selama ujian berlangsung di perangkat Android.',
    enabled: true,
    mode: 'instant_lock',
    points: 2,
    autoUnlockMinutes: 5,
  },
  {
    code: 'login_ulang_tengah_ujian',
    label: 'Login ulang di tengah ujian',
    devices: 'Semua Perangkat',
    description: 'Aplikasi/browser sempat tertutup lalu siswa masuk kembali menggunakan NIS yang sama saat sesi berjalan.',
    enabled: true,
    mode: 'add_points',
    points: 1,
    autoUnlockMinutes: 3,
  },
  {
    code: 'keluar_wifi_ujian',
    label: 'Keluar dari WiFi ujian',
    devices: 'Android & Desktop',
    description:
      'Pindah jaringan WiFi/seluler atau terlepas dari WiFi ujian > 10 detik saat pengaturan WiFi ujian diaktifkan.',
    enabled: true,
    mode: 'add_points',
    points: 1,
    autoUnlockMinutes: 2,
  },
  {
    code: 'kamera_tertutup',
    label: 'Kamera tertutup',
    devices: 'Android',
    description:
      'Lensa kamera depan ditutup; tampilan soal otomatis ditutup sampai kamera terlihat kembali.',
    enabled: true,
    mode: 'add_points',
    points: 1,
    autoUnlockMinutes: 2,
    blockQuestionsUntilResolved: true,
  },
  {
    code: 'perangkat_root_atau_emulator',
    label: 'HP di-root atau menggunakan Emulator',
    devices: 'Android',
    description: 'Perangkat Android terdeteksi dimodifikasi (root) atau berjalan di atas emulator.',
    enabled: true,
    mode: 'instant_lock',
    points: 3,
    autoUnlockMinutes: 0,
  },
  {
    code: 'keluar_jendela_ujian',
    label: 'Keluar dari jendela ujian (Alt+Tab / Minimize)',
    devices: 'Desktop',
    description:
      'Menekan Alt+Tab, mengklik area luar jendela, atau memperkecil jendela. Memunculkan layar merah & suara sirene.',
    enabled: true,
    mode: 'add_points',
    points: 1,
    autoUnlockMinutes: 3,
    triggerSirenRedScreen: true,
  },
  {
    code: 'kamera_mati_atau_dicabut',
    label: 'Kamera mati atau dicabut',
    devices: 'Desktop',
    description: 'Kamera dinonaktifkan atau dicabut saat fitur kamera diwajibkan dalam pengaturan ujian.',
    enabled: true,
    mode: 'add_points',
    points: 2,
    autoUnlockMinutes: 0,
    blockQuestionsUntilResolved: true,
  },
  {
    code: 'keluar_fullscreen',
    label: 'Keluar dari layar penuh (Fullscreen)',
    devices: 'Desktop & Web',
    description: 'Mode layar penuh (Fullscreen) dilepas saat ujian mewajibkan layar penuh.',
    enabled: true,
    mode: 'add_points',
    points: 1,
    autoUnlockMinutes: 2,
  },
  {
    code: 'tutup_atau_refresh_halaman',
    label: 'Menutup atau memuat ulang halaman (Refresh)',
    devices: 'Desktop & Web',
    description: 'Jendela atau tab ujian ditutup maupun dimuat ulang selama pengerjaan berlangsung.',
    enabled: true,
    mode: 'add_points',
    points: 1,
    autoUnlockMinutes: 2,
  },
  {
    code: 'meninggalkan_halaman_ujian',
    label: 'Meninggalkan halaman ujian',
    devices: 'Web',
    description: 'Berpindah aplikasi atau tab pada browser HP, iPhone, maupun iPad selama ujian berlangsung.',
    enabled: true,
    mode: 'add_points',
    points: 1,
    autoUnlockMinutes: 2,
  },
];

export const DEFAULT_BRAND_EXCEPTIONS: GadgetBrandException[] = [
  {
    brand: 'ADVAN',
    excusedEventTypes: ['tombol_home', 'jendela_lain_di_atas_aplikasi', 'layar_terbagi_split_screen'],
    reasonNote: 'pengecualian ADVAN',
    enabled: true,
  },
];

export const DEFAULT_VIOLATION_POLICY: ViolationPolicySettings = {
  rules: DEFAULT_VIOLATION_RULES,
  brandExceptions: DEFAULT_BRAND_EXCEPTIONS,
  wifiDisconnectGraceSeconds: 10,
  blockBackNavigation: true,
};

const VALID_MODES: ViolationRuleMode[] = ['record_only', 'add_points', 'instant_lock'];
const VALID_SCOPES: ViolationDeviceScope[] = [
  'Android',
  'Desktop',
  'Web',
  'Android & Web/iPad',
  'Android & Desktop',
  'Desktop & Web',
  'Semua Perangkat',
];

export function normalizeViolationPolicy(raw: unknown): ViolationPolicySettings {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rawRules = Array.isArray(src.rules) ? (src.rules as Array<Record<string, unknown>>) : [];
  const rawRuleMap = new Map(rawRules.map((r) => [String(r.code || ''), r]));

  const rules: ViolationRuleConfig[] = DEFAULT_VIOLATION_RULES.map((def) => {
    const incoming = rawRuleMap.get(def.code);
    if (!incoming) return { ...def };
    const mode = VALID_MODES.includes(incoming.mode as ViolationRuleMode)
      ? (incoming.mode as ViolationRuleMode)
      : def.mode;
    const devices = VALID_SCOPES.includes(incoming.devices as ViolationDeviceScope)
      ? (incoming.devices as ViolationDeviceScope)
      : def.devices;
    const points =
      mode === 'record_only'
        ? 0
        : Math.max(0, Math.min(10, Number.isFinite(Number(incoming.points)) ? Number(incoming.points) : def.points));
    const autoUnlockMinutes = Math.max(
      0,
      Math.min(120, Number.isFinite(Number(incoming.autoUnlockMinutes)) ? Number(incoming.autoUnlockMinutes) : def.autoUnlockMinutes)
    );
    return {
      code: def.code,
      label: String(incoming.label || def.label).trim().slice(0, 120) || def.label,
      devices,
      description: def.description,
      enabled: incoming.enabled !== false,
      mode,
      points,
      autoUnlockMinutes,
      triggerSirenRedScreen:
        incoming.triggerSirenRedScreen !== undefined
          ? Boolean(incoming.triggerSirenRedScreen)
          : def.triggerSirenRedScreen,
      blockQuestionsUntilResolved:
        incoming.blockQuestionsUntilResolved !== undefined
          ? Boolean(incoming.blockQuestionsUntilResolved)
          : def.blockQuestionsUntilResolved,
    };
  });

  const rawExceptions = Array.isArray(src.brandExceptions)
    ? (src.brandExceptions as Array<Record<string, unknown>>)
    : DEFAULT_BRAND_EXCEPTIONS;

  const brandExceptions: GadgetBrandException[] = rawExceptions
    .map((b) => {
      const brand = String(b.brand || '').trim().toUpperCase().slice(0, 40);
      if (!brand) return null;
      const excusedEventTypes = Array.isArray(b.excusedEventTypes)
        ? b.excusedEventTypes.map((e) => String(e).trim()).filter(Boolean)
        : [];
      return {
        brand,
        excusedEventTypes,
        reasonNote: String(b.reasonNote || `pengecualian ${brand}`).trim().slice(0, 120) || `pengecualian ${brand}`,
        enabled: b.enabled !== false,
      };
    })
    .filter((b): b is GadgetBrandException => Boolean(b));

  return {
    rules,
    brandExceptions: brandExceptions.length > 0 ? brandExceptions : [],
    wifiDisconnectGraceSeconds: Math.max(
      5,
      Math.min(60, Number(src.wifiDisconnectGraceSeconds ?? 10) || 10)
    ),
    blockBackNavigation: src.blockBackNavigation !== false,
  };
}

export function detectDeviceBrandFromUserAgent(ua: string, explicitBrand?: unknown): string {
  const cleanExplicit = String(explicitBrand || '').trim().toUpperCase();
  if (cleanExplicit && cleanExplicit !== 'UNKNOWN' && cleanExplicit !== 'BROWSER') {
    return cleanExplicit.slice(0, 40);
  }
  const source = String(ua || '');
  const matchers: Array<[RegExp, string]> = [
    [/\bADVAN\b|G9|Tab\s?Sketsa|NASA\s?Plus|VX\s?Lite/i, 'ADVAN'],
    [/\bSAMSUNG\b|SM-[A-Z0-9]+/i, 'SAMSUNG'],
    [/\bXIAOMI\b|Redmi|POCO|M20\d+|220\d+|230\d+/i, 'XIAOMI'],
    [/\bOPPO\b|CPH\d+/i, 'OPPO'],
    [/\bvivo\b/i, 'VIVO'],
    [/\brealme\b|RMX\d+/i, 'REALME'],
    [/\bInfinix\b/i, 'INFINIX'],
    [/\bTECNO\b/i, 'TECNO'],
    [/\bLENOVO\b|TB-[A-Z0-9]+/i, 'LENOVO'],
    [/\bASUS\b/i, 'ASUS'],
    [/iPad/i, 'APPLE_IPAD'],
    [/iPhone/i, 'APPLE_IPHONE'],
    [/Macintosh/i, 'APPLE_MAC'],
  ];
  for (const [regex, brand] of matchers) {
    if (regex.test(source)) return brand;
  }
  return '';
}

export function evaluateViolationAgainstPolicy(params: {
  policy: ViolationPolicySettings;
  eventType: string;
  deviceBrand: string;
  autoLockEnabled: boolean;
  currentPoints: number;
  maxViolationPoints: number;
  durationSeconds?: number | null;
}) {
  const { policy, eventType, deviceBrand, autoLockEnabled, currentPoints, maxViolationPoints } = params;
  const rule = policy.rules.find((r) => r.code === eventType);

  if (rule && !rule.enabled) {
    return {
      ignored: true,
      rule,
      isExcused: false,
      excuseReason: '',
      pointsAdded: 0,
      nextPoints: currentPoints,
      willLock: false,
      lockedUntil: null as string | null,
      lockReason: null as string | null,
      autoUnlockMinutes: 0,
    };
  }

  // Check gadget brand exception (e.g. ADVAN tablet floating Home button)
  const upperBrand = deviceBrand.trim().toUpperCase();
  const matchedException = upperBrand
    ? policy.brandExceptions.find(
        (ex) =>
          ex.enabled &&
          (upperBrand === ex.brand || upperBrand.includes(ex.brand)) &&
          (ex.excusedEventTypes.length === 0 || ex.excusedEventTypes.includes(eventType))
      )
    : undefined;

  if (matchedException) {
    const label = rule?.label || eventType;
    return {
      ignored: false,
      rule,
      isExcused: true,
      excuseReason: `${label} dimaafkan (${matchedException.reasonNote})`,
      pointsAdded: 0,
      nextPoints: currentPoints,
      willLock: false,
      lockedUntil: null as string | null,
      lockReason: null as string | null,
      autoUnlockMinutes: 0,
    };
  }

  const mode: ViolationRuleMode = rule?.mode || 'add_points';
  const pointsAdded = mode === 'record_only' ? 0 : Math.max(0, rule?.points ?? 1);
  const nextPoints = currentPoints + pointsAdded;
  const autoUnlockMinutes = Math.max(0, rule?.autoUnlockMinutes ?? 0);

  const willLock =
    Boolean(autoLockEnabled) &&
    (mode === 'instant_lock' || (mode === 'add_points' && pointsAdded > 0 && nextPoints >= maxViolationPoints));

  const lockedUntil =
    willLock && autoUnlockMinutes > 0
      ? new Date(Date.now() + autoUnlockMinutes * 60 * 1000).toISOString()
      : null;

  const eventLabel = rule?.label || eventType;
  const durationSuffix =
    typeof params.durationSeconds === 'number' && params.durationSeconds > 0
      ? ` selama ${params.durationSeconds} detik`
      : '';
  const unlockSuffix =
    lockedUntil && autoUnlockMinutes > 0
      ? ` Kunci akan terbuka otomatis dalam ${autoUnlockMinutes} menit.`
      : ' Hubungi pengawas ruang untuk membuka kunci.';

  const lockReason = willLock
    ? `Sesi dikunci otomatis (${eventLabel}${durationSuffix}; total ${nextPoints}/${maxViolationPoints} poin).${unlockSuffix}`
    : null;

  return {
    ignored: false,
    rule,
    isExcused: false,
    excuseReason: '',
    pointsAdded,
    nextPoints,
    willLock,
    lockedUntil,
    lockReason,
    autoUnlockMinutes,
  };
}

export function checkAndApplyAutoUnlockForSession(sessionId: string): {
  unlocked: boolean;
  unlockNotes?: string;
} {
  const sess = db
    .prepare(
      `SELECT id, exam_id, student_id, status, locked_until, locked_by_event_type
       FROM exam_sessions
       WHERE id = ?`
    )
    .get(sessionId) as
    | {
        id: string;
        exam_id: string;
        student_id: string;
        status: string;
        locked_until: string | null;
        locked_by_event_type: string | null;
      }
    | undefined;

  if (!sess || sess.status !== 'locked' || !sess.locked_until) {
    return { unlocked: false };
  }

  const unlockAtMs = new Date(sess.locked_until).getTime();
  if (Number.isNaN(unlockAtMs) || Date.now() < unlockAtMs) {
    return { unlocked: false };
  }

  const nowIso = new Date().toISOString();
  const unlockNote = `Kunci terbuka otomatis sesuai durasi aturan (${sess.locked_by_event_type || 'kebijakan sistem'}).`;

  db.prepare(`
    UPDATE exam_sessions
    SET status = 'in_progress',
        lock_reason = NULL,
        locked_until = NULL,
        locked_by_event_type = NULL,
        unlocked_by = 'SYSTEM_AUTO_UNLOCK',
        unlocked_at = ?,
        unlock_notes = ?
    WHERE id = ? AND status = 'locked'
  `).run(nowIso, unlockNote, sessionId);

  db.prepare(`
    INSERT INTO violation_logs (
      id, session_id, exam_id, student_id, event_type, details_json,
      device_type, device_brand, points_added, is_excused, excuse_reason,
      occurrence_number, triggered_lock, admin_action, admin_id, action_notes, server_timestamp
    )
    VALUES (?, ?, ?, ?, 'pembukaan_kunci_otomatis', ?, 'system', '', 0, 0, '', 0, 0, 'AUTO_UNLOCK', 'SYSTEM', ?, ?)
  `).run(
    crypto.randomUUID(),
    sess.id,
    sess.exam_id,
    sess.student_id,
    JSON.stringify({ previousEventType: sess.locked_by_event_type, scheduledUnlockAt: sess.locked_until }),
    unlockNote,
    nowIso
  );

  writeAuditLog({
    actorId: 'SYSTEM',
    actorRole: 'system',
    actorName: 'Auto-Unlock Sistem',
    action: 'AUTO_UNLOCK_EXAM_SESSION',
    targetType: 'exam_session',
    targetId: sess.id,
    details: { unlockNote, eventType: sess.locked_by_event_type },
  });

  return { unlocked: true, unlockNotes: unlockNote };
}
