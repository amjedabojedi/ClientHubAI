-- Healthcare Services with CPT codes and rates
INSERT INTO services (service_code, service_name, service_type, standard_duration, base_rate, billing_category, description, is_active) VALUES
('90834', 'Individual Psychotherapy 45 min', 'individual_therapy', 45, 150.00, 'Psychotherapy', 'Individual psychotherapy, insight oriented, behavior modifying and/or supportive, 45 minutes', true),
('90837', 'Individual Psychotherapy 60 min', 'individual_therapy', 60, 200.00, 'Psychotherapy', 'Individual psychotherapy, insight oriented, behavior modifying and/or supportive, 60 minutes', true),
('90791', 'Psychiatric Diagnostic Evaluation', 'assessment', 90, 300.00, 'Assessment', 'Psychiatric diagnostic evaluation including history, mental status exam, and treatment planning', true),
('90834+90837', 'Extended Individual Therapy', 'individual_therapy', 90, 350.00, 'Psychotherapy', 'Extended individual psychotherapy session combining 45 and 60 minute codes', true),
('90847', 'Family Therapy with Patient', 'family_therapy', 60, 180.00, 'Family Therapy', 'Family psychotherapy with patient present, 60 minutes', true),
('90853', 'Group Therapy', 'group_therapy', 90, 75.00, 'Group Therapy', 'Group psychotherapy (other than of a multiple-family group)', true),
('90834-95', 'Telehealth Individual 45 min', 'individual_therapy', 45, 150.00, 'Telehealth', 'Individual psychotherapy via telehealth, 45 minutes', true),
('90837-95', 'Telehealth Individual 60 min', 'individual_therapy', 60, 200.00, 'Telehealth', 'Individual psychotherapy via telehealth, 60 minutes', true),
('90834-TC', 'Crisis Session 45 min', 'individual_therapy', 45, 175.00, 'Crisis', 'Crisis intervention individual session, 45 minutes', true),
('90901', 'Biofeedback Training', 'individual_therapy', 45, 120.00, 'Specialized', 'Biofeedback training by any modality', true);

-- Therapy Rooms with equipment and capacity
INSERT INTO rooms (room_number, room_name, capacity, equipment, is_active, notes) VALUES
('101', 'Individual Therapy Room A', 2, ARRAY['comfortable_seating', 'tissues', 'white_noise', 'natural_light'], true, 'Quiet room with street view, ideal for individual sessions'),
('102', 'Individual Therapy Room B', 2, ARRAY['comfortable_seating', 'tissues', 'white_noise', 'plants'], true, 'Cozy room with plants, calming atmosphere'),
('103', 'Family Therapy Room', 6, ARRAY['family_seating', 'play_area', 'whiteboard', 'toys'], true, 'Large room suitable for family sessions with children'),
('104', 'Group Therapy Room', 12, ARRAY['circle_seating', 'whiteboard', 'flipchart', 'projector'], true, 'Spacious room for group therapy sessions'),
('105', 'Assessment Room', 3, ARRAY['desk', 'computer', 'testing_materials', 'quiet_environment'], true, 'Specialized room for psychological assessments'),
('106', 'Telehealth Room', 1, ARRAY['high_speed_internet', 'HD_camera', 'professional_lighting', 'privacy_screen'], true, 'Dedicated telehealth session room'),
('107', 'Crisis Intervention Room', 2, ARRAY['secure_environment', 'emergency_phone', 'comfortable_seating', 'calming_decor'], true, 'Secure room for crisis intervention sessions'),
('108', 'Couples Therapy Room', 3, ARRAY['comfortable_seating', 'tissues', 'neutral_decor', 'privacy'], true, 'Intimate setting for couples therapy'),
('109', 'Play Therapy Room', 4, ARRAY['play_materials', 'art_supplies', 'sensory_toys', 'child_furniture'], true, 'Specialized room for child and adolescent therapy'),
('110', 'Consultation Room', 4, ARRAY['conference_table', 'whiteboard', 'computer', 'phone'], true, 'Professional setting for consultations and treatment planning');