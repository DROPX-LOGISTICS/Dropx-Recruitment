import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type OfferLetterVariant = "statutory" | "non_statutory";

export type OfferSalaryBreakdown = {
  basic: number;
  hra: number;
  lta: number;
  specialAllowance: number;
  otherAllowance: number;
  employeePf: number;
  professionalTax: number;
  employerPf: number;
};

export type OfferLetterInput = {
  variant: OfferLetterVariant;
  reference: string;
  issueDate: Date;
  validUntil: Date;
  candidateName: string;
  jobTitle: string;
  compensation: string;
  joiningDate: Date;
  location: string;
  locationAddress: string;
  probation: string;
  additionalTerms: string[];
  standardTerms: string[];
  incentiveTerms: string;
  companyName: string;
  signatoryName: string;
  signatoryTitle: string;
  salary: OfferSalaryBreakdown;
};

const A4: [number, number] = [595.28, 841.89];
const ink = rgb(0.10, 0.14, 0.22);
const muted = rgb(0.39, 0.44, 0.52);
const pink = rgb(0.86, 0.08, 0.32);
const orange = rgb(0.96, 0.55, 0.05);
const pale = rgb(0.98, 0.98, 0.99);

function money(value: number) {
  return `INR ${Math.round(value).toLocaleString("en-IN")}`;
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const paragraphs = text.split(/\n/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) { lines.push(""); continue; }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else { if (line) lines.push(line); line = word; }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function drawLines(page: PDFPage, lines: string[], options: {
  x: number; y: number; width: number; font: PDFFont; size?: number; color?: ReturnType<typeof rgb>; lineHeight?: number;
}) {
  const size = options.size ?? 10.2;
  const lineHeight = options.lineHeight ?? size * 1.48;
  let y = options.y;
  for (const line of lines.flatMap((item) => wrap(item, options.font, size, options.width))) {
    if (line) page.drawText(line, { x: options.x, y, size, font: options.font, color: options.color ?? ink });
    y -= lineHeight;
  }
  return y;
}

function formatDate(value: Date) {
  return value.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
}

async function decorate(page: PDFPage, doc: PDFDocument, bold: PDFFont, pageNumber: number, pageCount: number, companyName: string) {
  page.drawRectangle({ x: 0, y: 825, width: A4[0], height: 17, color: orange });
  page.drawRectangle({ x: 210, y: 825, width: A4[0] - 210, height: 17, color: pink });
  try {
    const logoBytes = await readFile(join(process.cwd(), "public", "dropx-logo.png"));
    const logo = await doc.embedPng(logoBytes);
    const scale = Math.min(116 / logo.width, 54 / logo.height);
    page.drawImage(logo, { x: 425, y: 755, width: logo.width * scale, height: logo.height * scale });
  } catch {
    page.drawText("DropX", { x: 470, y: 785, size: 19, font: bold, color: pink });
  }
  page.drawText(companyName.toUpperCase(), { x: 42, y: 790, size: 13, font: bold, color: ink });
  page.drawLine({ start: { x: 42, y: 747 }, end: { x: 553, y: 747 }, thickness: 1.2, color: pink });
  page.drawLine({ start: { x: 42, y: 34 }, end: { x: 553, y: 34 }, thickness: 0.7, color: rgb(0.84, 0.85, 0.88) });
  page.drawText(`Page ${pageNumber} of ${pageCount}`, { x: 486, y: 18, size: 8, font: bold, color: muted });
}

export async function buildOfferLetterPdf(input: OfferLetterInput) {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page1 = doc.addPage(A4);
  const page2 = doc.addPage(A4);
  await decorate(page1, doc, bold, 1, 2, input.companyName);
  await decorate(page2, doc, bold, 2, 2, input.companyName);

  page1.drawText(`Ref: ${input.reference}`, { x: 42, y: 725, size: 9.5, font: regular, color: muted });
  page1.drawText(`Date: ${formatDate(input.issueDate)}`, { x: 390, y: 725, size: 9.5, font: regular, color: muted });
  page1.drawText("OFFER LETTER", { x: 216, y: 688, size: 18, font: bold, color: ink });
  page1.drawText(`Dear ${input.candidateName},`, { x: 42, y: 650, size: 11, font: bold, color: ink });
  let y = drawLines(page1, [
    `Further to the discussions, we are pleased to offer you the position of ${input.jobTitle} with ${input.companyName}.`,
    "",
    `Your monthly remuneration / CTC will be ${input.compensation}. Your proposed date of joining is ${formatDate(input.joiningDate)}.`,
    "",
    `Your initial work location will be ${input.location}${input.locationAddress ? `, ${input.locationAddress}` : ""}. The company may transfer or assign you based on business requirements.`,
    "",
    `You will be on probation for ${input.probation || "the period prescribed by company policy"}. During employment, all company, customer and candidate information must be kept confidential.`,
    "",
    "Employment may be ended by either party in accordance with the notice period and other conditions stated in company policy. This offer remains subject to document, background and statutory verification where applicable."
  ], { x: 42, y: 622, width: 511, font: regular });
  const terms = [...input.standardTerms, ...input.additionalTerms].filter(Boolean);
  if (input.variant === "non_statutory" && input.incentiveTerms) terms.unshift(input.incentiveTerms);
  if (terms.length) {
    page1.drawText("Additional terms", { x: 42, y: y - 4, size: 11, font: bold, color: ink });
    y -= 25;
    for (const [index, term] of terms.slice(0, 5).entries()) {
      y = drawLines(page1, [`${index + 1}. ${term}`], { x: 48, y, width: 500, font: regular, size: 9.4, lineHeight: 13.4 }) - 4;
    }
  }
  y = Math.max(150, y - 8);
  page1.drawText(`Please accept this offer on or before ${formatDate(input.validUntil)}.`, { x: 42, y, size: 10, font: regular, color: ink });
  page1.drawText(`For ${input.companyName}`, { x: 42, y: 104, size: 10, font: bold, color: ink });
  page1.drawLine({ start: { x: 42, y: 69 }, end: { x: 210, y: 69 }, thickness: 0.7, color: muted });
  page1.drawText(input.signatoryName, { x: 42, y: 56, size: 9.5, font: bold, color: ink });
  page1.drawText(input.signatoryTitle, { x: 42, y: 43, size: 9, font: regular, color: muted });

  if (input.variant === "statutory") {
    page2.drawText("SALARY ANNEXURE", { x: 205, y: 704, size: 17, font: bold, color: ink });
    page2.drawText(`${input.candidateName} — ${input.jobTitle}`, { x: 42, y: 674, size: 10.5, font: bold, color: ink });
    const salaryRows: Array<[string, number]> = [
      ["Basic salary", input.salary.basic], ["House Rent Allowance", input.salary.hra],
      ["Leave Travel Allowance", input.salary.lta], ["Special allowance", input.salary.specialAllowance],
      ["Other allowance", input.salary.otherAllowance]
    ];
    const gross = salaryRows.reduce((sum, row) => sum + row[1], 0);
    const deductions = input.salary.employeePf + input.salary.professionalTax;
    const net = gross - deductions;
    const ctc = gross + input.salary.employerPf;
    let tableY = 642;
    page2.drawRectangle({ x: 42, y: tableY - 2, width: 511, height: 24, color: pale });
    page2.drawText("Monthly component", { x: 54, y: tableY + 6, size: 9.5, font: bold, color: ink });
    page2.drawText("Amount", { x: 460, y: tableY + 6, size: 9.5, font: bold, color: ink });
    tableY -= 24;
    for (const [label, value] of salaryRows) {
      page2.drawText(label, { x: 54, y: tableY, size: 9.5, font: regular, color: ink });
      page2.drawText(money(value), { x: 446, y: tableY, size: 9.5, font: regular, color: ink });
      page2.drawLine({ start: { x: 42, y: tableY - 7 }, end: { x: 553, y: tableY - 7 }, thickness: 0.45, color: rgb(0.87, 0.88, 0.90) });
      tableY -= 24;
    }
    const totals: Array<[string, number]> = [
      ["Gross salary", gross], ["Employee PF", input.salary.employeePf],
      ["Professional tax", input.salary.professionalTax], ["Estimated take-home", net],
      ["Employer PF", input.salary.employerPf], ["Monthly CTC", ctc]
    ];
    for (const [label, value] of totals) {
      page2.drawText(label, { x: 54, y: tableY, size: 9.5, font: bold, color: ink });
      page2.drawText(money(value), { x: 446, y: tableY, size: 9.5, font: bold, color: ink });
      tableY -= 23;
    }
    drawLines(page2, ["Note: Net take-home may change based on statutory deductions, tax declarations and applicable law."], { x: 42, y: tableY - 4, width: 511, font: regular, size: 8.7, color: muted });
  } else {
    page2.drawText("OFFER ACCEPTANCE", { x: 203, y: 704, size: 17, font: bold, color: ink });
    drawLines(page2, [
      `I, ${input.candidateName}, accept the offer of employment for the position of ${input.jobTitle} with ${input.companyName}.`,
      "",
      "I confirm that I have read and understood the terms in this offer letter and agree to comply with applicable company policies."
    ], { x: 42, y: 658, width: 511, font: regular, size: 10.5 });
  }

  page2.drawText("Candidate acceptance", { x: 42, y: 190, size: 11, font: bold, color: ink });
  page2.drawLine({ start: { x: 42, y: 145 }, end: { x: 240, y: 145 }, thickness: 0.7, color: muted });
  page2.drawText(input.candidateName, { x: 42, y: 130, size: 9.5, font: bold, color: ink });
  page2.drawText("Signature", { x: 42, y: 116, size: 9, font: regular, color: muted });
  page2.drawLine({ start: { x: 355, y: 145 }, end: { x: 553, y: 145 }, thickness: 0.7, color: muted });
  page2.drawText("Date", { x: 355, y: 116, size: 9, font: regular, color: muted });

  doc.setTitle(`Offer Letter - ${input.candidateName}`);
  doc.setAuthor(input.companyName);
  doc.setSubject(`${input.variant === "statutory" ? "Statutory" : "Non-statutory"} employment offer`);
  return doc.save();
}
