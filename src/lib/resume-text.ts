import mammoth from "mammoth";
import pdf from "pdf-parse/lib/pdf-parse.js";

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_LENGTH = 45_000;

function cleanExtractedText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

export function supportedRecruitmentDocument(file: Pick<File, "name" | "size" | "type">) {
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) return false;
  return file.type === "application/pdf"
    || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    || file.type === "text/plain"
    || ["pdf", "docx", "txt"].includes(extension);
}

export async function extractRecruitmentDocumentText(file: File) {
  if (!supportedRecruitmentDocument(file)) {
    throw new Error("Upload a PDF, DOCX or TXT file between 1 byte and 15 MB.");
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  let value = "";
  if (file.type === "application/pdf" || extension === "pdf") {
    value = (await pdf(bytes)).text;
  } else if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || extension === "docx") {
    value = (await mammoth.extractRawText({ buffer: bytes })).value;
  } else {
    value = bytes.toString("utf8");
  }
  const text = cleanExtractedText(value);
  if (text.length < 40) throw new Error("The uploaded file does not contain enough readable text.");
  return text;
}
