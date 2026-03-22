import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { getDataPath } from "../../data-dirs";
import { writeFileSync } from "fs";
import type {
  ExportFormat,
  ExportHistoryRecord,
  SessionColumn,
} from "@shared/types";

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
    const firstSessionId = documents[0]?.sessionId ?? null;
    const hasSingleSession =
      !!firstSessionId &&
      documents.every(
        (doc) => doc.sessionId && doc.sessionId === firstSessionId,
      );

    const session = hasSingleSession
      ? await this.prisma.session.findUnique({
          where: { id: firstSessionId },
          select: {
            id: true,
            name: true,
            mode: true,
            columns: true,
          },
        })
      : null;

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
        exportPath = await this.exportExcel(documents, timestamp, session);
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

  private async exportContractExcel(
    documents: any[],
    timestamp: string,
  ): Promise<string> {
    const exportPath = getDataPath(
      "exports",
      `contract_export_${timestamp}.xlsx`,
    );

    try {
      const ExcelJS = require("exceljs");
      const workbook = new ExcelJS.Workbook();

      // Collect rows across all documents
      const allRates: Record<string, string>[] = [];
      const allOriginArbs: Record<string, string>[] = [];
      const allDestArbs: Record<string, string>[] = [];

      for (const doc of documents) {
        const parsed = JSON.parse(doc.extractedJson || "{}");
        if (parsed.type !== "CONTRACT") continue;
        allRates.push(...(parsed.rates || []));
        allOriginArbs.push(...(parsed.originArbs || []));
        allDestArbs.push(...(parsed.destArbs || []));
      }

      const HEADER_STYLE = {
        font: { bold: true, color: { argb: "FFFFFFFF" } },
        fill: {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF1E293B" },
        } as any,
      };

      const buildSheet = (
        name: string,
        rows: Record<string, string>[],
        columnOrder: string[],
      ) => {
        if (rows.length === 0) return;
        const sheet = workbook.addWorksheet(name);

        const keys = columnOrder;

        sheet.columns = keys.map((k) => ({
          header: k,
          key: k,
          width: Math.max(k.length + 2, 14),
        }));

        for (const row of rows) {
          sheet.addRow(
            keys.map((k) => {
              const value = row[k] ?? "";
              if (
                (k === "effective_date" || k === "expiration_date") &&
                value
              ) {
                const parsed = new Date(String(value));
                if (!Number.isNaN(parsed.getTime())) return parsed;
              }
              return value;
            }),
          );
        }

        // Style header row
        const headerRow = sheet.getRow(1);
        headerRow.eachCell((cell: any) => {
          cell.font = HEADER_STYLE.font;
          cell.fill = HEADER_STYLE.fill;
        });
        headerRow.commit();

        // Auto-filter
        sheet.autoFilter = {
          from: { row: 1, column: 1 },
          to: { row: 1, column: keys.length },
        };

        const effIdx = keys.indexOf("effective_date");
        if (effIdx >= 0) sheet.getColumn(effIdx + 1).numFmt = "yyyy-mm-dd";
        const expIdx = keys.indexOf("expiration_date");
        if (expIdx >= 0) sheet.getColumn(expIdx + 1).numFmt = "yyyy-mm-dd";
      };

      const RATES_COLS = [
        "Carrier",
        "Contract ID",
        "effective_date",
        "expiration_date",
        "commodity",
        "origin_city",
        "origin_via_city",
        "destination_city",
        "destination_via_city",
        "service",
        "Remarks",
        "SCOPE",
        "BaseRate 20",
        "BaseRate 40",
        "BaseRate 40H",
        "BaseRate 45",
        "AMS(CHINA & JAPAN)",
        "(HEA) Heavy Surcharge",
        "AGW",
        "RED SEA DIVERSION CHARGE(RDS).",
      ];

      const ORIGIN_ARB_COLS = [
        "Carrier",
        "Contract ID",
        "effective_date",
        "expiration_date",
        "commodity",
        "origin_city",
        "origin_via_city",
        "service",
        "Remarks",
        "Scope",
        "BaseRate 20",
        "BaseRate 40",
        "BaseRate 40H",
        "BaseRate 45",
        "20' AGW",
        "40' AGW",
        "45' AGW",
      ];

      const DEST_ARB_COLS = [
        "Carrier",
        "Contract ID",
        "effective_date",
        "expiration_date",
        "commodity",
        "destination_city",
        "destination_via_city",
        "service",
        "Remarks",
        "Scope",
        "BaseRate 20",
        "BaseRate 40",
        "BaseRate 40H",
        "BaseRate 45",
      ];

      buildSheet("Rates", allRates, RATES_COLS);
      buildSheet("Origin Arbitraries", allOriginArbs, ORIGIN_ARB_COLS);
      buildSheet("Destination Arbitraries", allDestArbs, DEST_ARB_COLS);

      await workbook.xlsx.writeFile(exportPath);
    } catch (err) {
      this.logger.error(
        "Contract Excel export failed, falling back to JSON",
        err,
      );
      return this.exportJson(documents, timestamp);
    }

    return exportPath;
  }

  private async exportExcel(
    documents: any[],
    timestamp: string,
    session?: {
      id: string;
      name: string;
      mode: string;
      columns: string;
    } | null,
  ): Promise<string> {
    if (session?.mode === "TABLE_EXTRACT" && documents.length > 0) {
      return this.exportTableExtractExcel(documents, timestamp, session);
    }

    // If all selected documents are PDF_EXTRACT contracts, use the contract-specific exporter
    const allAreContracts = documents.every((doc) => {
      try {
        return JSON.parse(doc.extractedJson || "{}").type === "CONTRACT";
      } catch {
        return false;
      }
    });
    if (allAreContracts && documents.length > 0) {
      return this.exportContractExcel(documents, timestamp);
    }

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

  private async exportTableExtractExcel(
    documents: any[],
    timestamp: string,
    session: {
      id: string;
      name: string;
      mode: string;
      columns: string;
    },
  ): Promise<string> {
    const dateStamp = new Date().toISOString().slice(0, 10);
    const safeSessionName = this.sanitizeFilenamePart(
      session.name || "Session",
    );
    const exportPath = getDataPath(
      "exports",
      `${safeSessionName}_${dateStamp || timestamp}.xlsx`,
    );

    try {
      const ExcelJS = require("exceljs");
      const workbook = new ExcelJS.Workbook();

      const sessionColumns = this.parseJson<SessionColumn[]>(
        session.columns,
        [],
      );
      const fixedHeaders = [
        "Filename",
        "Status",
        "Scanned",
        "Time",
        "Confidence",
        "Page",
        "Time",
        "Ext. Type",
      ];
      const dynamicHeaders = sessionColumns.map((c) => c.label || c.key);
      const headers = [...fixedHeaders, ...dynamicHeaders];

      const rowsSheet = workbook.addWorksheet("Rows");
      rowsSheet.columns = headers.map((header, index) => ({
        header,
        key: `col_${index}`,
        width: header.length > 20 ? header.length + 4 : 18,
      }));

      for (const doc of documents) {
        const extractedRow = this.parseJson<
          Record<string, { answer?: string; score?: number }>
        >(doc.extractedRow || "{}", {});

        const dynamicValues = sessionColumns.map(
          (col) => extractedRow[col.key]?.answer ?? "",
        );

        rowsSheet.addRow([
          doc.filename ?? "",
          this.statusLabel(doc.status),
          this.formatShortDateTime(doc.createdAt),
          this.formatShortTime(doc.ocrProcessingTime),
          this.formatConfidence(doc.ocrAvgConfidence),
          doc.ocrPageCount || "—",
          this.formatReadableTime(doc.ocrProcessingTime),
          this.extractionTypeLabel(doc.extractionType),
          ...dynamicValues,
        ]);
      }

      const headerRow = rowsSheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1E293B" },
      };
      rowsSheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: headers.length },
      };

      const summary = workbook.addWorksheet("Summary");
      const total = documents.length;
      const avgConfidence =
        total > 0
          ? documents.reduce(
              (acc, doc) => acc + Number(doc.ocrAvgConfidence || 0),
              0,
            ) / total
          : 0;
      const statusCounts = documents.reduce(
        (acc: Record<string, number>, doc) => {
          const key = String(doc.status || "UNKNOWN");
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        },
        {},
      );

      summary.columns = [
        { header: "Metric", key: "metric", width: 32 },
        { header: "Value", key: "value", width: 48 },
      ];
      summary.addRows([
        { metric: "Session", value: session.name || "Session" },
        {
          metric: "Generated At",
          value: this.formatShortDateTime(new Date().toISOString()),
        },
        { metric: "Documents", value: total },
        { metric: "Average Confidence", value: `${avgConfidence.toFixed(1)}%` },
        { metric: "", value: "" },
      ]);

      Object.entries(statusCounts)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([status, count]) => {
          summary.addRow({
            metric: `Status: ${this.statusLabel(status)}`,
            value: count,
          });
        });

      const summaryHeader = summary.getRow(1);
      summaryHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
      summaryHeader.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1E293B" },
      };

      await workbook.xlsx.writeFile(exportPath);
    } catch (err) {
      this.logger.error(
        "TABLE_EXTRACT Excel export failed, falling back to JSON",
        err,
      );
      return this.exportJson(documents, timestamp);
    }

    return exportPath;
  }

  private parseJson<T>(raw: string, fallback: T): T {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private formatShortDateTime(value: Date | string): string {
    if (!value) return "—";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yy = String(date.getFullYear()).slice(-2);
    const HH = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yy} ${HH}:${min}`;
  }

  private formatShortTime(seconds: number): string {
    if (!seconds || Number(seconds) === 0) return "—";
    return `${Number(seconds).toFixed(1)}s`;
  }

  private formatReadableTime(seconds: number): string {
    const value = Number(seconds || 0);
    if (!value) return "—";
    if (value < 60) return `${value.toFixed(1)}s`;
    return `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
  }

  private formatConfidence(confidence: number): string {
    const value = Number(confidence || 0);
    if (!value) return "—";
    return `${value.toFixed(1)}%`;
  }

  private extractionTypeLabel(type: string): string {
    const map: Record<string, string> = {
      AUTO: "Auto",
      IMAGE: "Image",
      PDF_TEXT: "PDF (Text)",
      PDF_IMAGE: "PDF (Scanned)",
      EXCEL: "Excel",
    };
    return map[type] ?? type ?? "—";
  }

  private statusLabel(status: string): string {
    const map: Record<string, string> = {
      QUEUED: "Queued",
      SCANNING: "Scanning",
      PROCESSING: "Processing",
      CANCELLING: "Cancelling",
      REVIEW: "Review",
      APPROVED: "Approved",
      REJECTED: "Rejected",
      EXPORTED: "Exported",
      ERROR: "Error",
    };
    return map[status] ?? status ?? "Unknown";
  }

  private sanitizeFilenamePart(name: string): string {
    const clean = (name || "Session")
      .replace(/[\\/:*?"<>|]/g, "_")
      .trim()
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 120);
    return clean || "Session";
  }
}
