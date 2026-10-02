CREATE TABLE IF NOT EXISTS yad2_configuration_migrations(id text PRIMARY KEY);
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM yad2_configuration_migrations WHERE id='focused-cities-v1') THEN
  UPDATE yad2_crawl_scopes SET enabled=false;
  INSERT INTO yad2_crawl_scopes(id,market,url,config)
  SELECT 'recent-'||city_slug||'-'||market,market,
   'https://www.yad2.co.il/realestate/'||CASE market WHEN 'sale' THEN 'forsale' ELSE 'rent' END||'?city='||city_code,
   jsonb_build_object('details',false,'published_within_days',30,'city_names',jsonb_build_array(city_name),'max_pages',10)
  FROM (VALUES('haifa','4000','חיפה'),('netanya','7400','נתניה'),('petah-tikva','7900','פתח תקווה')) c(city_slug,city_code,city_name)
  CROSS JOIN (VALUES('sale'),('rent')) m(market) ON CONFLICT DO NOTHING;
  INSERT INTO yad2_configuration_migrations VALUES('focused-cities-v1');
 END IF;
END $$;
