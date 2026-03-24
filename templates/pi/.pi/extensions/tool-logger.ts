import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx: ExtensionContext) => {
    const { toolName, input } = event;
    let logInput: string;
    const limit = 100;
    switch (toolName) {
      case 'bash':
        logInput = input.command?.substr(0, limit) ?? '...';
        break;
      case 'read':
      case 'write':
      case 'edit':
        logInput = input.path?.substr(0, limit) ?? '...';
        break;
      default:
        logInput = JSON.stringify(input).substring(0, limit);
    }

    const logMessage = `🔧 ${toolName} - \`${logInput}\``;

    try {
      const result = await pi.exec("clawmini-lite.js", ["log", logMessage], { cwd: ctx.cwd });
      if (result.code !== 0) {
        console.warn(`clawmini-lite failed: ${result.stderr}`);
      }
    } catch (error) {
      console.warn(`Failed to log tool call: ${error}`);
    }
  });
}