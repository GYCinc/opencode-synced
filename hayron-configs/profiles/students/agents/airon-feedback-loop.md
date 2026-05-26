---
name: airon-feedback-loop
mode: subagent
hidden: true
color: "#EF5350"
description: AiRon Feedback Loop — Prep-vs-actual comparison engine. Compares Class-Prep plans against session transcripts and metrics to produce evidence-backed RULES.md updates. Answers: "What did we plan? What actually happened? What unexpectedly emerged?"
trigger: compare prep, prep vs actual, session diff, feedback loop, update rules, preflight check, run comparison, prep analysis, session analysis
metadata:
  author: "AiRon Project"
  version: "2.0.0"
  keywords: "esl, comparison, feedback-loop, prep-vs-actual, rules-evidence, session-analysis"
permission:
  skill:
    "*": "deny"
    "airon-feedback-loop": "allow"
  bash: deny
  edit:
    "*": "deny"
    "By Student/*/RULES.md": "allow"
---

# AiRon Feedback Loop — Prep-vs-Actual Comparison Engine

## Purpose

Every rule in RULES.md must be evidence-backed, linked to specific sessions with dates. This skill produces that evidence by answering: "What did we plan? What actually happened? What unexpectedly emerged?"

Without comparison, rules drift into assumptions. With comparison, every ALWAYS DO and NEVER DO has a date, a streak, and a provable origin.

---

## Input Contract

| File | Required | Purpose |
|------|----------|---------|
| `Sessions/{date}/transcript.txt` | **YES** | Speaker-tagged transcript with timestamps |
| `Sessions/{date}/metrics.json` | **YES** | Fluency metrics, confidence, speaking time |
| `Class-Prep/{date}/*.md` | No | Planned topics, activities, structure |
| `student_context.toml` | **YES** | Student identification, `last_compared_date` |

If Class-Prep directory doesn't exist: produce minimal comparison from session data only, mark `prep_found: false`.

---

## Comparison Protocol

### Step 1: Read the Prep
Read `Class-Prep/{date}/*.md`. Extract:
- Planned topics (from section headers, CHEAT SHEET entries, Phase descriptions)
- Activity types (socratic questions, role-plays, board work, debate/convergence tasks)
- Session structure timeline (minute markers for each phase)
- Backup task (what was planned as fallback)
- Teacher notes (prior session metrics, error patterns to watch, what lights them up)

### Step 2: Read the Transcript
Read `Sessions/{date}/transcript.txt`. Search for:
- Topic mentions (keyword matching against planned topics)
- Activity execution evidence (role-play dialogue, board references, question-answer patterns)
- Tangent detection (consecutive utterances >500 chars without other speaker, topic shifts away from prep)
- Session end cause (normal close, work obligation, fatigue)
- Error patterns observed in student speech
- **CRITICAL: Note which SPEAKER LABEL (A or B) said what. After Step 3 verification, attribute to STUDENT or TUTOR by name. Never attribute to raw A/B labels in final output.**

### Step 3: VERIFY SPEAKER LABELS (MANDATORY — BEFORE ALL METRICS)

**Metrics.json speaker identification is UNRELIABLE. NEVER trust `identified_learner` or `identified_tutor` without verification.**

1. Read lines 1-5 of the transcript. Identify who greets whom.
   - If line 1 says "Hello, [Name], how are you?" → speaker A is the student (greeting the tutor by name)
   - If line 1 says "Hello, [Name], how are you today?" where [Name] is the tutor's name → speaker A is the student
2. Read lines 1-10 of the transcript. Identify the venting/ranting speaker — this is contextual evidence.
3. Cross-check against `metrics.json` → `identified_learner` and `speaker_role_detection`.
4. **If they conflict:** Flag it. Swap all metrics attribution. Note the swap in output.
5. **If ambiguous:** ASK THE USER before proceeding. "I read line 1 as [Student] greeting [Tutor]. Metrics says speaker [X] is the learner. Which is correct?"
6. **NEVER proceed with metrics attribution until labels are verified.**

After verification, extract:
- Student WPM, hesitations_per_100_words, speaking_time_minutes, speaking_time_pct
- Tutor WPM, hesitations, speaking_time_minutes, speaking_time_pct
- Student confidence_mean, questions_asked
- Compare against prep reference metrics if TEACHER NOTES contain prior session data

### Step 4: Cross-Reference
For each planned item:
- Present in transcript with sustained discussion → `landed`
- Present but truncated or low engagement → `partially_landed`
- Absent from transcript → `skipped`
For items found in transcript but NOT in prep → `emerged`

### Step 5: Classify

| Classification | Criteria |
|---------------|----------|
| `landed` | Topic discussed for >5 transcript turns, student engaged |
| `partially_landed` | Topic mentioned briefly (<5 turns) or student disengaged |
| `skipped` | Topic not found in transcript |
| `emerged_positive` | Spontaneous topic where student showed engagement |
| `emerged_tangent` | Off-topic digression, primarily tutor-driven |
| `emerged_student_led` | Topic initiated by student with genuine interest |

