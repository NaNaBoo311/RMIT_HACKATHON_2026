-- AIgree schema. The database only ever stores ciphertext and metadata.
-- Run in Supabase -> SQL Editor. Accessed only from Next.js server routes with the service-role key.

create table profiles (
  id uuid primary key default gen_random_uuid(),
  tide_user_key text,                         -- token "tideuserkey": the subject of User policies
  tide_user_id text unique not null,          -- token "sub"
  role text not null check (role in ('benh_nhan','bac_si','benh_vien')),
  display_name text not null,
  specialties text[] default '{}',            -- mirror of khoa_* roles, for UI
  created_at timestamptz default now()
);

create table patients (
  code text primary key,                      -- e.g. bn_7f3k9x (random)
  profile_id uuid unique references profiles(id),
  cccd_hmac text unique not null,
  cccd_ciphertext text,                       -- tag <code>_dinhdanh; set when registration completes
  status text not null default 'awaiting_activation'
    check (status in ('awaiting_activation','active')),
  created_at timestamptz default now()
);

create table family_links (
  patient_code text references patients(code),
  family_profile_id uuid references profiles(id),
  relation text,
  primary key (patient_code, family_profile_id)
);

create table records (
  id uuid primary key default gen_random_uuid(),
  patient_code text references patients(code),
  kind text not null check (kind in ('mat','noitiet','thietyeu')),
  tag text not null,
  ciphertext text not null,
  author_profile_id uuid references profiles(id),
  visit_id uuid,
  created_at timestamptz default now()
);

create table visits (
  id uuid primary key default gen_random_uuid(),
  patient_code text references patients(code),
  doctor_profile_id uuid references profiles(id),
  specialties text[] not null,                -- subset of doctor's specialties
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending_consent'
    check (status in ('pending_consent','awaiting_cosign','active','declined','completed','expired')),
  created_at timestamptz default now()
);

create table access_requests (                -- extra specialty during a visit
  id uuid primary key default gen_random_uuid(),
  visit_id uuid references visits(id),
  specialty text not null,
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  created_at timestamptz default now(),
  decided_at timestamptz
);

create table emergency_requests (
  id uuid primary key default gen_random_uuid(),
  patient_code text references patients(code),
  doctor_profile_id uuid references profiles(id),
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','expired')),
  expires_at timestamptz,
  created_at timestamptz default now()
);

create table emergency_approvals (
  request_id uuid references emergency_requests(id),
  approver_profile_id uuid references profiles(id),
  approver_type text not null check (approver_type in ('doctor','hospital','family')),
  approved_at timestamptz default now(),
  primary key (request_id, approver_type)
);

-- A grant is a RelationshipAttestation:1 policy naming one user (subject) and one compartment tag.
-- The server creates it as pending_signature; only the hospital account's Tide enclave can sign it.
create table policy_grants (
  id uuid primary key default gen_random_uuid(),
  subject_profile_id uuid not null references profiles(id),
  patient_code text not null references patients(code),
  tag text not null,                          -- = policy assignmentId = the only tag on every item
  access text not null check (access in ('read','read-write')),
  status text not null default 'pending_signature'
    check (status in ('pending_signature','active','revoked','expired')),
  policy_b64 text,                            -- signed policy bytes (base64)
  expires_at timestamptz not null,            -- also the policy's own expiry, enforced by the network
  visit_id uuid references visits(id),
  access_request_id uuid references access_requests(id),
  emergency_id uuid references emergency_requests(id),
  signed_by uuid references profiles(id),
  created_at timestamptz default now(),
  signed_at timestamptz,
  revoked_at timestamptz
);
create index policy_grants_subject_idx on policy_grants (subject_profile_id, status);
create index policy_grants_status_idx on policy_grants (status);

create table access_logs (
  id uuid primary key default gen_random_uuid(),
  patient_code text references patients(code),
  actor_profile_id uuid references profiles(id),
  action text not null check (action in ('decrypt','encrypt','denied','emergency','grant','revoke','sign')),
  tag text,
  visit_id uuid,
  created_at timestamptz default now()
);

create table demo_settings (           -- app switches (breach drill); name kept for existing databases
  key text primary key,
  value jsonb not null
);
insert into demo_settings values ('hacker_mode', 'false');

-- RLS on, no policies: only the service-role key (server) can access.
alter table profiles enable row level security;
alter table patients enable row level security;
alter table family_links enable row level security;
alter table records enable row level security;
alter table visits enable row level security;
alter table access_requests enable row level security;
alter table emergency_requests enable row level security;
alter table emergency_approvals enable row level security;
alter table policy_grants enable row level security;
alter table access_logs enable row level security;
alter table demo_settings enable row level security;
