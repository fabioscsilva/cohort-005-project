import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "~/db/schema";
import { courses, lessons, modules, notes } from "~/db/schema";

// ─── Notes ───
// A Note is a Student's own writing about a Lesson, private to the Student who
// wrote it. One per Student per Lesson, enforced by the
// `notes_user_lesson_unique` index. A Note is plain text and is never passed
// through the Markdown renderer. See GLOSSARY.md.
//
// Only the owning Student's Lesson page and Saved page may read Note bodies.
// No Instructor or Platform Admin view calls into this module.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Content access is the caller's job: the Lesson page action checks it
// before calling in.

export type Db = BetterSQLite3Database<typeof schema>;

export const MAX_NOTE_LENGTH = 2000;

/** A Note body as it arrives from a form: trimmed, and refused when too long. */
export const noteBodySchema = z
  .string()
  .trim()
  .max(
    MAX_NOTE_LENGTH,
    `A note can be at most ${MAX_NOTE_LENGTH.toLocaleString("en")} characters.`
  );

export type NoteOnLesson = { body: string; updatedAt: string };

function ofStudentOnLesson(userId: number, lessonId: number) {
  return and(eq(notes.userId, userId), eq(notes.lessonId, lessonId));
}

export function getNote(
  db: Db,
  userId: number,
  lessonId: number
): NoteOnLesson | undefined {
  return db
    .select({ body: notes.body, updatedAt: notes.updatedAt })
    .from(notes)
    .where(ofStudentOnLesson(userId, lessonId))
    .get();
}

export type SaveNoteResult =
  | { ok: true; note: NoteOnLesson | null }
  | { ok: false; error: string };

/**
 * Saves the Student's Note on a Lesson. A re-save replaces the body and moves
 * the "last edited" time (`updatedAt`) on; `createdAt` stays put. Saving an
 * empty box removes the Note, so the box is empty next time, as it is for a
 * Lesson with no Note.
 */
export function saveNote(
  db: Db,
  userId: number,
  lessonId: number,
  body: string,
  now: Date
): SaveNoteResult {
  const parsed = noteBodySchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  if (parsed.data.length === 0) {
    db.delete(notes).where(ofStudentOnLesson(userId, lessonId)).run();
    return { ok: true, note: null };
  }

  const at = now.toISOString();
  const note = db
    .insert(notes)
    .values({ userId, lessonId, body: parsed.data, createdAt: at, updatedAt: at })
    .onConflictDoUpdate({
      target: [notes.userId, notes.lessonId],
      set: { body: parsed.data, updatedAt: at },
    })
    .returning({ body: notes.body, updatedAt: notes.updatedAt })
    .get();

  return { ok: true, note };
}

/** The Student's Notes, last edited first, each with its Lesson and Course. */
export function listNotes(db: Db, userId: number) {
  return db
    .select({
      id: notes.id,
      body: notes.body,
      updatedAt: notes.updatedAt,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(notes)
    .innerJoin(lessons, eq(lessons.id, notes.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(eq(notes.userId, userId))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .all();
}
