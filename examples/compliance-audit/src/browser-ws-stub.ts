// Stub for `ws` module in browser builds.
// `@directive-run/ai` pulls in `ws` for Node-side devtools bridging,
// but the browser never reaches that code path.
export class WebSocketServer {
  constructor() {
    throw new Error("WebSocketServer is not available in the browser");
  }
}
export default WebSocketServer;
