import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import type { DifficultyLevel, QuestionType } from './types.ts';

export interface ImportIssue {
  row: number;
  column: string;
  message: string;
}

export interface ParsedStudentImportRow {
  row: number;
  nis: string;
  nisn: string;
  fullName: string;
  birthPlace: string;
  birthDate: string;
  gender: string;
  email: string;
  photoLink: string;
  className: string;
  pin: string;
  valid: boolean;
  errors: string[];
}

export interface ParsedQuestionImportRow {
  row: number;
  id: string;
  subjectCode: string;
  topic: string;
  questionType: QuestionType;
  stemHtml: string;
  options: unknown;
  correctKey: unknown;
  weight: number;
  difficulty: DifficultyLevel;
  explanationHtml: string;
  isActive: boolean;
  valid: boolean;
  errors: string[];
}

export function buildStudentsTemplateWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  const rows = [
    {
      NIS: '2026101',
      NISN: '0091234601',
      NAMA_LENGKAP: 'Contoh Siswa Pertama',
      JENIS_KELAMIN: 'L',
      TEMPAT_LAHIR: 'Jakarta',
      TANGGAL_LAHIR: '2008-05-14',
      ALAMAT_EMAIL: 'siswa1@sekolah.sch.id',
      LINK_FOTO: '',
      KELAS: 'XII-IPA-1',
      PIN: '123456',
    },
    {
      NIS: '2026102',
      NISN: '0091234602',
      NAMA_LENGKAP: 'Contoh Siswa Kedua',
      JENIS_KELAMIN: 'P',
      TEMPAT_LAHIR: 'Bandung',
      TANGGAL_LAHIR: '2008-11-22',
      ALAMAT_EMAIL: 'siswa2@sekolah.sch.id',
      LINK_FOTO: 'https://example.com/foto/siswa2.jpg',
      KELAS: 'XII-IPA-2',
      PIN: '654321',
    },
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'DataSiswa');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function buildQuestionsTemplateWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  const rows = [
    {
      ID_SOAL: 'IMP_PG_01',
      KODE_MAPEL: 'MAT',
      MATERI: 'Aljabar Linear',
      TIPE_SOAL: 'pg_tunggal',
      PERTANYAAN: 'Nilai $x$ yang memenuhi persamaan $2x + 4 = 12$ adalah...',
      OPSI_ATAU_PASANGAN: 'a:2 | b:4 | c:6 | d:8',
      KUNCI: 'b',
      BOBOT: 2,
      TINGKAT_KESULITAN: 'mudah',
      PEMBAHASAN: '$2x = 8 \\Rightarrow x = 4$.',
      TAMPILKAN: 'Ya',
    },
    {
      ID_SOAL: 'IMP_PGK_01',
      KODE_MAPEL: 'MAT',
      MATERI: 'Bilangan Prima',
      TIPE_SOAL: 'pg_kompleks',
      PERTANYAAN: 'Pilih semua bilangan prima yang terletak antara 10 dan 20:',
      OPSI_ATAU_PASANGAN: 'o1:11 | o2:12 | o3:13 | o4:17 | o5:18',
      KUNCI: 'o1,o3,o4',
      BOBOT: 4,
      TINGKAT_KESULITAN: 'sedang',
      PEMBAHASAN: 'Bilangan prima antara 10 dan 20 adalah 11, 13, 17, 19.',
      TAMPILKAN: 'Ya',
    },
    {
      ID_SOAL: 'IMP_BS_01',
      KODE_MAPEL: 'MAT',
      MATERI: 'Geometri Datar',
      TIPE_SOAL: 'benar_salah',
      PERTANYAAN: 'Tentukan Benar (B) atau Salah (S) untuk sifat persegi panjang berikut:',
      OPSI_ATAU_PASANGAN: 's1:Keempat sudutnya siku-siku | s2:Semua sisinya selalu sama panjang | s3:Diagonalnya saling membagi dua sama panjang',
      KUNCI: 's1:B | s2:S | s3:B',
      BOBOT: 4,
      TINGKAT_KESULITAN: 'mudah',
      PEMBAHASAN: 'Persegi panjang memiliki sudut 90 derajat dan diagonal sama panjang.',
      TAMPILKAN: 'Ya',
    },
    {
      ID_SOAL: 'IMP_JDH_01',
      KODE_MAPEL: 'MAT',
      MATERI: 'Trigonometri Dasar',
      TIPE_SOAL: 'menjodohkan',
      PERTANYAAN: 'Pasangkan sudut istimewa berikut dengan nilai trigonometrinya:',
      OPSI_ATAU_PASANGAN: 'KIRI: l1=$\\sin 30^\\circ$; l2=$\\cos 60^\\circ$; l3=$\\tan 45^\\circ$ || KANAN: r1=0.5; r2=1; r3=0',
      KUNCI: 'l1:r1 | l2:r1 | l3:r2',
      BOBOT: 4,
      TINGKAT_KESULITAN: 'sedang',
      PEMBAHASAN: '$\\sin 30^\\circ = 0.5$, $\\cos 60^\\circ = 0.5$, $\\tan 45^\\circ = 1$.',
      TAMPILKAN: 'Tidak',
    },
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'TemplateSoalTKA');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function normalizeExcelBirthDate(raw: unknown): { value: string; valid: boolean } {
  if (raw === null || raw === undefined) return { value: '', valid: true };
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return { value: `${y}-${m}-${d}`, valid: true };
  }
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 1000) {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return {
        value: `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`,
        valid: true,
      };
    }
    return { value: String(raw), valid: false };
  }

  const str = String(raw).trim();
  if (!str) return { value: '', valid: true };

  // YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(str);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d) {
      return { value: `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, valid: true };
    }
    return { value: str, valid: false };
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(str);
  if (dmyMatch) {
    const d = Number(dmyMatch[1]);
    const m = Number(dmyMatch[2]);
    const y = Number(dmyMatch[3]);
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d) {
      return { value: `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, valid: true };
    }
    return { value: str, valid: false };
  }

  return { value: str, valid: false };
}

