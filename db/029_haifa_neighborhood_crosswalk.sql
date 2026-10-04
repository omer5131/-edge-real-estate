-- Expand Haifa canonical neighborhood boundaries from the municipal street/statistical-area dataset.
-- Source: Haifa municipal statistical-area street mapping mirrored in OVER dataset
-- 30fc7a04-0576-4b90-97c8-553c84f4fb73.
--
-- These mappings are suitable for parcel-to-neighborhood spatial assignment.
-- Neve Yosef is explicitly lower-confidence because municipal area 714 is shared
-- with Neve Ganim West.

WITH mappings(slug,stat_code,label,confidence,safe_polygon,notes) AS (
 VALUES
  ('ahuza-haifa','933','אחוזה דרום - רח'' גבעת דאונס',.90,true,'Municipal statistical area explicitly labeled Ahuza South.'),
  ('ahuza-haifa','934','אחוזה דרום - רח'' הנטקה',.90,true,'Municipal statistical area explicitly labeled Ahuza South.'),
  ('hadar-elyon-haifa','621','הדר עליון -בי"ח בני ציון',.95,true,'Municipal statistical area explicitly labeled Upper Hadar.'),
  ('hadar-elyon-haifa','622','הדר עליון - רח'' הפועל',.95,true,'Municipal statistical area explicitly labeled Upper Hadar.'),
  ('yalg-haifa','641','הדר מזרח - רח'' יל"ג',.90,true,'Municipal statistical area explicitly centered on Yalag street subarea.'),
  ('kabirim-haifa','525','כרמל מרכזי - רח'' כבירים',.88,true,'Municipal statistical area explicitly labeled Kabirim street subarea.'),
  ('neve-david-haifa','426','נוה דוד',.98,true,'Municipal statistical area explicitly labeled Neve David.'),
  ('neve-yosef-haifa','714','נוה יוסף, נוה גנים מערב',.72,true,'Shared municipal statistical area with Neve Ganim West; geometry is provisional/contextual.'),
  ('ramot-remez-haifa','821','רמות רמז - רח'' שניאור זלמן',.95,true,'Municipal statistical area explicitly labeled Ramot Remez.'),
  ('ramot-remez-haifa','822','רמות רמז - רח'' בורוכוב',.95,true,'Municipal statistical area explicitly labeled Ramot Remez.'),
  ('ramat-eshkol-haifa','931','רמת אשכול',.98,true,'Municipal statistical area explicitly labeled Ramat Eshkol.'),
  ('ramat-sapir-haifa','824','רמת ספיר',.98,true,'Municipal statistical area explicitly labeled Ramat Sapir.'),
  ('shambur-haifa','512','שמבור',.98,true,'Municipal statistical area explicitly labeled Shambur.'),
  ('shaar-haaliya-haifa','424','שער העלייה',.98,true,'Municipal statistical area explicitly labeled Shaar HaAliya.')
)
INSERT INTO neighborhood_crosswalk_evidence(
 neighborhood_id,locality_code,statistical_area_code,boundary_reference_year,
 source_name,source_url,source_published_at,evidence_type,confidence,
 safe_for_identity,safe_for_analytics,safe_for_polygon,notes,evidence
)
SELECT n.id,c.settlement_code,m.stat_code,2022,
 'עיריית חיפה — רחובות לפי אזורים סטטיסטיים',
 'https://data.gov.il/he/datasets/haifa/944',
 NULL,'official_municipal',m.confidence,
 true,false,m.safe_polygon,m.notes,
 jsonb_build_object(
   'municipal_label',m.label,
   'statistical_area_code',m.stat_code,
   'over_dataset_id','30fc7a04-0576-4b90-97c8-553c84f4fb73',
   'source_grain','municipal_street_statistical_area'
 )
FROM mappings m
JOIN neighborhoods n ON n.slug=m.slug
JOIN cities c ON c.id=n.city_id
ON CONFLICT(neighborhood_id,statistical_area_code,source_url) DO UPDATE SET
 confidence=EXCLUDED.confidence,
 safe_for_identity=EXCLUDED.safe_for_identity,
 safe_for_analytics=EXCLUDED.safe_for_analytics,
 safe_for_polygon=EXCLUDED.safe_for_polygon,
 notes=EXCLUDED.notes,
 evidence=EXCLUDED.evidence,
 reviewed_at=now();
