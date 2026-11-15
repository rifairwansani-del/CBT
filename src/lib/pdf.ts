import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getAuthToken } from './api.ts';
import { formatBirthPlaceDate, formatGender } from './format.ts';
import type { InstitutionBranding } from '../types/cbt.ts';

async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const token = getAuthToken();
    const res = await fetch(url, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export interface RaporStudentInput {
  institution: InstitutionBranding;
  studentName: string;
  nis: string;
  nisn?: string;
  birthPlace?: string;
  birthDate?: string;
  gender?: string;
  email?: string;
  className: string;
  photoUrl?: string | null;
  subjectName: string;
  examTitle: string;
  examType: string;
  examDate: string;
  finalScore: number;
  rawPoints: number;
  maxPoints: number;
  correctCount: number;
  partialCount: number;
  wrongCount: number;
  blankCount: number;
  passingScore: number;
  passed: boolean;
}

export async function generateStudentRaporPDF(data: RaporStudentInput, mode: 'download' | 'print' = 'download') {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const logoData = await fetchImageAsDataUrl(data.institution.logoEndpoint || '/api/branding/logo');
  const photoData = data.photoUrl ? await fetchImageAsDataUrl(data.photoUrl) : null;

  // Header
  if (logoData) {
    doc.addImage(logoData, 'JPEG', 16, 14, 20, 20);
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(data.institution.name.toUpperCase(), 40, 20);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(71, 85, 105);
  doc.text(data.institution.address, 40, 25.5);
  doc.text(`Tahun Ajaran ${data.institution.academicYear} · Zona Waktu ${data.institution.timezone}`, 40, 30.5);

  doc.setDrawColor(30, 58, 138);
  doc.setLineWidth(0.7);
  doc.line(16, 38, 194, 38);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(30, 58, 138);
  doc.text('LAPORAN HASIL EVALUASI UJIAN (RAPOR CBT)', 105, 47, { align: 'center' });

  // Student identity box + official photo
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(16, 54, 178, 56, 2, 2, 'FD');

  if (photoData) {
    doc.addImage(photoData, 'JPEG', 21, 61, 27, 36);
  } else {
    doc.setDrawColor(203, 213, 225);
    doc.rect(21, 61, 27, 36);
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Tanpa Foto', 34.5, 80, { align: 'center' });
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  const infoX = 54;
  const infoRows: Array<[string, string]> = [
    ['Nama Peserta', data.studentName],
    ['NIS / NISN', `${data.nis}${data.nisn ? ` / ${data.nisn}` : ''}`],
    ['Jenis Kelamin', formatGender(data.gender, '-')],
    ['Tempat, Tgl Lahir', formatBirthPlaceDate(data.birthPlace, data.birthDate, '-')],
    ['Alamat Email', data.email?.trim() || '-'],
    ['Kelas', data.className],
    ['Mata Pelajaran', data.subjectName],
    ['Nama & Jenis Ujian', `${data.examTitle} (${data.examType})`],
    ['Tanggal Evaluasi', new Date(data.examDate).toLocaleString('id-ID')],
  ];
  infoRows.forEach(([label, val], idx) => {
    const y = 60.5 + idx * 5.2;
    doc.setFont('helvetica', 'bold');
    doc.text(label, infoX, y);
    doc.setFont('helvetica', 'normal');
    doc.text(`: ${val}`, infoX + 36, y);
  });

  // Score Summary Table
  autoTable(doc, {
    startY: 116,
    margin: { left: 16, right: 16 },
    head: [['Komponen Penilaian', 'Capaian']],
    body: [
      ['Nilai Akhir (Skala 0 - 100)', `${data.finalScore.toFixed(2)}`],
      ['Total Poin Parsial Diperoleh', `${data.rawPoints} / ${data.maxPoints}`],
      ['Jawaban Benar Penuh', `${data.correctCount} butir`],
      ['Jawaban Skor Parsial', `${data.partialCount} butir`],
      ['Jawaban Salah', `${data.wrongCount} butir`],
      ['Tidak Dijawab (Kosong)', `${data.blankCount} butir`],
      ['Batas Ketuntasan Minimal (KKM)', `${data.passingScore}`],
      ['Status Ketuntasan', data.passed ? 'TUNTAS (Mencapai Batas Ketuntasan)' : 'BELUM TUNTAS'],
    ],
    theme: 'grid',
    headStyles: { fillColor: [30, 58, 138], textColor: 255, fontStyle: 'bold' },
    styles: { fontSize: 10, cellPadding: 3.5 },
    columnStyles: { 0: { cellWidth: 95, fontStyle: 'bold' } },
  });

  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('Ringkasan Hasil:', 16, finalY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const summaryText = data.passed
    ? `Peserta atas nama ${data.studentName} (${data.nis}) telah mencapai batas ketuntasan minimal (${data.passingScore}) dengan nilai akhir ${data.finalScore.toFixed(2)} pada ${data.examTitle}.`
    : `Peserta atas nama ${data.studentName} (${data.nis}) memperoleh nilai akhir ${data.finalScore.toFixed(2)} dan belum mencapai batas ketuntasan minimal (${data.passingScore}). Disarankan mengikuti pendalaman materi.`;
  doc.text(doc.splitTextToSize(summaryText, 178), 16, finalY + 6);

  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Dicetak melalui sistem SinarCBT pada ${new Date().toLocaleString('id-ID')}`, 16, 282);

  if (mode === 'print') {
    doc.autoPrint();
    const blobUrl = doc.output('bloburl');
    window.open(blobUrl, '_blank');
  } else {
    doc.save(`Rapor_${data.nis}_${data.examTitle.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
  }
}

export async function generateClassReportPDF(params: {
  institution: InstitutionBranding;
  examTitle: string;
  examType: string;
  subjectName: string;
  summary: {
    participantCount: number;
    highest: number;
    lowest: number;
    average: number;
    median: number;
    passRate: number;
    passingScore: number;
  };
  scores: Array<{
    nis: string;
    full_name: string;
    class_name: string;
    raw_points: number;
    max_points: number;
    final_score: number;
    correct_count: number;
    partial_count: number;
    wrong_count: number;
    blank_count: number;
    passed: number;
  }>;
}) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const logoData = await fetchImageAsDataUrl(params.institution.logoEndpoint || '/api/branding/logo');
  if (logoData) doc.addImage(logoData, 'JPEG', 14, 12, 16, 16);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(params.institution.name.toUpperCase(), 34, 17);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Laporan Rekapitulasi Nilai · ${params.examTitle} (${params.examType}) · ${params.subjectName}`, 34, 23);

  autoTable(doc, {
    startY: 34,
    margin: { left: 14, right: 14 },
    head: [['Peserta', 'Tertinggi', 'Terendah', 'Rata-rata', 'Median', 'Ketuntasan (KKM ' + params.summary.passingScore + ')']],
    body: [[
      String(params.summary.participantCount),
      String(params.summary.highest),
      String(params.summary.lowest),
      String(params.summary.average),
      String(params.summary.median),
      `${params.summary.passRate}%`,
    ]],
    theme: 'grid',
    headStyles: { fillColor: [30, 58, 138] },
    styles: { fontSize: 9, halign: 'center' },
  });

  const y2 = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  autoTable(doc, {
    startY: y2,
    margin: { left: 14, right: 14 },
    head: [['No', 'NIS', 'Nama Lengkap', 'Kelas', 'B / P / S / K', 'Nilai', 'Status']],
    body: params.scores.map((s, idx) => [
      String(idx + 1),
      s.nis,
      s.full_name,
      s.class_name,
      `${s.correct_count} / ${s.partial_count} / ${s.wrong_count} / ${s.blank_count}`,
      s.final_score.toFixed(2),
      s.passed ? 'Tuntas' : 'Belum',
    ]),
    theme: 'striped',
    headStyles: { fillColor: [15, 23, 42] },
    styles: { fontSize: 8.5 },
  });

  doc.save(`Laporan_Kelas_${params.examTitle.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
}
