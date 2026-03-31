import { describe, it, expect } from 'vitest';
import { slashCommands } from './commands.js';

describe('Discord Slash Commands', () => {
  it('should define the required slash commands', () => {
    const commandNames = slashCommands.map((cmd) => cmd.name);

    expect(commandNames).toContain('new');
    expect(commandNames).toContain('stop');
    expect(commandNames).toContain('approve');
    expect(commandNames).toContain('reject');
    expect(commandNames).toContain('pending');
    expect(commandNames).toContain('show');
    expect(commandNames).toContain('hide');
    expect(commandNames).toContain('debug');
  });

  it('should define arguments for approve', () => {
    const approveCommand = slashCommands.find((cmd) => cmd.name === 'approve');
    expect(approveCommand).toBeDefined();
    const json = approveCommand?.toJSON();
    expect(json?.options).toBeDefined();
    const policyIdOption = json?.options?.find((opt) => opt.name === 'policy_id');
    expect(policyIdOption).toBeDefined();
    expect(policyIdOption?.required).toBe(true);
  });

  it('should define arguments for reject', () => {
    const rejectCommand = slashCommands.find((cmd) => cmd.name === 'reject');
    expect(rejectCommand).toBeDefined();
    const json = rejectCommand?.toJSON();
    expect(json?.options).toBeDefined();

    const policyIdOption = json?.options?.find((opt) => opt.name === 'policy_id');
    expect(policyIdOption).toBeDefined();
    expect(policyIdOption?.required).toBe(true);

    const rationaleOption = json?.options?.find((opt) => opt.name === 'rationale');
    expect(rationaleOption).toBeDefined();
    expect(rationaleOption?.required).toBe(false);
  });
});
