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

-- Scored listings per user
create table public.user_listings (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  listing_id uuid references public.listings(id) on delete cascade not null,
  score integer not null, -- 0-100
  score_breakdown jsonb, -- {price: 90, location: 80, amenities: 70, ...}
  score_reasoning text, -- AI explanation
  is_saved boolean not null default false,
  is_dismissed boolean not null default false,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, listing_id)
);

-- Search runs (tracks when scraping was triggered)
create table public.search_runs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  neighborhoods text[],
  listings_found integer default 0,
  listings_scored integer default 0,
  status text not null default 'pending', -- 'pending' | 'running' | 'completed' | 'failed'
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

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

-- Function to refund a search credit on failed runs
create or replace function public.decrement_searches_used(user_id uuid)
returns void as $$
begin
  update public.profiles
  set searches_used = greatest(0, searches_used - 1)
  where id = user_id;
end;
$$ language plpgsql security definer;
