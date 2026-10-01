import { sql } from '../db';

export async function recomputeOpportunityScores(){
 const rows=await sql`
  WITH latest AS (
    SELECT DISTINCT ON(listing_id) listing_id,asking_price_nis,area_sqm,rooms,observed_at
    FROM listing_snapshots ORDER BY listing_id,observed_at DESC
  ), comps AS (
    SELECT neighborhood_id,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY pp_sqm) FILTER (WHERE pp_sqm BETWEEN 5000 AND 100000 AND deal_date>=current_date-interval '18 months') AS comp_pp_sqm,
      count(*) FILTER (WHERE pp_sqm BETWEEN 5000 AND 100000 AND deal_date>=current_date-interval '18 months')::int AS comp_count
    FROM transactions WHERE neighborhood_id IS NOT NULL GROUP BY neighborhood_id
  ), renew AS (
    SELECT neighborhood_id,count(*)::int project_count,count(*) FILTER(WHERE in_execution)::int execution_count,max(permits_count)::int max_permits
    FROM renewal_projects WHERE neighborhood_id IS NOT NULL GROUP BY neighborhood_id
  ), seller AS (
    SELECT listing_id,days_on_market,price_reductions,total_reduction_pct FROM listing_seller_signals
  )
  SELECT l.id listing_id,l.neighborhood_id,latest.asking_price_nis,latest.area_sqm,
    CASE WHEN latest.area_sqm>0 AND comps.comp_pp_sqm>0 THEN 100*((latest.area_sqm*comps.comp_pp_sqm)-latest.asking_price_nis)/(latest.area_sqm*comps.comp_pp_sqm) ELSE 0 END AS discount_pct,
    coalesce(comps.comp_count,0) comp_count,coalesce(renew.project_count,0) project_count,coalesce(renew.execution_count,0) execution_count,coalesce(renew.max_permits,0) max_permits,
    coalesce(seller.days_on_market,0) days_on_market,coalesce(seller.price_reductions,0) price_reductions,coalesce(seller.total_reduction_pct,0) total_reduction_pct
  FROM listings l JOIN latest ON latest.listing_id=l.id
  LEFT JOIN comps ON comps.neighborhood_id=l.neighborhood_id LEFT JOIN renew ON renew.neighborhood_id=l.neighborhood_id LEFT JOIN seller ON seller.listing_id=l.id
  WHERE l.status='active' AND l.neighborhood_id IS NOT NULL AND latest.asking_price_nis>0`;
 let inserted=0;
 for(const r of rows){
   const priceGap=Math.max(-10,Math.min(25,Number(r.discount_pct||0)*1.5));
   const renewal=Math.min(18,Number(r.project_count||0)*2+(Number(r.execution_count||0)>0?5:0)+(Number(r.max_permits||0)>0?3:0));
   const seller=Math.min(14,Number(r.days_on_market||0)/18+Number(r.price_reductions||0)*3);
   const comp=Number(r.comp_count)>=8?10:Number(r.comp_count)>=3?5:-8;
   const risk=Number(r.comp_count)<3?8:0;
   const score=Math.max(1,Math.min(99,Math.round(50+priceGap+renewal+seller+comp-risk)));
   await sql`INSERT INTO opportunity_scores(entity_type,entity_id,score,price_gap_score,renewal_score,seller_motivation_score,comp_confidence_score,risk_deduction,model_version,inputs,explanation) VALUES('listing',${String(r.listing_id)}::uuid,${score},${priceGap},${renewal},${seller},${comp},${risk},'edge-v0.1',${JSON.stringify(r)}::jsonb,${JSON.stringify({priceGap:'discount to neighborhood closed comps',renewal:'matched renewal activity',seller:'days on market and price reductions',comp:'closed comp sample size'})}::jsonb)`;
   inserted++;
 }
 return {fetched:rows.length,inserted,updated:0,errors:0};
}
