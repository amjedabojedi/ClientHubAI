#!/usr/bin/env node

/**
 * Simple Database Check Script
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';

const sqlClient = postgres(process.env.DATABASE_URL);
const db = drizzle(sqlClient);

async function checkDatabase() {
  try {
    console.log('🔍 Checking database tables...\n');
    
    // Check if documents table exists
    const result = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'documents'
    `);
    
    if (result.length > 0) {
      console.log('✅ Documents table exists');
      
      // Get document count
      const countResult = await db.execute(sql`SELECT COUNT(*) as count FROM documents`);
      console.log(`📊 Found ${countResult[0].count} documents in database`);
      
      // Get sample documents
      const sampleDocs = await db.execute(sql`
        SELECT id, file_name, original_name, file_size, mime_type, created_at 
        FROM documents 
        ORDER BY created_at DESC 
        LIMIT 5
      `);
      
      console.log('\n📄 Sample documents:');
      sampleDocs.forEach(doc => {
        console.log(`  ${doc.id}: ${doc.original_name} (${doc.file_size} bytes, ${doc.mime_type})`);
      });
      
    } else {
      console.log('❌ Documents table does not exist');
      console.log('Available tables:');
      
      const tables = await db.execute(sql`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name
      `);
      
      tables.forEach(table => {
        console.log(`  - ${table.table_name}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await sqlClient.end();
  }
}

checkDatabase();
