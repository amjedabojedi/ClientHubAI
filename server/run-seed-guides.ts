#!/usr/bin/env tsx

/**
 * Standalone script to seed help guides
 * Run with: npm run tsx server/run-seed-guides.ts
 */

import { seedHelpGuides } from './seed-help-guides';

async function main() {
  console.log('Running help guides migration...');
  try {
    const result = await seedHelpGuides();
    console.log('Migration successful!', result);
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

main();
