import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { MAX_NOTE_LENGTH, getNote, listNotes, saveNote } from "./notes.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

function minutesAfterNow(minutes: number) {
  return new Date(NOW.getTime() + minutes * 60_000);
}

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonIds: number[];

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonIds = [1, 2].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
});

function addStudent(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: schema.UserRole.Student,
    })
    .returning()
    .get();
}

describe("saving a Note", () => {
  it("creates a Note on a Lesson with none, body trimmed", () => {
    const result = saveNote(db, base.user.id, lessonIds[0], "  # not a heading *  ", NOW);

    expect(result).toEqual({
      ok: true,
      note: { body: "# not a heading *", updatedAt: NOW.toISOString() },
    });
    expect(getNote(db, base.user.id, lessonIds[0])).toEqual({
      body: "# not a heading *",
      updatedAt: NOW.toISOString(),
    });
  });

  it("replaces the body and moves the last-edited time on when saved again", () => {
    saveNote(db, base.user.id, lessonIds[0], "First thoughts", NOW);
    const later = minutesAfterNow(5);

    saveNote(db, base.user.id, lessonIds[0], "Second thoughts", later);

    expect(getNote(db, base.user.id, lessonIds[0])).toEqual({
      body: "Second thoughts",
      updatedAt: later.toISOString(),
    });
    expect(listNotes(db, base.user.id)).toHaveLength(1);
  });

  it("refuses a Note over the cap with a message", () => {
    const result = saveNote(
      db,
      base.user.id,
      lessonIds[0],
      "a".repeat(MAX_NOTE_LENGTH + 1),
      NOW
    );

    expect(result).toEqual({
      ok: false,
      error: "A note can be at most 2,000 characters.",
    });
    expect(getNote(db, base.user.id, lessonIds[0])).toBeUndefined();
  });

  it("accepts a Note of exactly 2,000 characters", () => {
    const body = "a".repeat(2000);

    expect(saveNote(db, base.user.id, lessonIds[0], body, NOW)).toMatchObject({
      ok: true,
      note: { body },
    });
  });

  it("removes the Note when saved empty", () => {
    saveNote(db, base.user.id, lessonIds[0], "Something", NOW);

    expect(saveNote(db, base.user.id, lessonIds[0], "   ", NOW)).toEqual({
      ok: true,
      note: null,
    });
    expect(getNote(db, base.user.id, lessonIds[0])).toBeUndefined();
  });

  it("refuses a second Note row for the same Student and Lesson", () => {
    saveNote(db, base.user.id, lessonIds[0], "Mine", NOW);

    expect(() =>
      db
        .insert(schema.notes)
        .values({ userId: base.user.id, lessonId: lessonIds[0], body: "Again" })
        .run()
    ).toThrow();
  });
});

describe("listing Notes", () => {
  it("lists only the Student's own Notes, last edited first, with Lesson and Course", () => {
    const other = addStudent("Ben");
    saveNote(db, base.user.id, lessonIds[1], "On lesson 2", NOW);
    saveNote(db, base.user.id, lessonIds[0], "On lesson 1", minutesAfterNow(1));
    saveNote(db, other.id, lessonIds[0], "Ben's note", minutesAfterNow(2));
    // Editing the older Note moves it to the top.
    saveNote(db, base.user.id, lessonIds[1], "On lesson 2, edited", minutesAfterNow(3));

    expect(listNotes(db, base.user.id)).toMatchObject([
      {
        lessonId: lessonIds[1],
        body: "On lesson 2, edited",
        lessonTitle: "Lesson 2",
        courseTitle: "Test Course",
        courseSlug: "test-course",
      },
      { lessonId: lessonIds[0], body: "On lesson 1" },
    ]);
  });
});
