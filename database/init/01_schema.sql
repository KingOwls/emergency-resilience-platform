create extension if not exists pgcrypto;
create extension if not exists postgis;

do $$ begin
  if not exists(select 1 from pg_roles where rolname='app_backend') then
    execute 'create role app_backend nologin';
  end if;
end $$;

create schema if not exists app;
create schema if not exists intake;
create schema if not exists dispatch;
create schema if not exists geo;
create schema if not exists notification;

grant usage on schema app,intake,dispatch,geo,notification to app_backend;

create or replace function app.claims()
returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create or replace function app.claim_role()
returns text language sql stable as $$ select app.claims()->>'role' $$;

create or replace function app.claim_sub()
returns uuid language plpgsql stable as $$
declare v text;
begin
  v := app.claims()->>'sub';
  if v is null or v = '' then return null; end if;
  return v::uuid;
exception when others then return null;
end $$;

grant execute on function app.claims(), app.claim_role(), app.claim_sub() to app_backend;

create table intake.emergencies (
  id uuid primary key default gen_random_uuid(),
  citizen_id uuid not null,
  type text not null check(type in ('USAR_MEDICAL','SHELTER','SUPPLIES','DAMAGE_ASSESSMENT')),
  priority text not null check(priority in ('P1','P2','P3','P4')),
  city text not null check(city in ('CHOCO','PEREIRA','CALI','MANIZALES')),
  status text not null default 'RECEIVED' check(status in ('RECEIVED','TRIAGED','DISPATCHED','IN_PROGRESS','RESOLVED','CLOSED')),
  latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  location geography(point,4326) generated always as (st_setsrid(st_makepoint(longitude,latitude),4326)::geography) stored,
  critical_data jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index emergencies_city_priority_idx on intake.emergencies(city,priority,status);
create index emergencies_location_gix on intake.emergencies using gist(location);

create table dispatch.rescue_resources (
  id uuid primary key default gen_random_uuid(),
  agency text not null check(agency in ('CRUZ_ROJA','BOMBEROS','DEFENSA_CIVIL','UNGRD')),
  resource_type text not null,
  city text not null check(city in ('CHOCO','PEREIRA','CALI','MANIZALES')),
  status text not null default 'AVAILABLE' check(status in ('AVAILABLE','RESERVED','EN_ROUTE','ON_SCENE','OUT_OF_SERVICE')),
  latitude double precision not null,
  longitude double precision not null,
  location geography(point,4326) generated always as (st_setsrid(st_makepoint(longitude,latitude),4326)::geography) stored,
  capabilities jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index rescue_resources_city_status_idx on dispatch.rescue_resources(city,status);
create index rescue_resources_location_gix on dispatch.rescue_resources using gist(location);

create table dispatch.assignments (
  id uuid primary key default gen_random_uuid(),
  emergency_id uuid not null references intake.emergencies(id) on delete cascade,
  resource_id uuid not null references dispatch.rescue_resources(id),
  operator_id uuid not null,
  status text not null default 'ASSIGNED' check(status in ('ASSIGNED','EN_ROUTE','ON_SCENE','COMPLETED','CANCELLED')),
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index dispatch_emergency_idx on dispatch.assignments(emergency_id,assigned_at desc);
create unique index one_active_dispatch_per_emergency on dispatch.assignments(emergency_id)
  where status in ('ASSIGNED','EN_ROUTE','ON_SCENE');

create table notification.outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  aggregate_id uuid not null,
  payload jsonb not null,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index outbox_pending_idx on notification.outbox(created_at) where processed_at is null;

create table notification.events (
  id uuid primary key default gen_random_uuid(),
  source_event_id uuid not null unique,
  emergency_id uuid not null references intake.emergencies(id) on delete cascade,
  city text not null check(city in ('CHOCO','PEREIRA','CALI','MANIZALES')),
  status text not null,
  message text not null,
  source text not null,
  created_at timestamptz not null default now()
);
create index notification_emergency_idx on notification.events(emergency_id,created_at desc);

create table notification.webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  city text not null check(city in ('CHOCO','PEREIRA','CALI','MANIZALES')),
  target_url text not null,
  active boolean not null default true,
  unique(city,target_url),
  created_at timestamptz not null default now()
);

create table notification.webhook_deliveries (
  event_id uuid not null references notification.events(id) on delete cascade,
  subscription_id uuid not null references notification.webhook_subscriptions(id) on delete cascade,
  attempts integer not null default 0,
  status_code integer,
  last_error text,
  delivered_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(event_id,subscription_id)
);

alter table intake.emergencies enable row level security;
alter table intake.emergencies force row level security;
alter table dispatch.rescue_resources enable row level security;
alter table dispatch.rescue_resources force row level security;
alter table dispatch.assignments enable row level security;
alter table dispatch.assignments force row level security;
alter table notification.outbox enable row level security;
alter table notification.outbox force row level security;
alter table notification.events enable row level security;
alter table notification.events force row level security;
alter table notification.webhook_subscriptions enable row level security;
alter table notification.webhook_subscriptions force row level security;
alter table notification.webhook_deliveries enable row level security;
alter table notification.webhook_deliveries force row level security;

create policy emergency_select on intake.emergencies for select to app_backend
using (app.claim_role()='operator' or (app.claim_role()='citizen' and citizen_id=app.claim_sub()));
create policy emergency_insert on intake.emergencies for insert to app_backend
with check (app.claim_role()='citizen' and citizen_id=app.claim_sub());
create policy emergency_update_operator on intake.emergencies for update to app_backend
using (app.claim_role()='operator') with check (app.claim_role()='operator');

create policy resources_select_operator on dispatch.rescue_resources for select to app_backend
using (app.claim_role()='operator');
create policy resources_update_operator on dispatch.rescue_resources for update to app_backend
using (app.claim_role()='operator') with check (app.claim_role()='operator');

create policy assignments_select_operator on dispatch.assignments for select to app_backend
using (app.claim_role()='operator');
create policy assignments_insert_operator on dispatch.assignments for insert to app_backend
with check (app.claim_role()='operator');
create policy assignments_update_operator on dispatch.assignments for update to app_backend
using (app.claim_role()='operator') with check (app.claim_role()='operator');

create policy outbox_insert_domain on notification.outbox for insert to app_backend
with check (app.claim_role() in ('citizen','operator','system'));
create policy outbox_system_read on notification.outbox for select to app_backend
using (app.claim_role()='system');
create policy outbox_system_update on notification.outbox for update to app_backend
using (app.claim_role()='system') with check (app.claim_role()='system');

create policy notifications_select on notification.events for select to app_backend
using (
  app.claim_role() in ('operator','system')
  or (app.claim_role()='citizen' and exists(
    select 1 from intake.emergencies e where e.id=notification.events.emergency_id and e.citizen_id=app.claim_sub()
  ))
);
create policy notifications_system_insert on notification.events for insert to app_backend
with check (app.claim_role()='system');

create policy webhooks_operator_select on notification.webhook_subscriptions for select to app_backend
using (app.claim_role()='operator');
create policy webhooks_operator_insert on notification.webhook_subscriptions for insert to app_backend
with check (app.claim_role()='operator');
create policy webhooks_operator_update on notification.webhook_subscriptions for update to app_backend
using (app.claim_role()='operator') with check (app.claim_role()='operator');
create policy webhooks_system_select on notification.webhook_subscriptions for select to app_backend
using (app.claim_role()='system');
create policy deliveries_system_all on notification.webhook_deliveries for all to app_backend
using (app.claim_role()='system') with check (app.claim_role()='system');

grant select,insert,update on intake.emergencies to app_backend;
grant select,update on dispatch.rescue_resources to app_backend;
grant select,insert,update on dispatch.assignments to app_backend;
grant select,insert,update on notification.outbox to app_backend;
grant select,insert on notification.events to app_backend;
grant select,insert,update on notification.webhook_subscriptions to app_backend;
grant select,insert,update on notification.webhook_deliveries to app_backend;

create or replace function geo.hotspots_by_city(p_city text)
returns table(cluster_id integer,incident_count bigint,p1_count bigint,latitude double precision,longitude double precision)
language plpgsql security definer set search_path=geo,intake,public,app as $$
begin
  if app.claim_role() <> 'operator' then raise exception 'FORBIDDEN'; end if;
  return query
  with clustered as (
    select priority,location,
      st_clusterdbscan(st_transform(location::geometry,3857), eps:=1500, minpoints:=2) over() cid
    from intake.emergencies where city=p_city and status not in ('RESOLVED','CLOSED')
  ), grouped as (
    select cid,count(*) total,count(*) filter(where priority='P1') critical,
      st_centroid(st_collect(location::geometry)) center
    from clustered where cid is not null group by cid
  )
  select cid,total,critical,st_y(center),st_x(center) from grouped order by critical desc,total desc;
end $$;

create or replace function dispatch.assign_nearest_resource(p_emergency_id uuid,p_operator_id uuid)
returns table(dispatch_id uuid,emergency_id uuid,resource_id uuid,city text,distance_m double precision,status text)
language plpgsql security definer set search_path=dispatch,intake,notification,public,app as $$
declare e intake.emergencies%rowtype; r dispatch.rescue_resources%rowtype; a dispatch.assignments%rowtype;
begin
  if app.claim_role() <> 'operator' then raise exception 'FORBIDDEN'; end if;
  if exists(select 1 from dispatch.assignments x where x.emergency_id=p_emergency_id and x.status in ('ASSIGNED','EN_ROUTE','ON_SCENE')) then
    raise exception 'ACTIVE_DISPATCH_EXISTS';
  end if;
  select * into e from intake.emergencies where id=p_emergency_id for update;
  if not found then raise exception 'EMERGENCY_NOT_FOUND'; end if;
  select rr.* into r from dispatch.rescue_resources rr
    where rr.city=e.city and rr.status='AVAILABLE'
    order by st_distance(rr.location,e.location) limit 1 for update skip locked;
  if not found then raise exception 'NO_RESOURCE_AVAILABLE'; end if;
  update dispatch.rescue_resources set status='RESERVED',updated_at=now() where id=r.id;
  insert into dispatch.assignments(emergency_id,resource_id,operator_id,status)
    values(e.id,r.id,p_operator_id,'ASSIGNED') returning * into a;
  update intake.emergencies set status='DISPATCHED',updated_at=now() where id=e.id;
  insert into notification.outbox(event_type,aggregate_id,payload) values(
    'dispatch.assigned',e.id,jsonb_build_object('dispatch_id',a.id,'emergency_id',e.id,'resource_id',r.id,'city',e.city,'status',a.status)
  );
  return query select a.id,e.id,r.id,e.city,st_distance(r.location,e.location),a.status;
end $$;

create or replace function dispatch.update_dispatch_status(p_dispatch_id uuid,p_status text,p_operator_id uuid)
returns table(dispatch_id uuid,emergency_id uuid,resource_id uuid,city text,status text)
language plpgsql security definer set search_path=dispatch,intake,public,app as $$
declare a dispatch.assignments%rowtype; e intake.emergencies%rowtype;
begin
  if app.claim_role() <> 'operator' then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('ASSIGNED','EN_ROUTE','ON_SCENE','COMPLETED','CANCELLED') then raise exception 'INVALID_DISPATCH_STATUS'; end if;
  select * into a from dispatch.assignments where id=p_dispatch_id for update;
  if not found then raise exception 'DISPATCH_NOT_FOUND'; end if;
  update dispatch.assignments set status=p_status,operator_id=p_operator_id,updated_at=now() where id=a.id returning * into a;
  if p_status='EN_ROUTE' then
    update dispatch.rescue_resources set status='EN_ROUTE',updated_at=now() where id=a.resource_id;
  elsif p_status='ON_SCENE' then
    update dispatch.rescue_resources set status='ON_SCENE',updated_at=now() where id=a.resource_id;
    update intake.emergencies set status='IN_PROGRESS',updated_at=now() where id=a.emergency_id;
  elsif p_status='COMPLETED' then
    update dispatch.rescue_resources set status='AVAILABLE',updated_at=now() where id=a.resource_id;
    update intake.emergencies set status='RESOLVED',updated_at=now() where id=a.emergency_id;
  elsif p_status='CANCELLED' then
    update dispatch.rescue_resources set status='AVAILABLE',updated_at=now() where id=a.resource_id;
  end if;
  select * into e from intake.emergencies where id=a.emergency_id;
  insert into notification.outbox(event_type,aggregate_id,payload) values(
    'dispatch.updated',a.emergency_id,jsonb_build_object('dispatch_id',a.id,'emergency_id',a.emergency_id,'resource_id',a.resource_id,'city',e.city,'status',a.status)
  );
  return query select a.id,a.emergency_id,a.resource_id,e.city,a.status;
end $$;

grant execute on function geo.hotspots_by_city(text) to app_backend;
grant execute on function dispatch.assign_nearest_resource(uuid,uuid) to app_backend;
grant execute on function dispatch.update_dispatch_status(uuid,text,uuid) to app_backend;

-- Compatibilidad con Supabase Realtime: si la publicación existe en la nube, se agregan las tablas.
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    execute 'alter publication supabase_realtime add table intake.emergencies';
    execute 'alter publication supabase_realtime add table notification.events';
  end if;
exception when duplicate_object then null;
end $$;
