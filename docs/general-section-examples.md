# General Section Examples for Different Reports

## Overview
General sections synthesize information from ALL assessment responses without requiring new questions. They're perfect for cross-cutting themes like treatment planning, risk assessment, and clinical impressions.

## How to Create General Sections

### Step 1: Add Section in Template Builder
1. Go to Template Builder
2. Add new section
3. Set "Report Section Type" 
4. Add AI instructions
5. **Leave questions empty** (this makes it general)

### Step 2: Example General Sections

## Treatment Recommendations Section
**Report Section Type:** `recommendations`
**AI Instructions:**
```
Based on all assessment responses, generate comprehensive treatment recommendations including:

1. Primary therapeutic modalities (CBT, DBT, trauma-focused therapy, etc.)
2. Medication considerations if indicated by symptoms
3. Frequency and duration of treatment
4. Specific intervention targets based on presenting concerns
5. Referrals to specialists if needed (psychiatrist, medical, social services)
6. Crisis safety planning if risk factors identified
7. Family/support system involvement recommendations
8. Treatment goals prioritization

Use clinical language appropriate for treatment planning. Consider cultural factors, trauma history, and client strengths mentioned in responses.
```

## Risk Assessment Section
**Report Section Type:** `risk_assessment`
**AI Instructions:**
```
Analyze all assessment responses to provide comprehensive risk assessment covering:

1. Suicide risk - ideation, plan, means, protective factors
2. Self-harm behaviors and triggers
3. Substance use risks and patterns
4. Violence risk to others
5. Medical health risks
6. Environmental safety concerns
7. Social/relationship risks
8. Occupational/academic functioning risks

Rate overall risk level (low/moderate/high) with specific safety recommendations. Use clinical risk assessment language suitable for documentation and safety planning.
```

## Clinical Summary Section
**Report Section Type:** `clinical_summary`
**AI Instructions:**
```
Synthesize all assessment findings into comprehensive clinical summary including:

1. Overall clinical presentation and appearance
2. Primary presenting concerns and symptom patterns
3. Mental status observations from responses
4. Psychosocial stressors and environmental factors
5. Strengths and protective factors
6. Functional impairments across life domains
7. Cultural and contextual considerations
8. Clinical observations and professional impressions

Write in third-person clinical narrative suitable for medical records and professional consultation.
```

## Diagnostic Impressions Section
**Report Section Type:** `diagnostic_impressions`
**AI Instructions:**
```
Based on assessment responses, provide clinical diagnostic impressions including:

1. Primary diagnostic considerations with DSM-5 criteria support
2. Differential diagnoses to be considered or ruled out
3. Severity specifiers and course patterns
4. Comorbidity considerations
5. Areas requiring additional assessment or clarification
6. Cultural formulation factors affecting diagnosis
7. Diagnostic confidence level and rationale

Use professional diagnostic language consistent with clinical practice standards. Include specific symptom clusters and duration factors from responses.
```

## Prognosis Section
**Report Section Type:** `prognosis`
**AI Instructions:**
```
Analyze assessment data to provide clinical prognosis covering:

1. Expected treatment response and timeline
2. Factors supporting positive outcomes (strengths, motivation, support)
3. Potential barriers to treatment success
4. Long-term functional recovery expectations
5. Risk factors that may complicate treatment
6. Maintenance and relapse prevention considerations
7. Quality of life improvement projections

Provide realistic, evidence-based prognosis using clinical terminology appropriate for treatment planning and case management.
```

## Follow-up Plan Section
**Report Section Type:** `follow_up`
**AI Instructions:**
```
Based on assessment findings, recommend comprehensive follow-up plan including:

1. Immediate next steps and timeline
2. Frequency of therapy sessions and duration
3. Medication monitoring if applicable
4. Psychological testing recommendations if needed
5. Medical referrals and health assessments
6. Social service referrals if indicated
7. Crisis contact and safety planning
8. Family/collateral contact recommendations
9. Progress monitoring methods and intervals
10. Treatment review and adjustment schedule

Provide specific, actionable follow-up recommendations with clear timelines and responsible parties.
```

## Advanced Tips

### Cross-Report Consistency
- Use same report section types across different assessment templates
- Standardize AI instructions for consistency
- Create template library of proven instructions

### Cultural Considerations
Add to any section:
```
Consider cultural background, immigration status, language preferences, religious beliefs, and community factors that influence presentation and treatment planning.
```

### Trauma-Informed Approach
For trauma-related assessments:
```
Apply trauma-informed principles recognizing potential trauma history impact on responses, behavior, and treatment engagement. Consider safety, trustworthiness, collaboration, and empowerment in recommendations.
```

### Multi-Disciplinary Integration
```
Consider input from medical providers, social workers, case managers, and family members. Recommend coordination with existing treatment providers and support systems.
```

## Benefits of General Sections

1. **Reusable Across Templates** - Same section works for different assessments
2. **No Additional Questions** - Synthesizes existing data
3. **Professional Integration** - Creates comprehensive clinical documentation
4. **Customizable** - Tailor AI instructions to your practice style
5. **Consistent Output** - Standardized report sections across all assessments

## Implementation Strategy

1. Start with 2-3 core general sections (Clinical Summary, Treatment Recommendations, Risk Assessment)
2. Test with sample assessments and refine AI instructions
3. Add specialized sections for specific assessment types
4. Create instruction templates for different clinical populations
5. Train staff on section configuration and customization