import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { bookmarks, courses, lessons, modules } from "~/db/schema";

// ─── Bookmarks ───
// A Bookmark is a Student's flag on a Lesson, so they can find it again. One
// per Student per Lesson, enforced by the `bookmarks_user_lesson_unique` index.
// See GLOSSARY.md.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Content access is the caller's job: the Lesson page action checks it
// before calling in.

export type Db = BetterSQLite3Database<typeof schema>;

function ofStudentOnLesson(userId: number, lessonId: number) {
  return and(eq(bookmarks.userId, userId), eq(bookmarks.lessonId, lessonId));
}

export function isBookmarked(db: Db, userId: number, lessonId: number) {
  return !!db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(ofStudentOnLesson(userId, lessonId))
    .get();
}

/**
 * Bookmarks the Lesson, or removes the Bookmark if there is one. Returns
 * whether the Lesson is bookmarked afterwards.
 */
export function toggleBookmark(
  db: Db,
  userId: number,
  lessonId: number,
  now: Date
): boolean {
  const removed = db
    .delete(bookmarks)
    .where(ofStudentOnLesson(userId, lessonId))
    .returning({ id: bookmarks.id })
    .all();
  if (removed.length > 0) return false;

  // A concurrent toggle may have inserted first; the unique index keeps it to one.
  db.insert(bookmarks)
    .values({ userId, lessonId, createdAt: now.toISOString() })
    .onConflictDoNothing()
    .run();
  return true;
}

/** The Student's Bookmarks, newest first, each with its Lesson and Course. */
export function listBookmarks(db: Db, userId: number) {
  return db
    .select({
      id: bookmarks.id,
      createdAt: bookmarks.createdAt,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      moduleTitle: modules.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(bookmarks)
    .innerJoin(lessons, eq(lessons.id, bookmarks.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(eq(bookmarks.userId, userId))
    .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
    .all();
}
