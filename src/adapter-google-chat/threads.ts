export const threadMappings = new Map<string, { threadName: string; timestamp: number }>();

// Periodically clean up mappings older than 24 hours
setInterval(
  () => {
    const now = Date.now();
    for (const [id, data] of threadMappings.entries()) {
      if (now - data.timestamp > 24 * 60 * 60 * 1000) {
        threadMappings.delete(id);
      }
    }
  },
  60 * 60 * 1000
).unref();
