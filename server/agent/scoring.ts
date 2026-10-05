import { sql } from '../db.js';

export async function recomputeOpportunityScores(){
 const configs=await sql`SELECT * FROM score_configurations WHERE is_active=true ORDER BY updated_at DESC LIMIT 1`;
 const cfg:any=configs[0]||{model_version:'edge-v0.3',base_score:50,price_gap_weight:1.5,price_gap_min:-10,price_gap_max:25,renewal_project_weight:2,renewal_execution_bonus:5,renewal_permit_bonus:3,renewal_max:18,seller_dom_divisor:18,seller_reduction_weight:3,seller_max:14,comp_high_min:20,comp_medium_min:8,comp_min_required:3,comp_high_score:10,comp_medium_score:7,comp_low_score:5,low_comp_risk:4};
 const rows=await sql`
  WITH latest AS (
    SELECT DISTINCT ON(listing_id) listing_id,asking_price_nis,area_sqm,rooms,observed_at
    FROM listing_snapshots ORDER BY listing_id,observed_at DESC
  ), comps AS (
    SELECT neighborhood_id,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY COALESCE(normalized_pp_sqm,pp_sqm))
        FILTER (WHERE deal_date>=current_date-interval '18 months') AS comp_pp_sqm,
      count(*) FILTER (WHERE deal_date>=current_date-interval '18 months')::int AS comp_count,
      max(deal_date) AS latest_comp_date
    FROM comparable_transactions
    WHERE neighborhood_id IS NOT NULL
    GROUP BY neighborhood_id
  ), renew AS (
    SELECT neighborhood_id,count(*)::int project_count,
      count(*) FILTER(WHERE in_execution)::int execution_count,
      max(permits_count)::int max_permits
    FROM renewal_projects WHERE neighborhood_id IS NOT NULL AND source_id <> 'renewal_research' GROUP BY neighborhood_id
  ), seller AS (
    SELECT listing_id,days_on_market,price_reductions,total_reduction_pct FROM listing_seller_signals
  )
  SELECT l.id listing_id,l.neighborhood_id,latest.asking_price_nis,latest.area_sqm,
    100*((latest.area_sqm*comps.comp_pp_sqm)-latest.asking_price_nis)/(latest.area_sqm*comps.comp_pp_sqm) AS discount_pct,
    comps.comp_count,comps.latest_comp_date,
    coalesce(renew.project_count,0) project_count,coalesce(renew.execution_count,0) execution_count,
    coalesce(renew.max_permits,0) max_permits,coalesce(seller.days_on_market,0) days_on_market,
    coalesce(seller.price_reductions,0) price_reductions,coalesce(seller.total_reduction_pct,0) total_reduction_pct
  FROM listings l
  JOIN latest ON latest.listing_id=l.id
  JOIN comps ON comps.neighborhood_id=l.neighborhood_id
  LEFT JOIN renew ON renew.neighborhood_id=l.neighborhood_id
  LEFT JOIN seller ON seller.listing_id=l.id
  WHERE l.status='active'
    AND l.neighborhood_id IS NOT NULL
    AND latest.asking_price_nis>0
    AND latest.area_sqm>0
    AND comps.comp_count>=${Number(cfg.comp_min_required)}
 `;

 await sql`
   DELETE FROM opportunity_scores os
   WHERE os.entity_type='listing'
     AND os.model_version=${String(cfg.model_version)}
 `;

 let inserted=0;
 for(const r of rows){
   const priceGap=Math.max(Number(cfg.price_gap_min),Math.min(Number(cfg.price_gap_max),Number(r.discount_pct||0)*Number(cfg.price_gap_weight)));
   const renewal=Math.min(Number(cfg.renewal_max),Number(r.project_count||0)*Number(cfg.renewal_project_weight)+(Number(r.execution_count||0)>0?Number(cfg.renewal_execution_bonus):0)+(Number(r.max_permits||0)>0?Number(cfg.renewal_permit_bonus):0));
   const seller=Math.min(Number(cfg.seller_max),Number(r.days_on_market||0)/Number(cfg.seller_dom_divisor)+Number(r.price_reductions||0)*Number(cfg.seller_reduction_weight));
   const comp=Number(r.comp_count)>=Number(cfg.comp_high_min)?Number(cfg.comp_high_score):Number(r.comp_count)>=Number(cfg.comp_medium_min)?Number(cfg.comp_medium_score):Number(cfg.comp_low_score);
   const risk=Number(r.comp_count)<Number(cfg.comp_medium_min)?Number(cfg.low_comp_risk):0;
   const score=Math.max(1,Math.min(99,Math.round(Number(cfg.base_score)+priceGap+renewal+seller+comp-risk)));

   await sql`
     INSERT INTO opportunity_scores(
       entity_type,entity_id,score,price_gap_score,renewal_score,seller_motivation_score,
       comp_confidence_score,risk_deduction,model_version,inputs,explanation
     ) VALUES(
       'listing',${String(r.listing_id)}::uuid,${score},${priceGap},${renewal},${seller},
       ${comp},${risk},${String(cfg.model_version)},${JSON.stringify({...r,score_config_id:cfg.id})}::jsonb,
       ${JSON.stringify({
         evidenceRule:`score only emitted with >=${cfg.comp_min_required} comparable closed transactions and valid asking price/area`,
         priceGap:'discount to comparable closed transactions',
         renewal:'matched official renewal evidence',
         seller:'days on market and observed price reductions',
         comp:'comparable sample size'
       })}::jsonb
     )
   `;
   inserted++;
 }
 const [{count:eligibleListings}]=await sql`SELECT count(*)::int count FROM listings WHERE status='active'`;
 return {fetched:rows.length,inserted,updated:0,errors:0,skipped:Number(eligibleListings)-rows.length};
}
