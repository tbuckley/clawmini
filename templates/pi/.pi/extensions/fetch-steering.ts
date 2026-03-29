import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

function sendSteering(pi: ExtensionAPI, message: string) {
  pi.sendMessage({
    customType: "fetch-steering",
    content: [{ type: "text", text: message }],
    display: false,
  }, {
    deliverAs: "steer",
  });
}

async function fetchAndSend(pi: ExtensionAPI, ctx: ExtensionContext) {
  const result = await pi.exec("clawmini-lite.js", ["fetch-pending"], { cwd: ctx.cwd });

  if (result.code === 0 && result.stdout.trim()) {
    const steeringMessage = result.stdout.trim();
    sendSteering(pi, steeringMessage);
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_result", async (event, ctx: ExtensionContext) => {
    await fetchAndSend(pi, ctx);
  });

  pi.on("turn_end", async (event, ctx: ExtensionContext) => {
    await fetchAndSend(pi, ctx);
  });
}