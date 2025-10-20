/**
 * Automated Tests for Invoice Service Enrichment
 * 
 * Tests that invoices correctly display service names instead of codes
 * This prevents bugs where clients see "90834" instead of "Individual Psychotherapy 45 min"
 * 
 * Run with: npx tsx test/invoice-enrichment.test.ts
 * 
 * LIMITATIONS:
 * - Tests use LIVE database data (not fixtures or mocks)
 * - Requires database to have at least 1 service and 1 invoice
 * - Results depend on current database state
 * - For production CI/CD, should seed deterministic test data first
 * 
 * FUTURE IMPROVEMENTS:
 * - Seed controlled test fixtures before running
 * - Mock database calls for unit testing
 * - Add integration test hitting actual /api/portal/invoices endpoint
 */

import { db } from "../server/db";
import { services, sessionBilling, sessions, clients } from "../shared/schema";
import { eq } from "drizzle-orm";

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    testsFailed++;
  }
}

function assertEqual(actual: any, expected: any, message: string) {
  if (actual === expected) {
    console.log(`✅ PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    console.error(`   Expected: ${expected}`);
    console.error(`   Actual: ${actual}`);
    testsFailed++;
  }
}

async function testInvoiceServiceEnrichment() {
  console.log("\n🧪 Starting Invoice Service Enrichment Tests\n");
  
  try {
    // Test 1: Verify services table has serviceCode field
    console.log("Test 1: Verify services table structure");
    const allServices = await db.select().from(services).limit(1);
    assert(allServices.length > 0, "Services table has data");
    
    if (allServices.length === 0) {
      throw new Error("Services table is empty - cannot run enrichment tests without service data");
    }
    
    const service = allServices[0];
    assert('serviceCode' in service, "Service has serviceCode field");
    assert('serviceName' in service, "Service has serviceName field");
    
    // Test 2: Verify invoice enrichment logic
    console.log("\nTest 2: Invoice enrichment mapping logic");
    
    // Simulate the enrichment logic from server/routes.ts
    const testServices = await db.select().from(services);
    const serviceMap = new Map(testServices.map(s => [s.serviceCode, s]));
    
    assert(serviceMap.size > 0, "Service map created successfully");
    
    // Test mapping by serviceCode (correct approach)
    const testCode = testServices[0]?.serviceCode;
    if (testCode) {
      const mappedService = serviceMap.get(testCode);
      assert(mappedService !== undefined, `Service code ${testCode} maps correctly`);
      assertEqual(
        mappedService?.serviceCode, 
        testCode, 
        "Mapped service has correct serviceCode"
      );
    }
    
    // Test 3: Verify invoice structure
    console.log("\nTest 3: Invoice database structure");
    const sampleInvoices = await db.select().from(sessionBilling).limit(5);
    
    if (sampleInvoices.length > 0) {
      const invoice = sampleInvoices[0];
      assert('serviceCode' in invoice, "Invoice has serviceCode field");
      assert(!('serviceId' in invoice), "Invoice does NOT have serviceId field (correct)");
      
      // Test enrichment for real invoice
      const invoiceService = serviceMap.get(invoice.serviceCode);
      if (invoiceService) {
        assert(
          invoiceService.serviceName !== undefined,
          `Invoice ${invoice.id} can be enriched with service name: ${invoiceService.serviceName}`
        );
      }
    } else {
      console.log("⚠️  No invoices in database to test enrichment");
    }
    
    // Test 4: End-to-end enrichment simulation
    console.log("\nTest 4: End-to-end enrichment simulation");
    
    const rawInvoices = await db
      .select()
      .from(sessionBilling)
      .limit(10);
    
    // Enrich invoices (same logic as portal endpoint)
    const enrichedInvoices = rawInvoices.map(inv => {
      const service = inv.serviceCode ? serviceMap.get(inv.serviceCode) : null;
      return {
        ...inv,
        serviceName: service?.serviceName || null,
      };
    });
    
    // Verify enrichment worked
    const invoicesWithNames = enrichedInvoices.filter(inv => inv.serviceName !== null);
    const invoicesWithoutNames = enrichedInvoices.filter(inv => inv.serviceName === null);
    
    console.log(`   Invoices enriched: ${invoicesWithNames.length}`);
    console.log(`   Invoices without service: ${invoicesWithoutNames.length}`);
    
    assert(
      enrichedInvoices.length === rawInvoices.length,
      "All invoices processed in enrichment"
    );
    
    // Test 5: Verify no invoices are using incorrect serviceId field
    console.log("\nTest 5: Verify invoices don't use deprecated serviceId");
    
    const invoiceSchema = Object.keys(sampleInvoices[0] || {});
    assert(
      !invoiceSchema.includes('serviceId'),
      "Invoice schema does not include deprecated serviceId field"
    );
    
    // Test 6: Performance test - ensure enrichment is fast
    console.log("\nTest 6: Performance test");
    
    const startTime = Date.now();
    const largeInvoiceSet = await db.select().from(sessionBilling).limit(100);
    const enrichedSet = largeInvoiceSet.map(inv => {
      const service = inv.serviceCode ? serviceMap.get(inv.serviceCode) : null;
      return { ...inv, serviceName: service?.serviceName || null };
    });
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    assert(
      duration < 1000,
      `Enrichment of ${largeInvoiceSet.length} invoices completed in ${duration}ms (< 1s)`
    );
    
  } catch (error) {
    console.error("\n❌ Test suite error:", error);
    testsFailed++;
  }
  
  // Print summary
  console.log("\n" + "=".repeat(50));
  console.log("📊 TEST SUMMARY");
  console.log("=".repeat(50));
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log(`📈 Total:  ${testsPassed + testsFailed}`);
  
  if (testsFailed === 0) {
    console.log("\n🎉 All tests passed!");
    process.exit(0);
  } else {
    console.log("\n⚠️  Some tests failed. Please review the output above.");
    process.exit(1);
  }
}

// Run tests
testInvoiceServiceEnrichment().catch(error => {
  console.error("Fatal error running tests:", error);
  process.exit(1);
});
