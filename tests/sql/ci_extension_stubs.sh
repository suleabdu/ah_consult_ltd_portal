#!/usr/bin/env bash
# Installs tiny stand-ins for pg_cron / pg_net (Supabase-hosted extensions) on a vanilla Postgres server so the
# migrations can run in CI. Needs write access to the Postgres extension directory (use sudo on GitHub runners).
set -euo pipefail
EXT_DIR="$(pg_config --sharedir)/extension"
SUDO=""; [ -w "$EXT_DIR" ] || SUDO="sudo"
$SUDO tee "$EXT_DIR/pg_cron.control" >/dev/null <<'C'
comment = 'test stub of pg_cron'
default_version = '1.0'
relocatable = false
C
$SUDO tee "$EXT_DIR/pg_cron--1.0.sql" >/dev/null <<'S'
create schema if not exists cron;
create table cron.job(jobid bigserial primary key, schedule text, command text, jobname text);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$ insert into cron.job(jobname,schedule,command) values(job_name,schedule,command) returning jobid $$;
create function cron.schedule(schedule text, command text) returns bigint language sql as $$ insert into cron.job(schedule,command) values(schedule,command) returning jobid $$;
create function cron.unschedule(job_name text) returns boolean language sql as $$ delete from cron.job where jobname=job_name returning true $$;
S
$SUDO tee "$EXT_DIR/pg_net.control" >/dev/null <<'C'
comment = 'test stub of pg_net'
default_version = '1.0'
relocatable = false
C
$SUDO tee "$EXT_DIR/pg_net--1.0.sql" >/dev/null <<'S'
create schema if not exists net;
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 1000) returns bigint language sql as $$ select 1::bigint $$;
S
echo "extension stubs installed in $EXT_DIR"
