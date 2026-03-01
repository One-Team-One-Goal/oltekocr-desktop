import { useEffect, useRef, useCallback } from "react";
import type { WsEvent } from "@shared/types";

const WS_URL = "ws://localhost:3847/ws";

type WsEventHandler = (event: WsEvent) => void;

/**
 * WebSocket hook — connects to the NestJS WebSocket gateway and
 * dispatches parsed events to the handler.
 */
export function useWebSocket(handler: WsEventHandler): void {
  const wsRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef(handler);

  // Keep handler ref current
  handlerRef.current = handler;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log("[WS] Connected");
    };

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as WsEvent;
        handlerRef.current(parsed);
      } catch (err) {
        console.warn("[WS] Failed to parse message:", event.data);
      }
    };

    ws.onclose = () => {
      console.log("[WS] Disconnected, reconnecting in 3s...");
      setTimeout(connect, 3000);
    };

    ws.onerror = (err) => {
      console.error("[WS] Error:", err);
      ws.close();
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);
}
