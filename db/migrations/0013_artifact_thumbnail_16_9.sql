-- Pre-production only: stop all Artifact writers and clear Artifact rows and
-- Artifact-owned objects before applying this renderer-v2 dimension contract.
do $$
begin
  if exists (select 1 from content_bundle_thumbnail) then
    raise exception 'clear Artifact data before applying the renderer-v2 thumbnail contract';
  end if;
end
$$;

alter table content_bundle_thumbnail
  drop constraint content_bundle_thumbnail_width_check,
  drop constraint content_bundle_thumbnail_height_check,
  drop constraint content_bundle_thumbnail_dimensions_check,
  add constraint content_bundle_thumbnail_dimensions_check
    check (width = 800 and height = 450);
