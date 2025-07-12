# Complete Billing Flow Documentation

## Overview
The healthcare billing system automatically generates invoices when sessions are completed. This flow ensures compliance with healthcare billing standards and tracks all financial transactions.

## Billing Flow Process

### 1. Session Creation Phase
**When:** User creates a new session
**What happens:**
- Session is created with status = 'scheduled' 
- Service selected determines CPT code, duration, and pricing
- Room is booked to prevent conflicts
- calculated_rate is auto-populated from service base_rate
- No billing record is created yet (session not completed)

### 2. Session Completion Trigger
**When:** Session status changes from 'scheduled' to 'completed'
**What happens:**
- System automatically creates billing record in session_billing table
- Billing record includes:
  - service_code (CPT code from service)
  - units (usually 1 for individual sessions)
  - rate_per_unit (from service base_rate)
  - total_amount (calculated: units × rate_per_unit)
  - insurance_covered (based on client insurance settings)
  - copay_amount (from client insurance info)
  - billing_date (current date)
  - payment_status = 'pending'

### 3. Invoice Generation
**When:** Billing record is created
**What happens:**
- Invoice is automatically generated with:
  - Client information (name, insurance details)
  - Service details (CPT code, description, duration)
  - Billing amount and insurance coverage
  - Payment status tracking
  - Due date and payment terms

### 4. Payment Processing
**When:** Payment is received
**What happens:**
- payment_status updated to 'paid'
- Payment date recorded
- Insurance claims processed if applicable
- Client account updated

## Key Database Tables

### Sessions Table
- Stores session details and completion status
- Links to services (CPT codes) and rooms
- Tracks calculated_rate from service pricing

### Session_Billing Table
- Created automatically when session is completed
- Contains all billing details for invoice generation
- Tracks payment status and insurance information

### Services Table
- Healthcare service catalog with CPT codes
- Contains pricing and billing information
- Links to sessions for automatic billing

## Billing Triggers

### Primary Trigger: Session Status Change
```sql
-- When session status changes to 'completed'
UPDATE sessions SET status = 'completed' WHERE id = [session_id];
-- Triggers automatic billing record creation
```

### Secondary Triggers:
1. **Cancellation Billing**: Some services bill for cancelled sessions
2. **No-Show Billing**: Configurable billing for no-show appointments
3. **Insurance Updates**: Recalculate billing when insurance changes

## Business Rules

### CPT Code Compliance
- All services linked to standard healthcare CPT codes
- Billing automatically uses correct codes for insurance claims
- Duration and pricing match CPT code requirements

### Insurance Processing
- Client insurance info determines coverage
- Copay amounts calculated automatically
- Insurance claims generated for covered services

### Payment Tracking
- All payments tracked from pending to paid
- Outstanding balances calculated automatically
- Payment history maintained for audit trail

## Current Implementation Status

✅ **Completed Features:**
- Service catalog with CPT codes and pricing
- Session creation with automatic rate calculation
- Room booking and conflict prevention
- Database schema for complete billing flow

🔄 **In Progress:**
- Automatic billing record creation on session completion
- Invoice generation system
- Payment status tracking

📋 **Next Steps:**
1. Implement session status change trigger
2. Add billing record creation logic
3. Build invoice generation system
4. Add payment processing interface

## Testing the Flow

### Test Scenario:
1. Create session with service selection
2. Complete the session (change status to 'completed')
3. Verify billing record is created automatically
4. Check invoice generation
5. Process payment and verify status updates

This system ensures full compliance with healthcare billing standards while automating the entire process from session completion to payment tracking.