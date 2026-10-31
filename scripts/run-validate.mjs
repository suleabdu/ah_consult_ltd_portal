import { spawnSync } from 'node:child_process';

const candidates = process.platform === 'win32'
  ? [
      ['python', ['scripts/validate.py']],
      ['python3', ['scripts/validate.py']],
      ['py', ['-3', 'scripts/validate.py']],
    ]
  : [
      ['python3', ['scripts/validate.py']],
      ['python', ['scripts/validate.py']],
    ];

for (const [command, args] of candidates) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error?.code === 'ENOENT') continue;
  if (result.error) {
    console.error(`Unable to run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

console.error('Python 3 is required to run scripts/validate.py. Install Python 3 and ensure python3, python, or py is available on PATH.');
process.exit(1);
