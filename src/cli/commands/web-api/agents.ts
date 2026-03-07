import http from 'node:http';
import { z } from 'zod';
import {
  listAgents,
  getAgent,
  writeAgentSettings,
  deleteAgent,
  isValidAgentId,
} from '../../../shared/workspace.js';
import { parseJsonBody, sendJsonResponse } from './utils.js';

export async function handleApiAgents(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  urlPath: string
) {
  if (req.method === 'GET' && urlPath === '/api/agents') {
    const agentIds = await listAgents();
    const agents = [];
    for (const id of agentIds) {
      try {
        const agent = await getAgent(id);
        if (agent) {
          agents.push({ id, ...agent });
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(`Failed to load agent ${id}: ${errorMessage}`);
        agents.push({ id, error: errorMessage });
      }
    }
    sendJsonResponse(res, 200, agents);
    return true;
  }

  if (req.method === 'POST' && urlPath === '/api/agents') {
    try {
      const schema = z.object({
        id: z.string().refine(isValidAgentId, { message: 'Invalid agent ID' }),
        directory: z.string().optional(),
        env: z.record(z.string(), z.string()).optional(),
        commands: z.record(z.string(), z.string()).optional(),
      });

      const body = await parseJsonBody(req, schema);

      const existing = await getAgent(body.id);
      if (existing) {
        sendJsonResponse(res, 409, { error: 'Agent already exists' });
        return true;
      }

      const newAgent = {
        directory: body.directory,
        env: body.env || {},
        commands: body.commands || {},
      };

      try {
        await writeAgentSettings(body.id, newAgent);
      } catch (err) {
        sendJsonResponse(res, 400, {
          error: err instanceof Error ? err.message : 'Invalid agent directory',
        });
        return true;
      }

      sendJsonResponse(res, 201, { id: body.id, ...newAgent });
    } catch {
      sendJsonResponse(res, 500, { error: 'Failed to create agent' });
    }
    return true;
  }

  const agentMatch = urlPath.match(/^\/api\/agents\/([^/]+)$/);
  if (agentMatch && agentMatch[1]) {
    const agentId = agentMatch[1];

    if (!isValidAgentId(agentId)) {
      sendJsonResponse(res, 400, { error: 'Invalid agent ID' });
      return true;
    }

    if (req.method === 'GET') {
      try {
        const agent = await getAgent(agentId);
        if (!agent) {
          sendJsonResponse(res, 404, { error: 'Agent not found' });
          return true;
        }
        sendJsonResponse(res, 200, { id: agentId, ...agent });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        sendJsonResponse(res, 500, { error: errorMessage });
      }
      return true;
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      try {
        const schema = z.object({
          directory: z.string().optional(),
          env: z.record(z.string(), z.string()).optional(),
          commands: z.record(z.string(), z.string()).optional(),
        });

        const body = await parseJsonBody(req, schema);

        const agent = (await getAgent(agentId)) || {};
        if (body.directory !== undefined) agent.directory = body.directory;
        if (body.env !== undefined) agent.env = body.env;
        if (body.commands !== undefined) agent.commands = body.commands;

        try {
          await writeAgentSettings(agentId, agent);
        } catch (err) {
          sendJsonResponse(res, 400, {
            error: err instanceof Error ? err.message : 'Invalid agent directory',
          });
          return true;
        }

        sendJsonResponse(res, 200, { id: agentId, ...agent });
      } catch {
        sendJsonResponse(res, 500, { error: 'Failed to update agent' });
      }
      return true;
    }

    if (req.method === 'DELETE') {
      await deleteAgent(agentId);
      sendJsonResponse(res, 200, { success: true });
      return true;
    }
  }

  return false;
}
