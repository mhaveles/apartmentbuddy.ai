-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Profiles table (extends Supabase auth.users)
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  full_name text,
  plan text not null default 'free', -- 'free' | 'pro'
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text, -- 'active' | 'canceled' | 'past_due'
  searches_used int not null default 0,
  credits int not null default 3,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- User preferences (gathered from AI chat)
create table public.preferences (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  max_rent integer, -- monthly rent in cents
  min_bedrooms integer default 1,
  max_bedrooms integer,
  min_bathrooms numeric(3,1),
  pet_friendly boolean,
  parking_required boolean,
  in_unit_laundry boolean,
  gym boolean,
  rooftop boolean,
  doorman boolean,
  elevator boolean,
  outdoor_space boolean,
  move_in_date date,
  lease_length text, -- '12 months', 'flexible', etc.
  other_requirements text[], -- free-form array of requirements
  deal_breakers text[], -- must-not-haves
  summary text, -- AI-generated plain-english summary of preferences
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Neighborhoods to monitor
create table public.monitored_neighborhoods (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  city text not null,
  state text not null,
  neighborhood text not null,
  zip_code text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Chat conversations
create table public.conversations (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  messages jsonb not null default '[]'::jsonb, -- array of {role, content, timestamp}
  preferences_extracted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Scraped listings
create table public.listings (
  id uuid primary key default uuid_generate_v4(),
  external_id text not null, -- from source site
  source text not null, -- 'zillow' | 'apartments_com' | 'craigslist'
  url text not null,
  title text,
  address text,
  city text not null,
  state text not null,
  neighborhood text,
  zip_code text,
  rent integer not null, -- monthly in cents
  bedrooms numeric(3,1),
  bathrooms numeric(3,1),
  sqft integer,
  available_date date,
  amenities text[],
  description text,
  images text[],
  raw_data jsonb,
  scraped_at timestamptz not null default now(),
  unique(external_id, source)
);

-- Search runs (tracks when scraping was triggered)
create table public.search_runs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  neighborhoods text[],
  neighborhood_id uuid references public.monitored_neighborhoods(id) on delete set null, -- set only for single-neighborhood runs (free/pay-per-credit)
  neighborhood_label text, -- denormalized "Neighborhood, City, ST" snapshot, survives deletion of the neighborhood row
  listings_found integer default 0,
  listings_scored integer default 0,
  status text not null default 'pending', -- 'pending' | 'running' | 'completed' | 'failed'
  error text,
  apify_runs_pending int not null default 0,
  apify_run_ids jsonb not null default '{}',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Scored listings per user
create table public.user_listings (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  listing_id uuid references public.listings(id) on delete cascade not null,
  score integer not null, -- 0-100
  score_breakdown jsonb, -- {price: 90, location: 80, amenities: 70, ...}
  score_reasoning text, -- AI explanation
  vote integer, -- 1 (good fit) or -1 (bad fit), null = unvoted
  score_vote_delta integer, -- score * vote: negative = AI/user disagreement
  is_saved boolean not null default false,
  is_dismissed boolean not null default false,
  notified_at timestamptz,
  search_run_id uuid references public.search_runs(id) on delete set null, -- which run surfaced this listing (ties it to a neighborhood via search_runs.neighborhood_id)
  created_at timestamptz not null default now(),
  unique(user_id, listing_id)
);

-- Migration: add apify tracking columns to existing search_runs tables
-- Run this in the Supabase SQL editor if the table already exists:
-- alter table public.search_runs
--   add column if not exists apify_runs_pending int not null default 0,
--   add column if not exists apify_run_ids jsonb not null default '{}';

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.preferences enable row level security;
alter table public.monitored_neighborhoods enable row level security;
alter table public.conversations enable row level security;
alter table public.listings enable row level security;
alter table public.user_listings enable row level security;
alter table public.search_runs enable row level security;

-- Profiles policies
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);

-- Preferences policies
create policy "Users can manage own preferences" on public.preferences for all using (auth.uid() = user_id);

-- Neighborhoods policies
create policy "Users can manage own neighborhoods" on public.monitored_neighborhoods for all using (auth.uid() = user_id);

-- Conversations policies
create policy "Users can manage own conversations" on public.conversations for all using (auth.uid() = user_id);

-- Listings policies (readable by all authenticated users)
create policy "Authenticated users can read listings" on public.listings for select using (auth.role() = 'authenticated');

-- User listings policies
create policy "Users can manage own user_listings" on public.user_listings for all using (auth.uid() = user_id);

-- Search runs policies
create policy "Users can manage own search runs" on public.search_runs for all using (auth.uid() = user_id);

-- Function to handle new user signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name'
  );
  return new;
end;
$$ language plpgsql security definer;

-- Trigger on auth.users insert
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Function to atomically decrement apify_runs_pending, returns updated row
create or replace function public.decrement_apify_runs_pending(run_id uuid)
returns public.search_runs as $$
  update public.search_runs
  set apify_runs_pending = greatest(0, apify_runs_pending - 1)
  where id = run_id
  returning *;
$$ language sql security definer;

-- Migration: add vote column to user_listings
-- alter table public.user_listings
--   add column if not exists vote smallint check (vote in (-1, 1));

-- Migration: add sources tracking to user_listings + atomic append function
-- Run in Supabase SQL Editor:
-- alter table public.user_listings
--   add column if not exists sources text[];
--
-- create or replace function public.append_user_listing_source(ul_id uuid, new_source text)
-- returns void as $$
--   update public.user_listings
--   set sources = array_append(coalesce(sources, array[]::text[]), new_source)
--   where id = ul_id
--     and not (coalesce(sources, array[]::text[]) @> array[new_source]::text[]);
-- $$ language sql security definer;

-- Migration: single-neighborhood search selection + per-listing neighborhood attribution
-- Run in Supabase SQL Editor:
-- alter table public.search_runs
--   add column if not exists neighborhood_id uuid references public.monitored_neighborhoods(id) on delete set null,
--   add column if not exists neighborhood_label text;
--
-- alter table public.user_listings
--   add column if not exists search_run_id uuid references public.search_runs(id) on delete set null;

-- Function to refund a search credit on failed runs
create or replace function public.decrement_searches_used(user_id uuid)
returns void as $$
begin
  update public.profiles
  set searches_used = greatest(0, searches_used - 1)
  where id = user_id;
end;
$$ language plpgsql security definer;

-- Migration: credit packs (Stripe one-time $5 purchases add 3 credits)
-- Run in Supabase SQL Editor:
-- alter table public.profiles
--   add column if not exists credits int not null default 3;
--
-- create or replace function public.increment_credits(user_id uuid, amount int)
-- returns public.profiles as $$
--   update public.profiles
--   set credits = credits + amount, updated_at = now()
--   where id = user_id
--   returning *;
-- $$ language sql security definer;
--
-- create or replace function public.increment_searches_used(user_id uuid)
-- returns public.profiles as $$
--   update public.profiles
--   set searches_used = searches_used + 1, updated_at = now()
--   where id = user_id
--   returning *;
-- $$ language sql security definer;

-- =========================================================
-- Intent-based chat sessions (replaces monolithic conversations)
-- =========================================================

create table public.chat_sessions (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users,
  intent      text        not null check (intent in ('onboarding', 'refinement', 'check-in', 'deep-dive')),
  status      text        not null default 'open' check (status in ('open', 'resolved')),
  context     jsonb,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.chat_sessions enable row level security;

create policy "users manage own sessions"
  on public.chat_sessions for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table public.chat_messages (
  id          uuid        primary key default gen_random_uuid(),
  session_id  uuid        not null references public.chat_sessions,
  role        text        not null check (role in ('user', 'assistant')),
  content     text        not null,
  created_at  timestamptz not null default now()
);

alter table public.chat_messages enable row level security;

create policy "users manage own messages"
  on public.chat_messages for all
  using  (session_id in (select id from public.chat_sessions where user_id = auth.uid()))
  with check (session_id in (select id from public.chat_sessions where user_id = auth.uid()));

-- =========================================================
-- Anonymous pre-login intake sessions
-- =========================================================

create table public.anon_sessions (
  id                 uuid primary key default gen_random_uuid(),
  session_id         text not null unique,
  preferences_json   jsonb,
  chat_history       jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  converted_user_id  uuid references auth.users(id),
  status             text not null default 'pending' check (status in ('pending', 'converted', 'expired'))
);

alter table public.anon_sessions enable row level security;
-- No policies: this table is only ever touched by server routes using the
-- service-role client (createServiceClient). RLS is enabled purely so a leaked
-- anon key can never read or write it.

-- Marks an anon session converted and hands back its data for the caller to
-- migrate into `preferences`/`monitored_neighborhoods`. Guards against double-firing
-- on retries: only succeeds once, while status is still 'pending'.
create or replace function public.migrate_anon_session(anon_session_id uuid, new_user_id uuid)
returns public.anon_sessions as $$
  update public.anon_sessions
  set converted_user_id = new_user_id,
      status = 'converted'
  where id = anon_session_id
    and status = 'pending'
  returning *;
$$ language sql security definer;
