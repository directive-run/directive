/**
 * Mock WebSocket — simulates connection, messages, errors, and close events.
 * No real network calls; all behavior is driven by setTimeout/setInterval.
 */

export interface WsMessage {
  id: string;
  type: "system" | "chat" | "data";
  from: string;
  text: string;
  timestamp: number;
}

let messageCounter = 0;

const SYSTEM_MESSAGES = [
  "User joined the channel",
  "Server sync complete",
  "New topic started",
  "Channel updated",
];

const CHAT_MESSAGES = [
  "Hello world!",
  "How's everyone doing?",
  "Great progress today",
  "Anyone seen the latest update?",
  "This is amazing",
  "Let's discuss the roadmap",
];

const DATA_MESSAGES = [
  () => `Price: $${(Math.random() * 1000).toFixed(2)}`,
  () => `CPU: ${(Math.random() * 100).toFixed(1)}%`,
  () => `Memory: ${(Math.random() * 16).toFixed(1)}GB`,
  () => `Latency: ${Math.floor(Math.random() * 200)}ms`,
  () => `Users online: ${Math.floor(Math.random() * 500)}`,
];

const USERNAMES = ["Alice", "Bob", "Carol", "Dan", "Eve", "Server"];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shouldFail(failRate: number): boolean {
  return Math.random() * 100 < failRate;
}

export class MockWebSocket {
  onopen: (() => void) | null = null;
  onmessage: ((msg: WsMessage) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: Error) => void) | null = null;

  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private messageTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(
    url: string,
    private failRate: number,
    private messageRateMs: number,
  ) {
    if (!url) {
      throw new Error("WebSocket URL is required");
    }

    // Simulate connection delay (300-600ms)
    const delay = 300 + Math.random() * 300;
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;

      if (this.closed) {
        return;
      }

      if (shouldFail(this.failRate)) {
        this.onerror?.(new Error("Connection failed: server unreachable"));

        return;
      }

      this.onopen?.();
      this.startMessages();
    }, delay);
  }

  send(text: string): void {
    if (this.closed) {
      return;
    }

    // Echo back as a chat message after 100ms
    setTimeout(() => {
      if (this.closed) {
        return;
      }

      messageCounter++;
      this.onmessage?.({
        id: `msg-${messageCounter}`,
        type: "chat",
        from: "You",
        text,
        timestamp: Date.now(),
      });
    }, 100);
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;

    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }

    if (this.messageTimer !== null) {
      clearInterval(this.messageTimer);
      this.messageTimer = null;
    }

    this.onclose?.();
  }

  private startMessages(): void {
    this.messageTimer = setInterval(() => {
      if (this.closed) {
        return;
      }

      messageCounter++;
      const types: Array<"system" | "chat" | "data"> = [
        "system",
        "chat",
        "data",
      ];
      const type = types[messageCounter % 3];

      let text: string;
      let from: string;

      if (type === "system") {
        text = randomFrom(SYSTEM_MESSAGES);
        from = "Server";
      } else if (type === "chat") {
        text = randomFrom(CHAT_MESSAGES);
        from = randomFrom(USERNAMES.filter((u) => u !== "Server"));
      } else {
        const generator = randomFrom(DATA_MESSAGES);
        text = generator();
        from = "Monitor";
      }

      this.onmessage?.({
        id: `msg-${messageCounter}`,
        type,
        from,
        text,
        timestamp: Date.now(),
      });
    }, this.messageRateMs);
  }
}
