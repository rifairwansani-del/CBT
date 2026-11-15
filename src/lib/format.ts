const MONTHS_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

export function formatBirthDate(birthDate?: string | null): string {
  const clean = (birthDate || '').trim();
  if (!clean) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean);
  if (m) {
    const year = Number(m[1]);
    const monthIdx = Number(m[2]) - 1;
    const day = Number(m[3]);
    if (monthIdx >= 0 && monthIdx < 12 && day >= 1 && day <= 31) {
      return `${day} ${MONTHS_ID[monthIdx]} ${year}`;
    }
  }
  const parsed = new Date(clean);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  return clean;
}

export function formatBirthPlaceDate(
  birthPlace?: string | null,
  birthDate?: string | null,
  fallback = 'Belum dilengkapi'
): string {
  const place = (birthPlace || '').trim();
  const formattedDate = formatBirthDate(birthDate);
  if (place && formattedDate) return `${place}, ${formattedDate}`;
  if (place) return place;
  if (formattedDate) return formattedDate;
  return fallback;
}

export function formatGender(gender?: string | null, fallback = 'Belum diisi'): string {
  const clean = (gender || '').trim().toUpperCase();
  if (clean === 'L') return 'Laki-laki';
  if (clean === 'P') return 'Perempuan';
  return fallback;
}

