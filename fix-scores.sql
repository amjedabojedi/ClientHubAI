-- This script recalculates scores for assignment 21

-- First, let's update each response's score_value
-- For Beck Anxiety (questions 81-101) - 4 options: 0, 1, 2, 3
-- For PTSD (questions 102-118) - 5 options: 1, 2, 3, 4, 5  
-- For Beck BDI II (questions 60-80) - 4 options: 0, 1, 2, 3

-- The query will:
-- 1. Get each response
-- 2. Look up the option at the selected index
-- 3. Use that option's value as the score

UPDATE assessment_responses ar
SET score_value = (
  SELECT aqo.option_value::text
  FROM assessment_question_options aqo
  WHERE aqo.question_id = ar.question_id
  ORDER BY aqo.sort_order
  OFFSET ar.selected_options[1]
  LIMIT 1
)
WHERE ar.assignment_id = 21
  AND ar.selected_options IS NOT NULL
  AND array_length(ar.selected_options, 1) > 0;

-- Update the total score for assignment 21
UPDATE assessment_assignments
SET total_score = (
  SELECT COALESCE(SUM(ar.score_value::numeric), 0)::text
  FROM assessment_responses ar
  JOIN assessment_questions aq ON aq.id = ar.question_id
  JOIN assessment_sections asec ON asec.id = aq.section_id
  WHERE ar.assignment_id = 21
    AND ar.score_value IS NOT NULL
    AND asec.is_scoring = true
)
WHERE id = 21;
