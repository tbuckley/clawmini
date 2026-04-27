import type { RouterState } from './types.js';
import { detectInstall } from '../../cli/install-detection.js';
import { sendControlRequest } from '../../cli/supervisor-control.js';
import { isAcceptableVersion } from '../../cli/supervisor-actions.js';
import { getClawminiVersion } from '../../shared/version.js';

export async function slashUpgrade(state: RouterState): Promise<RouterState> {
  const trimmed = state.message.trim();
  if (!/^\/upgrade(\s|$)/.test(trimmed)) return state;

  // Gated to user messages by USER_ROUTERS in resolveRouters.
  const info = detectInstall();
  if (!info.isNpmGlobal) {
    return stop(
      state,
      `Cannot upgrade: clawmini is not installed via \`npm install -g\` ` +
        `(running from ${info.entryRealPath}). Skipping.`
    );
  }

  const rest = trimmed.slice('/upgrade'.length).trim();

  // Bare `/upgrade` is informational. Requiring an explicit version means a
  // misclick (or a malicious tool output that somehow reached this router)
  // can't silently install whatever the npm registry currently calls
  // `latest`. The user has to opt in to the version they want.
  if (rest === '') {
    return stop(
      state,
      [
        `Currently running clawmini v${getClawminiVersion()}.`,
        '/upgrade requires an explicit target:',
        '  /upgrade latest      — install whatever npm reports as the latest tag',
        '  /upgrade <version>   — install a specific version (e.g. /upgrade 0.0.7)',
      ].join('\n')
    );
  }

  // Single token only — extra args could be smuggled into the npm command
  // line otherwise (npm install -g clawmini@<rest> via shell).
  if (!/^\S+$/.test(rest)) {
    return stop(state, 'Usage: /upgrade <version>');
  }

  const version = rest;
  if (!isAcceptableVersion(version)) {
    return stop(state, `Invalid version: ${version}`);
  }

  // The supervisor enqueues the post-upgrade reply on its side based on the
  // outcome of `npm install -g`, so we don't pre-queue anything here.
  let res;
  try {
    res = await sendControlRequest({
      action: 'upgrade',
      version,
      chatId: state.chatId,
      messageId: state.messageId,
    });
  } catch (err) {
    return stop(
      state,
      `Could not reach supervisor: ${err instanceof Error ? err.message : String(err)}.`
    );
  }

  if (!res.ok) {
    return stop(state, `Upgrade aborted: ${res.error ?? 'unknown error'}.`);
  }

  return stop(state, `Upgrading clawmini to ${version}... services will restart shortly.`);
}

function stop(state: RouterState, reply: string): RouterState {
  return { ...state, message: '', action: 'stop', reply };
}
