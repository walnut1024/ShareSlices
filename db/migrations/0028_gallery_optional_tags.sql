alter table gallery_listing_proposal
  drop constraint gallery_listing_proposal_tags_check,
  add constraint gallery_listing_proposal_tags_check
    check (cardinality(tags) between 0 and 5);

alter table gallery_listing_revision
  drop constraint gallery_listing_revision_tags_check,
  add constraint gallery_listing_revision_tags_check
    check (cardinality(tags) between 0 and 5);