function normalizeExcelGender(raw: unknown): { value: string; valid: boolean } {
  const str = String(raw ?? '').trim().toLowerCase();
  if (!str) return { value: '', valid: true };
  if (str === 'l' || str === 'laki-laki' || str === 'laki laki' || str === 'laki' || str === 'male' || str === 'm') {
    return { value: 'L', valid: true };
  }
  if (str === 'p' || str === 'perempuan' || str === 'wanita' || str === 'female' || str === 'f') {
    return { value: 'P', valid: true };
  }
  return { value: String(raw ?? '').trim(), valid: false };
}

function isValidEmailAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhotoUrlLink(url: string): boolean {
  return /^https?:\/\/.+/i.test(url) || url.startsWith('/api/');
}

export function previewStudentsExcelImport(
  buffer: Buffer,
  existingNisSet: Set<string>,
  existingNisnSet: Set<string>,
  validClassNames: Set<string>
): { rows: ParsedStudentImportRow[]; issues: ImportIssue[] } {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return { rows: [], issues: [{ row: 0, column: 'FILE', message: 'File Excel tidak memiliki lembar kerja.' }] };
  }
  const sheet = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  const rows: ParsedStudentImportRow[] = [];
  const issues: ImportIssue[] = [];
  const seenNis = new Set<string>();
  const seenNisn = new Set<string>();

  raw.forEach((item, idx) => {
    const rowNum = idx + 2; // 1-indexed + header
    const nis = String(item['NIS'] ?? item['nis'] ?? '').trim();
    const nisn = String(item['NISN'] ?? item['nisn'] ?? '').trim();
    const fullName = String(item['NAMA_LENGKAP'] ?? item['NAMA'] ?? item['nama'] ?? '').trim();
    const birthPlace = String(item['TEMPAT_LAHIR'] ?? item['tempat_lahir'] ?? item['Tempat Lahir'] ?? '').trim();
    const rawBirthDate = item['TANGGAL_LAHIR'] ?? item['tanggal_lahir'] ?? item['Tanggal Lahir'] ?? '';
    const parsedBirthDate = normalizeExcelBirthDate(rawBirthDate);
    const rawGender = item['JENIS_KELAMIN'] ?? item['jenis_kelamin'] ?? item['JK'] ?? item['jk'] ?? item['Jenis Kelamin'] ?? '';
    const parsedGender = normalizeExcelGender(rawGender);
    const email = String(item['ALAMAT_EMAIL'] ?? item['EMAIL'] ?? item['email'] ?? item['alamat_email'] ?? '').trim();
    const photoLink = String(item['LINK_FOTO'] ?? item['link_foto'] ?? item['URL_FOTO'] ?? item['url_foto'] ?? '').trim();
    const className = String(item['KELAS'] ?? item['kelas'] ?? '').trim();
    const pin = String(item['PIN'] ?? item['pin'] ?? '123456').trim() || '123456';

    const errors: string[] = [];

    if (!nis || !/^[a-zA-Z0-9_-]{4,20}$/.test(nis)) {
      const msg = 'NIS wajib diisi (4-20 karakter alfanumerik).';
      errors.push(msg);
      issues.push({ row: rowNum, column: 'NIS', message: msg });
    } else if (seenNis.has(nis)) {
      const msg = `NIS "${nis}" duplikat di dalam file Excel.`;
      errors.push(msg);
      issues.push({ row: rowNum, column: 'NIS', message: msg });
    } else if (existingNisSet.has(nis)) {
      const msg = `NIS "${nis}" sudah terdaftar di sistem.`;
      errors.push(msg);
      issues.push({ row: rowNum, column: 'NIS', message: msg });
    }
    seenNis.add(nis);

    if (!nisn || !/^[0-9]{6,15}$/.test(nisn)) {
      const msg = 'NISN wajib berupa 6-15 digit angka.';
      errors.push(msg);
      issues.push({ row: rowNum, column: 'NISN', message: msg });
    } else if (seenNisn.has(nisn)) {
      const msg = `NISN "${nisn}" duplikat di dalam file Excel.`;
      errors.push(msg);
      issues.push({ row: rowNum, column: 'NISN', message: msg });
    } else if (existingNisnSet.has(nisn)) {
      const msg = `NISN "${nisn}" sudah terdaftar di sistem.`;
      errors.push(msg);
      issues.push({ row: rowNum, column: 'NISN', message: msg });
    }
    seenNisn.add(nisn);

    if (!fullName || fullName.length < 2) {
      const msg = 'Nama lengkap wajib diisi (minimal 2 karakter).';
      errors.push(msg);
      issues.push({ row: rowNum, column: 'NAMA_LENGKAP', message: msg });
    }

    if (!parsedBirthDate.valid) {
      const msg = `Format TANGGAL_LAHIR "${parsedBirthDate.value}" tidak valid. Gunakan YYYY-MM-DD atau DD/MM/YYYY.`;
      errors.push(msg);
      issues.push({ row: rowNum, column: 'TANGGAL_LAHIR', message: msg });
    }

    if (!parsedGender.valid) {
      const msg = `JENIS_KELAMIN "${parsedGender.value}" tidak valid. Gunakan L (Laki-laki) atau P (Perempuan).`;
      errors.push(msg);
      issues.push({ row: rowNum, column: 'JENIS_KELAMIN', message: msg });
    }

    if (email && !isValidEmailAddress(email)) {
      const msg = `ALAMAT_EMAIL "${email}" bukan format email yang valid.`;
      errors.push(msg);
      issues.push({ row: rowNum, column: 'ALAMAT_EMAIL', message: msg });
    }

    if (photoLink && !isValidPhotoUrlLink(photoLink)) {
      const msg = `LINK_FOTO "${photoLink}" harus diawali http:// atau https://.`;
      errors.push(msg);
      issues.push({ row: rowNum, column: 'LINK_FOTO', message: msg });
    }

    if (!className || !validClassNames.has(className)) {
      const msg = `Kelas "${className}" tidak ditemukan. Daftarkan kelas terlebih dahulu.`;
      errors.push(msg);
      issues.push({ row: rowNum, column: 'KELAS', message: msg });
    }

    if (pin.length < 4 || pin.length > 12) {
      const msg = 'PIN ujian harus 4-12 karakter.';
      errors.push(msg);
      issues.push({ row: rowNum, column: 'PIN', message: msg });
    }

    rows.push({
      row: rowNum,
      nis,
      nisn,
      fullName,
      birthPlace,
      birthDate: parsedBirthDate.valid ? parsedBirthDate.value : '',
      gender: parsedGender.valid ? parsedGender.value : '',
      email,
      photoLink,
      className,
      pin,
      valid: errors.length === 0,
      errors,
    });
  });

  return { rows, issues };
}

