/** Keep onboarding preflight and doctor aligned with the package engines. */
export function isSupportedNodeVersion(version: string): boolean {
  const match = version.match(/^v?(\d+)(?:\.\d+){1,2}$/u);
  return match?.[1] === '24' || match?.[1] === '26';
}

export const NODE_RUNTIME_GUIDANCE = 'Install Node.js 24 or 26 from https://nodejs.org/en/download (or run "nvm install 24" then "nvm use 24" if nvm is installed). Run "node --version" in this client terminal to verify, restart the client so MCP inherits the updated PATH, then retry the same command.';

export function assertSupportedNodeRuntime(version = process.version): void {
  if (!isSupportedNodeVersion(version)) {
    throw new Error(`NODE_UNSUPPORTED: Node ${version}; supported lines are 24 and 26. ${NODE_RUNTIME_GUIDANCE}`);
  }
}
