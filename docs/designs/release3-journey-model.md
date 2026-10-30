# Release 3: Student journey model

Status: DRAFT for founder review (2026-10-30). Data model only; screens wait for the Release 2 design decisions.
Migration: `v16_journey.sql` (also in `schema/install.sql`, Section 7.2).

## The flow in one paragraph

A counsellor must see every student. The first meeting opens a **case**. If there is no concern, the counsellor closes it straight away as **all clear**, and from then on the student only needs a **regular** check-in about once a term. If there is a concern, the case stays open with a **need level** that sets how often follow-ups happen. When the counsellor closes a concern case, the student **must be seen again within 90 days** to confirm things held. Then they go back to regular check-ins. Cases recur: a new concern, from the counsellor or a **teacher referral**, opens a new case.

## Where a student is (exactly one, worked out from the data)

| Stage | Meaning | Next thing due |
|---|---|---|
| **Not seen** | No completed session and no case | First meeting (this is the coverage number) |
| **Open case** | A case is open with a need level | Next follow-up, from the need level's rhythm |
| **Review due** | A concern case closed, post-closure check not done yet | The check, within 90 days of closing |
| **Regular** | No open case, nothing pending | Termly check-in |

**Overdue** is a warning on any of these when the next thing due has passed. It is not a stage.

## How worried (only while a case is open)

| Need level | Default rhythm (Settings) |
|---|---|
| **Urgent** | First contact within 2 days, then every 7 days |
| **Support** | Every 14 days |
| **Watch** | Every 30 days |

There is no fourth level: "all clear" is a way of closing a case, not a level. This keeps the screen to 3 colours of worry.

## Closing a case

The counsellor closes a case, and must pick an outcome:

| Outcome | 90-day check required? |
|---|---|
| All clear (first meeting, no concern) | No, goes straight to Regular |
| Improved | Yes |
| Referred to a specialist | Yes |
| No longer needed | Yes |
| Parents declined | Yes |
| Left school | No |

A completed session with the student after closing counts as the check. If that session finds a new concern, the counsellor opens a new case.

## Teacher referrals

A teacher notices something and records it: student, category (behaviour, emotional, academic, social, attendance, wellbeing, other), "concern" or "serious", what they observed, and when. It lands in the counsellor's referral queue as **New**. The counsellor then does one of three things:

- **Open a case.** The referral becomes the case's source.
- **Add to the open case.** The student already has an open case.
- **No action needed.** The counsellor writes a short reply to the teacher.

Teachers sign in like other staff (role `teacher`), but they can only:
- search students by name, ID or class (names only, nothing else);
- send a referral;
- see their own referrals' status and the counsellor's reply.

They never see sessions, scores, notes or cases. Teacher screens come with the Release 3 UI; until then a teacher account signs in to "Your access is not active".

## Settings (per school, admin only)

`urgent_first_contact_days` 2, `followup_days_urgent` 7, `followup_days_support` 14, `followup_days_watch` 30, `post_closure_review_days` 90, `routine_checkin_days` 90. Days are calendar days; school-day counting is a later refinement.

## What changes in existing data

- Sessions get an optional `case_id`. A session saved while the student has an open case is linked to it automatically.
- `risk_level` on the student follows the open case (Urgent → High, Support → Medium, Watch → Low; closing → Low), so Analytics and existing screens keep working.
- Existing GCM students need no conversion to start: anyone with a completed session appears as Regular, everyone else as Not seen. Students who are currently a concern need a case opened by a counsellor. `v16_backfill.sql` can do that from `risk_level` after review; nothing runs automatically.

## Decisions to confirm

1. Default rhythms above.
2. Outcome list.
3. Teacher referral categories.
4. Whether to run the backfill for current High/Medium-risk students, or let counsellors open cases by hand.
