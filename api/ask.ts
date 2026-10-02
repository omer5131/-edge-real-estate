import type { VercelRequest,VercelResponse } from '@vercel/node';
import { sql } from '../server/db.js';

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
  if(req.method!=='POST') return res.status(405).json({error:'method_not_allowed'});
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
