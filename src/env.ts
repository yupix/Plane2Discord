import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';
import process from 'node:process';
import { configDotenv } from 'dotenv';

configDotenv();

export const env = createEnv({
  server: {
    PORT: z.coerce.number().default(3000),
    DISCORD_WEBHOOK_URL: z.string().optional(),
    WEBHOOK_SECRET: z.string().optional(),
    PLANE_API_KEY: z.string().optional(),
    PLANE_API_BASE_URL: z.string().optional(),
    PLANE_HOSTNAME: z.string().optional(),
    S3_BUCKET_NAME: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_ENDPOINT: z.string().optional(),
  },
  runtimeEnv: process.env,
});
