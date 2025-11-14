# Assessment Score Calculation Flow

## Overview
SmartHub calculates assessment scores at the **backend** level when responses are saved. The AI only **presents** these pre-calculated scores in narrative form - it does NOT calculate them.

## The Complete Flow

### 1. Frontend - Data Collection
**File**: `client/src/pages/assessment-completion.tsx`

- User selects an answer (e.g., "I am sad all the time")
- Frontend sends **option ID** (NOT array index) to backend
- Example: `selectedOptions: [17931]` where 17931 is the database ID of the option

```typescript
// Correct: Sends option ID
question.allOptions[selectedIndex].id  // → 17931
```

### 2. Backend - Score Calculation
**File**: `server/storage.ts` - Method: `saveAssessmentResponse()`

**Step 2.1**: Normalize option IDs (line 3889)
- Handles legacy data that might have array indices
- Converts everything to option IDs

**Step 2.2**: Calculate score (line 3896)
```typescript
const scoreValue = await this.calculateResponseScore(responseData);
```

**Step 2.3**: Save to database (line 3920, 3937)
```typescript
scoreValue: scoreValue !== null ? scoreValue.toString() : null
```

### 3. Score Calculation Logic
**File**: `server/storage.ts` - Method: `calculateResponseScore()`

**Requirements for scoring**:
1. Question must have `contributesToScore = true`
2. Response must have `selectedOptions` (option IDs)

**Calculation steps**:
```typescript
// Get the selected options by their IDs
const selectedOptions = await db
  .select()
  .from(assessmentQuestionOptions)
  .where(inArray(assessmentQuestionOptions.id, optionIds));

// Sum up the option values
let totalScore = 0;
for (const option of selectedOptions) {
  totalScore += Number(option.optionValue) || 0;
}
return totalScore;
```

**Example**:
- Question: "Sadness"
- Selected: "I am sad all the time." (option ID: 17931)
- Option value in DB: 2
- **Score saved to database**: 2

### 4. AI Report Generation
**File**: `server/ai/openai.ts` - Method: `generateAssessmentReport()`

**Step 4.1**: Retrieve responses from database (already have scores)

**Step 4.2**: Calculate section totals (line 586-589)
```typescript
sectionTotal = sectionResponses.reduce((sum, resp) => {
  const scoreValue = resp.scoreValue ? Number(resp.scoreValue) : 0;
  return sum + scoreValue;
}, 0);
```

**Step 4.3**: Send to AI with explicit instruction (line 599)
```typescript
userPrompt += `CRITICAL - USE EXACT SCORE: This section's total score is ${sectionTotal}. 
You MUST report this EXACT score - do not recalculate or interpret it.`;
```

**Step 4.4**: AI generates narrative using the provided score
- Temperature: 0 (deterministic output)
- AI wraps the score in clinical language
- Score remains exactly as provided

## Database Schema

### Questions
```sql
assessment_questions
- id (primary key)
- contributes_to_score (boolean) -- MUST be true for scoring questions
```

### Options
```sql
assessment_question_options
- id (primary key)
- question_id (foreign key)
- option_text (e.g., "I am sad all the time")
- option_value (e.g., 2) -- The score for this option
- sort_order (e.g., 2)
```

### Responses
```sql
assessment_responses
- id (primary key)
- question_id (foreign key)
- selected_options (integer array) -- Contains OPTION IDs: {17931}
- score_value (numeric) -- Pre-calculated score: 2
```

## Score Verification Query

Check if scores are calculated correctly:

```sql
SELECT 
  aq.question_text,
  aqo.option_text,
  aqo.option_value,
  ar.score_value,
  CASE 
    WHEN aqo.option_value = ar.score_value THEN '✓ Correct'
    ELSE '✗ Mismatch'
  END as status
FROM assessment_responses ar
JOIN assessment_questions aq ON ar.question_id = aq.id
JOIN assessment_question_options aqo ON aqo.id = ar.selected_options[1]
WHERE ar.assignment_id = 41
AND aq.section_id = 9;
```

## Common Issues & Fixes

### Issue: Scores are NULL
**Cause**: `contributes_to_score` is false
**Fix**: 
```sql
UPDATE assessment_questions
SET contributes_to_score = true
WHERE section_id IN (SELECT id FROM assessment_sections WHERE is_scoring = true);
```

### Issue: Scores are doubled or outside expected range
**Cause**: Multiple responders answering the same assessment, and system was summing ALL responses instead of using latest per question
**Fix**: 
- Modified `getAssessmentResponses` in `server/storage.ts` to deduplicate responses
- Keeps only the LATEST response per question (by `created_at` timestamp)
- Code now properly handles multi-responder scenarios

### Issue: Scores change each regeneration
**Cause**: AI temperature > 0 or AI is recalculating instead of using provided scores
**Fix**: 
- Set `temperature: 0` in OpenAI API call
- Add explicit instruction to use exact scores (already implemented)

### Issue: Scores are always zero
**Cause**: Frontend sending array indices instead of option IDs
**Fix**: Use `question.allOptions[index].id` not just `index`

## Recalculating Scores

If scores need to be recalculated after fixing data issues:

```bash
tsx recalculate-scores.ts <assignmentId>
```

Or use SQL for bulk update:
```sql
WITH response_scores AS (
  SELECT 
    ar.id as response_id,
    SUM(aqo.option_value::int) as calculated_score
  FROM assessment_responses ar
  JOIN assessment_questions aq ON ar.question_id = aq.id
  CROSS JOIN LATERAL unnest(ar.selected_options) AS option_id
  JOIN assessment_question_options aqo ON aqo.id = option_id
  WHERE aq.contributes_to_score = true
  GROUP BY ar.id
)
UPDATE assessment_responses
SET score_value = rs.calculated_score,
    updated_at = NOW()
FROM response_scores rs
WHERE assessment_responses.id = rs.response_id;
```

## Summary

**The golden rule**: 
- ✅ **Backend calculates and stores scores** when responses are saved
- ✅ **AI reads and presents scores** in narrative form
- ❌ **AI never calculates scores** - it only formats them

This ensures:
- Consistent scores across all reports
- Fast report generation (no recalculation needed)
- Reliable audit trail (scores stored in database)
- Deterministic AI output (temperature: 0)
