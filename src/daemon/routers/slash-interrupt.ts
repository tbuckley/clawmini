import { createSlashActionRouter } from './utils.js';

export const slashInterrupt = createSlashActionRouter(
  'interrupt',
  'interrupt',
  'Interrupting current task...'
);
