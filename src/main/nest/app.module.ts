import { Module } from "@nestjs/common";
import { PrismaModule } from "./prisma/prisma.module";
import { DocumentsModule } from "./documents/documents.module";
import { ExportModule } from "./export/export.module";
import { SettingsModule } from "./settings/settings.module";
import { ScannerModule } from "./scanner/scanner.module";
import { OcrModule } from "./ocr/ocr.module";
import { QueueModule } from "./queue/queue.module";
import { SessionsModule } from "./sessions/sessions.module";

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
  ],
})
export class AppModule {}