function parsePipePairs(raw: string): Array<{ id: string; text: string }> {
  return raw
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, idx) => {
      const colonIdx = part.indexOf(':');
      const eqIdx = part.indexOf('=');
      const splitIdx = colonIdx !== -1 ? colonIdx : eqIdx;
      if (splitIdx !== -1) {
        return {
          id: part.slice(0, splitIdx).trim(),
          text: part.slice(splitIdx + 1).trim(),
        };
      }
      return { id: `opt_${idx + 1}`, text: part };
    });
}

export function validateQuestionRow(
  rowNum: number,
  rawItem: Record<string, unknown>,
  validSubjectCodes: Set<string>,
  issues: ImportIssue[]
): ParsedQuestionImportRow {
  const id = String(rawItem['ID_SOAL'] ?? rawItem['id_soal'] ?? `IMP_${rowNum}`).trim();
  const subjectCode = String(rawItem['KODE_MAPEL'] ?? rawItem['kode_mapel'] ?? 'MAT').trim().toUpperCase();
  const topic = String(rawItem['MATERI'] ?? rawItem['materi'] ?? 'Umum').trim();
  const rawType = String(rawItem['TIPE_SOAL'] ?? rawItem['tipe_soal'] ?? '').trim().toLowerCase();
  const stemHtml = String(rawItem['PERTANYAAN'] ?? rawItem['pertanyaan'] ?? '').trim();
  const rawOpt = String(rawItem['OPSI_ATAU_PASANGAN'] ?? rawItem['opsi'] ?? '').trim();
  const rawKey = String(rawItem['KUNCI'] ?? rawItem['kunci'] ?? '').trim();
  const weight = Number(rawItem['BOBOT'] ?? rawItem['bobot'] ?? (rawType === 'pg_tunggal' ? 2 : 4));
  const rawDiff = String(rawItem['TINGKAT_KESULITAN'] ?? rawItem['kesulitan'] ?? 'sedang').trim().toLowerCase();
  const explanationHtml = String(rawItem['PEMBAHASAN'] ?? rawItem['pembahasan'] ?? '').trim();
  const rawShow = String(rawItem['TAMPILKAN'] ?? rawItem['tampilkan'] ?? rawItem['AKTIF'] ?? rawItem['aktif'] ?? 'Ya').trim().toLowerCase();
  const isActive = !['tidak', 'no', 'false', '0', 'off', 'sembunyikan', 'nonaktif'].includes(rawShow);

  const errors: string[] = [];

  if (!validSubjectCodes.has(subjectCode)) {
    const msg = `Kode mapel "${subjectCode}" tidak ditemukan.`;
    errors.push(msg);
    issues.push({ row: rowNum, column: 'KODE_MAPEL', message: msg });
  }

  const validTypes: QuestionType[] = ['pg_tunggal', 'pg_kompleks', 'benar_salah', 'menjodohkan'];
  const questionType = validTypes.includes(rawType as QuestionType) ? (rawType as QuestionType) : 'pg_tunggal';
  if (!validTypes.includes(rawType as QuestionType)) {
    const msg = `Tipe soal "${rawType}" tidak valid. Gunakan: pg_tunggal, pg_kompleks, benar_salah, atau menjodohkan.`;
    errors.push(msg);
    issues.push({ row: rowNum, column: 'TIPE_SOAL', message: msg });
  }

  if (!stemHtml) {
    const msg = 'Pertanyaan tidak boleh kosong.';
    errors.push(msg);
    issues.push({ row: rowNum, column: 'PERTANYAAN', message: msg });
  }

  let options: unknown = [];
  let correctKey: unknown = '';

  if (questionType === 'pg_tunggal') {
    const parsed = parsePipePairs(rawOpt);
    if (parsed.length < 2) {
      const msg = 'Minimal 2 opsi jawaban dipisahkan "|" (contoh: a:Pilihan A | b:Pilihan B).';
      errors.push(msg);
      issues.push({ row: rowNum, column: 'OPSI_ATAU_PASANGAN', message: msg });
    }
    options = parsed.map((o, i) => ({ id: o.id, label: String.fromCharCode(65 + i), text: o.text }));
    correctKey = rawKey;
    if (!rawKey || !parsed.some((p) => p.id === rawKey)) {
      const msg = `Kunci "${rawKey}" harus cocok dengan salah satu ID opsi.`;
      errors.push(msg);
      issues.push({ row: rowNum, column: 'KUNCI', message: msg });
    }
  } else if (questionType === 'pg_kompleks') {
    const parsed = parsePipePairs(rawOpt);
    if (parsed.length < 2) {
      const msg = 'Minimal 2 opsi untuk PG Kompleks.';
      errors.push(msg);
      issues.push({ row: rowNum, column: 'OPSI_ATAU_PASANGAN', message: msg });
    }
    options = parsed.map((o, i) => ({ id: o.id, label: String(i + 1), text: o.text }));
    const keys = rawKey.split(/[,|;]/).map((k) => k.trim()).filter(Boolean);
    correctKey = keys;
    if (keys.length === 0 || keys.some((k) => !parsed.some((p) => p.id === k))) {
      const msg = 'Kunci PG Kompleks (pisahkan koma) harus cocok dengan ID opsi.';
      errors.push(msg);
      issues.push({ row: rowNum, column: 'KUNCI', message: msg });
    }
  } else if (questionType === 'benar_salah') {
    const parsed = parsePipePairs(rawOpt);
    if (parsed.length < 1) {
      const msg = 'Minimal 1 pernyataan Benar-Salah (contoh: s1:Pernyataan 1 | s2:Pernyataan 2).';
      errors.push(msg);
      issues.push({ row: rowNum, column: 'OPSI_ATAU_PASANGAN', message: msg });
    }
    options = parsed;
    const keyMap: Record<string, string> = {};
    for (const kp of parsePipePairs(rawKey)) {
      const norm = kp.text.toUpperCase();
      keyMap[kp.id] = norm === 'B' || norm === 'BENAR' || norm === 'TRUE' ? 'B' : 'S';
    }
    correctKey = keyMap;
    if (Object.keys(keyMap).length !== parsed.length) {
      const msg = 'Jumlah kunci (contoh: s1:B | s2:S) harus sama dengan jumlah pernyataan.';
      errors.push(msg);
      issues.push({ row: rowNum, column: 'KUNCI', message: msg });
    }
  } else if (questionType === 'menjodohkan') {
    const [leftRaw, rightRaw] = rawOpt.split('||').map((s) => s.trim());
    const cleanLeft = (leftRaw || '').replace(/^KIRI\s*:/i, '').trim();
    const cleanRight = (rightRaw || '').replace(/^KANAN\s*:/i, '').trim();
    const leftItems = cleanLeft
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((p, i) => {
        const eq = p.indexOf('=');
        const col = p.indexOf(':');
        const idx = eq !== -1 ? eq : col;
        return idx !== -1 ? { id: p.slice(0, idx).trim(), text: p.slice(idx + 1).trim() } : { id: `l${i + 1}`, text: p };
      });
    const rightItems = cleanRight
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((p, i) => {
        const eq = p.indexOf('=');
        const col = p.indexOf(':');
        const idx = eq !== -1 ? eq : col;
        return idx !== -1 ? { id: p.slice(0, idx).trim(), text: p.slice(idx + 1).trim() } : { id: `r${i + 1}`, text: p };
      });

    if (leftItems.length === 0 || rightItems.length === 0) {
      const msg = 'Format menjodohkan wajib memakai pemisah "||" antara KIRI dan KANAN.';
      errors.push(msg);
      issues.push({ row: rowNum, column: 'OPSI_ATAU_PASANGAN', message: msg });
    }
    options = { left: leftItems, right: rightItems };
    const keyMap: Record<string, string> = {};
    for (const kp of parsePipePairs(rawKey)) {
      keyMap[kp.id] = kp.text;
    }
    correctKey = keyMap;
    if (Object.keys(keyMap).length === 0) {
      const msg = 'Kunci menjodohkan tidak valid (contoh: l1:r1 | l2:r2).';
      errors.push(msg);
      issues.push({ row: rowNum, column: 'KUNCI', message: msg });
    }
  }

  const validDiffs: DifficultyLevel[] = ['mudah', 'sedang', 'sulit'];
  const difficulty = validDiffs.includes(rawDiff as DifficultyLevel) ? (rawDiff as DifficultyLevel) : 'sedang';

  if (Number.isNaN(weight) || weight <= 0) {
    const msg = 'Bobot soal harus angka lebih dari 0.';
    errors.push(msg);
    issues.push({ row: rowNum, column: 'BOBOT', message: msg });
  }

  return {
    row: rowNum,
    id,
    subjectCode,
    topic: topic || 'Umum',
    questionType,
    stemHtml,
    options,
    correctKey,
    weight: Number.isNaN(weight) || weight <= 0 ? 2 : weight,
    difficulty,
    explanationHtml,
    isActive,
    valid: errors.length === 0,
    errors,
  };
}

