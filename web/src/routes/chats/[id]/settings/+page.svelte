<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Trash2, Plus, ArrowLeft } from 'lucide-svelte';
  
  let { data } = $props<{ data: PageData }>();
  
  let cronJobs = $derived(data.cronJobs);
  
  let isAdding = $state(false);
  let newJobId = $state('');
  let newJobMessage = $state('');
  let newJobSchedule = $state('');
  let newJobType = $state('cron'); // 'cron', 'every', 'at'
  let isSubmitting = $state(false);
  let errorMsg = $state('');

  async function deleteJob(jobId: string) {
    if (!confirm('Are you sure you want to delete this job?')) return;
    try {
      const res = await fetch(`/api/chats/${data.id}/cron/${jobId}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to delete job');
      await invalidate(`app:chat:${data.id}:cron`);
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function addJob(e: Event) {
    e.preventDefault();
    isSubmitting = true;
    errorMsg = '';
    
    try {
      const job: any = {
        id: newJobId,
        message: newJobMessage,
        schedule: {}
      };
      
      if (newJobType === 'cron') job.schedule.cron = newJobSchedule;
      else if (newJobType === 'every') job.schedule.every = newJobSchedule;
      else if (newJobType === 'at') job.schedule.at = newJobSchedule;
      
      const res = await fetch(`/api/chats/${data.id}/cron`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job)
      });
      
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to add job');
      }
      
      isAdding = false;
      newJobId = '';
      newJobMessage = '';
      newJobSchedule = '';
      newJobType = 'cron';
      
      await invalidate(`app:chat:${data.id}:cron`);
    } catch (e: any) {
      errorMsg = e.message;
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="flex-1 overflow-y-auto p-6 h-full bg-background text-foreground">
  <div class="max-w-4xl mx-auto space-y-8">
    <div class="flex items-center gap-4">
      <a href="/chats/{data.id}" class="p-2 -ml-2 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Back to Chat">
        <ArrowLeft class="w-5 h-5" />
      </a>
      <h1 class="text-2xl font-bold tracking-tight">Chat Settings</h1>
    </div>

    <section class="space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-semibold">Cron Jobs</h2>
        <Button variant="outline" size="sm" onclick={() => isAdding = !isAdding}>
          <Plus class="w-4 h-4 mr-2" />
          Add Job
        </Button>
      </div>

      {#if errorMsg}
        <div class="p-3 bg-destructive/10 text-destructive text-sm rounded-md border border-destructive/20">
          {errorMsg}
        </div>
      {/if}

      {#if isAdding}
        <form onsubmit={addJob} class="p-4 border rounded-lg space-y-4 bg-card text-card-foreground shadow-sm">
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-2">
              <label class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70" for="jobId">Job ID</label>
              <Input id="jobId" bind:value={newJobId} placeholder="e.g. daily-standup" required />
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70" for="jobType">Schedule Type</label>
              <select id="jobType" bind:value={newJobType} class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                <option value="cron">Cron Expression</option>
                <option value="every">Every (e.g. '1h', '30m')</option>
                <option value="at">At (ISO Date/Time)</option>
              </select>
            </div>
            <div class="space-y-2 col-span-2">
              <label class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70" for="jobSchedule">Schedule Expression</label>
              <Input id="jobSchedule" bind:value={newJobSchedule} placeholder="e.g. * * * * *, 1h, or 2024-01-01T12:00:00Z" required />
            </div>
            <div class="space-y-2 col-span-2">
              <label class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70" for="jobMessage">Message / Command</label>
              <Input id="jobMessage" bind:value={newJobMessage} placeholder="Command to run..." required />
            </div>
          </div>
          <div class="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onclick={() => isAdding = false}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Job'}
            </Button>
          </div>
        </form>
      {/if}

      {#if !cronJobs || cronJobs.length === 0}
        {#if !isAdding}
          <div class="p-8 text-center text-muted-foreground border rounded-lg border-dashed">
            No cron jobs configured for this chat.
          </div>
        {/if}
      {:else}
        <div class="grid gap-4">
          {#each cronJobs as job (job.id)}
            <div class="flex items-center justify-between p-4 border rounded-lg bg-card text-card-foreground shadow-sm">
              <div class="space-y-1.5 overflow-hidden">
                <div class="font-medium flex items-center gap-2">
                  <span class="truncate">{job.id}</span>
                  <span class="shrink-0 px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider rounded-full bg-secondary text-secondary-foreground">
                    {#if job.schedule.cron}cron: {job.schedule.cron}{/if}
                    {#if job.schedule.every}every: {job.schedule.every}{/if}
                    {#if job.schedule.at}at: {job.schedule.at}{/if}
                  </span>
                </div>
                <div class="text-sm text-muted-foreground font-mono bg-muted/50 p-1.5 rounded-md truncate">
                  $ {job.message}
                </div>
              </div>
              <Button variant="ghost" size="icon" class="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive" onclick={() => deleteJob(job.id)}>
                <Trash2 class="w-4 h-4" />
                <span class="sr-only">Delete</span>
              </Button>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  </div>
</div>