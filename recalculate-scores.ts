import { PostgresStorage } from './server/storage';

const storage = new PostgresStorage();

async function recalculate() {
  console.log('Recalculating scores for assignment 21...');
  await storage.recalculateAssessmentScores(21);
  console.log('Done! Scores recalculated.');
  process.exit(0);
}

recalculate().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
