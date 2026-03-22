/**
 * Environment configuration
 *
 * This module MUST be imported first in index.ts to ensure
 * environment variables are loaded before any other modules.
 */

import dotenv from 'dotenv';

dotenv.config({ path: '.env.prod' });

export const NODE_ENV = 'production';
export const ENV_LABEL = 'PROD';
