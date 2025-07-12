# Session Booking System Enhancement Plan

## Overview
Enhance the current session booking system to include service codes, billing integration, room conflict prevention, and comprehensive service management for healthcare billing compliance.

## Current State Analysis

### Existing Schema Issues:
- Manual duration entry (should be service-based)
- Basic room field without conflict checking
- Missing service codes for billing
- No service catalog or rate management
- No room availability system

## Proposed Enhancements

### 1. Service Catalog System
```sql
-- Services table with billing codes and rates
CREATE TABLE services (
  id SERIAL PRIMARY KEY,
  service_code VARCHAR(20) UNIQUE NOT NULL,  -- CPT codes like "90834", "90837"
  service_name TEXT NOT NULL,                -- "Individual Psychotherapy 45 min"
  service_type service_type_enum NOT NULL,   -- assessment, psychotherapy, consultation
  standard_duration INTEGER NOT NULL,        -- 45, 60, 90 minutes
  base_rate DECIMAL(10,2) NOT NULL,         -- Standard billing rate
  billing_category VARCHAR(50),             -- Insurance category
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Room management system
CREATE TABLE rooms (
  id SERIAL PRIMARY KEY,
  room_number VARCHAR(20) UNIQUE NOT NULL,
  room_name TEXT NOT NULL,
  capacity INTEGER DEFAULT 1,
  equipment TEXT[],                         -- ['video', 'whiteboard', 'telephone']
  is_active BOOLEAN DEFAULT TRUE,
  notes TEXT
);

-- Room availability and conflict prevention
CREATE TABLE room_bookings (
  id SERIAL PRIMARY KEY,
  room_id INTEGER REFERENCES rooms(id),
  session_id INTEGER REFERENCES sessions(id),
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  booked_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(room_id, start_time, end_time)     -- Prevent double booking
);
```

### 2. Enhanced Session Schema
```sql
-- Updated sessions table
ALTER TABLE sessions 
ADD COLUMN service_id INTEGER REFERENCES services(id),
ADD COLUMN room_id INTEGER REFERENCES rooms(id),
ADD COLUMN calculated_rate DECIMAL(10,2),
ADD COLUMN insurance_applicable BOOLEAN DEFAULT FALSE,
ADD COLUMN billing_notes TEXT,
REMOVE COLUMN duration,  -- Now comes from service
REMOVE COLUMN room;      -- Now FK to rooms table
```

### 3. Billing Integration
```sql
-- Session billing records
CREATE TABLE session_billing (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES sessions(id),
  service_code VARCHAR(20) NOT NULL,
  units INTEGER DEFAULT 1,
  rate_per_unit DECIMAL(10,2) NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  insurance_covered BOOLEAN DEFAULT FALSE,
  copay_amount DECIMAL(10,2),
  billing_date DATE,
  payment_status billing_status_enum DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Implementation Steps

### Phase 1: Database Schema Updates
1. Create services table with standard healthcare service codes
2. Create rooms table with conflict prevention
3. Create room_bookings table for availability tracking
4. Update sessions table to use service_id and room_id
5. Create session_billing table for billing records

### Phase 2: Backend API Updates
1. Add service management endpoints
2. Add room availability checking logic
3. Update session creation to validate room conflicts
4. Add billing calculation based on service rates
5. Add room booking/release functionality

### Phase 3: Frontend Updates
1. Replace duration field with service selection
2. Add room availability calendar
3. Add service catalog management
4. Update booking form with service codes
5. Add billing preview in session booking

### Phase 4: Business Logic
1. Automatic billing calculation based on service
2. Room conflict prevention during booking
3. Service rate management by admin
4. Billing report generation
5. Insurance integration prep

## Expected Benefits

### For Therapists:
- No manual duration entry - automatically set by service type
- No room conflicts - system prevents double booking
- Automatic billing calculation based on service codes
- Professional billing codes for insurance

### For Administrators:
- Centralized service and rate management
- Room utilization tracking
- Billing compliance with healthcare standards
- Conflict-free room scheduling

### For Billing:
- Standardized service codes (CPT codes)
- Automatic rate calculation
- Insurance-ready billing records
- Audit trail for all sessions

## Sample Service Codes
- 90834: Individual Psychotherapy, 45 minutes
- 90837: Individual Psychotherapy, 60 minutes  
- 90791: Psychiatric Diagnostic Evaluation
- 90834+90837: Extended therapy session
- 90847: Family Therapy with patient present

## Room Conflict Prevention
- Real-time availability checking
- Visual calendar showing room usage
- Automatic conflict detection
- Alternative room suggestions
- Booking confirmation system

This enhancement will transform the session booking from a simple scheduling tool into a comprehensive healthcare service management system with billing integration and resource conflict prevention.