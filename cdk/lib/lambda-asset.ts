import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import { execSync } from 'child_process';

const LAMBDA_DIR: string = path.join(__dirname, '../lambda');

/** The one code asset for every function built from cdk/lambda. Each function picks its own handler. */
export function lambdaCode(): lambda.Code {
  return lambda.Code.fromAsset(LAMBDA_DIR, {
    bundling: {
      local: {
        tryBundle(outputDir: string): boolean {
          execSync(`cd ${LAMBDA_DIR} && npm install && npm run build && npm prune --omit=dev`, { stdio: 'inherit' });
          execSync(`cp -r ${LAMBDA_DIR}/dist/. ${outputDir}/`, { stdio: 'inherit' });
          execSync(`cp -r ${LAMBDA_DIR}/node_modules ${outputDir}/node_modules`, { stdio: 'inherit' });
          return true;
        },
      },
      image: lambda.Runtime.NODEJS_22_X.bundlingImage,
      command: [
        'bash', '-c',
        'npm ci && npm run build && cp -r dist/* /asset-output/ && cp -r node_modules /asset-output/node_modules',
      ],
    },
  });
}
