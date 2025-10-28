#!/usr/bin/env node

/**
 * Manual Migration Script
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import fs from 'fs';

const sqlClient = postgres(process.env.DATABASE_URL);
const db = drizzle(sqlClient);

async function runMigration() {
  try {
    console.log('🚀 Running manual migration...\n');
    
    // Read the migration file
    const migrationSQL = fs.readFileSync('./migrations/0000_jittery_cammi.sql', 'utf8');
    
    // Split by statement breakpoints and execute each statement
    const statements = migrationSQL
      .split('--> statement-breakpoint')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0);
    
    console.log(`📋 Found ${statements.length} SQL statements to execute\n`);
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      try {
        console.log(`Executing statement ${i + 1}/${statements.length}...`);
        await db.execute(sql.raw(statement));
        console.log(`✅ Statement ${i + 1} executed successfully`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`⚠️  Statement ${i + 1} skipped (already exists)`);
        } else {
          console.log(`❌ Statement ${i + 1} failed: ${error.message}`);
          throw error;
        }
      }
    }
    
    console.log('\n🎉 Migration completed successfully!');
    
    // Verify documents table exists
    const tables = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      AND table_name = 'documents'
    `);
    
    if (tables.length > 0) {
      console.log('✅ Documents table created successfully');
      
      // Check document count
      const countResult = await db.execute(sql`SELECT COUNT(*) as count FROM documents`);
      console.log(`📊 Documents in database: ${countResult[0].count}`);
    } else {
      console.log('❌ Documents table not found');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await sqlClient.end();
  }
}

runMigration();
