// @ts-nocheck
"use client";

import { getStore } from "@/components/InlineChat";
import { createSystem } from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";
import { useEffect, useRef } from "react";
import { chatSession } from "./chat-session-module";

/**
 * Creates a Directive system backed by the chat-session module, and keeps it
 * in sync with InlineChat's store. The system registers on window.__DIRECTIVE__
 * via devtoolsPlugin so the DevToolsProvider auto-detects it.
 */
export function useChatSystem(apiEndpoint: string) {
  const systemRef = useRef<ReturnType<typeof createSystem> | null>(null);

  // Create the system once
  if (!systemRef.current) {
    systemRef.current = createSystem({
      module: chatSession,
      plugins: [devtoolsPlugin({ name: "ai-chat" })],
      debug: { runHistory: true },
    });
  }

  const system = systemRef.current;

  useEffect(() => {
    system.initialize();
    system.start();

    const store = getStore(apiEndpoint);

    // Sync InlineChat state → Directive facts
    function syncState() {
      const state = store.getSnapshot();
      const messages = state.messages;

      let totalCharsSent = 0;
      let totalCharsReceived = 0;
      let userCount = 0;
      let assistantCount = 0;

      for (const msg of messages) {
        if (msg.role === "user") {
          userCount++;
          totalCharsSent += msg.content.length;
        } else {
          assistantCount++;
          totalCharsReceived += msg.content.length;
        }
      }

      // Include streaming content in received chars
      if (state.streamingContent) {
        totalCharsReceived += state.streamingContent.length;
      }

      system.events.updateMessages({
        messageCount: messages.length,
        userMessages: userCount,
        assistantMessages: assistantCount,
        totalCharsSent,
        totalCharsReceived,
      });

      system.events.setStreaming({ isStreaming: state.isLoading });
      system.events.setError({ error: state.error ?? "" });
    }

    // Initial sync
    syncState();

    // Throttled sync — at most once per 200ms during streaming
    let syncTimer: ReturnType<typeof setTimeout> | null = null;
    function debouncedSync() {
      if (syncTimer) {
        return;
      }
      syncTimer = setTimeout(() => {
        syncTimer = null;
        syncState();
      }, 200);
    }

    const unsubscribe = store.subscribe(() => {
      const state = store.getSnapshot();
      if (state.isLoading) {
        debouncedSync();
      } else {
        // Final sync — immediate when streaming stops
        if (syncTimer) {
          clearTimeout(syncTimer);
          syncTimer = null;
        }
        syncState();
      }
    });

    return () => {
      if (syncTimer) {
        clearTimeout(syncTimer);
        syncTimer = null;
      }
      unsubscribe();
      system.stop();
      system.destroy();
    };
  }, [apiEndpoint, system]);

  return system;
}
