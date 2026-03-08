import { createSlashActionRouter } from './utils.js';

export const slashStop = createSlashActionRouter('stop', 'stop', 'Stopping current task...');