export function previewQuestionsExcelImport(
  buffer: Buffer,
  validSubjectCodes: Set<string>
): { rows: ParsedQuestionImportRow[]; issues: ImportIssue[] } {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return { rows: [], issues: [{ row: 0, column: 'FILE', message: 'File Excel kosong.' }] };
  }
  const sheet = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const issues: ImportIssue[] = [];
  const rows = raw.map((item, idx) => validateQuestionRow(idx + 2, item, validSubjectCodes, issues));
  return { rows, issues };
}

export async function previewQuestionsWordImport(
  buffer: Buffer,
  validSubjectCodes: Set<string>
): Promise<{ rows: ParsedQuestionImportRow[]; issues: ImportIssue[]; warningNote?: string }> {
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value || '';
  const blocks = text
    .split(/\n\s*---+\s*\n|\n(?=ID_SOAL\s*:)/i)
    .map((b) => b.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    return {
      rows: [],
      issues: [{
        row: 1,
        column: 'DOCX',
        message: 'Struktur Word tidak dikenali. Gunakan format blok key-value (ID_SOAL:, KODE_MAPEL:, TIPE_SOAL:, PERTANYAAN:, OPSI_ATAU_PASANGAN:, KUNCI:, BOBOT:) yang dipisah "---", atau gunakan Template Excel untuk hasil paling akurat termasuk tabel kompleks dan rumus OMML.',
      }],
    };
  }

  const issues: ImportIssue[] = [];
  const rows: ParsedQuestionImportRow[] = [];

  blocks.forEach((block, idx) => {
    const record: Record<string, string> = {};
    for (const line of block.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim().toUpperCase();
        const val = line.slice(colonIdx + 1).trim();
        record[key] = val;
      }
    }
    if (record['PERTANYAAN'] || record['ID_SOAL']) {
      rows.push(validateQuestionRow(idx + 1, record, validSubjectCodes, issues));
    }
  });

  const warningNote = rows.length === 0
    ? 'Dokumen Word terbaca namun tidak ditemukan blok soal berformat standar (ID_SOAL:, TIPE_SOAL:, PERTANYAAN:, OPSI_ATAU_PASANGAN:, KUNCI:). Silakan gunakan template Excel untuk soal dengan tabel kompleks atau rumus Equation Word.'
    : 'Catatan Impor Word: Persamaan matematika native Word (OMML) atau gambar tertanam perlu diperiksa ulang pada pratinjau; gunakan sintaks LaTeX ($...$) atau unggah gambar soal manual bila diperlukan.';

  return { rows, issues, warningNote };
}

