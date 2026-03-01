import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { getDataPath } from "../../data-dirs";
import { join } from "path";
import { writeFileSync } from "fs";
import type { ExportFormat, ExportHistoryRecord } from "@shared/types";

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(private readonly prisma: PrismaService) {}

  async exportDocuments(
    documentIds: string[],
    format: ExportFormat,
  ): Promise<string> {
    const documents = await this.prisma.document.findMany({
      where: { id: { in: documentIds } },
    });

    if (documents.length === 0) {
      throw new Error("No documents found for export");
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    let exportPath: string;

    switch (format) {
      case "json":
        exportPath = await this.exportJson(documents, timestamp);
        break;
      case "csv":
        exportPath = await this.exportCsv(documents, timestamp);
        break;
      case "excel":
      default:
        exportPath = await this.exportExcel(documents, timestamp);
        break;
    }

    // Record export history and mark documents
    for (const doc of documents) {
      await this.prisma.exportHistory.create({
        data: {
          documentId: doc.id,
          exportFormat: format,
          exportPath,
        },
      });

      if (doc.status === "APPROVED") {
        await this.prisma.document.update({
          where: { id: doc.id },
          data: { exported: true, exportPath, status: "EXPORTED" },
        });
      }
    }

    this.logger.log(`Exported ${documents.length} documents to ${exportPath}`);
    return exportPath;
  }

  async exportAllApproved(format: ExportFormat): Promise<string> {
    const approved = await this.prisma.document.findMany({
      where: { status: "APPROVED" },
      select: { id: true },
    });
    const ids = approved.map((d) => d.id);
    if (ids.length === 0) throw new Error("No approved documents to export");
    return this.exportDocuments(ids, format);
  }

  async getHistory(): Promise<ExportHistoryRecord[]> {
    const records = await this.prisma.exportHistory.findMany({
      orderBy: { exportedAt: "desc" },
      take: 100,
    });
    return records.map((r) => ({
      id: r.id,
      documentId: r.documentId,
      exportFormat: r.exportFormat,
      exportPath: r.exportPath,
      exportedAt: r.exportedAt.toISOString(),
    }));
  }

  // ─── Export Implementations ────────────────────────────
  private async exportJson(
    documents: any[],
    timestamp: string,
  ): Promise<string> {
    const exportPath = getDataPath("exports", `export_${timestamp}.json`);
    const data = documents.map((doc) => ({
      id: doc.id,
      filename: doc.filename,
      status: doc.status,
      createdAt: doc.createdAt,
      ocrText: doc.ocrFullText,
      ocrMarkdown: doc.ocrMarkdown,
      tables: JSON.parse(doc.ocrTables || "[]"),
      confidence: doc.ocrAvgConfidence,
      notes: doc.notes,
      extractedJson: JSON.parse(doc.extractedJson || "{}"),
    }));
    writeFileSync(exportPath, JSON.stringify(data, null, 2), "utf-8");
    return exportPath;
  }

  private async exportCsv(
    documents: any[],
    timestamp: string,
  ): Promise<string> {
    const exportPath = getDataPath("exports", `export_${timestamp}.csv`);
    const headers = [
      "ID",
      "Filename",
      "Status",
      "Created At",
      "Confidence",
      "Pages",
      "Text (truncated)",
      "Notes",
    ];
    const rows = documents.map((doc) => [
      doc.id,
      doc.filename,
      doc.status,
      doc.createdAt?.toISOString?.() || doc.createdAt,
      doc.ocrAvgConfidence.toFixed(1),
      doc.ocrPageCount,
      (doc.ocrFullText || "").slice(0, 500).replace(/"/g, '""'),
      (doc.notes || "").replace(/"/g, '""'),
    ]);

    const csv = [
      headers.join(","),
      ...rows.map((r) => r.map((v: any) => `"${v}"`).join(",")),
    ].join("\n");

    writeFileSync(exportPath, csv, "utf-8");
    return exportPath;
  }

  private async exportExcel(
    documents: any[],
    timestamp: string,
  ): Promise<string> {
    const exportPath = getDataPath("exports", `export_${timestamp}.xlsx`);

    try {
      const ExcelJS = require("exceljs");
      const workbook = new ExcelJS.Workbook();

      // Summary sheet
      const summary = workbook.addWorksheet("Summary");
      summary.columns = [
        { header: "ID", key: "id", width: 36 },
        { header: "Filename", key: "filename", width: 30 },
        { header: "Status", key: "status", width: 12 },
        { header: "Created", key: "createdAt", width: 20 },
        { header: "Confidence", key: "confidence", width: 12 },
        { header: "Pages", key: "pages", width: 8 },
        { header: "Tables", key: "tables", width: 8 },
        { header: "Notes", key: "notes", width: 40 },
      ];

      for (const doc of documents) {
        summary.addRow({
          id: doc.id,
          filename: doc.filename,
          status: doc.status,
          createdAt: doc.createdAt?.toISOString?.() || doc.createdAt,
          confidence: doc.ocrAvgConfidence,
          pages: doc.ocrPageCount,
          tables: JSON.parse(doc.ocrTables || "[]").length,
          notes: doc.notes,
        });
      }

      // Style header row
      summary.getRow(1).font = { bold: true };
      summary.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1E293B" },
      };
      summary.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

      // Per-document sheets (text + tables)
      for (const doc of documents) {
        const safeName = doc.filename.replace(/[\\/*?[\]]/g, "_").slice(0, 28);
        const sheet = workbook.addWorksheet(safeName);

        sheet.addRow(["Filename", doc.filename]);
        sheet.addRow(["Status", doc.status]);
        sheet.addRow(["Confidence", `${doc.ocrAvgConfidence}%`]);
        sheet.addRow([]);
        sheet.addRow(["Extracted Text"]);
        sheet.addRow([doc.ocrFullText || "(no text)"]);

        const tables = JSON.parse(doc.ocrTables || "[]");
        if (tables.length > 0) {
          sheet.addRow([]);
          sheet.addRow([`Tables (${tables.length})`]);
          for (const table of tables) {
            sheet.addRow([]);
            if (table.caption) sheet.addRow([table.caption]);
            // Build 2D grid
            const grid: string[][] = Array.from({ length: table.rows }, () =>
              Array(table.cols).fill(""),
            );
            for (const cell of table.cells || []) {
              if (cell.row < table.rows && cell.col < table.cols) {
                grid[cell.row][cell.col] = cell.text;
              }
            }
            for (const row of grid) {
              sheet.addRow(row);
            }
          }
        }
      }

      await workbook.xlsx.writeFile(exportPath);
    } catch (err) {
      this.logger.error("Excel export failed, falling back to JSON", err);
      return this.exportJson(documents, timestamp);
    }

    return exportPath;
  }
}
