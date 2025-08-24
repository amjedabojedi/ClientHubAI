#!/usr/bin/env node

// Admin Password Reset Tool for Production
// Run this script on your live server to reset admin password

const { Pool } = require('@neondatabase/serverless');
const bcrypt = require('bcrypt');

async function resetAdminPassword() {
  try {
    // Use the production DATABASE_URL
    const databaseUrl = process.env.DATABASE_URL;
    
    if (!databaseUrl) {
      console.error('❌ DATABASE_URL environment variable not found');
      console.log('Make sure this script runs where DATABASE_URL is available');
      process.exit(1);
    }
    
    console.log('🔗 Connecting to database...');
    const pool = new Pool({ connectionString: databaseUrl });
    
    // New admin password
    const newPassword = 'TherapyFlow2025!';
    console.log('🔐 Generating secure password hash...');
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Update admin password
    console.log('📝 Updating admin password...');
    const result = await pool.query(
      'UPDATE users SET password = $1 WHERE username = $2',
      [hashedPassword, 'admin']
    );
    
    if (result.rowCount === 0) {
      console.error('❌ Admin user not found in database');
      process.exit(1);
    }
    
    console.log('✅ Admin password reset successfully!');
    console.log('');
    console.log('Login credentials:');
    console.log('Username: admin');
    console.log('Password: TherapyFlow2025!');
    
    await pool.end();
  } catch (error) {
    console.error('❌ Error resetting password:', error.message);
    process.exit(1);
  }
}

resetAdminPassword();