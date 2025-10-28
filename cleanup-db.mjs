#!/usr/bin/env node

/**
 * Database Cleanup Script
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';

const sqlClient = postgres(process.env.DATABASE_URL);
const db = drizzle(sqlClient);

async function cleanupDatabase() {
  try {
    console.log('🧹 Cleaning up database...\n');
    
    // Check existing types
    const types = await db.execute(sql`
      SELECT typname 
      FROM pg_type 
      WHERE typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND typtype = 'e'
    `);
    
    console.log('📋 Existing enum types:');
    types.forEach(type => {
      console.log(`  - ${type.typname}`);
    });
    
    // Check existing tables
    const tables = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    console.log('\n📋 Existing tables:');
    tables.forEach(table => {
      console.log(`  - ${table.table_name}`);
    });
    
    if (tables.length > 0) {
      console.log('\n⚠️  Database has existing data. Skipping cleanup.');
      console.log('💡 You may need to manually drop tables/types if you want a fresh start.');
    } else {
      console.log('\n✅ Database is clean and ready for migration.');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await sqlClient.end();
  }
}

cleanupDatabase();
