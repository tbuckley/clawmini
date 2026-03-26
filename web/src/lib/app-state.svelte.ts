export const appState = $state<{
  verbosityLevel: 'default' | 'debug' | 'verbose';
  markdownEnabled: boolean;
}>({
  verbosityLevel: 'default',
  markdownEnabled: true,
});
