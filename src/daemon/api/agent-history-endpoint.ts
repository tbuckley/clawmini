import { z } from 'zod';
import path from 'node:path';
import { TRPCError } from '@trpc/server';
import { getMessages, type ChatMessage } from '../chats.js';
import { getWorkspaceRoot } from '../../shared/workspace.js';
import { apiProcedure } from './trpc.js';
import { resolveAgentDir } from './router-utils.js';

// Predicate: a message is part of the agent-facing thread when (1) it has no
// subagentId, (2) it does not have displayRole === 'agent' (router auto-replies
// opt out via that flag), and (3) it is either a real user message, a
// displayRole === 'user' adapter echo, or a real agent reply. See SPEC.md
// "What counts as the conversation as the agent should see it".
function isAgentVisibleMessage(msg: ChatMessage): boolean {
  if (msg.subagentId !== undefined) return false;
  if (msg.displayRole === 'agent') return false;
  if (msg.displayRole === 'user') return true;
  if (msg.role === 'user') return true;
  if (msg.role === 'agent') return true;
  return false;
}

export interface ThreadHistoryEntry {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  files?: string[];
  sessionId?: string;
}

function normalizeThreadEntry(
  msg: ChatMessage,
  workspaceRoot: string,
  agentDir: string
): ThreadHistoryEntry {
  const role: 'user' | 'agent' =
    msg.displayRole === 'user' ? 'user' : msg.role === 'user' ? 'user' : 'agent';
  const entry: ThreadHistoryEntry = {
    id: msg.id,
    role,
    content: msg.content,
    timestamp: msg.timestamp,
  };
  const files = (msg as { files?: string[] }).files;
  if (Array.isArray(files) && files.length > 0) {
    // Files are persisted as host-workspace-relative paths (validateLogFile).
    // Re-relativize against agentDir so they resolve from the agent's cwd —
    // which corresponds to agentDir on the host, and to the env's baseDir
    // inside a VM-style sandbox.
    entry.files = files.map((f) => path.relative(agentDir, path.resolve(workspaceRoot, f)));
  }
  if (msg.sessionId !== undefined) entry.sessionId = msg.sessionId;
  return entry;
}

export const getThreadHistory = apiProcedure
  .input(
    z.object({
      limit: z.number().int().min(1).max(200).optional(),
      before: z.string().optional(),
    })
  )
  .query(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    }
    if (ctx.tokenPayload.subagentId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'thread history is not available to subagents',
      });
    }

    const chatId = ctx.tokenPayload.chatId;
    const limit = input.limit ?? 20;
    const workspaceRoot = getWorkspaceRoot(process.cwd());
    const agentDir = await resolveAgentDir(ctx.tokenPayload.agentId, workspaceRoot);

    const fetched = await getMessages(
      chatId,
      limit + 1,
      process.cwd(),
      isAgentVisibleMessage,
      input.before
    );

    let hasMore = false;
    let page = fetched;
    if (fetched.length > limit) {
      hasMore = true;
      page = fetched.slice(1);
    }

    const messages = page.map((msg) => normalizeThreadEntry(msg, workspaceRoot, agentDir));
    const oldestId = messages.length > 0 ? messages[0]!.id : undefined;
    return { messages, hasMore, oldestId };
  });
