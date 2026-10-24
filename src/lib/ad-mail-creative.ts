import {createHash} from 'node:crypto';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24);
const assetPath=(value:unknown)=>{
 try {const url=new URL(String(value||''));return `${url.hostname}${url.pathname}`;}
 catch {return String(value||'');}
};

/** Signed CDN URLs and thumbnail sizes are transport details, not poster edits. */
export function creativeFingerprint(ad:{poster_url?:string|null;raw_payload?:any}) {
 const creative=ad.raw_payload?.creative||{};
 const story=creative.object_story_spec||{};
 const identity=creative.id?['creative',String(creative.id)]
  :story.link_data?.image_hash?['image',story.link_data.image_hash]
  :story.video_data?.video_id?['video',story.video_data.video_id]
  :['asset',assetPath(creative.image_url||ad.poster_url||creative.thumbnail_url)];
 return `v2:${hash(identity)}`;
}

/** Upgrade the legacy URL-based baseline quietly; never manufacture a change. */
export function creativeChanged(previous:string|null|undefined,current:string) {
 return Boolean(previous?.startsWith('v2:')&&previous!==current);
}
