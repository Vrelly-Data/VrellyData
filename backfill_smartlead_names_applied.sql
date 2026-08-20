-- Repair smartlead full_name values that were overwritten by our OWN sender's
-- name, using the directional rule now deployed in smartlead-webhook v44:
-- to_name is trustworthy ONLY when to_email is the canonical prospect
-- (sl_lead_email). Source is stored webhook_events — NOT the reply threads,
-- which were tested and return our senders as often as the prospect.
BEGIN;

CREATE TEMP TABLE _fix ON COMMIT DROP AS
WITH trustworthy AS (
  SELECT lower(event_data->>'sl_lead_email') AS prospect,
         trim(event_data->>'to_name')        AS good_name,
         created_at,
         row_number() OVER (PARTITION BY lower(event_data->>'sl_lead_email')
                            ORDER BY created_at DESC) AS rn
  FROM webhook_events
  WHERE event_type LIKE 'smartlead%'
    AND event_data ? 'sl_lead_email'
    AND lower(event_data->>'to_email') = lower(event_data->>'sl_lead_email')
    AND nullif(trim(event_data->>'to_name'),'') IS NOT NULL
)
SELECT l.id, l.email, l.full_name AS old_name, t.good_name AS new_name
FROM agent_leads l
JOIN trustworthy t ON t.prospect = lower(l.email) AND t.rn = 1
WHERE l.source = 'smartlead'
  AND l.full_name IS DISTINCT FROM t.good_name;

\echo '--- what will change (nothing committed yet) ---'
SELECT email, old_name, new_name FROM _fix ORDER BY email;
SELECT count(*) AS rows_to_update FROM _fix;

UPDATE agent_leads l SET full_name = f.new_name
FROM _fix f WHERE l.id = f.id;

\echo '--- post-update verification ---'
SELECT l.email, l.full_name FROM agent_leads l JOIN _fix f ON f.id=l.id ORDER BY l.email;

\echo '--- any lead still named after a known sender? ---'
SELECT count(*) AS still_named_after_a_sender
FROM agent_leads l
WHERE l.source='smartlead'
  AND EXISTS (SELECT 1 FROM email_sender_mailboxes m
              WHERE m.user_id=l.user_id AND m.sender_name=l.full_name);

\echo '--- no name was blanked? ---'
SELECT count(*) AS smartlead_leads_with_no_name
FROM agent_leads WHERE source='smartlead' AND (full_name IS NULL OR full_name='');

COMMIT;
