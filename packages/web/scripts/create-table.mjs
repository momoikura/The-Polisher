// Creates ThePolisher's DynamoDB table, sized for AWS's always-free tier.
// The free tier only covers PROVISIONED capacity (25 read + 25 write units per region),
// so the table uses 10 + 10 and leaves room for anything else in the account.
//
//   node packages/web/scripts/create-table.mjs
//
// Reads THEPOLISHER_TABLE, AWS_REGION, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from .env.

import fs from "node:fs";
import { CreateTableCommand, DescribeTableCommand, DynamoDBClient, waitUntilTableExists } from "@aws-sdk/client-dynamodb";

const envFile = new URL("../../../.env", import.meta.url);
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const table = process.env.THEPOLISHER_TABLE?.trim();
const region = process.env.AWS_REGION?.trim() || "us-east-1";
if (!table) {
  console.error("Set THEPOLISHER_TABLE in .env first (for example THEPOLISHER_TABLE=thepolisher).");
  process.exit(1);
}

const ddb = new DynamoDBClient({ region });
try {
  await ddb.send(new DescribeTableCommand({ TableName: table }));
  console.log(`Table "${table}" already exists in ${region}; nothing to do.`);
  process.exit(0);
} catch (err) {
  if (err.name !== "ResourceNotFoundException") throw err;
}

await ddb.send(
  new CreateTableCommand({
    TableName: table,
    AttributeDefinitions: [
      { AttributeName: "pk", AttributeType: "S" },
      { AttributeName: "sk", AttributeType: "S" },
    ],
    KeySchema: [
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ],
    BillingMode: "PROVISIONED",
    ProvisionedThroughput: { ReadCapacityUnits: 10, WriteCapacityUnits: 10 },
  })
);
await waitUntilTableExists({ client: ddb, maxWaitTime: 120 }, { TableName: table });
console.log(`Created "${table}" in ${region} (provisioned 10 read / 10 write units, inside the free tier).`);
