import { db } from './server/db';
import { assessmentResponses, assessmentQuestionOptions } from './shared/schema';
import { eq, and } from 'drizzle-orm';

/**
 * Migration script to convert legacy assessment responses from array indices to option IDs
 * 
 * Legacy format: selectedOptions = [0, 1, 2, 3] (array indices)
 * New format: selectedOptions = [17929, 17930, 17931, 17932] (option IDs)
 * 
 * This script:
 * 1. Finds all responses with selectedOptions
 * 2. For each response, checks if values are indices or IDs
 * 3. Converts indices to proper option IDs by matching sort order
 * 4. Updates the response in the database
 */

async function migrateAssessmentResponses() {
  console.log('Starting migration of assessment responses...');
  
  try {
    // Get all responses that have selectedOptions
    const responses = await db
      .select()
      .from(assessmentResponses)
      .where(eq(assessmentResponses.selectedOptions, assessmentResponses.selectedOptions));
    
    console.log(`Found ${responses.length} total responses`);
    
    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (const response of responses) {
      if (!response.selectedOptions || response.selectedOptions.length === 0) {
        skippedCount++;
        continue;
      }
      
      try {
        // Get all options for this question
        const allOptions = await db
          .select()
          .from(assessmentQuestionOptions)
          .where(eq(assessmentQuestionOptions.questionId, response.questionId))
          .orderBy(assessmentQuestionOptions.sortOrder);
        
        if (allOptions.length === 0) {
          console.log(`⚠️  No options found for question ${response.questionId}, response ${response.id}`);
          skippedCount++;
          continue;
        }
        
        // Check if values are already option IDs
        const optionIds = allOptions.map(opt => opt.id);
        const allAreIds = response.selectedOptions.every(val => optionIds.includes(val));
        
        if (allAreIds) {
          // Already normalized
          skippedCount++;
          continue;
        }
        
        // Convert indices to option IDs
        const normalized: number[] = [];
        
        for (const value of response.selectedOptions) {
          // Try to match by sort order (for index-based)
          let matched = allOptions.find(opt => (opt.sortOrder ?? 0) === value);
          
          // If not found, try to match by score value (for BDI-II where scores are 0,1,2,3)
          if (!matched) {
            matched = allOptions.find(opt => Number(opt.optionValue) === value);
          }
          
          // If still not found and value is a valid array index, use it
          if (!matched && value >= 0 && value < allOptions.length) {
            matched = allOptions[value];
          }
          
          if (matched) {
            normalized.push(matched.id);
          } else {
            console.log(`⚠️  Could not match value ${value} for question ${response.questionId}, response ${response.id}`);
          }
        }
        
        if (normalized.length > 0 && normalized.length === response.selectedOptions.length) {
          // Update the response with normalized option IDs
          await db
            .update(assessmentResponses)
            .set({
              selectedOptions: normalized,
              updatedAt: new Date()
            })
            .where(eq(assessmentResponses.id, response.id));
          
          console.log(`✓ Migrated response ${response.id}: ${JSON.stringify(response.selectedOptions)} → ${JSON.stringify(normalized)}`);
          migratedCount++;
        } else {
          console.log(`⚠️  Partial match for response ${response.id}, skipping`);
          skippedCount++;
        }
      } catch (error) {
        console.error(`❌ Error migrating response ${response.id}:`, error);
        errorCount++;
      }
    }
    
    console.log('\n=== Migration Summary ===');
    console.log(`Total responses: ${responses.length}`);
    console.log(`✓ Successfully migrated: ${migratedCount}`);
    console.log(`- Skipped (already normalized or no options): ${skippedCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log('\nMigration complete!');
    
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

// Run the migration
migrateAssessmentResponses()
  .then(() => {
    console.log('Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
