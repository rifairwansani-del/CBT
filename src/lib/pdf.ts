import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getAuthToken } from './api.ts';
import { formatBirthPlaceDate, formatGender } from './format.ts';
import type { InstitutionBranding, ParticipantCardSettings } from '../types/cbt.ts';

function getImageFormat(dataUrl: string): 'PNG' | 'JPEG' {
  return dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
}

function printPdfDoc(doc: jsPDF) {
  doc.autoPrint();
  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.src = blobUrl;
  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      // Fallback: ignore if browser blocks programmatic print inside sandbox
    }
    window.setTimeout(() => {
      iframe.remove();
      URL.revokeObjectURL(blobUrl);
    }, 60000);
  };
  document.body.appendChild(iframe);
}

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
    printPdfDoc(doc);
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

export interface ParticipantCardStudentInput {
  fullName: string;
  nis: string;
  nisn?: string;
  birthPlace?: string;
  birthDate?: string;
  gender?: string;
  email?: string;
  className: string;
  photoUrl?: string | null;
  pinDisplay?: string;
  exams?: Array<{
    title: string;
    subjectName: string;
    startAt: string;
    durationMinutes: number;
  }>;
}

export async function generateParticipantCardsPDF(params: {
  institution: InstitutionBranding;
  cardSettings: ParticipantCardSettings;
  students: ParticipantCardStudentInput[];
  mode?: 'download' | 'print';
  filename?: string;
}) {
  const { institution, cardSettings, students, mode = 'download', filename } = params;
  if (!students || students.length === 0) return;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const logoData = await fetchImageAsDataUrl(institution.logoEndpoint || '/api/branding/logo');

  // Pre-fetch student photos cleanly
  const photoDataMap = new Map<string, string | null>();
  await Promise.all(
    students.map(async (s) => {
      if (s.photoUrl && !photoDataMap.has(s.photoUrl)) {
        const dataUrl = await fetchImageAsDataUrl(s.photoUrl);
        photoDataMap.set(s.photoUrl, dataUrl);
      }
    })
  );

  const cardWidth = 186;
  const cardHeight = 132;
  const cardX = 12;

  students.forEach((stu, idx) => {
    if (idx > 0 && idx % 2 === 0) {
      doc.addPage();
    }
    const slot = idx % 2;
    const cardY = slot === 0 ? 11 : 153;

    // Dashed cut separator between top and bottom card
    if (slot === 1) {
      doc.setDrawColor(148, 163, 184);
      doc.setLineDashPattern([2, 2], 0);
      doc.line(10, 148, 200, 148);
      doc.setLineDashPattern([], 0);
    }

    // Outer Card Frame
    doc.setDrawColor(30, 58, 138);
    doc.setLineWidth(0.6);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(cardX, cardY, cardWidth, cardHeight, 2.5, 2.5, 'FD');

    // Header Banner
    doc.setFillColor(30, 58, 138);
    doc.roundedRect(cardX, cardY, cardWidth, 21, 2.5, 2.5, 'F');
    doc.rect(cardX, cardY + 14, cardWidth, 7, 'F');

    if (logoData) {
      try {
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(cardX + 4, cardY + 3, 15, 15, 1.5, 1.5, 'F');
        doc.addImage(logoData, getImageFormat(logoData), cardX + 4.8, cardY + 3.8, 13.4, 13.4);
      } catch {
        // skip invalid logo image
      }
    }

    const headerTextX = logoData ? cardX + 23 : cardX + 6;
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text((cardSettings.cardTitle || 'KARTU PESERTA UJIAN').toUpperCase(), headerTextX, cardY + 7.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(`${institution.name.toUpperCase()} · TA ${institution.academicYear}`, headerTextX, cardY + 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(224, 242, 254);
    doc.text(institution.address || '', headerTextX, cardY + 17.8, { maxWidth: cardWidth - 30 });

    // Portrait Photo Box (3:4 ratio)
    const photoX = cardX + 6;
    const photoY = cardY + 26;
    const photoW = 28;
    const photoH = 37;
    const stuPhoto = stu.photoUrl ? photoDataMap.get(stu.photoUrl) : null;
    if (stuPhoto) {
      try {
        doc.addImage(stuPhoto, getImageFormat(stuPhoto), photoX, photoY, photoW, photoH);
        doc.setDrawColor(199, 210, 254);
        doc.setLineWidth(0.35);
        doc.rect(photoX, photoY, photoW, photoH);
      } catch {
        doc.setDrawColor(203, 213, 225);
        doc.rect(photoX, photoY, photoW, photoH);
      }
    } else {
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(203, 213, 225);
      doc.rect(photoX, photoY, photoW, photoH, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text('Pas Foto\n3 x 4', photoX + photoW / 2, photoY + 17, { align: 'center' });
    }

    // Student Identity Rows
    const infoX = cardX + 39;
    let infoY = cardY + 29.5;
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(stu.fullName, infoX, infoY, { maxWidth: 138 });
    infoY += 5.5;

    const rows: Array<[string, string]> = [
      ['NIS / NISN', `${stu.nis}${stu.nisn ? ` / ${stu.nisn}` : ''}`],
      ['Jenis Kelamin', formatGender(stu.gender, '-')],
      ['Tempat, Tgl Lahir', formatBirthPlaceDate(stu.birthPlace, stu.birthDate, '-')],
      ['Kelas', stu.className],
      ['Alamat Email', stu.email?.trim() || '-'],
      ['Ruang / Sesi', cardSettings.examSessionNote?.trim() || 'Ruang CBT Terpadu'],
    ];
    if (cardSettings.showPinOnCard && stu.pinDisplay) {
      rows.push(['PIN Ujian', stu.pinDisplay]);
    }

    doc.setFontSize(8.3);
    rows.forEach(([label, val]) => {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text(label, infoX, infoY);
      doc.setFont('helvetica', label === 'PIN Ujian' || label === 'NIS / NISN' ? 'bold' : 'normal');
      doc.setTextColor(label === 'PIN Ujian' ? 30 : 15, label === 'PIN Ujian' ? 58 : 23, label === 'PIN Ujian' ? 138 : 42);
      doc.text(`: ${val}`, infoX + 31, infoY, { maxWidth: 108 });
      infoY += 4.8;
    });

    // Exam schedule compact box
    const schedY = cardY + 69;
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.roundedRect(cardX + 6, schedY, cardWidth - 12, 27, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.setTextColor(30, 58, 138);
    doc.text('JADWAL UJIAN TERDAFTAR', cardX + 9, schedY + 4.8);

    const examList = (stu.exams || []).slice(0, 3);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(51, 65, 85);
    if (examList.length === 0) {
      doc.text('Mengikuti jadwal resmi kelas pada portal peserta SinarCBT.', cardX + 9, schedY + 11);
    } else {
      examList.forEach((ex, exIdx) => {
        const dtStr = new Date(ex.startAt).toLocaleString('id-ID', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        });
        const line = `${exIdx + 1}. ${ex.title} (${ex.subjectName}) · ${dtStr} · ${ex.durationMinutes} mnt`;
        doc.text(line, cardX + 9, schedY + 10.5 + exIdx * 5.2, { maxWidth: cardWidth - 18 });
      });
      if ((stu.exams || []).length > 3) {
        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        doc.text(`+ ${(stu.exams || []).length - 3} jadwal ujian lainnya tersedia di portal siswa.`, cardX + 9, schedY + 25.2);
      }
    }

    // Bottom Note & Official Signer
    const footerY = cardY + 101;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    doc.setTextColor(71, 85, 105);
    const noteLines = doc.splitTextToSize(
      cardSettings.cardNote || 'Kartu peserta ini wajib dibawa dan ditunjukkan kepada pengawas ruang saat ujian berlangsung.',
      115
    );
    doc.text(noteLines.slice(0, 4), cardX + 6, footerY + 2);

    const signX = cardX + cardWidth - 54;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(51, 65, 85);
    doc.text(cardSettings.signerTitle || 'Ketua Panitia Ujian', signX, footerY + 1);
    doc.setDrawColor(148, 163, 184);
    doc.line(signX, footerY + 18, signX + 46, footerY + 18);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.setTextColor(15, 23, 42);
    doc.text(cardSettings.signerName?.trim() || '( .................................... )', signX, footerY + 22.5, { maxWidth: 48 });
  });

  if (mode === 'print') {
    printPdfDoc(doc);
  } else {
    const safeName =
      filename ||
      (students.length === 1
        ? `Kartu_Peserta_${students[0].nis}_${students[0].fullName.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`
        : `Kartu_Peserta_Ujian_${students.length}_Siswa.pdf`);
    doc.save(safeName);
  }
}
