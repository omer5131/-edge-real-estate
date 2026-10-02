import type { VercelRequest,VercelResponse } from '@vercel/node';
import { sql } from '../server/db.js';

export const config = { maxDuration: 120 };

const aliasMap:Record<string,string>={
  'קריית אליעזר':'kiryat-eliezer-haifa','קרית אליעזר':'kiryat-eliezer-haifa',
  'קריית שפרינצק':'kiryat-sprinzak-haifa','קרית שפרינצק':'kiryat-sprinzak-haifa','שפרינצק':'kiryat-sprinzak-haifa',
  'קריית נורדאו':'kiryat-nordau-netanya','קרית נורדאו':'kiryat-nordau-netanya','נורדאו':'kiryat-nordau-netanya',
  'יוספטל':'yoseftal-petah-tikva'
};

function wantedNeighborhoods(q:string){
  const out:string[]=[];
  for(const [name,slug] of Object.entries(aliasMap)) if(q.includes(name)&&!out.includes(slug)) out.push(slug);
  return out;
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  if(['sql-agent','edge-agent'].includes(String(req.query.mode)))return (await import('../server/http/agent-chat.js')).default(req,res);
  if(req.query.mode==='data-explorer')return (await import('../server/http/data-explorer.js')).default(req,res);
  if(req.query.mode==='yad2-research')return (await import('../server/http/yad2-research.js')).default(req,res);
  if(req.query.mode==='yad2-admin')return (await import('../server/http/yad2-admin.js')).default(req,res);
  if(['area-tiles','area-dashboard','area-score-model','area-refresh'].includes(String(req.query.mode)))return (await import('../server/http/area-intelligence.js')).default(req,res);
  if(req.method==='GET' && String(req.query.mode||'')==='run_collection'){
    const token=typeof req.query.token==='string'?req.query.token.trim():'';
    if(!token)return res.status(401).json({error:'run_token_required'});
    const used=await sql`UPDATE manual_run_tokens SET consumed_at=now() WHERE token_hash=encode(digest(${token},'sha256'),'hex') AND consumed_at IS NULL AND expires_at>now() RETURNING token_hash`;
    if(!used.length)return res.status(401).json({error:'invalid_or_expired_run_token'});
    try{
      const mod=await import('../server/agent/runIngestion.js');
      const report=await mod.runEdgeIngestion({skipOver:true});
      return res.status(200).json({ok:true,skipOver:true,report});
    }catch(error:any){
      console.error('Token collection failed',error);
      return res.status(500).json({ok:false,error:error?.message??String(error)});
    }
  }
  if(req.method==='GET' && String(req.query.mode||'')==='admin'){
    const [config]=await sql`SELECT * FROM score_configurations WHERE is_active=true ORDER BY updated_at DESC LIMIT 1`;
    const areas=await sql`SELECT n.id,n.slug,n.name_he,c.name_he city,coalesce(f.is_active,false) followed,coalesce(f.research_depth,'basic') research_depth FROM neighborhoods n JOIN cities c ON c.id=n.city_id LEFT JOIN followed_areas f ON f.neighborhood_id=n.id ORDER BY c.name_he,n.name_he`;
    return res.status(200).json({config,areas});
  }
  if(req.method!=='POST') return res.status(405).json({error:'method_not_allowed'});
  if(req.body?.mode==='admin'){
    const b=req.body||{};
    if(b.action==='run_collection'){
      try{
        const mod=await import('../server/agent/runIngestion.js');
        const report=await mod.runEdgeIngestion({skipOver:true});
        return res.status(200).json({ok:true,skipOver:true,report});
      }catch(error:any){
        console.error('Admin collection failed',error);
        return res.status(500).json({ok:false,error:error?.message??String(error)});
      }
    }
    if(b.action==='area'){
      const rows=await sql`INSERT INTO followed_areas(neighborhood_id,label,is_active,research_depth) VALUES(${b.neighborhood_id}::uuid,${b.label||null},${b.followed!==false},${b.research_depth||'full'}) ON CONFLICT(neighborhood_id) DO UPDATE SET is_active=EXCLUDED.is_active,research_depth=EXCLUDED.research_depth,label=coalesce(EXCLUDED.label,followed_areas.label) RETURNING *`;
      await sql`UPDATE neighborhoods SET is_focus=${b.followed!==false} WHERE id=${b.neighborhood_id}::uuid`; return res.status(200).json({area:rows[0]});
    }
    if(b.action==='score'){
      const current=await sql`SELECT * FROM score_configurations WHERE is_active=true LIMIT 1`; if(!current.length)return res.status(404).json({error:'no_active_config'});
      const v:any={...current[0],...b};const version='edge-admin-'+Date.now();await sql`UPDATE score_configurations SET is_active=false WHERE is_active=true`;
      const rows=await sql`INSERT INTO score_configurations(name,is_active,model_version,base_score,price_gap_weight,price_gap_min,price_gap_max,renewal_project_weight,renewal_execution_bonus,renewal_permit_bonus,renewal_max,seller_dom_divisor,seller_reduction_weight,seller_max,comp_high_min,comp_medium_min,comp_min_required,comp_high_score,comp_medium_score,comp_low_score,low_comp_risk) VALUES(${b.name||'Custom Edge Score'},true,${version},${Number(v.base_score)},${Number(v.price_gap_weight)},${Number(v.price_gap_min)},${Number(v.price_gap_max)},${Number(v.renewal_project_weight)},${Number(v.renewal_execution_bonus)},${Number(v.renewal_permit_bonus)},${Number(v.renewal_max)},${Number(v.seller_dom_divisor)},${Number(v.seller_reduction_weight)},${Number(v.seller_max)},${Number(v.comp_high_min)},${Number(v.comp_medium_min)},${Number(v.comp_min_required)},${Number(v.comp_high_score)},${Number(v.comp_medium_score)},${Number(v.comp_low_score)},${Number(v.low_comp_risk)}) RETURNING *`;
      return res.status(200).json({config:rows[0]});
    }
    return res.status(400).json({error:'unknown_admin_action'});
  }
  const question=typeof req.body?.question==='string'?req.body.question.trim():'';
  if(!question) return res.status(400).json({error:'question_required'});

  try{
    const slugs=wantedNeighborhoods(question);
    const areas=await sql`
      WITH tx AS (
        SELECT neighborhood_id,
          count(*) FILTER(WHERE deal_date>=current_date-interval '12 months')::int sample_12m,
          percentile_cont(.5) WITHIN GROUP(ORDER BY COALESCE(normalized_pp_sqm,pp_sqm))
            FILTER(WHERE deal_date>=current_date-interval '12 months') median_ppsqm,
          max(deal_date) latest_deal_date
        FROM comparable_transactions
        WHERE neighborhood_id IS NOT NULL
        GROUP BY neighborhood_id
      )
      SELECT n.slug,n.name_he,c.name_he city,
        coalesce(tx.sample_12m,0)::int sample_12m,tx.median_ppsqm::float8,tx.latest_deal_date,
        coalesce(mc.confidence,'insufficient') confidence,
        rm.median_rent_nis::float8,rm.active_supply::int rent_sample,
        (SELECT count(*)::int FROM renewal_projects rp WHERE rp.neighborhood_id=n.id) renewal_projects
      FROM neighborhoods n
      JOIN cities c ON c.id=n.city_id
      LEFT JOIN tx ON tx.neighborhood_id=n.id
      LEFT JOIN neighborhood_market_confidence mc ON mc.neighborhood_id=n.id
      LEFT JOIN neighborhood_rent_metrics rm ON rm.neighborhood_id=n.id
      WHERE n.is_focus
      ORDER BY n.slug
    `;

    const opportunities=await sql`
      WITH latest AS (
        SELECT DISTINCT ON(listing_id) listing_id,asking_price_nis,area_sqm,rooms,observed_at
        FROM listing_snapshots ORDER BY listing_id,observed_at DESC
      ), score AS (
        SELECT DISTINCT ON(entity_id) entity_id,score,model_version,calculated_at
        FROM opportunity_scores
        WHERE entity_type='listing' AND model_version='edge-v0.2'
        ORDER BY entity_id,calculated_at DESC
      )
      SELECT l.id::text,l.canonical_address,n.slug,n.name_he neighborhood,
        latest.asking_price_nis::float8 asking_price,latest.area_sqm::float8,
        score.score::int,score.calculated_at
      FROM listings l
      JOIN latest ON latest.listing_id=l.id
      JOIN neighborhoods n ON n.id=l.neighborhood_id
      LEFT JOIN score ON score.entity_id=l.id
      WHERE l.status='active'
      ORDER BY score.score DESC NULLS LAST,l.last_seen_at DESC
      LIMIT 20
    `;

    const scopedAreas=slugs.length?areas.filter((a:any)=>slugs.includes(a.slug)):areas;
    const scopedOpportunities=slugs.length?opportunities.filter((p:any)=>slugs.includes(p.slug)):opportunities;
    const lines:string[]=[];
    if(scopedAreas.length===0){
      lines.push('אין כרגע נתוני אמת תואמים לשאלה הזו.');
    }else{
      for(const a of scopedAreas){
        const price=a.median_ppsqm==null?'אין עדיין מדגם מחיר מספק':`חציון סגירות כ-₪${Math.round(Number(a.median_ppsqm)).toLocaleString('he-IL')}/מ"ר`;
        const rent=a.median_rent_nis==null?'שכירות: טרם נאסף מדגם':`שכירות מבוקשת חציונית כ-₪${Math.round(Number(a.median_rent_nis)).toLocaleString('he-IL')} (${a.rent_sample||0} מודעות)`;
        lines.push(`**${a.name_he}, ${a.city}** — ${price}; ${a.sample_12m} עסקאות ב-12 חודשים; confidence: ${a.confidence}; ${rent}; פרויקטי התחדשות שנקלטו: ${a.renewal_projects}.`);
      }
    }
    if(scopedOpportunities.length){
      lines.push('');
      lines.push('**מלאי פעיל עם נתונים:**');
      for(const p of scopedOpportunities.slice(0,5)){
        lines.push(`- ${p.canonical_address||'כתובת לא פתורה'} — ₪${Math.round(Number(p.asking_price||0)).toLocaleString('he-IL')}${p.score==null?' · ללא Score (אין מספיק ראיות)':` · Score ${p.score}`}`);
      }
    }else{
      lines.push('');
      lines.push('אין כרגע מודעות מכירה פעילות שעברו את שכבת הנרמול של Edge.');
    }

    res.status(200).json({
      answer:lines.join('\n'),
      evidence:{
        areas:scopedAreas.map((a:any)=>({neighborhood:a.name_he,sample:a.sample_12m,latest:a.latest_deal_date,confidence:a.confidence})),
        opportunityCount:scopedOpportunities.length
      },
      mode:'live-db',
      generatedAt:new Date().toISOString()
    });
  }catch(e){
    res.status(503).json({error:String(e),mode:'unavailable'});
  }
}
