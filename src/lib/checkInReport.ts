// ============================================================================
// ElderWatch check-in reports (PDF)
// ============================================================================
// One renderer, two reports, so they always look the same:
//
//   buildDailyReportPdf()   - today only, one row per resident (Yes / No)
//   buildPeriodReportPdf()  - the 7 / 30 day export, one row per check-in
//
// Shared look: emerald header band, the home name, a large date-or-period
// heading, a "checked in / not checked in" summary, a grid table whose verdict
// cell is filled green (Yes) or red (No), page numbers and a legend.
//
// Kept in lib/ (not inline in AdminPanel) so the exact same code path can be run
// and tested outside the browser.

type JsPdfDoc = InstanceType<typeof import('jspdf').jsPDF>;

export interface ReportResident {
  name: string;
  roomNumber?: string;
  unitNumber?: string;
  todayStatus?: string;
  isAway?: boolean;
}

export interface ReportRecord {
  residentName?: string;
  roomNumber?: string;
  unitNumber?: string;
  date?: string;
  status?: string;
  timestamp?: string;
}

const COLORS = {
  emerald: [21, 122, 76] as [number, number, number],
  red: [197, 48, 48] as [number, number, number],
  ink: [18, 24, 21] as [number, number, number],
  muted: [110, 120, 115] as [number, number, number],
  line: [222, 226, 224] as [number, number, number],
};

const PAGE_MARGIN = 14;
const LEGEND = 'Yes = resident checked in.    No = no check-in recorded.';

/** A resident counts as checked in only when the status is 'ok'. */
export function isCheckedIn(status?: string): boolean {
  return status === 'ok';
}

/** Room first (every resident has one), unit appended when the record has it. */
export function unitLabel(r: { roomNumber?: string; unitNumber?: string }): string {
  const room = (r.roomNumber ?? '').toString().trim();
  const unit = (r.unitNumber ?? '').toString().trim();
  if (room && unit) return `${room} / ${unit}`;
  return room || unit || '—';
}

function formatLongDate(date: string): string {
  try {
    return new Intl.DateTimeFormat('en-ZA', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    }).format(new Date(`${date}T00:00:00Z`));
  } catch {
    return date;
  }
}

function formatShortDate(date?: string): string {
  if (!date) return '—';
  try {
    return new Intl.DateTimeFormat('en-ZA', {
      day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
    }).format(new Date(`${date}T00:00:00Z`));
  } catch {
    return date;
  }
}

