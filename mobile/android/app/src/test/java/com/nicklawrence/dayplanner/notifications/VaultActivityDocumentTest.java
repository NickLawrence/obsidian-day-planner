package com.nicklawrence.dayplanner.notifications;

import static org.junit.Assert.*;
import org.junit.Test;
import java.util.List;
import java.util.Map;

public class VaultActivityDocumentTest {
    private static final String ID = "[\"_Planner/activities/2026/2026-W41.yaml\",\"read\",[\"2026-10-06 10:00:00\"]]";
    private static final String YAML = "activities:\n"
        + "  - activity: read\n    log:\n      - start: '2026-10-06 10:00:00'\n"
        + "    read:\n      book: '001'\n      start-page: 1\n    quality: 8\n    notes: Existing\n"
        + "    taskIds: [task-1]\n    custom: {string: yes, number: 5, flag: true}\n"
        + "  - activity: walk\n    log:\n      - start: '2026-10-06 11:00:00'\n";

    @Test public void inlineReplyWritesCanonicalYamlAndPreservesOtherRecords() {
        String result = new VaultActivityDocument(YAML).appendNote(ID, "\u00a0During activity\uFEFF");
        Map<String, Object> record = new VaultActivityDocument(result).findOpen(ID);
        assertEquals("Existing\nDuring activity", record.get("notes"));
        assertEquals(List.of("task-1"), record.get("taskIds"));
        assertEquals("001", ((Map<?, ?>) record.get("read")).get("book"));
        assertEquals("yes", ((Map<?, ?>) record.get("custom")).get("string"));
        assertEquals(true, ((Map<?, ?>) record.get("custom")).get("flag"));
        assertEquals(8, record.get("quality"));
        assertEquals(2, ((List<?>) ((Map<?, ?>) VaultActivityDocument.load(result)).get("activities")).size());
        assertTrue(result.contains("\"2026-10-06 10:00:00\""));
    }

    @Test public void coldReplyResolvesIdentityAfterRecordsAreReordered() {
        String reordered = "activities:\n  - activity: walk\n    log: [{start: '2026-10-06 11:00:00'}]\n"
            + "  - activity: read\n    log: [{start: '2026-10-06 10:00:00'}]\n";
        Map<String, Object> record = new VaultActivityDocument(new VaultActivityDocument(reordered).appendNote(ID, "Note")).findOpen(ID);
        assertEquals("Note", record.get("notes"));
    }

    @Test public void rejectsStaleFinishedAndAmbiguousNotificationTargets() {
        assertThrows(IllegalArgumentException.class, () -> new VaultActivityDocument(YAML.replace("10:00:00", "09:00:00")).appendNote(ID, "Note"));
        assertThrows(IllegalArgumentException.class, () -> new VaultActivityDocument(YAML.replace("start: '2026-10-06 10:00:00'", "start: '2026-10-06 10:00:00'\n        end: '2026-10-06 10:30:00'")).appendNote(ID, "Note"));
        String duplicate = "- activity: read\n  log: [{start: '2026-10-06 10:00:00'}]\n";
        assertThrows(IllegalArgumentException.class, () -> new VaultActivityDocument(duplicate + duplicate).appendNote(ID, "Note"));
    }

    @Test public void normalizesLegacyPlannerClockAndPreservesMetadata() {
        String old = "planner:\n  activities:\n    - activity: read\n      taskIds: []\n      log: []\n"
            + "  log: [{start: '2026-10-06 10:00:00'}]\n";
        String updated = new VaultActivityDocument(old).appendNote(ID, "Note");
        assertEquals("Note", new VaultActivityDocument(updated).findOpen(ID).get("notes"));
        assertTrue(updated.contains("taskIds"));
        assertFalse(updated.contains("planner"));
    }
}
