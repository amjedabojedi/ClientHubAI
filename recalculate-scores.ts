import { PostgresStorage } from './server/storage';

const storage = new PostgresStorage();

async function recalculate() {
  const assignmentId = process.argv[2] ? parseInt(process.argv[2]) : null;
  
  if (!assignmentId) {
    console.log('Usage: tsx recalculate-scores.ts <assignmentId>');
    console.log('Example: tsx recalculate-scores.ts 21');
    process.exit(1);
  }
  
  console.log(`Recalculating scores for assessment assignment ${assignmentId}...`);
  await storage.recalculateAssessmentScores(assignmentId);
  console.log('Done! Scores recalculated successfully.');
  console.log('\nNOTE: After recalculating scores, you should regenerate the AI report for this assessment.');
  process.exit(0);
}

recalculate().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
