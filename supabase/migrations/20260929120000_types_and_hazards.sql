-- A1 (1/8): shared types and the hazards config table (spec sections 8 and 13).
-- Every alert, report, SOS and safe place carries a hazard_type; only flood is active in 2026.

create type public.hazard_type as enum
  ('flood', 'flash_flood', 'landslide', 'fire', 'earthquake', 'other', 'unknown');
create type public.hazard_status as enum ('active', 'coming_soon', 'disabled');
create type public.hazard_capability as enum ('forecast', 'nowcast', 'detect', 'sos_only');

create type public.user_role as enum ('user', 'authority', 'admin', 'super_admin');
create type public.org_type as enum ('government', 'private', 'nonprofit', 'volunteer');
create type public.authority_status as enum ('pending', 'verified', 'suspended');
create type public.authority_capability as enum ('coordination', 'rescue', 'planning', 'support');
create type public.admin_level as enum ('province', 'district', 'tambon');

create type public.alert_level as enum ('normal', 'watch', 'warning', 'evacuate', 'return');
create type public.depth_ref as enum
  ('dry', 'ankle', 'knee', 'waist', 'chest', 'above_head', 'roof');
create type public.water_trend as enum ('rising', 'steady', 'falling');
create type public.road_access as enum ('car', 'motorbike_only', 'impassable');
create type public.moderation_status as enum ('pending', 'approved', 'hidden');
create type public.verification_status as enum ('unverified', 'verified', 'rejected');

create type public.safe_place_type as enum
  ('shelter', 'school', 'mosque', 'temple', 'government', 'high_ground_parking', 'other');
create type public.safe_place_status as enum ('open', 'full', 'closed', 'unknown');

-- SOS timeline: received → assigned → en_route → rescued; the requester can say they are safe;
-- admins can dismiss suspected spam (reversible, logged). A merged repeat SOS never gets its own row.
create type public.sos_status as enum
  ('received', 'assigned', 'en_route', 'rescued', 'safe_cancelled', 'dismissed');
create type public.rescue_confirmation_method as enum ('requester', 'second_authority', 'admin');
create type public.delivery_channel as enum ('web_push', 'line', 'sms');
create type public.invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');

create table public.hazards (
  code public.hazard_type primary key,
  status public.hazard_status not null default 'coming_soon',
  capability public.hazard_capability not null default 'sos_only',
  -- {"th": "...", "ms": "...", "en": "..."}
  name jsonb not null,
  description jsonb not null default '{}'::jsonb,
  -- Shown on a coming-soon card: never implies "no risk" (safety rule 10).
  placeholder jsonb not null default '{}'::jsonb,
  hotline text not null default '1784',
  display_order smallint not null default 100
);
comment on table public.hazards is
  'Hazard config. Only flood is active in the MVP; others show "coming soon" and point to SOS and a hotline.';
