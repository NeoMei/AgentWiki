import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function parseEnvironmentAssignment(assignment) {
  const separator = assignment?.indexOf('=') ?? -1;
  const name = separator > 0 ? assignment.slice(0, separator) : '';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
    throw new Error('Expected an environment assignment in NAME=value form');
  }
  return { name, value: assignment.slice(separator + 1) };
}

export function runNodeWithEnv(argv, run = spawnSync) {
  const [assignment, ...nodeArguments] = argv;
  if (nodeArguments.length === 0) throw new Error('Expected a Node.js script or option after the environment assignment');
  const { name, value } = parseEnvironmentAssignment(assignment);
  const result = run(process.execPath, nodeArguments, {
    env: { ...process.env, [name]: value },
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entrypoint === import.meta.url) process.exitCode = runNodeWithEnv(process.argv.slice(2));
