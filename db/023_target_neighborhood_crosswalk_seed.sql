-- Reproducible reviewed target-neighborhood crosswalk seeds.

INSERT INTO neighborhood_crosswalk_evidence(
 neighborhood_id,locality_code,statistical_area_code,boundary_reference_year,source_name,source_url,source_published_at,
 evidence_type,confidence,safe_for_identity,safe_for_analytics,safe_for_polygon,notes,evidence)
SELECT n.id,c.settlement_code,x.stat_code,2019,
 'עיריית חיפה — שנתון 2019 חלוקה גיאו-סטטיסטית ומפות העיר',
 'https://www.haifa.muni.il/wp-content/uploads/2021/08/2019%D7%94%D7%97%D7%9C%D7%95%D7%A7%D7%94-%D7%94%D7%92%D7%90%D7%95-%D7%A1%D7%98%D7%98%D7%99%D7%A1%D7%98%D7%99%D7%AA-%D7%95%D7%9E%D7%A4%D7%95%D7%AA-%D7%94%D7%A2%D7%99%D7%A8.pdf',
 '2019-01-01','official_municipal',.88,true,false,true,
 'Official municipal neighborhood/statistical-area naming; polygon is provisional because source predates 2022 CBS boundaries.',
 jsonb_build_object('neighborhood',n.name_he,'statistical_area_code',x.stat_code,'source_grain','municipal_statistical_division')
FROM neighborhoods n
JOIN cities c ON c.id=n.city_id
JOIN (VALUES
 ('kiryat-eliezer-haifa','412'),('kiryat-eliezer-haifa','413'),('kiryat-eliezer-haifa','414'),
 ('kiryat-sprinzak-haifa','422'),('kiryat-sprinzak-haifa','423')
) AS x(slug,stat_code) ON x.slug=n.slug
ON CONFLICT(neighborhood_id,statistical_area_code,source_url) DO UPDATE SET
 confidence=EXCLUDED.confidence,safe_for_identity=EXCLUDED.safe_for_identity,
 safe_for_analytics=EXCLUDED.safe_for_analytics,safe_for_polygon=EXCLUDED.safe_for_polygon,
 notes=EXCLUDED.notes,evidence=EXCLUDED.evidence,reviewed_at=now();

INSERT INTO neighborhood_crosswalk_evidence(
 neighborhood_id,locality_code,statistical_area_code,boundary_reference_year,source_name,source_url,source_published_at,
 evidence_type,confidence,safe_for_identity,safe_for_analytics,safe_for_polygon,notes,evidence)
SELECT n.id,c.settlement_code,x.stat_code,2022,
 'משרד החקלאות ופיתוח הכפר — נספח תמיכה בפריפריה 2022',
 'https://www.gov.il/BlobFolder/rfp/final_procedure_2022_periphery_support/ar/forestry_and_trees_final_procedure_2022_periphery_support.pdf',
 '2022-01-01','official_government',.92,true,false,true,
 'Government 2022 table explicitly names the neighborhood and statistical area; safe for provisional polygon, retained as non-analytics-safe until CBS 2022 key confirms boundary equivalence.',
 jsonb_build_object('neighborhood',n.name_he,'statistical_area_code',x.stat_code,'subarea_label',x.label)
FROM neighborhoods n
JOIN cities c ON c.id=n.city_id
JOIN (VALUES
 ('yoseftal-petah-tikva','513','יוספטל'),
 ('kiryat-nordau-netanya','512','קרית נורדאו (דרום-מזרח)'),
 ('kiryat-nordau-netanya','521','קרית נורדאו (דרום-מערב)'),
 ('kiryat-nordau-netanya','522','קרית נורדאו (צפון-מערב)')
) AS x(slug,stat_code,label) ON x.slug=n.slug
ON CONFLICT(neighborhood_id,statistical_area_code,source_url) DO UPDATE SET
 confidence=EXCLUDED.confidence,safe_for_identity=EXCLUDED.safe_for_identity,
 safe_for_analytics=EXCLUDED.safe_for_analytics,safe_for_polygon=EXCLUDED.safe_for_polygon,
 notes=EXCLUDED.notes,evidence=EXCLUDED.evidence,reviewed_at=now();
