-- Backfill last_surfaced_reply_at on pre-existing dismissed HeyReach leads
-- whose watermark was NULL. See gen_backfill_29.mjs header for the rule.
BEGIN;
UPDATE agent_leads AS a
SET last_surfaced_reply_at = v.wm
FROM (VALUES
  ('5a874896-9885-480d-b82d-5ec9e9456978'::uuid, '2026-07-31T12:53:18.648Z'::timestamptz),
  ('8887b9a1-20b0-4736-b9f5-bfb15ccaa02b'::uuid, '2026-08-07T03:02:35.862Z'::timestamptz),
  ('58bb2395-6d10-49f5-809a-7b6e48357535'::uuid, '2026-07-29T16:41:50.191Z'::timestamptz),
  ('848cab9c-7617-44cf-be1b-38485ffedabb'::uuid, '2026-08-07T03:21:44.086Z'::timestamptz),
  ('182872c4-9c18-439e-9d6f-94277d04836f'::uuid, '2026-08-11T15:54:49.596Z'::timestamptz),
  ('b1e12794-c69b-47f4-a56f-abe8f81ed3ac'::uuid, '2026-08-11T21:55:46.059Z'::timestamptz),
  ('335f690a-7dfe-4b5e-80e2-955277883218'::uuid, '2026-08-11T22:43:04.956Z'::timestamptz),
  ('0ef3378a-115f-4de2-b86f-a0ca088a4b6d'::uuid, '2026-07-28T21:50:18.229Z'::timestamptz),
  ('45acc508-1ca0-4e12-b839-e3b1056986e2'::uuid, '2026-08-07T20:21:55.513Z'::timestamptz),
  ('f839e27f-69c6-484a-b26a-9ddfc06114fe'::uuid, '2026-08-06T21:25:21.905Z'::timestamptz),
  ('a317b1e5-c82d-4f82-a86c-c16040576729'::uuid, '2026-08-06T19:33:27.326Z'::timestamptz),
  ('265703ca-b1cc-420c-879d-6165011ec58b'::uuid, '2026-08-06T14:55:27.857Z'::timestamptz),
  ('2aee1bb1-3339-4778-bc9f-f5f8f7add9d9'::uuid, '2026-08-08T08:03:30.069Z'::timestamptz),
  ('54c99d1e-0974-49c8-82fc-074e7ffe0fcd'::uuid, '2026-08-06T13:14:06.793Z'::timestamptz),
  ('509a1d95-be03-4559-8769-e28e1558e8a1'::uuid, '2026-07-28T18:28:02.982Z'::timestamptz),
  ('937054ad-c0a8-4a0a-9657-2ca11bdcdfe8'::uuid, '2026-08-06T13:53:13.583Z'::timestamptz),
  ('868254fd-a990-48f5-9a46-0faccaba3a65'::uuid, '2026-07-28T12:40:09.881Z'::timestamptz),
  ('6832e3d0-1682-49a4-bf61-e63492bfd53d'::uuid, '2026-07-30T05:33:17.315Z'::timestamptz),
  ('4bdba9a6-2bbc-4e7f-89b4-bbd50d10d6b9'::uuid, '2026-08-05T20:42:31.848Z'::timestamptz),
  ('8f3d2250-58bb-4a96-97a6-6191164928f4'::uuid, '2026-07-24T11:21:12.419Z'::timestamptz),
  ('55964232-d795-4ee7-a1f1-699e9dd6ba8d'::uuid, '2026-08-06T14:18:51.993Z'::timestamptz),
  ('86856807-eb86-4e8f-944c-9e28ba2491f3'::uuid, '2026-08-11T21:48:47.252Z'::timestamptz),
  ('a191072b-e712-4b96-82ec-4f19f5aad64b'::uuid, '2026-08-10T22:55:11.171Z'::timestamptz),
  ('b3227c87-41e7-4618-af30-269a0b3c2317'::uuid, '2026-08-06T18:01:59.496Z'::timestamptz),
  ('a743fa77-704a-42a7-8b6b-497235212cb0'::uuid, '2026-08-05T14:17:44.367Z'::timestamptz),
  ('2d217452-a501-457e-8b78-e299148a9f98'::uuid, '2026-08-05T03:40:40.880Z'::timestamptz),
  ('e217f48a-d4d5-4a66-8878-0c4e379a77bd'::uuid, '2026-07-28T18:28:22.653Z'::timestamptz),
  ('7cf6a54c-a07f-456a-814f-f0d80aa2d964'::uuid, '2026-08-06T15:42:28.704Z'::timestamptz),
  ('0e178f72-6d4f-4d12-aa7e-f2458d955d38'::uuid, '2026-08-05T16:06:16.301Z'::timestamptz)
) AS v(id, wm)
WHERE a.id = v.id AND a.source = 'heyreach'
  AND a.inbox_status = 'dismissed' AND a.last_surfaced_reply_at IS NULL;
