// Emit an OCI runtime spec (config.json) for a single gvisor-sandboxed command.
// Paths/command come via env vars so the shell wrapper can avoid quoting headaches.

// eslint-disable-next-line no-undef
const proc = process;
const env = proc.env;
const workspace = required('CLAWMINI_WORKSPACE');
const agent = required('CLAWMINI_AGENT');
const home = required('CLAWMINI_HOME');
const command = required('CLAWMINI_COMMAND');
const pathVal = required('CLAWMINI_PATH');
const uid = Number(required('CLAWMINI_UID'));
const gid = Number(required('CLAWMINI_GID'));

function required(key) {
  const val = env[key];
  if (val === undefined || val === '') {
    console.error(`build-spec: missing required env var ${key}`);
    proc.exit(2);
  }
  return val;
}

const spec = {
  ociVersion: '1.0.0',
  process: {
    terminal: false,
    user: { uid, gid },
    args: ['/bin/sh', '-c', command],
    env: [
      `PATH=${pathVal}`,
      `HOME=${home}`,
      'HTTP_PROXY=http://127.0.0.1:8888',
      'HTTPS_PROXY=http://127.0.0.1:8888',
      'http_proxy=http://127.0.0.1:8888',
      'https_proxy=http://127.0.0.1:8888',
    ],
    cwd: agent,
    noNewPrivileges: true,
  },
  // Host root as read-only lower layer; gvisor's rootfs overlay sends any
  // writes to an ephemeral tmpfs so /tmp, /var, etc. behave normally but
  // never persist to the host.
  root: { path: '/', readonly: true },
  mounts: [
    { destination: workspace, source: workspace, type: 'bind', options: ['rbind', 'rw'] },
    {
      destination: `${home}/.gemini`,
      source: `${home}/.gemini`,
      type: 'bind',
      options: ['rbind', 'rw'],
    },
    {
      destination: `${home}/.npm`,
      source: `${home}/.npm`,
      type: 'bind',
      options: ['rbind', 'rw'],
    },
    {
      destination: `${home}/.cache`,
      source: `${home}/.cache`,
      type: 'bind',
      options: ['rbind', 'rw'],
    },
    {
      destination: `${home}/.gitconfig`,
      source: `${home}/.gitconfig`,
      type: 'bind',
      options: ['rbind', 'rw'],
    },
    // Blank, read-only tmpfs hides the real .clawmini from the sandboxed command.
    {
      destination: `${workspace}/.clawmini`,
      source: 'tmpfs',
      type: 'tmpfs',
      options: ['nosuid', 'noexec', 'nodev', 'ro'],
    },
  ],
  linux: {
    namespaces: [
      { type: 'pid' },
      { type: 'ipc' },
      { type: 'uts' },
      { type: 'mount' },
    ],
  },
};

proc.stdout.write(JSON.stringify(spec, null, 2));
