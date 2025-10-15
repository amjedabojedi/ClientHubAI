-- Insert Beck BDI-II options for questions 62-66, 68, 70-80
-- Each question has 4 options scored 0, 1, 2, 3

-- 62: Past Failure
INSERT INTO assessment_question_options (question_id, option_text, option_value, sort_order) VALUES
(62, 'I do not feel like a failure.', 0, 0),
(62, 'I have failed more than I should have.', 1, 1),
(62, 'As I look back, I see a lot of failures.', 2, 2),
(62, 'I feel I am a total failure as a person.', 3, 3);

-- 63: Loss of Pleasure
INSERT INTO assessment_question_options (question_id, option_text, option_value, sort_order) VALUES
(63, 'I get as much pleasure as I ever did from the things I enjoy.', 0, 0),
(63, 'I don''t enjoy things as much as I used to.', 1, 1),
(63, 'I get very little pleasure from the things I used to enjoy.', 2, 2),
(63, 'I can''t get any pleasure from the things I used to enjoy.', 3, 3);

-- 64: Guilty Feelings
INSERT INTO assessment_question_options (question_id, option_text, option_value, sort_order) VALUES
(64, 'I don''t feel particularly guilty.', 0, 0),
(64, 'I feel guilty over many things I have done or should have done.', 1, 1),
(64, 'I feel quite guilty most of the time.', 2, 2),
(64, 'I feel guilty all of the time.', 3, 3);

-- 65: Punishment Feelings
INSERT INTO assessment_question_options (question_id, option_text, option_value, sort_order) VALUES
(65, 'I don''t feel I am being punished.', 0, 0),
(65, 'I feel I may be punished.', 1, 1),
(65, 'I expect to be punished.', 2, 2),
(65, 'I feel I am being punished.', 3, 3);

-- 66: Self-Dislike
INSERT INTO assessment_question_options (question_id, option_text, option_value, sort_order) VALUES
(66, 'I feel the same about myself as ever.', 0, 0),
(66, 'I have lost confidence in myself.', 1, 1),
(66, 'I am disappointed in myself.', 2, 2),
(66, 'I dislike myself.', 3, 3);

-- 68: Suicidal Thoughts or Wishes
INSERT INTO assessment_question_options (question_id, option_text, option_value, sort_order) VALUES
(68, 'I don''t have any thoughts of killing myself.', 0, 0),
(68, 'I have thoughts of killing myself, but I would not carry them out.', 1, 1),
(68, 'I would like to kill myself.', 2, 2),
(68, 'I would kill myself if I had the chance.', 3, 3);

-- 70: Agitation
INSERT INTO assessment_question_options (question_id, option_text, option_value, sort_order) VALUES
(70, 'I am no more restless or wound up than usual.', 0, 0),
(70, 'I feel more restless or wound up than usual.', 1, 1),
(70, 'I am so restless or agitated that it''s hard to stay still.', 2, 2),
(70, 'I am so restless or agitated that I have to keep moving or doing something.', 3, 3);

-- 71: Loss of Interest
INSERT INTO assessment_question_options (question_id, option_text, option_value, sort_order) VALUES
(71, 'I have not lost interest in other people or activities.', 0, 0),
(71, 'I am less interested in other people or things than before.', 1, 1),
(71, 'I have lost most of my interest in other people or things.', 2, 2),
(71, 'It''s hard to get interested in anything.', 3, 3);

-- 72: Indecisiveness
INSERT INTO assessment_question_options (question_id, option_text, option_value, sort_order) VALUES
(72, 'I make decisions about as well as ever.', 0, 0),
(72, 'I find it more difficult to make decisions than usual.', 1, 1),
(72, 'I have much greater difficulty in making decisions than I used to.', 2, 2),
(72, 'I have trouble making any decisions.', 3, 3);

-- 73: Worthlessness
INSERT INTO assessment_question_options (question_id, option_text, option_value, sort_order) VALUES
(73, 'I do not feel I am worthless.', 0, 0),
(73, 'I don''t consider myself as worthwhile and useful as I used to.', 1, 1),
(73, 'I feel more worthless as compared to other people.', 2, 2),
(73, 'I feel utterly worthless.', 3, 3);

-- 74: Loss of Energy
INSERT INTO assessment_question_options (question_id, option_text, option_value, sort_order) VALUES
(74, 'I have as much energy as ever.', 0, 0),
(74, 'I have less energy than I used to have.', 1, 1),
(74, 'I don''t have enough energy to do very much.', 2, 2),
(74, 'I don''t have enough energy to do anything.', 3, 3);

-- 75: Changes in Sleeping Pattern
INSERT INTO assessment_question_options (question_id, option_text, option_value, sort_order) VALUES
(75, 'I have not experienced any change in my sleeping pattern.', 0, 0),
(75, 'I sleep somewhat more than usual / I sleep somewhat less than usual.', 1, 1),
(75, 'I sleep a lot more than usual / I sleep a lot less than usual.', 2, 2),
(75, 'I sleep most of the day / I wake up 1-2 hours early and can''t get back to sleep.', 3, 3);

-- 76: Irritability
INSERT INTO assessment_question_options (question_id, option_text, option_value, sort_order) VALUES
(76, 'I am no more irritable than usual.', 0, 0),
(76, 'I am more irritable than usual.', 1, 1),
(76, 'I am much more irritable than usual.', 2, 2),
(76, 'I am irritable all the time.', 3, 3);

-- 77: Changes in Appetite
INSERT INTO assessment_question_options (question_id, option_text, option_value, sort_order) VALUES
(77, 'I have not experienced any change in my appetite.', 0, 0),
(77, 'My appetite is somewhat less than usual / My appetite is somewhat greater than usual.', 1, 1),
(77, 'My appetite is much less than before / My appetite is much greater than usual.', 2, 2),
(77, 'I have no appetite at all / I crave food all the time.', 3, 3);

-- 78: Tiredness or Fatigue
INSERT INTO assessment_question_options (question_id, option_text, option_value, sort_order) VALUES
(78, 'I am no more tired or fatigued than usual.', 0, 0),
(78, 'I get more tired or fatigued more easily than usual.', 1, 1),
(78, 'I am too tired or fatigued to do a lot of the things I used to do.', 2, 2),
(78, 'I am too tired or fatigued to do most of the things I used to do.', 3, 3);

-- 79: Concentration Difficulty
INSERT INTO assessment_question_options (question_id, option_text, option_value, sort_order) VALUES
(79, 'I can concentrate as well as ever.', 0, 0),
(79, 'I can''t concentrate as well as usual.', 1, 1),
(79, 'It''s hard to keep my mind on anything for very long.', 2, 2),
(79, 'I find I can''t concentrate on anything.', 3, 3);

-- 80: Loss of Interest in Sex
INSERT INTO assessment_question_options (question_id, option_text, option_value, sort_order) VALUES
(80, 'I have not noticed any recent change in my interest in sex.', 0, 0),
(80, 'I am less interested in sex than I used to be.', 1, 1),
(80, 'I am much less interested in sex now.', 2, 2),
(80, 'I have lost interest in sex completely.', 3, 3);