// ======================== QUESTION EXCEL EXPORT SERIALIZER ========================
export function serializeQuestionForExcelExport(q: {
  id: string;
  subject_code: string;
  topic: string;
  question_type: QuestionType;
  stem_html: string;
  options_json: string;
  key_json: string;
  weight: number | null;
  difficulty: DifficultyLevel;
  explanation_html: string | null;
  is_active?: number;
}) {
  let optionsParsed: unknown = [];
  let keyParsed: unknown = '';
  try {
    optionsParsed = JSON.parse(q.options_json || '[]');
  } catch {
    optionsParsed = [];
  }
  try {
    keyParsed = JSON.parse(q.key_json || '""');
  } catch {
    keyParsed = '';
  }

  let optText = '';
  let keyText = '';

  if (q.question_type === 'pg_tunggal') {
    const opts = Array.isArray(optionsParsed) ? (optionsParsed as Array<{ id: string; text: string }>) : [];
    optText = opts.map((o) => `${o.id}:${o.text}`).join(' | ');
    keyText = String(keyParsed || '');
  } else if (q.question_type === 'pg_kompleks') {
    const opts = Array.isArray(optionsParsed) ? (optionsParsed as Array<{ id: string; text: string }>) : [];
    optText = opts.map((o) => `${o.id}:${o.text}`).join(' | ');
    keyText = Array.isArray(keyParsed) ? keyParsed.join(',') : String(keyParsed || '');
  } else if (q.question_type === 'benar_salah') {
    const opts = Array.isArray(optionsParsed) ? (optionsParsed as Array<{ id: string; text: string }>) : [];
    optText = opts.map((o) => `${o.id}:${o.text}`).join(' | ');
    const km = (typeof keyParsed === 'object' && keyParsed !== null ? keyParsed : {}) as Record<string, string>;
    keyText = Object.entries(km).map(([k, v]) => `${k}:${v}`).join(' | ');
  } else if (q.question_type === 'menjodohkan') {
    const obj = (typeof optionsParsed === 'object' && optionsParsed !== null ? optionsParsed : {}) as {
      left?: Array<{ id: string; text: string }>;
      right?: Array<{ id: string; text: string }>;
    };
    const leftStr = (obj.left || []).map((l) => `${l.id}=${l.text}`).join('; ');
    const rightStr = (obj.right || []).map((r) => `${r.id}=${r.text}`).join('; ');
    optText = `KIRI: ${leftStr} || KANAN: ${rightStr}`;
    const km = (typeof keyParsed === 'object' && keyParsed !== null ? keyParsed : {}) as Record<string, string>;
    keyText = Object.entries(km).map(([k, v]) => `${k}:${v}`).join(' | ');
  }

  return {
    ID_SOAL: q.id,
    KODE_MAPEL: q.subject_code,
    MATERI: q.topic,
    TIPE_SOAL: q.question_type,
    PERTANYAAN: q.stem_html,
    OPSI_ATAU_PASANGAN: optText,
    KUNCI: keyText,
    BOBOT: q.weight ?? (q.question_type === 'pg_tunggal' ? 2 : 4),
    TINGKAT_KESULITAN: q.difficulty,
    PEMBAHASAN: q.explanation_html || '',
    TAMPILKAN: q.is_active === 0 ? 'Tidak' : 'Ya',
  };
}

