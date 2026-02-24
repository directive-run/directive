// Stub for `ws` module in browser builds.
export class WebSocketServer {
  constructor() {
    throw new Error("WebSocketServer is not available in the browser");
  }
}
export default WebSocketServer;
