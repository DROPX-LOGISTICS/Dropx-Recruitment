import type { SupabaseClient } from '@supabase/supabase-js';

/** Match an application, never a person across unrelated hiring ads. */
export async function findMetaApplication(admin: SupabaseClient, companyId: string, metaId: string, key: string, adName: string, phone: string|null) {
  const base = () => admin.from('recruitment_leads').select('id,duplicate_count,meta_lead_id').eq('company_id',companyId);
  let match=await base().eq('meta_lead_id',metaId).maybeSingle();
  if(match.error)throw new Error(match.error.message);
  if(!match.data)match=await base().eq('canonical_key',key).maybeSingle();
  if(match.error)throw new Error(match.error.message);
  // Legacy imports used meta:<id> keys. Keep same-ad retries deduplicated too.
  if(!match.data&&phone)match=await base().eq('ad_name',adName).eq('normalized_phone',phone)
    .order('archived',{ascending:true}).order('updated_at',{ascending:false}).limit(1).maybeSingle();
  if(match.error)throw new Error(match.error.message);
  return match;
}