// ======================== CLASSES EXCEL TEMPLATE & IMPORT ========================
export interface ParsedClassImportRow {
  row: number;
  name: string;
  gradeLevel: string;
  academicYear: string;
  valid: boolean;
  errors: string[];
}

export function buildClassesTemplateWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([
    { NAMA_KELAS: 'XII-IPA-3', TINGKAT: '12', TAHUN_AJARAN: '2026/2027' },
    { NAMA_KELAS: 'XII-IPS-2', TINGKAT: '12', TAHUN_AJARAN: '2026/2027' },
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'DataKelas');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function previewClassesExcelImport(
  buffer: Buffer,
  existingClassNames: Set<string>
): { rows: ParsedClassImportRow[]; issues: ImportIssue[] } {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { rows: [], issues: [{ row: 0, column: 'FILE', message: 'File Excel kosong.' }] };
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: '' });
  const rows: ParsedClassImportRow[] = [];
  const issues: ImportIssue[] = [];
  const seen = new Set<string>();

  raw.forEach((item, idx) => {
    const rowNum = idx + 2;
    const name = String(item['NAMA_KELAS'] ?? item['KELAS'] ?? item['nama'] ?? '').trim();
    const gradeLevel = String(item['TINGKAT'] ?? item['tingkat'] ?? '12').trim() || '12';
    const academicYear = String(item['TAHUN_AJARAN'] ?? item['tahun_ajaran'] ?? '2026/2027').trim() || '2026/2027';
    const errors: string[] = [];

    if (!name) {
      const msg = 'Nama kelas wajib diisi.';
      errors.push(msg);
      issues.push({ row: rowNum, column: 'NAMA_KELAS', message: msg });
    } else if (seen.has(name) || existingClassNames.has(name)) {
      const msg = `Nama kelas "${name}" sudah ada atau duplikat.`;
      errors.push(msg);
      issues.push({ row: rowNum, column: 'NAMA_KELAS', message: msg });
    }
    seen.add(name);
    rows.push({ row: rowNum, name, gradeLevel, academicYear, valid: errors.length === 0, errors });
  });

  return { rows, issues };
}

// ======================== SUBJECTS EXCEL TEMPLATE & IMPORT ========================
export interface ParsedSubjectImportRow {
  row: number;
  code: string;
  name: string;
  passingGrade: number;
  valid: boolean;
  errors: string[];
}

export function buildSubjectsTemplateWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([
    { KODE_MAPEL: 'KIM', NAMA_MAPEL: 'Kimia', KKM: 75 },
    { KODE_MAPEL: 'BIO', NAMA_MAPEL: 'Biologi', KKM: 76 },
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'MataPelajaran');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function previewSubjectsExcelImport(
  buffer: Buffer,
  existingCodes: Set<string>
): { rows: ParsedSubjectImportRow[]; issues: ImportIssue[] } {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { rows: [], issues: [{ row: 0, column: 'FILE', message: 'File Excel kosong.' }] };
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: '' });
  const rows: ParsedSubjectImportRow[] = [];
  const issues: ImportIssue[] = [];
  const seen = new Set<string>();

  raw.forEach((item, idx) => {
    const rowNum = idx + 2;
    const code = String(item['KODE_MAPEL'] ?? item['KODE'] ?? item['kode'] ?? '').trim().toUpperCase();
    const name = String(item['NAMA_MAPEL'] ?? item['NAMA'] ?? item['nama'] ?? '').trim();
    const passingGrade = Number(item['KKM'] ?? item['kkm'] ?? 75);
    const errors: string[] = [];

    if (!code) {
      const msg = 'Kode mata pelajaran wajib diisi.';
      errors.push(msg);
      issues.push({ row: rowNum, column: 'KODE_MAPEL', message: msg });
    } else if (seen.has(code) || existingCodes.has(code)) {
      const msg = `Kode "${code}" sudah ada atau duplikat.`;
      errors.push(msg);
      issues.push({ row: rowNum, column: 'KODE_MAPEL', message: msg });
    }
    seen.add(code);

    if (!name) {
      const msg = 'Nama mata pelajaran wajib diisi.';
      errors.push(msg);
      issues.push({ row: rowNum, column: 'NAMA_MAPEL', message: msg });
    }
    if (Number.isNaN(passingGrade) || passingGrade < 0 || passingGrade > 100) {
      const msg = 'KKM harus bernilai 0-100.';
      errors.push(msg);
      issues.push({ row: rowNum, column: 'KKM', message: msg });
    }
    rows.push({
      row: rowNum,
      code,
      name,
      passingGrade: Number.isNaN(passingGrade) ? 75 : passingGrade,
      valid: errors.length === 0,
      errors,
    });
  });

  return { rows, issues };
}

