UPDATE data_sources SET is_enabled=false
WHERE id IN ('cbs','cbs_census_2022','listing_feed','over_gov','mot_transport_plans');

UPDATE data_sources SET is_enabled=true
WHERE id IN ('over_deals','over_nadlan','urban_renewal_gov','xplan','over_listing_archive','yad2_sale','yad2_rent','mot_bus_stops','mot_planned_terminals');
