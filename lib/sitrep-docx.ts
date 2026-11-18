import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import {
  documentId,
  headlineLevel,
  LEVELS,
  LIMITS,
  tambonRows,
  type Level,
  type Period,
  type Sitrep,
} from "@/lib/sitrep";

/**
 * The SITREP as a Word file.
 *
 * Why Word as well as the printed page: the page becomes a PDF, which is what gets filed, but a
 * Thai district or provincial office works in Word. A report they can paste their own heading on
 * and put into their own memo is a report that gets used; a PDF is a report that gets retyped.
 *
 * Every word in here comes from `messages/*.json` through the `text` map the route passes in:
 * this file knows no copy of its own, so the document and the page can never drift apart, and the
 * reviewed Thai is the Thai that prints (CLAUDE.md: no hardcoded strings).
 *
 * Typography: IBM Plex Sans Thai, the brand face (docs/brand.md), with body text at 11 pt - the
 * print equivalent of the app's 18 px Thai minimum - and no colour anywhere. A level is a word.
 */

export type DocxText = {
  /** Every string the document prints, already translated and filled by the route. */
  kicker: string;
  title: string;
  unitLine: string;
  period: string;
  areaLine: string;
  docLine: string;
  alertsTitle: string;
  alertsNone: string;
  alertsHeadline: string;
  alertsIssued: string | null;
  alertRows: { level: string; tambons: string; reason: string; times: string; stale: string | null }[];
  figuresTitle: string;
  figures: { label: string; value: string }[];
  breakdown: string;
  flagged: string | null;
  byTambonTitle: string;
  byTambonNone: string;
  tableHead: string[];
  tableRows: string[][];
  placesTitle: string;
  placesCounts: string;
  placesRows: string[];
  gaugesTitle: string;
  gaugeRows: string[];
  limitsTitle: string;
  limits: string[];
  hotlines: string;
  credit: string;
  footer: string;
};

const FONT = "IBM Plex Sans Thai";

function heading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120 },
    children: [new TextRun({ text, font: FONT, size: 26, bold: true, color: "1D3B53" })],
  });
}

function body(text: string, opts: { bold?: boolean; small?: boolean } = {}): Paragraph {
  return new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({
        text,
        font: FONT,
        size: opts.small ? 18 : 22,
        bold: opts.bold ?? false,
        color: opts.small ? "4A5A66" : "1A1A1A",
      }),
    ],
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, font: FONT, size: 22 })],
  });
}

function cell(text: string, opts: { head?: boolean } = {}): TableCell {
  return new TableCell({
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: [
      new Paragraph({
        children: [
          new TextRun({ text, font: FONT, size: 18, bold: opts.head ?? false }),
        ],
      }),
    ],
  });
}

export async function sitrepDocx(
  sitrep: Sitrep,
  period: Period,
  text: DocxText,
): Promise<Buffer> {
  const rows = tambonRows(sitrep);
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({ text: text.kicker, font: FONT, size: 18, color: "4A5A66", allCaps: false }),
      ],
    }),
    new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: text.title, font: FONT, size: 36, bold: true, color: "1D3B53" })],
    }),
    body(text.unitLine, { bold: true }),
    body(text.period),
    body(text.areaLine, { small: true }),
    body(text.docLine, { small: true }),
    new Paragraph({
      spacing: { after: 160 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "D7DDE2" } },
      children: [],
    }),

    heading(text.alertsTitle),
  ];

  if (text.alertRows.length === 0) {
    children.push(body(text.alertsNone));
  } else {
    children.push(body(text.alertsHeadline, { bold: true }));
    for (const a of text.alertRows) {
      children.push(body(`${a.level} · ${a.tambons}`, { bold: true }));
      if (a.reason) children.push(body(a.reason));
      children.push(body(a.times, { small: true }));
      if (a.stale) children.push(body(a.stale, { small: true }));
    }
  }
  if (text.alertsIssued) children.push(body(text.alertsIssued, { small: true }));

  children.push(heading(text.figuresTitle));
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          children: text.figures.map((f) => cell(f.label, { head: true })),
        }),
        new TableRow({ children: text.figures.map((f) => cell(f.value)) }),
      ],
    }),
  );
  children.push(body(text.breakdown, { small: true }));
  if (text.flagged) children.push(body(text.flagged, { small: true }));

  children.push(heading(text.byTambonTitle));
  if (rows.length === 0) {
    children.push(body(text.byTambonNone));
  } else {
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: text.tableHead.map((h) => cell(h, { head: true })),
          }),
          ...text.tableRows.map((r) => new TableRow({ children: r.map((v) => cell(v)) })),
        ],
      }),
    );
  }

  children.push(heading(text.placesTitle));
  children.push(body(text.placesCounts));
  for (const p of text.placesRows) children.push(bullet(p));

  if (text.gaugeRows.length > 0) {
    children.push(heading(text.gaugesTitle));
    for (const g of text.gaugeRows) children.push(bullet(g));
  }

  // The limits are a section of the document, in the body, never an appendix: a Word file is
  // forwarded and excerpted, and they have to travel with the figures (safety rule 8).
  children.push(heading(text.limitsTitle));
  for (const l of text.limits) children.push(bullet(l));
  children.push(body(text.hotlines, { small: true }));
  children.push(body(text.credit, { small: true }));

  const doc = new Document({
    creator: "Jaga",
    title: `${text.title} · ${documentId(sitrep.unit.id, period)}`,
    description: text.period,
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [
      {
        properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: `${text.footer} · `, font: FONT, size: 16, color: "4A5A66" }),
                  new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: "4A5A66" }),
                  new TextRun({ text: "/", font: FONT, size: 16, color: "4A5A66" }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: "4A5A66" }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/** The levels present in a report, for the "issued in this period" line. */
export function issuedLevels(sitrep: Sitrep): Level[] {
  return LEVELS.filter((l) => (sitrep.alerts_issued[l] ?? 0) > 0);
}

export { headlineLevel, LIMITS };
