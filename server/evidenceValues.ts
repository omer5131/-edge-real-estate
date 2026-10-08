// Source facts: absent values must not be coerced to ground floor/distance zero.
export const numberOrNull=(value:unknown):number|null=>{
  if(value==null||typeof value==='boolean'||(typeof value!=='number'&&typeof value!=='string')||String(value).trim()==='')return null;
  const n=Number(value);return Number.isFinite(n)?n:null;
};
export const normalizeAddress=(value:unknown)=>String(value??'').normalize('NFKC').toLowerCase().replace(/[״"'׳',.-]/g,' ').replace(/\s+/g,' ').trim();
export const streetKey=(value:unknown)=>normalizeAddress(value).replace(/(?:^|\s)(?:דירה|קומה|כניסה)(?:\s|$).*$/u,'').replace(/(?:^|\s)\d+[א-תa-z]?(?=\s|$)/gu,' ').replace(/\s+/g,' ').trim();
const numbered=(value:unknown)=>/(?:^|\s)\d+[א-תa-z]?(?=\s|$)/u.test(normalizeAddress(value));
export function addressRelation(subject:any,candidate:any){
  const a=subject.canonical_address||subject.address,b=candidate.address_text||candidate.canonical_address||candidate.address;
  const sameScope=Boolean(subject.neighborhood_id&&subject.neighborhood_id===candidate.neighborhood_id)||Boolean(subject.city_id&&subject.city_id===candidate.city_id);
  if(subject.building_id&&candidate.building_id&&subject.building_id===candidate.building_id)return 'same_building' as const;
  if(sameScope&&subject.address_verified===true&&candidate.address_verified===true&&numbered(a)&&numbered(b)&&normalizeAddress(a)===normalizeAddress(b))return 'same_building' as const;
  const sa=streetKey(a),sb=streetKey(b);
  if(sameScope&&sa&&sb&&sa===sb)return 'same_street' as const;
  const distance=numberOrNull(candidate.distance_meters);
  if(candidate.distance_verified===true&&distance!=null&&distance>=0&&distance<=1200)return 'nearby' as const;
  if(subject.neighborhood_id&&subject.neighborhood_id===candidate.neighborhood_id)return 'same_neighborhood' as const;
  return 'fallback' as const;
}
