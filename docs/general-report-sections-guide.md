# General Report Sections Configuration Guide

## Overview
TherapyFlow allows you to configure flexible general report sections that are not tied to specific assessment questions. These sections are generated using AI based on all assessment responses and custom prompts you define.

## How It Works

### 1. Database-Driven Sections
- General report sections are stored in the `assessment_sections` table
- They use the `reportMapping` field to categorize the section type
- They use the `aiReportPrompt` field to provide custom AI instructions
- They have NO questions (empty questions array) - they synthesize from all assessment data

### 2. Section Types Available
The system supports these report section types:
- `clinical_summary` - Overall clinical presentation and findings
- `intervention_plan` - Treatment recommendations and goals
- `diagnostic_impressions` - Clinical impressions and potential diagnoses
- `recommendations` - Professional recommendations for treatment
- `prognosis` - Expected outcomes and recovery timeline
- `follow_up` - Follow-up care and monitoring plans
- `additional_notes` - Any additional clinical observations

### 3. Creating General Sections

#### Option A: Through Assessment Template Builder
1. Go to Assessment Templates management
2. Edit or create a template
3. Add a new section
4. Set `reportMapping` to desired section type (e.g., 'clinical_summary')
5. Add detailed `aiReportPrompt` with specific instructions
6. Leave questions empty (this makes it a general section)

#### Option B: Direct Database Insert
```sql
INSERT INTO assessment_sections (
  template_id, 
  title, 
  description,
  report_mapping,
  ai_report_prompt,
  sort_order
) VALUES (
  11, -- Your template ID
  'Clinical Summary',
  'Comprehensive synthesis of assessment findings',
  'clinical_summary',
  'Generate a comprehensive clinical summary that synthesizes all assessment findings. Include: - Overall clinical presentation and diagnostic impressions - Key symptoms and their severity/impact - Risk factors and protective factors - Functional impairments and strengths - Clinical observations and professional judgment. Use third-person clinical language suitable for diagnostic and treatment planning purposes.',
  99 -- High sort order to appear at end
);
```

### 4. AI Prompt Best Practices

#### Effective AI Prompts Include:
- **Specific Instructions**: What to include in the section
- **Clinical Focus**: Relevant clinical areas to address
- **Language Style**: "Use third-person clinical language"
- **Context**: "Based on assessment responses provided"
- **Professional Standards**: Reference to clinical documentation requirements

#### Example Prompts:

**Clinical Summary:**
```
Generate a comprehensive clinical summary that synthesizes all assessment findings. Include: overall clinical presentation, diagnostic impressions, key symptoms and severity, risk factors, protective factors, functional impairments, and clinical strengths. Use professional third-person clinical language appropriate for medical documentation.
```

**Intervention Plan:**
```
Develop evidence-based treatment recommendations based on assessment findings. Include: recommended therapeutic modalities, specific intervention targets, measurable goals, referral recommendations if needed, risk management strategies, treatment timeline, and client strengths to leverage. Use professional clinical language for treatment planning.
```

**Diagnostic Impressions:**
```
Provide clinical diagnostic impressions based on assessment responses. Include: potential diagnoses with DSM-5 considerations, differential diagnoses, severity assessments, comorbidity considerations, and areas requiring further evaluation. Use clinical diagnostic language appropriate for professional documentation.
```

### 5. Benefits of General Sections

#### Flexibility:
- Create sections specific to your clinical needs
- Customize AI prompts for your practice style
- Add/remove sections per template

#### Professional Output:
- AI synthesizes all assessment data
- Follows your specific clinical focus
- Maintains consistent professional language

#### Workflow Integration:
- Sections appear in generated reports automatically
- Print/PDF/Word formatting maintained
- Regenerate functionality works with custom sections

### 6. Management Tips

#### Organization:
- Use clear, descriptive section titles
- Set appropriate sort order (higher numbers appear later)
- Group related general sections together

#### Quality Control:
- Test AI prompts with sample assessments
- Refine prompts based on output quality
- Use specific clinical language in instructions

#### Template Design:
- Balance question-based sections with general sections
- Consider clinical workflow and documentation needs
- Ensure comprehensive coverage without redundancy

## Example Configuration

For a comprehensive mental health assessment:

1. **Question-based sections**: Background, Symptoms, Mental Status
2. **General sections**: 
   - Clinical Summary (synthesizes all findings)
   - Risk Assessment (analyzes risk factors from responses)
   - Treatment Recommendations (evidence-based interventions)
   - Prognosis (expected outcomes based on assessment)

This creates a complete clinical report with both detailed question responses and professional clinical synthesis sections.