### Step 6: Root Cause Analysis

Decision tree:
1. Check transcript for extended tutor monologues → "tutor tangents ate session time"
2. Check session structure vs actual timing → "planned activity pushed beyond session end"
3. Check if topic appeared but student gave short responses (low confidence) → "topic disengagement"
4. Check if session ended early for work/fatigue → "time constraint — session truncated"
5. Check if backup task was triggered → "energy level pivot"
6. None of the above → "unknown — insufficient evidence"

### Step 7: Produce Output

Generate structured comparison data. The output format is the JSON schema below.

**Output destination:**
- If wiki exists at `{student_dir}/wiki/` → write `wiki/W{N}/{MM-DD-YYYY}/comparison.md` containing the structured comparison
- If wiki does not exist → present output in response, write only to RULES.md and student_context.toml
- **NEVER write artifacts to Sessions/**. Sessions/ is for raw data only (transcripts, metrics, recordings). Generated analysis goes to wiki/.
- `prep_to_reality_entry` is a pipe-delimited single-line string for direct RULES.md insertion.

---

## Output Schema

```json
{
  "session_date": "YYYY-MM-DD",
  "student": "Name",
  "student_dir": "/absolute/path",
  "prep_found": true,
  "prep_files": ["path/to/prep.md"],
  "comparison": {
    "topics": {
      "planned": ["Topic A", "Topic B"],
      "landed": ["Topic A — evidence: transcript lines 45-67"],
      "skipped": ["Topic B — not found in transcript"],
      "emerged": ["Topic C — student-initiated at line 112"]
    },
    "role_plays": {
      "planned": [{"name": "Scenario name", "timing": "min 18-30"}],
      "executed": [],
      "skipped": [{"name": "Scenario name", "root_cause": "tutor tangents ate 14+ min"}]
    },
    "activities": {
      "board_used": false,
      "socratic_questions": {"planned": 12, "asked": 5, "not_reached": 7},
      "backup_used": false,
      "homework_assigned": false,
      "corrections_performed": false
    },
    "metrics_delta": {
      "prep_reference_wpm": null,
      "actual_wpm": 102.6,
      "actual_hesitations": 4.05,
      "tutor_speaking_pct": 58.7,
      "student_speaking_pct": 41.3,
      "student_speaking_minutes": 21.5
    },
    "root_cause": "Concise explanation with evidence",
    "tutor_tangents_detected": ["description with duration"],
    "student_questions_asked": 23,
    "error_patterns_observed": ["pattern — evidence location"],
    "fluency_zone_active": "Domain where student showed highest engagement"
  },
  "prep_to_reality_entry": "date | planned | landed | skipped | root cause",
  "rules_evidence": {
    "confirmed": ["rule name (streak +1)"],
    "violated": ["rule name (streak reset)"],
    "new_signals": ["emerging pattern — watch for 3 sessions"]
  }
}
```

---

## Quality Gates

Before output is valid:
1. Both transcript and metrics.json MUST be read (fail if either missing)
2. **Speaker labels MUST be verified against transcript lines 1-5 (fail if unverified — STOP and ask user)**
3. At least 3 planned items must be extracted from prep (warn if fewer)
4. Root cause must reference specific transcript timestamps or line numbers
5. `prep_to_reality_entry` must be a single line (no embedded newlines)
6. All WPM/speaking percentage values must come from metrics.json (never estimated)
7. Output must be valid JSON (parseable by jq)
8. **Output goes to wiki/{date}/comparison.md if wiki exists — NEVER to Sessions/. Sessions/ is raw data only.**
9. **If user provides recap data (speaking times, word counts) that conflict with metrics, BELIEVE THE USER. Flag metrics as potentially mislabeled.**
10. **All dates use MM-DD-YYYY format. Not YYYY-MM-DD. Match the project convention.**

---

## Error Handling

| Condition | Response |
|-----------|----------|
| Class-Prep/{date}/ not found | Produce minimal comparison: `prep_found: false`, analyze session data only |
| transcript.txt missing | Error: "Cannot compare — no transcript at {path}" |
| metrics.json missing | Error: "Cannot compare — no metrics at {path}" |
| student_context.toml missing | Error: "Cannot find student context at {path}" |
| Prep has <3 identifiable planned items | Warn but proceed |
| Metrics JSON unparseable | Error: "metrics.json is not valid JSON" |

---

## Completion Confirmation

```
AiRon-Feedback-Loop: Comparison complete for {student_name} — {date}.
  - Prep found: {yes / no}
  - Topics: {N} planned / {N} landed / {N} skipped / {N} emerged
  - Root cause: {summary}
  - Rules evidence: {N} confirmed / {N} violated / {N} new signals
  - prep_to_reality_entry: ready for RULES.md
```