// ======================== EXAMS EXCEL TEMPLATE & IMPORT ========================
export interface ParsedExamImportRow {
  row: number;
  title: string;
  examType: string;
  subjectCode: string;
  subjectId: string;
  questionBankName: string;
  questionBankId: string;
  classIds: string[];
  classNames: string[];
  questionCount: number;
  durationMinutes: number;
  passingScore: number;
  shuffleMode: 'A' | 'B' | 'C';
  startAt: string;
  entryDeadlineAt: string;
  endAt: string;
  publicationPolicy: 'hidden' | 'view_only' | 'view_download' | 'view_download_print';
  valid: boolean;
  errors: string[];
}

export function buildExamsTemplateWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  const now = Date.now();
  const start = new Date(now + 3600000).toISOString().slice(0, 16);
  const end = new Date(now + 10800000).toISOString().slice(0, 16);
  const ws = XLSX.utils.json_to_sheet([
    {
      NAMA_UJIAN: 'Ulangan Harian Matematika Impor',
      JENIS_UJIAN: 'Ulangan Harian',
      KODE_MAPEL: 'MAT',
      NAMA_BANK: 'Bank Soal TKA Matematika Wajib',
      KELAS_PESERTA: 'XII-IPA-1, XII-IPA-2',
      JUMLAH_SOAL: 6,
      DURASI_MENIT: 60,
      KKM: 75,
      MODE_ACAK: 'A',
      WAKTU_MULAI: start,
      BATAS_MASUK: end,
      WAKTU_SELESAI: end,
      PUBLIKASI: 'view_download_print',
    },
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'JadwalUjian');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function previewExamsExcelImport(
  buffer: Buffer,
  subjectByCode: Map<string, string>,
  bankByName: Map<string, string>,
  classByName: Map<string, string>
): { rows: ParsedExamImportRow[]; issues: ImportIssue[] } {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { rows: [], issues: [{ row: 0, column: 'FILE', message: 'File Excel kosong.' }] };
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: '' });
  const rows: ParsedExamImportRow[] = [];
  const issues: ImportIssue[] = [];
  const validPubs = new Set(['hidden', 'view_only', 'view_download', 'view_download_print']);

  raw.forEach((item, idx) => {
    const rowNum = idx + 2;
    const title = String(item['NAMA_UJIAN'] ?? '').trim();
    const examType = String(item['JENIS_UJIAN'] ?? 'Ulangan Harian').trim() || 'Ulangan Harian';
    const subjectCode = String(item['KODE_MAPEL'] ?? '').trim().toUpperCase();
    const questionBankName = String(item['NAMA_BANK'] ?? '').trim();
    const rawClasses = String(item['KELAS_PESERTA'] ?? '').split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
    const questionCount = Number(item['JUMLAH_SOAL'] ?? 10);
    const durationMinutes = Number(item['DURASI_MENIT'] ?? 60);
    const passingScore = Number(item['KKM'] ?? 75);
    const rawShuffle = String(item['MODE_ACAK'] ?? 'A').trim().toUpperCase();
    const shuffleMode: 'A' | 'B' | 'C' = rawShuffle === 'B' || rawShuffle === 'C' ? rawShuffle : 'A';
    const rawStart = String(item['WAKTU_MULAI'] ?? '').trim();
    const rawEnd = String(item['WAKTU_SELESAI'] ?? '').trim();
    const rawDeadline = String(item['BATAS_MASUK'] ?? rawEnd).trim();
    const rawPub = String(item['PUBLIKASI'] ?? 'view_download_print').trim();
    const publicationPolicy = (validPubs.has(rawPub) ? rawPub : 'view_download_print') as ParsedExamImportRow['publicationPolicy'];

    const errors: string[] = [];
    if (!title) {
      const msg = 'Nama ujian wajib diisi.';
      errors.push(msg);
      issues.push({ row: rowNum, column: 'NAMA_UJIAN', message: msg });
    }
    const subjectId = subjectByCode.get(subjectCode) || '';
    if (!subjectId) {
      const msg = `Kode mapel "${subjectCode}" tidak ditemukan.`;
      errors.push(msg);
      issues.push({ row: rowNum, column: 'KODE_MAPEL', message: msg });
    }
    const questionBankId = bankByName.get(questionBankName.toLowerCase()) || '';
    if (!questionBankId) {
      const msg = `Bank soal "${questionBankName}" tidak ditemukan.`;
      errors.push(msg);
      issues.push({ row: rowNum, column: 'NAMA_BANK', message: msg });
    }
    const classIds: string[] = [];
    for (const cn of rawClasses) {
      const cid = classByName.get(cn);
      if (!cid) {
        const msg = `Kelas "${cn}" tidak ditemukan.`;
        errors.push(msg);
        issues.push({ row: rowNum, column: 'KELAS_PESERTA', message: msg });
      } else {
        classIds.push(cid);
      }
    }
    const startMs = Date.parse(rawStart);
    const endMs = Date.parse(rawEnd);
    const deadlineMs = Date.parse(rawDeadline || rawEnd);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
      const msg = 'Format WAKTU_MULAI / WAKTU_SELESAI tidak valid atau waktu selesai <= waktu mulai.';
      errors.push(msg);
      issues.push({ row: rowNum, column: 'WAKTU_MULAI', message: msg });
    }

    rows.push({
      row: rowNum,
      title,
      examType,
      subjectCode,
      subjectId,
      questionBankName,
      questionBankId,
      classIds,
      classNames: rawClasses,
      questionCount: Number.isNaN(questionCount) || questionCount <= 0 ? 10 : questionCount,
      durationMinutes: Number.isNaN(durationMinutes) || durationMinutes <= 0 ? 60 : durationMinutes,
      passingScore: Number.isNaN(passingScore) ? 75 : passingScore,
      shuffleMode,
      startAt: Number.isNaN(startMs) ? new Date().toISOString() : new Date(startMs).toISOString(),
      entryDeadlineAt: Number.isNaN(deadlineMs) ? new Date(endMs || Date.now()).toISOString() : new Date(deadlineMs).toISOString(),
      endAt: Number.isNaN(endMs) ? new Date().toISOString() : new Date(endMs).toISOString(),
      publicationPolicy,
      valid: errors.length === 0,
      errors,
    });
  });

  return { rows, issues };
}

