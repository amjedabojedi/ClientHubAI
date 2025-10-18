import { db } from "../db";
import { clients, clientHistory } from "@shared/schema";
import { notInArray, sql } from "drizzle-orm";

/**
 * Backfill script to add 'file_created' history events for all existing clients
 * that don't already have one
 */
async function backfillFileCreatedHistory() {
  console.log('Starting backfill of file_created history events...');
  
  try {
    // Get all clients that don't have a file_created event
    const allClients = await db.select().from(clients);
    console.log(`Found ${allClients.length} total clients`);
    
    // Get client IDs that already have file_created events
    const existingEvents = await db
      .select({ clientId: clientHistory.clientId })
      .from(clientHistory)
      .where(sql`${clientHistory.eventType} = 'file_created'`);
    
    const existingClientIds = new Set(existingEvents.map(e => e.clientId));
    console.log(`${existingClientIds.size} clients already have file_created events`);
    
    // Filter to clients that need backfill
    const clientsNeedingBackfill = allClients.filter(c => !existingClientIds.has(c.id));
    console.log(`${clientsNeedingBackfill.length} clients need backfill`);
    
    if (clientsNeedingBackfill.length === 0) {
      console.log('No clients need backfill. Exiting.');
      return;
    }
    
    // Create file_created events for each client
    let successCount = 0;
    let errorCount = 0;
    
    for (const client of clientsNeedingBackfill) {
      try {
        await db.insert(clientHistory).values({
          clientId: client.id,
          eventType: 'file_created',
          description: 'Client file created (backfilled)',
          fromValue: null,
          toValue: client.stage || 'intake',
          createdAt: client.createdAt || new Date(),
          createdBy: null // No user info available for historical records
        });
        successCount++;
        
        if (successCount % 100 === 0) {
          console.log(`Progress: ${successCount}/${clientsNeedingBackfill.length}`);
        }
      } catch (error) {
        console.error(`Error backfilling client ${client.id}:`, error);
        errorCount++;
      }
    }
    
    console.log('\nBackfill complete!');
    console.log(`✓ Successfully created: ${successCount} events`);
    if (errorCount > 0) {
      console.log(`✗ Errors: ${errorCount} events`);
    }
    
  } catch (error) {
    console.error('Fatal error during backfill:', error);
    throw error;
  }
}

// Run the backfill
backfillFileCreatedHistory()
  .then(() => {
    console.log('Backfill script finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Backfill script failed:', error);
    process.exit(1);
  });
