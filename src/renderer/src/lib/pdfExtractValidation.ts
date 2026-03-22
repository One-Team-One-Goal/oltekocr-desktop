import { documentsApi, type PdfContentAnalysisResult } from "@/api/client";

export interface PdfExtractBlockedFile {
  filePath: string;
  classification: "NON_PDF" | PdfContentAnalysisResult["classification"];
  reason: string;
}

export interface PdfExtractValidationResult {
  allowedFilePaths: string[];
  blockedFiles: PdfExtractBlockedFile[];
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "";
  return path.slice(dot).toLowerCase();
}

function reasonForClassification(
  classification: PdfContentAnalysisResult["classification"],
  error: string | null,
): string {
  if (classification === "UNKNOWN") {
    return (
      error ||
      "Could not determine PDF content type. Try again or use OCR_EXTRACT mode."
    );
  }
  if (classification === "IMAGE_ONLY") {
    return "Image-only PDF detected. It will use Docling text extraction automatically.";
  }
  if (classification === "MIXED") {
    return "Mixed text/image PDF detected. It will use Docling text extraction automatically.";
  }
  return "Digital text PDF detected. It will use pdfplumber text extraction.";
}

export async function validatePdfExtractFiles(
  filePaths: string[],
): Promise<PdfExtractValidationResult> {
  const nonPdf = filePaths.filter((path) => extensionOf(path) !== ".pdf");
  const pdfPaths = filePaths.filter((path) => extensionOf(path) === ".pdf");

  const blockedFiles: PdfExtractBlockedFile[] = nonPdf.map((filePath) => ({
    filePath,
    classification: "NON_PDF",
    reason: "Only PDF files are supported in PDF_EXTRACT mode.",
  }));

  if (pdfPaths.length === 0) {
    return {
      allowedFilePaths: [],
      blockedFiles,
    };
  }

  const analysis = await documentsApi.analyzePdfContent(pdfPaths);
  const allowedFilePaths: string[] = [];

  for (const result of analysis) {
    if (result.classification !== "UNKNOWN") {
      allowedFilePaths.push(result.filePath);
      continue;
    }

    blockedFiles.push({
      filePath: result.filePath,
      classification: result.classification,
      reason: reasonForClassification(result.classification, result.error),
    });
  }

  return {
    allowedFilePaths,
    blockedFiles,
  };
}
