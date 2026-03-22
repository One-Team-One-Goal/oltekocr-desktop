import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { WsAdapter } from "@nestjs/platform-ws";
import { AppModule } from "./app.module";

export async function bootstrapNestServer(): Promise<number> {
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn", "log"],
  });

  // Use ws adapter instead of socket.io
  app.useWebSocketAdapter(new WsAdapter(app));

  // Global prefix
  app.setGlobalPrefix("api");

  // Validation pipe for DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Enable CORS for dev (Vite dev server on different port)
  app.enableCors();

  // Allow large local payloads (e.g. extracted OCR JSON from long PDFs).
  (app as any).useBodyParser("json", { limit: "50mb" });
  (app as any).useBodyParser("urlencoded", {
    extended: true,
    limit: "50mb",
  });

  // ─── OpenAPI / Swagger ─────────────────────────────────
  const config = new DocumentBuilder()
    .setTitle("OltekOCR API")
    .setDescription(
      "REST API for OltekOCR — Logistics Document Processor. " +
        "Manages document ingestion, OCR processing, review workflow, and export.",
    )
    .setVersion("1.0.0")
    .addTag("documents", "Document CRUD and lifecycle management")
    .addTag("export", "Export documents to Excel, JSON, or CSV")
    .addTag("settings", "Application settings management")
    .addTag("scanner", "Scanner and folder watcher management")
    .addTag("ocr", "OCR processing (stub)")
    .addTag("queue", "Processing queue status")
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document, {
    customSiteTitle: "OltekOCR API Docs",
    customCss: ".swagger-ui .topbar { display: none }",
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: "list",
      filter: true,
      showRequestDuration: true,
    },
  });

  const port = 3847;
  await app.listen(port);
  return port;
}
