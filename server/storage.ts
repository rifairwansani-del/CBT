import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';

export const PRIVATE_STORAGE_ROOT = path.resolve(process.cwd(), 'private_storage');
export const PHOTOS_DIR = path.join(PRIVATE_STORAGE_ROOT, 'photos');
export const MEDIA_DIR = path.join(PRIVATE_STORAGE_ROOT, 'media');
export const BRANDING_DIR = path.join(PRIVATE_STORAGE_ROOT, 'branding');

export function ensureStorageDirs() {
  for (const dir of [PRIVATE_STORAGE_ROOT, PHOTOS_DIR, MEDIA_DIR, BRANDING_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export const MAX_PHOTO_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_MEDIA_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export function detectImageMimeFromMagicBytes(buf: Buffer): 'image/jpeg' | 'image/png' | null {
  if (!buf || buf.length < 8) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  return null;
}

export function sanitizeIdForFilename(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '');
}

export function savePrivateStudentPhoto(studentId: string, buffer: Buffer): { path: string; mime: string; size: number } {
  ensureStorageDirs();
  if (buffer.length > MAX_PHOTO_SIZE_BYTES) {
    throw new Error('Ukuran file melebihi batas maksimal 2 MB.');
  }
  const mime = detectImageMimeFromMagicBytes(buffer);
  if (!mime) {
    throw new Error('Format isi file tidak valid. Hanya JPG, JPEG, dan PNG asli yang diizinkan.');
  }
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  const safeId = sanitizeIdForFilename(studentId);
  // Remove previous photo files for this student
  for (const oldExt of ['jpg', 'jpeg', 'png']) {
    const oldPath = path.join(PHOTOS_DIR, `${safeId}.${oldExt}`);
    if (fs.existsSync(oldPath)) {
      fs.unlinkSync(oldPath);
    }
  }
  const filename = `${safeId}.${ext}`;
  const fullPath = path.join(PHOTOS_DIR, filename);
  fs.writeFileSync(fullPath, buffer);
  return { path: filename, mime, size: buffer.length };
}

export function deletePrivateStudentPhoto(photoPath: string | null) {
  if (!photoPath) return;
  const safeName = path.basename(photoPath);
  const fullPath = path.join(PHOTOS_DIR, safeName);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}

export function readPrivateStudentPhoto(photoPath: string): Buffer | null {
  const safeName = path.basename(photoPath);
  const fullPath = path.join(PHOTOS_DIR, safeName);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath);
}

export function saveQuestionMedia(fileId: string, buffer: Buffer): { path: string; mime: string; size: number } {
  ensureStorageDirs();
  if (buffer.length > MAX_MEDIA_SIZE_BYTES) {
    throw new Error('Ukuran media soal melebihi batas 5 MB.');
  }
  const mime = detectImageMimeFromMagicBytes(buffer);
  if (!mime) {
    throw new Error('Media gambar soal hanya mendukung JPG/JPEG/PNG yang valid.');
  }
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  const filename = `${sanitizeIdForFilename(fileId)}.${ext}`;
  fs.writeFileSync(path.join(MEDIA_DIR, filename), buffer);
  return { path: filename, mime, size: buffer.length };
}

export function saveBrandingLogo(buffer: Buffer): { path: string; mime: string } {
  ensureStorageDirs();
  if (buffer.length > MAX_PHOTO_SIZE_BYTES) {
    throw new Error('Ukuran logo melebihi 2 MB.');
  }
  const mime = detectImageMimeFromMagicBytes(buffer);
  if (!mime) {
    throw new Error('Logo lembaga harus berformat JPG atau PNG yang valid.');
  }
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  const filename = `institution_logo.${ext}`;
  fs.writeFileSync(path.join(BRANDING_DIR, filename), buffer);
  return { path: filename, mime };
}

export interface BulkZipPhotoEntry {
  entryName: string;
  baseName: string;
  nisCandidate: string;
  status: 'matched' | 'not_found' | 'duplicate_nis_in_zip' | 'invalid_format' | 'oversize';
  reason?: string;
  studentId?: string;
  studentName?: string;
  className?: string;
  mime?: string;
  size?: number;
  previewBase64?: string;
}

export function parseBulkPhotoZip(
  zipBuffer: Buffer,
  findStudentByNis: (nis: string) => { id: string; nis: string; full_name: string; class_name: string } | undefined
): { entries: BulkZipPhotoEntry[]; validBuffers: Map<string, Buffer> } {
  const zip = new AdmZip(zipBuffer);
  const rawEntries = zip.getEntries();
  const entries: BulkZipPhotoEntry[] = [];
  const validBuffers = new Map<string, Buffer>();
  const seenNis = new Map<string, number>();

  for (const zEntry of rawEntries) {
    if (zEntry.isDirectory) continue;
    const entryName = zEntry.entryName;
    if (entryName.startsWith('__MACOSX') || path.basename(entryName).startsWith('.')) continue;

    const baseName = path.basename(entryName);
    const ext = path.extname(baseName).toLowerCase();
    const nisCandidate = path.basename(baseName, ext).trim();

    if (!['.jpg', '.jpeg', '.png'].includes(ext)) {
      entries.push({
        entryName,
        baseName,
        nisCandidate,
        status: 'invalid_format',
        reason: 'Ekstensi file bukan .jpg, .jpeg, atau .png.',
      });
      continue;
    }

    const buf = zEntry.getData();
    if (buf.length > MAX_PHOTO_SIZE_BYTES) {
      entries.push({
        entryName,
        baseName,
        nisCandidate,
        status: 'oversize',
        size: buf.length,
        reason: `Ukuran file ${(buf.length / (1024 * 1024)).toFixed(2)} MB melebihi batas 2 MB.`,
      });
      continue;
    }

    const mime = detectImageMimeFromMagicBytes(buf);
    if (!mime) {
      entries.push({
        entryName,
        baseName,
        nisCandidate,
        status: 'invalid_format',
        reason: 'Isi file bukan gambar JPG/PNG yang sah (gagal pemeriksaan magic bytes).',
      });
      continue;
    }

    const count = (seenNis.get(nisCandidate) || 0) + 1;
    seenNis.set(nisCandidate, count);
    if (count > 1) {
      entries.push({
        entryName,
        baseName,
        nisCandidate,
        status: 'duplicate_nis_in_zip',
        size: buf.length,
        mime,
        reason: `NIS "${nisCandidate}" muncul lebih dari satu kali dalam arsip ZIP.`,
      });
      continue;
    }

    const student = findStudentByNis(nisCandidate);
    if (!student) {
      entries.push({
        entryName,
        baseName,
        nisCandidate,
        status: 'not_found',
        size: buf.length,
        mime,
        reason: `NIS "${nisCandidate}" tidak terdaftar pada database siswa.`,
      });
      continue;
    }

    validBuffers.set(student.id, buf);
    entries.push({
      entryName,
      baseName,
      nisCandidate,
      status: 'matched',
      studentId: student.id,
      studentName: student.full_name,
      className: student.class_name,
      mime,
      size: buf.length,
      previewBase64: `data:${mime};base64,${buf.toString('base64')}`,
    });
  }

  return { entries, validBuffers };
}
