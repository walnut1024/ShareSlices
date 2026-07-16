import type { Pool } from "pg";

export class GallerySourceClosureService {
  constructor(private readonly pool:Pool){}

  async closeAccount(userId:string):Promise<void>{
    const client=await this.pool.connect();
    try{await client.query("begin");await client.query('select id from "user" where id=$1 for update',[userId]);
      await client.query("insert into gallery_account_closure(user_id) values($1) on conflict(user_id) do nothing",[userId]);
      await client.query(`insert into gallery_listing_lifecycle_event(id,listing_id,from_lifecycle_state,to_lifecycle_state,closure_reason,base_listing_revision,committed_listing_revision,actor_kind)
        select 'glevent_'||replace(gen_random_uuid()::text,'-',''),id,lifecycle_state,'withdrawn','account_deleted',listing_revision,listing_revision+1,'system'
        from gallery_listing where owner_user_id=$1 and (lifecycle_state in ('pending','listed') or (lifecycle_state='removed' and closure_reason='administrator_removal'))`,[userId]);
      await client.query(`update gallery_listing set lifecycle_state='withdrawn',closure_reason='account_deleted',listing_revision=listing_revision+1,closed_at=now(),updated_at=now()
        where owner_user_id=$1 and (lifecycle_state in ('pending','listed') or (lifecycle_state='removed' and closure_reason='administrator_removal'))`,[userId]);
      await client.query(`update gallery_listing_proposal proposal set state='closed',closed_at=now() from gallery_listing listing
        where proposal.listing_id=listing.id and listing.owner_user_id=$1 and proposal.state='open'`,[userId]);
      await client.query(`update gallery_appeal appeal set state='moot',resolved_at=now() from gallery_governance_decision decision
        join gallery_governance_case governance_case on governance_case.id=decision.case_id join gallery_listing listing on listing.id=governance_case.listing_id
        where appeal.decision_id=decision.id and appeal.state='pending' and listing.owner_user_id=$1`,[userId]);
      await client.query(`insert into gallery_listing_closure_tombstone(listing_id,opaque_slug,was_ever_public,terminal_lifecycle_state,closure_reason,source_deleted_at,permanently_non_restorable_at)
        select id,opaque_slug,current_revision_id is not null,'withdrawn','account_deleted',now(),now() from gallery_listing where owner_user_id=$1 and lifecycle_state='withdrawn' and closure_reason='account_deleted'
        on conflict(listing_id) do update set terminal_lifecycle_state='withdrawn',closure_reason='account_deleted',source_deleted_at=now(),permanently_non_restorable_at=now()`,[userId]);
      await client.query("update gallery_creator_profile set retired_at=coalesce(retired_at,now()),updated_at=now() where user_id=$1",[userId]);
      await client.query("commit");
    }catch(error){await client.query("rollback");throw error;}finally{client.release();}
  }
}
