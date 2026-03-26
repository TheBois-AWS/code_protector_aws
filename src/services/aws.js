import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs';
import { CostExplorerClient } from '@aws-sdk/client-cost-explorer';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
const ddbClient = new DynamoDBClient({ region });
const ddb = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true }
});
const s3 = new S3Client({ region });
const lambdaClient = new LambdaClient({ region });
const cloudFrontClient = new CloudFrontClient({ region: 'us-east-1' });
const cloudWatchClient = new CloudWatchClient({ region });
const cloudWatchGlobalClient = new CloudWatchClient({ region: 'us-east-1' });
const cloudWatchLogsClient = new CloudWatchLogsClient({ region });
const costExplorerClient = new CostExplorerClient({ region: 'us-east-1' });

export {
  ddbClient,
  ddb,
  s3,
  lambdaClient,
  cloudFrontClient,
  cloudWatchClient,
  cloudWatchGlobalClient,
  cloudWatchLogsClient,
  costExplorerClient
};
