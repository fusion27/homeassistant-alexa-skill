/**
 * Validate a local config JSON file and write it to the SecureString config parameter.
 * CloudFormation can't create SecureString parameters, so this is the codified one-off.
 *
 *   npx ts-node scripts/put-config.ts <path/to/config.json> [--yes]
 *
 * Without --yes it only validates. Keep the JSON file out of git.
 */
import { readFileSync } from 'fs';
import { SSMClient, PutParameterCommand } from '@aws-sdk/client-ssm';
import { CONFIG_PARAMETER, CONFIG_REGION, parseAppConfig } from '../lib/config';

const STANDARD_TIER_LIMIT_BYTES = 4096;

async function main(argv: readonly string[]): Promise<void> {
  const path: string | undefined = argv[0];
  if (path === undefined) throw new Error('Usage: put-config.ts <config.json> [--yes]');

  const config = parseAppConfig(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  const value: string = JSON.stringify(config);
  const size: number = Buffer.byteLength(value, 'utf8');
  if (size > STANDARD_TIER_LIMIT_BYTES) {
    throw new Error(`Config is ${size} bytes; Standard tier allows ${STANDARD_TIER_LIMIT_BYTES}`);
  }
  console.log(`Valid config, ${size} bytes. Top-level keys: ${Object.keys(config).join(', ')}`);

  if (!argv.includes('--yes')) {
    console.log('Dry run. Re-run with --yes to write the parameter.');
    return;
  }
  const result = await new SSMClient({ region: CONFIG_REGION }).send(new PutParameterCommand({
    Name: CONFIG_PARAMETER,
    Value: value,
    Type: 'SecureString',
    Tier: 'Standard',
    Overwrite: true,
    Description: 'ha-alexa-skill configuration (JSON)',
  }));
  console.log(`Wrote ${CONFIG_PARAMETER} version ${result.Version ?? '?'}`);
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
