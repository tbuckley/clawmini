# Questions for Web Interface Feature

## Q1: Web Server vs Daemon Roles
**Q:** Should `clawmini web` spin up a separate HTTP server process (e.g., at `localhost:8080`) that bridges to the existing Unix socket daemon, or should the daemon itself be modified to optionally listen on a TCP port and serve the web UI/API?
**A:** `clawmini web` should spin up a separate HTTP server that communicates with the daemon via its Unix socket.
\n## Q2: SvelteKit Integration\n**Q:** SvelteKit integration requires a dual-build setup with `@sveltejs/adapter-static`. Are you comfortable with this approach?\n**A:** Let's try SvelteKit and see how it goes.
\n## Q3: Real-time Updates (SSE vs WebSockets)\n**Q:** Is an SSE approach driven by file-watching acceptable for pushing updates to the UI, or do you prefer WebSockets?\n**A:** Yes, SSE sounds great!
\n## Q4: CSS Preferences\n**Q:** Should we strictly use vanilla CSS to keep dependencies light, or would you prefer a styling framework like TailwindCSS (v3 or v4)?\n**A:** Yeah, let's use tailwind + shadcn-svelte for ui.
