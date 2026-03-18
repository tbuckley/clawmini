import { Command } from 'commander';
import { promises as fsPromises, Dirent } from 'fs';
import {
  resolveSkillsTemplatePath,
  copyAgentSkills,
  copyAgentSkill,
} from '../../shared/workspace.js';
import { handleError } from '../utils.js';

export const skillsCmd = new Command('skills').description('Manage template skills');

skillsCmd
  .command('list')
  .description('List available template skills')
  .action(async () => {
    try {
      let skillsDir: string;
      try {
        skillsDir = await resolveSkillsTemplatePath();
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('Template not found: skills')) {
          console.error('No skills found. The templates/skills directory does not exist.');
          return;
        }
        throw err;
      }

      let entries: Dirent[];
      try {
        entries = await fsPromises.readdir(skillsDir, { withFileTypes: true });
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
          console.error('No skills found.');
          return;
        }
        throw err;
      }

      const skills = entries.filter((e) => e.isDirectory()).map((e) => e.name);

      if (skills.length === 0) {
        console.error('No skills found.');
        return;
      }
      for (const skill of skills) {
        console.log(`- ${skill}`);
      }
    } catch (err) {
      handleError('list skills', err);
    }
  });

skillsCmd
  .command('add [skill-name]')
  .description('Add a skill to an agent, overwriting the target skill directory if it exists')
  .option('-a, --agent <agentId>', 'Agent ID (defaults to "default")')
  .action(async (skillName: string | undefined, options: { agent?: string }) => {
    try {
      const agentId = options.agent || 'default';

      if (skillName) {
        await copyAgentSkill(agentId, skillName, process.cwd(), true);
        console.log(`Successfully added skill '${skillName}' to agent '${agentId}'.`);
      } else {
        await copyAgentSkills(agentId, process.cwd(), true);
        console.log(`Successfully added all skills to agent '${agentId}'.`);
      }
    } catch (err) {
      handleError('add skill', err);
    }
  });
