import { Module } from "@nestjs/common";
import { PrismaModule } from "./prisma/prisma.module";
import { DocumentsModule } from "./documents/documents.module";
import { ExportModule } from "./export/export.module";
import { SettingsModule } from "./settings/settings.module";
import { ScannerModule } from "./scanner/scanner.module";
import { OcrModule } from "./ocr/ocr.module";
import { QueueModule } from "./queue/queue.module";
import { SessionsModule } from "./sessions/sessions.module";
import { SessionPresetsModule } from "./session-presets/session-presets.module";
import { ContractExtractionModule } from "./contract-extraction/contract-extraction.module";

@Module({
  imports: [
    PrismaModule,
    DocumentsModule,
    ExportModule,
    SettingsModule,
    ScannerModule,
    OcrModule,
    QueueModule,
    SessionsModule,
    SessionPresetsModule,
    ContractExtractionModule,
  ],
})
export class AppModule {}