// ======================== STAFF (PENGAWAS) EXCEL TEMPLATE & IMPORT ========================
export interface ParsedStaffImportRow {
  row: number;
  username: string;
  fullName: string;
  password: string;
  assignedClassIds: string[];
  assignedClassNames: string[];
  canUnlockSessions: boolean;
  valid: boolean;
  errors: string[];
}

export function buildStaffTemplateWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([
    {
      USERNAME: 'pengawas2',
      NAMA_LENGKAP: 'Budi Santoso, S.Pd.',
      PASSWORD: 'Pengawas#2026',
      KELAS_TUGAS: 'XII-IPA-1, XII-IPA-2',
      IZIN_BUKA_KUNCI: 'Ya',
    },
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Pengawas');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function previewStaffExcelImport(
  buffer: Buffer,
  existingUsernames: Set<string>,
  classByName: Map<string, string>
): { rows: ParsedStaffImportRow[]; issues: ImportIssue[] } {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { rows: [], issues: [{ row: 0, column: 'FILE', message: 'File Excel kosong.' }] };
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: '' });
  const rows: ParsedStaffImportRow[] = [];
  const issues: ImportIssue[] = [];
  const seen = new Set<string>();

  raw.forEach((item, idx) => {
    const rowNum = idx + 2;
    const username = String(item['USERNAME'] ?? item['username'] ?? '').trim();
    const fullName = String(item['NAMA_LENGKAP'] ?? item['NAMA'] ?? '').trim();
    const password = String(item['PASSWORD'] ?? 'Pengawas#2026').trim() || 'Pengawas#2026';
    const rawClasses = String(item['KELAS_TUGAS'] ?? '').split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
    const unlockRaw = String(item['IZIN_BUKA_KUNCI'] ?? '').trim().toLowerCase();
    const canUnlockSessions = unlockRaw === 'ya' || unlockRaw === '1' || unlockRaw === 'true' || unlockRaw === 'yes';

    const errors: string[] = [];
    if (!username || username.length < 3) {
      const msg = 'Username wajib minimal 3 karakter.';
      errors.push(msg);
      issues.push({ row: rowNum, column: 'USERNAME', message: msg });
    } else if (seen.has(username) || existingUsernames.has(username)) {
      const msg = `Username "${username}" sudah ada atau duplikat.`;
      errors.push(msg);
      issues.push({ row: rowNum, column: 'USERNAME', message: msg });
    }
    seen.add(username);

    if (!fullName) {
      const msg = 'Nama lengkap wajib diisi.';
      errors.push(msg);
      issues.push({ row: rowNum, column: 'NAMA_LENGKAP', message: msg });
    }

    const assignedClassIds: string[] = [];
    for (const cn of rawClasses) {
      const cid = classByName.get(cn);
      if (!cid) {
        const msg = `Kelas "${cn}" tidak ditemukan.`;
        errors.push(msg);
        issues.push({ row: rowNum, column: 'KELAS_TUGAS', message: msg });
      } else {
        assignedClassIds.push(cid);
      }
    }

    rows.push({
      row: rowNum,
      username,
      fullName,
      password,
      assignedClassIds,
      assignedClassNames: rawClasses,
      canUnlockSessions,
      valid: errors.length === 0,
      errors,
    });
  });

  return { rows, issues };
}

