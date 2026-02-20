// Type stub for ws — resolved at runtime via dynamic import
declare module "ws" {
  class WebSocketServer {
    constructor(options: { port: number; host: string });
    on(event: string, callback: (...args: any[]) => void): void;
    close(): void;
  }
}
