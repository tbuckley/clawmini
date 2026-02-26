<script lang="ts">
  import { invalidate } from '$app/navigation';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Plus, Trash, Edit, Bot } from 'lucide-svelte';

  let { data }: { data: { agents: { id: string; directory?: string; env?: Record<string, string> }[] } } = $props();

  let agents = $derived(data.agents || []);

  let editAgentOpen = $state(false);
  let isEditing = $state(false);
  
  let agentId = $state('');
  let agentDirectory = $state('');
  let agentEnv = $state(''); // will parse as JSON or multiline KEY=VALUE
  
  let isSaving = $state(false);
  
  // parse/unparse env for editing
  function unparseEnv(envObj: any) {
    if (!envObj) return '';
    return Object.entries(envObj).map(([k, v]) => `${k}=${v}`).join('\n');
  }

  function parseEnv(envStr: string) {
    const obj: Record<string, string> = {};
    const lines = envStr.split('\n');
    for (const line of lines) {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        obj[match[1].trim()] = match[2].trim();
      }
    }
    return obj;
  }

  function openCreate() {
    isEditing = false;
    agentId = '';
    agentDirectory = '';
    agentEnv = '';
    editAgentOpen = true;
  }

  function openEdit(agent: any) {
    isEditing = true;
    agentId = agent.id;
    agentDirectory = agent.directory || '';
    agentEnv = unparseEnv(agent.env);
    editAgentOpen = true;
  }

  async function saveAgent() {
    isSaving = true;
    try {
      const payload: any = {
        directory: agentDirectory.trim(),
        env: parseEnv(agentEnv),
      };
      if (!isEditing) payload.id = agentId;

      const url = isEditing ? `/api/agents/${agentId}` : '/api/agents';
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        editAgentOpen = false;
        await invalidate('app:agents');
      } else {
        const d = await res.json();
        alert(d.error || 'Failed to save agent');
      }
    } catch (e) {
      alert('Error saving agent');
    } finally {
      isSaving = false;
    }
  }

  async function deleteAgent(id: string) {
    if (!confirm(`Are you sure you want to delete agent "${id}"?`)) return;
    try {
      const res = await fetch(`/api/agents/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await invalidate('app:agents');
      } else {
        alert('Failed to delete agent');
      }
    } catch (e) {
      alert('Error deleting agent');
    }
  }
</script>

<div class="p-6 max-w-4xl mx-auto flex flex-col gap-6 h-full overflow-y-auto">
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-bold tracking-tight">Agents</h1>
    <Button onclick={openCreate} size="sm">
      <Plus class="w-4 h-4 mr-2" />
      Create Agent
    </Button>
  </div>

  {#if agents.length === 0}
    <div class="flex flex-col items-center justify-center p-12 text-center text-muted-foreground border rounded-lg bg-background">
      <Bot class="w-12 h-12 mb-4 text-muted-foreground/50" />
      <p>No agents created yet.</p>
    </div>
  {:else}
    <div class="grid gap-4 md:grid-cols-2">
      {#each agents as agent}
        <div class="flex flex-col gap-2 p-4 border rounded-lg bg-background shadow-sm">
          <div class="flex items-center justify-between">
            <h2 class="font-semibold text-lg flex items-center gap-2">
              <Bot class="w-5 h-5 text-primary" />
              {agent.id}
            </h2>
            <div class="flex gap-2">
              <Button variant="outline" size="icon" onclick={() => openEdit(agent)}>
                <Edit class="w-4 h-4" />
              </Button>
              <Button variant="destructive" size="icon" onclick={() => deleteAgent(agent.id)}>
                <Trash class="w-4 h-4" />
              </Button>
            </div>
          </div>
          {#if agent.directory}
            <div class="text-sm mt-2">
              <span class="text-muted-foreground font-medium">Directory:</span>
              <code class="ml-1 bg-muted px-1 py-0.5 rounded text-xs">{agent.directory}</code>
            </div>
          {/if}
          {#if agent.env && Object.keys(agent.env).length > 0}
            <div class="text-sm mt-2">
              <span class="text-muted-foreground font-medium">Environment Variables:</span>
              <div class="mt-1 bg-muted p-2 rounded text-xs overflow-x-auto whitespace-pre">
{Object.entries(agent.env).map(([k, v]) => `${k}=${v}`).join('\n')}
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <Dialog.Root bind:open={editAgentOpen}>
    <Dialog.Content class="sm:max-w-[425px]">
      <Dialog.Header>
        <Dialog.Title>{isEditing ? 'Edit Agent' : 'Create Agent'}</Dialog.Title>
        <Dialog.Description>
          Configure the agent's working directory and environment variables.
        </Dialog.Description>
      </Dialog.Header>
      <div class="grid gap-4 py-4">
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium leading-none" for="agent-id">ID</label>
          <Input id="agent-id" bind:value={agentId} disabled={isEditing} placeholder="e.g. backend-agent" />
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium leading-none" for="agent-dir">Directory</label>
          <Input id="agent-dir" bind:value={agentDirectory} placeholder="e.g. ./apps/backend" />
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium leading-none" for="agent-env">Environment Variables (KEY=VALUE)</label>
          <textarea
            id="agent-env"
            bind:value={agentEnv}
            placeholder="PORT=8080&#10;NODE_ENV=development"
            class="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          ></textarea>
        </div>
      </div>
      <Dialog.Footer>
        <Button disabled={!agentId || isSaving} onclick={saveAgent}>
          {isSaving ? 'Saving...' : 'Save Agent'}
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
</div>