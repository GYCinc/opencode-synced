---
name: student-session-report
description: Extract and organize session data into a student-facing HTML report. Handles recast cataloging, vocabulary tagging, grammar patterns, phrasal verb extraction, and interactive tutor-driven selection workflow. This is the AUTHORITY for any student-facing report — overrides any other report format.
trigger: report, session report, student report, class report, progress report, make report, create report, generate report, HTML report, combined report, dual report
---

# Student Session Report Generator

## Purpose
Extract and organize session data into a student-facing report. The skill handles: finding strong points, identifying error patterns, cataloging recasts, listing vocabulary, and building a practice plan.

---

## Process

### 1. Read the transcript twice
First pass: get the overall flow — what topics came up, what the student seemed confident about, where the tutor stepped in.

Second pass: mark specific moments as you go:
- Self-corrections (student caught their own error)
- Tutor recasts (tutor rephrased student errors)
- Vocabulary moments (student asked for a word, used a new word, or didn't produce one)
- Grammar moments (errors with the same pattern appearing 2+ times)

---

### 2. Strong Points

**How to find them:**
- Self-corrections: did the student catch and fix their own errors?
- Topic depth: did the student sustain a conversation beyond surface level?
- Vocabulary strategy: did the student use circumlocution, ask for words, or use new words in context?
- Consistency: was the student present and engaged throughout?
- Specific language: did the student produce complex structures correctly?

**Write the opening as a single paragraph.**
Structure it like this:
1. Open with the student's own words or a concrete moment from the session
2. List the topics covered as a natural inventory — one sentence, comma-separated
3. If the student expressed openness to correction, use that as a bridge into the grammar section
4. Close with a brief acknowledgment

The paragraph should read like a message from someone who was there. 3-5 sentences. Second person. Conversational.

**Tone:**
- Write like the tutor talking to someone they see every week
- Use casual connectors: "since you said," "I thought this might be," "probably within a literal single session"
- Include the tutor's actual voice: hedging, self-awareness, casual asides ("fossilized, whatever")
- End the opening on a real note, not a performance review phrase
- Grammar notes should sound like the tutor explaining something, not a textbook

---

### 3. Grammar Patterns

**How to find them:**
1. Look for the same type of error appearing 2+ times
2. Check if the error follows a pattern (e.g., preposition + -ing, subject-verb agreement, article use)
3. Quote the exact error from the transcript
4. Quote the exact correction the tutor gave

**Present up to 5 options ordered by frequency.**

**Each option needs:**
- Plain-English pattern name
- Quote the error
- Quote the correction
- One-sentence plain-English explanation

**Example format:**
- Preposition + -ing
- Student said: "I enjoy to study"
- Correction: "I enjoy studying"
- When you use "enjoy," you need a gerund (-ing), not an infinitive.

**Maximum 2 patterns per session. Ask:** "Which 2 should I focus on?"

---

### 4. Recasts

**How to find them:**
Go back through the transcript and look for every place you repeated or rephrased something the student said — either to correct it or to model correct usage.

**How to present them to the student:**
Write each recast as a natural observation in your voice. No HOW labels. No "You:" / "Me:" quote labels. No "what this teaches" meta-lines. Just say what happened and why it matters.

**Format:**
Narrate it naturally: "When you said [student quote], I repeated it as [correction]. The difference is [one-sentence plain-English explanation]."

Group related recasts together in a single flowing section. Don't label them individually.

**CRITICAL: No third-person labels.** Never write "Tutor offered," "Student self-corrected," "Tutor modeled." You are the tutor. You write as "I" to the student as "you."

---

### 5. Vocabulary

**How to find them:**
Go through the transcript and pull every word the tutor defined, explained, or that the student asked about or used.

**How to present them to the student:**
List each word with: the word, the session it came from, and how it came up — told as a short, natural sentence in the tutor's voice. No tags. No categories. No meta-language.

**Wrong format:**
`financially stable [Receptive] [Lesson 1] — (adj. phrase) Having enough money to feel secure.`

**Right format:**
`financially stable — you were reaching for "financiera" and I gave you this. You used it immediately.`

**CRITICAL: No vocabulary tags.** Never label words as Requested / Acquired / Receptive in student-facing output. The student does not need to know these categories. Just tell the story of how each word came up.

**Verify every item.** If a vocabulary moment was actually a misunderstanding (e.g., accent confusion, the student meant a different word), do NOT include it. Accuracy over volume.

---

### 6. Phrasal Verbs & Collocations

**How to find them:**
- Look for multi-word verbs (run out of, bring in, take out)
- Look for word pairings that go together naturally (make a decision, take a break)
- Quote the exact context where they appeared

**For each one:**
- The phrasal verb or collocation
- Its meaning in plain English
- Why it's worth knowing
- The exact example from the transcript

---

### 7. Practice Plan

**How to build it:**

**Column 1 — In class:**
- What the student will do in the next session
- Be specific: name the phrasal verbs, name the activity type
- Build on new material from this session

**Column 2 — Outside class:**
- What the student will do on their own
- Also specific: use the phrasal verbs in conversation, practice with specific prompts
- Write concrete actions with measurable outcomes (e.g., "use run out of in 3 sentences about your week")

**Ask:** "What should the practice plan focus on?"

---

### 8. Tutor Note

Write 1-2 sentences in the tutor's own voice. Warm, specific, real. Reference something that actually happened in the session.

Write only when you have something genuine to say.

---

## HTML Output

### Design
- System fonts only (-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial)
- Minimum 14px for all body text
- Forest green accent color
- Warm white background
- Use muted earth tones for all text and accents
- Plain text only, no decorative symbols
- Topic tags: each a different muted color (not all the same)
- Section headers inside boxes: same size as body text

### Structure
- Badge: "Session Report · [Week number if given]"
- Open directly with the report content
- Footer: "Generated by [Tutor name] & AiRon"

---

## Workflow Summary

1. Read transcript twice
2. Extract strong points → present 5 options → tutor picks 3-4
3. Extract grammar patterns → present up to 5 by frequency → tutor picks 2
4. Extract recasts → tutor reviews list
5. Extract vocabulary → tutor reviews categorization
6. Extract phrasal verbs and collocations
7. Build practice plan → tutor approves
8. Write tutor note → tutor approves
9. Assemble HTML → tutor reviews

**For each extraction step: present options, let the tutor decide. Do not make all the decisions yourself.**

---

## Related Skills and Workflow

### Complete Analysis Workflow
For a complete student analysis pipeline, use the **student-analysis-workflow** skill which chains:
1. **student-context-populator** - Extract data and build student_context.json
2. **student-facing-report** - Generate this HTML report (current skill)
3. **transcript-final-review** - Validate the report against source transcripts

### When to Use This Skill Independently
- You already have a populated `student_context.json` file
- You need a quick student report without full data extraction
- You're updating an existing report with new session data

### Related Skills
- **student-context-populator**: Use before this skill to extract structured data from transcripts
- **transcript-final-review**: Use after this skill to validate the generated report
- **student-analysis-workflow**: Use for the complete analysis pipeline
- **deck-forge**: Alternative output format (Anki flashcards from session data)

### Integration Notes
- This skill works best with a populated `student_context.json` from student-context-populator
- Always validate outputs with transcript-final-review before delivering to students
- Consider using student-analysis-workflow for end-to-end analysis

---

## HARD LESSONS — What Breaks a Student-Facing Report

These rules came from failure. Violating any of them produces output the student can't use.

### 1. NO THIRD-PERSON TUTOR REFERENCES
The tutor writes the report. The tutor is "I." The student is "you." Any label like "Tutor offered," "Tutor modeled," "Student self-corrected" reads as clinical meta-commentary, not as someone talking to their student.

**Wrong:** `[Tutor offered] You: "X" Me: "Y" → Teaches: Z`
**Right:** `When you said "X," I repeated it as "Y." The difference is Z.`

### 2. NO VOCABULARY META-TAGS
Tags like `Requested / Acquired / Receptive` are internal classification. The student does not need to know whether a word was "acquired" vs "receptive." Just present the word naturally with how it came up.

**Wrong:** `financially stable [Receptive] [Lesson 1]`
**Right:** `financially stable — you were reaching for "financiera" and I gave you this. You used it immediately.`

### 3. RECASTS ARE NARRATED, NOT LABELED
Don't format recasts as blocks with HOW labels, student/tutor quote labels, and "teaches" lines. Write them as natural observations from the tutor to the student. One flowing paragraph per recast, or group related ones together. The tutor's voice carries the meaning — labels kill it.

### 4. VERIFY BEFORE INCLUDING
Every vocabulary item, every recast, every claim must be verified against the transcript. If a vocabulary moment was actually a misunderstanding (student and tutor talking past each other due to accent/audio), do NOT include it. If you're not sure what the student meant, do NOT include it. "She said carrot cake, then fruit cake, then cheesecake" is confusion, not vocabulary acquisition.

### 5. NO FLATTERY
Don't mention impressive self-taught feats ("you learned Portuguese by yourself"). Don't present recasts as miracles. Don't use the intro to list the student's virtues. State what happened. Let the content carry the value.

### 6. READ THE CONTEXT
Before including any claim about what the student said or did, cross-reference with the transcript. A recast labeled "Student corrected tutor" when it was actually an accent misunderstanding is worse than no recast at all. The report must be accurate, not flattering.

### 7. REMEMBER THE RELATIONSHIP
This is an ESL lesson. The student's first language is Spanish. The tutor speaks Spanish. The report is a message from one person to another — not a clinical document, not a performance review, not a teaching log. Every sentence should sound like something Aaron would actually say to Lizeth.
