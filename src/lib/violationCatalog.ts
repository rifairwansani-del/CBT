import type { GadgetBrandException, ViolationPolicySettings, ViolationRuleConfig } from '../types/cbt.ts';

export const VIOLATION_LABELS: Record<string, string> = {
  keluar_aplikasi: 'Keluar dari aplikasi',
  tombol_home: 'Menekan tombol Home',
  jendela_lain_di_atas_aplikasi: 'Jendela lain di atas Xambro',
  layar_terbagi_split_screen: 'Layar terbagi / mengambang (Split screen)',
  sematan_layar_dilepas: 'Sematan layar (Screen pinning) dilepas',
  login_ulang_tengah_ujian: 'Login ulang di tengah ujian',
  keluar_wifi_ujian: 'Keluar dari WiFi ujian',
  kamera_tertutup: 'Kamera tertutup',
  perangkat_root_atau_emulator: 'HP di-root atau menggunakan Emulator',
  keluar_jendela_ujian: 'Keluar dari jendela ujian',
  kamera_mati_atau_dicabut: 'Kamera mati atau dicabut',
  keluar_fullscreen: 'Keluar dari layar penuh (Fullscreen)',
  tutup_atau_refresh_halaman: 'Menutup atau memuat ulang halaman (Refresh)',
  meninggalkan_halaman_ujian: 'Meninggalkan halaman ujian',
  sesi_ganda_terdeteksi: 'Akses sesi ganda pada perangkat lain',
  perpindahan_tab_atau_halaman_tersembunyi: 'Meninggalkan halaman ujian',
  kehilangan_fokus_jendela: 'Keluar dari jendela ujian',
  keluar_mode_layar_penuh: 'Keluar dari layar penuh (Fullscreen)',
  pembukaan_kunci_otomatis: 'Kunci terbuka otomatis',
  pembukaan_kunci_sesi: 'Pembukaan kunci sesi oleh Pengawas/Admin',
  klarifikasi_gangguan_teknis: 'Klarifikasi gangguan teknis',
  penguncian_manual_pengawas: 'Penguncian manual oleh Pengawas/Admin',
};

export function getViolationLabel(code: string): string {
  return VIOLATION_LABELS[code] || code.replace(/_/g, ' ');
}

export const DEFAULT_BRAND_EXCEPTIONS_CLIENT: GadgetBrandException[] = [
  {
    brand: 'ADVAN',
    excusedEventTypes: ['tombol_home', 'jendela_lain_di_atas_aplikasi', 'layar_terbagi_split_screen'],
    reasonNote: 'pengecualian ADVAN',
    enabled: true,
  },
];

export const DEFAULT_VIOLATION_RULES_CLIENT: ViolationRuleConfig[] = [
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
    description: 'Lensa kamera depan ditutup; tampilan soal otomatis ditutup sampai kamera terlihat kembali.',
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

export const DEFAULT_VIOLATION_POLICY_CLIENT: ViolationPolicySettings = {
  rules: DEFAULT_VIOLATION_RULES_CLIENT,
  brandExceptions: DEFAULT_BRAND_EXCEPTIONS_CLIENT,
  wifiDisconnectGraceSeconds: 10,
  blockBackNavigation: true,
};

export type DetectedDeviceCategory = 'android' | 'ios_ipad' | 'mobile_web' | 'desktop';

export interface ClientDeviceInfo {
  deviceType: DetectedDeviceCategory;
  deviceBrand: string;
  osLabel: string;
  isNativeXambro: boolean;
}

export function detectClientDeviceInfo(): ClientDeviceInfo {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const platform = typeof navigator !== 'undefined' ? navigator.platform || '' : '';
  const maxTouch = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0;

  const win = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : {};
  const nativeBridge = (win.XambroBridge || win.AndroidBridge || win.CBTBridge) as
    | { getDeviceBrand?: () => string; isRooted?: () => boolean; isEmulator?: () => boolean }
    | undefined;
  const isNativeXambro = Boolean(nativeBridge) || /Xambro|Exambro|SinarCBT-Android|; wv\)/i.test(ua);

  const isIPad = /iPad/i.test(ua) || (platform === 'MacIntel' && maxTouch > 1);
  const isIPhone = /iPhone|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);

  let deviceType: DetectedDeviceCategory = 'desktop';
  let osLabel = 'Desktop';

  if (isAndroid) {
    deviceType = 'android';
    osLabel = isNativeXambro ? 'Android (Xambro)' : 'Android (Browser)';
  } else if (isIPad || isIPhone) {
    deviceType = 'ios_ipad';
    osLabel = isIPad ? 'iPadOS (Web)' : 'iPhone (Web)';
  } else if (/Mobile|Tablet/i.test(ua) || maxTouch > 1) {
    deviceType = 'mobile_web';
    osLabel = 'Web HP/Tablet';
  } else {
    deviceType = 'desktop';
    if (/Windows/i.test(ua)) osLabel = 'Desktop (Windows)';
    else if (/Mac/i.test(ua)) osLabel = 'Desktop (macOS)';
    else if (/Linux/i.test(ua)) osLabel = 'Desktop (Linux)';
  }

  let deviceBrand = '';
  try {
    const bridgeBrand = nativeBridge?.getDeviceBrand?.();
    if (bridgeBrand) deviceBrand = String(bridgeBrand).trim().toUpperCase();
  } catch {
    // ignore bridge read error
  }

  if (!deviceBrand) {
    const matchers: Array<[RegExp, string]> = [
      [/\bADVAN\b|G9|Tab\s?Sketsa|NASA\s?Plus|VX\s?Lite/i, 'ADVAN'],
      [/\bSAMSUNG\b|SM-[A-Z0-9]+/i, 'SAMSUNG'],
      [/\bXIAOMI\b|Redmi|POCO/i, 'XIAOMI'],
      [/\bOPPO\b|CPH\d+/i, 'OPPO'],
      [/\bvivo\b/i, 'VIVO'],
      [/\brealme\b|RMX\d+/i, 'REALME'],
      [/\bInfinix\b/i, 'INFINIX'],
      [/\bLENOVO\b|TB-[A-Z0-9]+/i, 'LENOVO'],
      [/\bASUS\b/i, 'ASUS'],
      [/iPad/i, 'APPLE_IPAD'],
      [/iPhone/i, 'APPLE_IPHONE'],
    ];
    for (const [regex, brand] of matchers) {
      if (regex.test(ua)) {
        deviceBrand = brand;
        break;
      }
    }
  }

  return { deviceType, deviceBrand, osLabel, isNativeXambro };
}

