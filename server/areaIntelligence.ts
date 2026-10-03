import {queryDatabase} from './db.js';
import {refreshNeighborhoodIntelligence} from './neighborhoodIntelligence.js';
import type {ScoreModel} from './areaScoring.js';

export async function getActiveAreaScoreModel():Promise<ScoreModel>{
  const rows=await queryDatabase(`
    SELECT version,weights,parameters
    FROM area_score_models
    WHERE is_active=true
    ORDER BY activated_at DESC NULLS LAST,created_at DESC
    LIMIT 1
  `);
  if(!rows.length)throw new Error('No active score model');
  return rows[0] as ScoreModel;
}

/**
 * Compatibility entry point retained for the older area-refresh route.
 * Neighborhood is now the canonical product aggregation grain.
 */
export async function refreshAreaIntelligence(){
  const result=await refreshNeighborhoodIntelligence();
  return {
    mode:'neighborhood-first',
    scoreVersion:result.scoreVersion,
    neighborhoods:result.neighborhoods,
    crosswalk:result.crosswalk,
    evidence:result.evidence,
    metrics:result.metrics,
    dealHeat:result.dealHeat
  };
}
