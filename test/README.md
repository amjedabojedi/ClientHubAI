# TherapyFlow Automated Tests

## Overview
This directory contains automated tests for critical TherapyFlow functionality to prevent regressions and ensure data integrity.

## Running Tests

### Invoice Service Enrichment Tests
Tests that invoices correctly display service names instead of just codes.

```bash
npx tsx test/invoice-enrichment.test.ts
```

**What it tests:**
- Service table structure (serviceCode, serviceName fields)
- Invoice enrichment mapping logic
- Invoice database structure (uses serviceCode, not serviceId)
- End-to-end enrichment workflow
- Performance (enrichment should be < 1 second)

**Expected result:**
```
✅ Passed: 12
❌ Failed: 0
🎉 All tests passed!
```

**Limitations:**
- ⚠️ Uses live database data (not mocked or seeded fixtures)
- ⚠️ Requires at least 1 service and 1 invoice in database
- ⚠️ Results depend on current database state
- ⚠️ For production CI/CD, seed deterministic test data first

**Future improvements:**
- Seed controlled test fixtures before running tests
- Add integration tests hitting actual API endpoints
- Mock database calls for true unit testing

## Adding New Tests

To add new test files:

1. Create a new `.test.ts` file in the `test/` directory
2. Use the same pattern as `invoice-enrichment.test.ts`:
   - Import database and schema
   - Create assert/assertEqual utility functions
   - Write descriptive test cases
   - Print a summary at the end
3. Add instructions to this README

## Test Best Practices

- **Test real data**: Tests run against the actual database, not mocks
- **Be descriptive**: Clear test names explain what's being verified
- **Assert everything**: Don't assume - explicitly check conditions
- **Show progress**: Print status so you can see what's being tested
- **Clean output**: Use ✅ and ❌ for easy scanning
- **Performance matters**: Flag slow operations (> 1 second)

## When to Run Tests

Run tests:
- ✅ After modifying invoice or billing code
- ✅ Before deploying to production
- ✅ When adding new service types
- ✅ After database schema changes
- ✅ When fixing bugs in data enrichment

## Future Test Ideas

Potential tests to add:
- Portal appointment booking race conditions
- Document upload/download integrity
- Stripe payment webhook processing
- Audit log creation for HIPAA compliance
- Email notification delivery
- Session double-booking prevention
