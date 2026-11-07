"""Replay a past flood season into a Supabase project with the clock shifted to now.

For the launch dry run (docs/prompts.md A10, docs/launch.md): the observed Nov 2025 river
gauges and the dam, read from the tidy archive and fed into the database as if they were
arriving live, so the admins' signal dashboard rises, a ticked gauge crosses its threshold, and
the automated alarm rings (as a drill). Advisory and rehearsal only: it writes readings, never an
alert (safety rule 2).

Safe by construction: the default command writes nothing, `run` refuses without an explicit
confirmation and refuses a target that equals LIVE_DB_URL, and the ingestion crons it pauses are
always restored on exit. See replay/METHODS.md.
"""
