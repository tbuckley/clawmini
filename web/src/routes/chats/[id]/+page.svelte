<script lang="ts">
  import type { PageData } from './$types';

  let { data } = $props<{ data: PageData }>();
</script>

<div class="p-6">
  <h1 class="text-2xl font-bold mb-4">Chat: {data.id}</h1>
  <p class="text-muted-foreground">This is where the messages will appear.</p>
</div>