function formatStamp(d: Date): string {
  try {
    return new Intl.DateTimeFormat('en-ZA', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      hour12: false, timeZone: 'Africa/Johannesburg',
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

export function dailyReportFileName(homeName: string, date: string): string {
  return `ElderWatch_Daily_${homeName.replace(/[^a-zA-Z0-9]+/g, '_')}_${date}.pdf`;
}

export function periodReportFileName(homeName: string, label: string, start: string, end: string): string {
  return `ElderWatch_${label.replace(/[^a-zA-Z0-9]+/g, '_')}_${homeName.replace(/[^a-zA-Z0-9]+/g, '_')}_${start}_to_${end}.pdf`;
}

interface RenderSpec {
  title: string;
  homeName: string;
  heading: string;
  summary: string;
  columns: string[];
  rows: string[][];
  /** Index of the Yes/No column that gets the coloured cell. */
  verdictColumn: number;
  /** Fractions of the printable width, one per column. */
  widths: number[];
  legend?: string;
  emptyMessage?: string;
  generatedAt?: Date;
}

async function renderReport(spec: RenderSpec): Promise<JsPdfDoc> {
  const { jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const generatedAt = spec.generatedAt || new Date();

  // Header band
  doc.setFillColor(...COLORS.emerald);
  doc.rect(0, 0, 210, 26, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(17);
  doc.setFont('helvetica', 'bold');
  doc.text(spec.title, 14, 13);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(spec.homeName, 14, 20);

  // Heading + summary
  doc.setTextColor(...COLORS.ink);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(spec.heading, 14, 36);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.muted);
  doc.text(spec.summary, 14, 43);

  if (!spec.rows.length) {
    doc.setFontSize(11);
    doc.setTextColor(...COLORS.muted);
    doc.text(spec.emptyMessage || 'No records for this period.', 14, 55);
    return doc;
  }

  const printable = doc.internal.pageSize.getWidth() - PAGE_MARGIN * 2;
  const columnStyles: Record<number, any> = {};
  spec.columns.forEach((_, i) => {
    columnStyles[i] = { cellWidth: printable * (spec.widths[i] ?? 1 / spec.columns.length) };
  });
  columnStyles[spec.verdictColumn] = {
    ...columnStyles[spec.verdictColumn],
    halign: 'center',
    fontStyle: 'bold',
    textColor: [255, 255, 255],
  };

  (autoTable as any)(doc, {
    startY: 49,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    head: [spec.columns],
    body: spec.rows,
    theme: 'grid',
    styles: { fontSize: 10, cellPadding: 2.4, lineColor: COLORS.line, lineWidth: 0.2, textColor: COLORS.ink },
    headStyles: { fillColor: COLORS.emerald, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'left' },
    columnStyles,
    // Colour the verdict cell itself: green = checked in, red = not.
    didParseCell: (data: any) => {
      if (data.section !== 'body' || data.column.index !== spec.verdictColumn) return;
      data.cell.styles.fillColor = data.cell.raw === 'Yes' ? COLORS.emerald : COLORS.red;
    },
    didDrawPage: () => {
      const page = doc.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(...COLORS.muted);
      doc.text(`Generated ${formatStamp(generatedAt)} by ElderWatch`, PAGE_MARGIN, 290);
      doc.text(`Page ${page}`, 196, 290, { align: 'right' });
    },
  });

  const endY = Math.min(((doc as any).lastAutoTable?.finalY || 60) + 10, 278);
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  doc.text(spec.legend || LEGEND, PAGE_MARGIN, endY);

  return doc;
}

/** Today only: one row per resident of the home. */
export async function buildDailyReportPdf(options: {
  homeName: string;
  date: string;
  residents: ReportResident[];
  generatedAt?: Date;
}): Promise<JsPdfDoc> {
  const { homeName, date, residents } = options;

  const rows = [...residents].sort((a, b) =>
    String(a.roomNumber ?? '').localeCompare(String(b.roomNumber ?? ''), undefined, { numeric: true }) ||
    a.name.localeCompare(b.name)
  );

  const checkedIn = rows.filter((r) => isCheckedIn(r.todayStatus)).length;

  return renderReport({
    title: 'Daily Check-In Report',
    homeName,
    heading: formatLongDate(date),
    summary: `Checked in: ${checkedIn} of ${rows.length}    •    Not checked in: ${rows.length - checkedIn}`,
    columns: ['Name', 'Room / Unit', 'Checked in'],
    widths: [0.46, 0.27, 0.27],
    verdictColumn: 2,
    rows: rows.map((r) => [r.name || '—', unitLabel(r), isCheckedIn(r.todayStatus) ? 'Yes' : 'No']),
    legend: 'Yes = resident checked in today.    No = no check-in recorded by report time.',
    emptyMessage: 'No residents found for this home.',
    generatedAt: options.generatedAt,
  });
}

/** 7 / 30 day export: one row per check-in record. */
export async function buildPeriodReportPdf(options: {
  homeName: string;
  startDate: string;
  endDate: string;
  periodLabel?: string;
  records: ReportRecord[];
  generatedAt?: Date;
}): Promise<JsPdfDoc> {
  const { homeName, startDate, endDate, records } = options;

  const rows = [...records].sort((a, b) => {
    const byName = (a.residentName || '').localeCompare(b.residentName || '');
    if (byName !== 0) return byName;
    return (a.date || '').localeCompare(b.date || '');
  });

  const checkedIn = rows.filter((r) => isCheckedIn(r.status)).length;
  const heading =
    startDate === endDate
      ? formatLongDate(startDate)
      : `${formatShortDate(startDate)}  –  ${formatShortDate(endDate)}`;

  return renderReport({
    title: options.periodLabel ? `${options.periodLabel} Check-In Report` : 'Check-In Report',
    homeName,
    heading,
    summary: `Records: ${rows.length}    •    Checked in: ${checkedIn}    •    Not checked in: ${rows.length - checkedIn}`,
    columns: ['Name', 'Room / Unit', 'Date', 'Checked in'],
    widths: [0.40, 0.24, 0.18, 0.18],
    verdictColumn: 3,
    rows: rows.map((r) => [
      r.residentName || '—',
      unitLabel(r),
      formatShortDate(r.date),
      isCheckedIn(r.status) ? 'Yes' : 'No',
    ]),
    legend: 'Yes = checked in that day.    No = no check-in recorded (awaiting, no response or help requested).',
    emptyMessage: 'No check-ins found for this period.',
    generatedAt: options.generatedAt,
  });
}
