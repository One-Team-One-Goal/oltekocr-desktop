import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { Server, WebSocket } from "ws";
import type { DocumentStatus } from "@shared/types";

@WebSocketGateway({ path: "/ws" })
export class DocumentsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(DocumentsGateway.name);

  handleConnection(client: WebSocket): void {
    this.logger.log("Client connected");
  }

  handleDisconnect(client: WebSocket): void {
    this.logger.log("Client disconnected");
  }

  /** Broadcast queue size update to all clients */
  sendQueueUpdate(size: number, processing: string | null): void {
    this.broadcast({
      event: "queue:update",
      data: { size, processing },
    });
  }

  /** Broadcast document status change */
  sendDocumentStatus(
    id: string,
    status: DocumentStatus,
    updatedAt: string,
  ): void {
    this.broadcast({
      event: "document:status",
      data: { id, status, updatedAt },
    });
  }

  /** Broadcast processing progress */
  sendProcessingProgress(id: string, progress: number, message: string): void {
    this.broadcast({
      event: "processing:progress",
      data: { id, progress, message },
    });
  }

  /** Broadcast a single processing log line */
  sendProcessingLog(id: string, line: string): void {
    this.broadcast({
      event: "processing:log",
      data: { id, line, timestamp: new Date().toISOString() },
    });
  }

  private broadcast(payload: unknown): void {
    if (!this.server) return;
    const data = JSON.stringify(payload);
    this.server.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }
}