export function detectRootOrEmulatorClient(): { suspicious: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (typeof navigator === 'undefined') return { suspicious: false, reasons };

  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const win = window as unknown as Record<string, unknown>;
  const bridge = (win.XambroBridge || win.AndroidBridge || win.CBTBridge) as
    | { isRooted?: () => boolean; isEmulator?: () => boolean }
    | undefined;

  try {
    if (bridge?.isRooted?.()) reasons.push('Native bridge mendeteksi akses Root');
    if (bridge?.isEmulator?.()) reasons.push('Native bridge mendeteksi Emulator');
  } catch {
    // ignore
  }

  if (isAndroid) {
    if (/Android SDK built for|Genymotion|BlueStacks|Nox|LDPlayer|MEmu|Goldfish|Ranchu/i.test(ua)) {
      reasons.push('User-Agent teridentifikasi sebagai Emulator Android');
    }
    if ((navigator as unknown as { webdriver?: boolean }).webdriver) {
      reasons.push('Lingkungan otomasi/emulator terdeteksi (webdriver)');
    }
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl && 'getExtension' in gl) {
        const dbg = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
        if (dbg) {
          const renderer = String((gl as WebGLRenderingContext).getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
          if (/SwiftShader|llvmpipe|Android Emulator|Bluestacks|vbox/i.test(renderer)) {
            reasons.push(`Renderer grafis emulator (${renderer})`);
          }
        }
      }
    } catch {
      // ignore WebGL error
    }
  }

  return { suspicious: reasons.length > 0, reasons };
}

// Synthesized Desktop Alert Siren (Web Audio API — zero external asset required)
class SirenController {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private intervalId: number | null = null;
  private stopTimeoutId: number | null = null;

  start(durationMs = 8000) {
    this.stop();
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = 660;
      gain.gain.value = 0.14;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();

      let high = true;
      this.intervalId = window.setInterval(() => {
        try {
          osc.frequency.setValueAtTime(high ? 920 : 620, ctx.currentTime);
          high = !high;
        } catch {
          // ignore
        }
      }, 280);

      this.ctx = ctx;
      this.osc = osc;
      this.gain = gain;
      this.stopTimeoutId = window.setTimeout(() => this.stop(), durationMs);
    } catch {
      // Ignore if audio autoplay blocked by browser policy
    }
  }

  stop() {
    if (this.stopTimeoutId !== null) {
      window.clearTimeout(this.stopTimeoutId);
      this.stopTimeoutId = null;
    }
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    try {
      this.osc?.stop();
      this.osc?.disconnect();
      this.gain?.disconnect();
      this.ctx?.close().catch(() => {});
    } catch {
      // ignore
    }
    this.osc = null;
    this.gain = null;
    this.ctx = null;
  }
}

export const desktopSiren = new SirenController();
