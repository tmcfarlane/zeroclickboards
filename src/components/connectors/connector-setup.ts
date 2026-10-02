// Every value is one literal shell argument, including operator-chosen public IDs.
const shellArgument = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export function nativeSetupCommand(endpoint: string, clientId: string): string {
  return `codex mcp add zeroboard --url ${shellArgument(endpoint)} --oauth-client-id ${shellArgument(clientId)} --oauth-resource ${shellArgument(endpoint)}`;
}
