-- Recalculate scores for ALL assessment responses that have selected options
UPDATE assessment_responses ar
SET score_value = (
  SELECT aqo.option_value
  FROM assessment_question_options aqo
  WHERE aqo.question_id = ar.question_id
  ORDER BY aqo.sort_order
  OFFSET ar.selected_options[1]
  LIMIT 1
)
WHERE ar.selected_options IS NOT NULL
  AND array_length(ar.selected_options, 1) > 0
  AND ar.score_value IS NULL;

-- Update total scores for all assignments
UPDATE assessment_assignments aa
SET total_score = (
  SELECT COALESCE(SUM(ar.score_value), 0)
  FROM assessment_responses ar
  JOIN assessment_questions aq ON aq.id = ar.question_id
  JOIN assessment_sections asec ON asec.id = aq.section_id
  WHERE ar.assignment_id = aa.id
    AND ar.score_value IS NOT NULL
    AND asec.is_scoring = true
)
WHERE EXISTS (
  SELECT 1 FROM assessment_responses ar2 
  WHERE ar2.assignment_id = aa.id
);
