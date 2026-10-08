package com.nicklawrence.dayplanner.notifications;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.snakeyaml.engine.v2.api.Load;
import org.snakeyaml.engine.v2.api.LoadSettings;
import org.snakeyaml.engine.v2.api.Dump;
import org.snakeyaml.engine.v2.api.DumpSettings;
import org.snakeyaml.engine.v2.common.FlowStyle;
import org.snakeyaml.engine.v2.common.ScalarStyle;
import org.snakeyaml.engine.v2.schema.JsonSchema;

/** Minimal background note adapter, for when the TypeScript WebView is stopped. */
final class VaultActivityDocument {
    private final List<Map<String, Object>> records;

    @SuppressWarnings("unchecked")
    VaultActivityDocument(String contents) {
        if (contents == null) throw new IllegalArgumentException("The activity file was removed");
        Object root = load(contents);
        Object activities = root;
        if (root instanceof Map) {
            Map<String, Object> data = (Map<String, Object>) root;
            if (data.get("planner") instanceof Map) {
                Map<String, Object> planner = (Map<String, Object>) data.get("planner");
                activities = planner.getOrDefault("activities", new ArrayList<>());
                if (!(activities instanceof List)) activities = new ArrayList<>();
                List<Object> list = new ArrayList<>((List<Object>) activities);
                Object oldLog = planner.get("log");
                if (oldLog instanceof List && !((List<?>) oldLog).isEmpty()) {
                    Map<String, Object> first = list.isEmpty() ? new LinkedHashMap<>() : new LinkedHashMap<>((Map<String, Object>) list.remove(0));
                    first.putIfAbsent("activity", "Activity");
                    List<Object> log = new ArrayList<>((List<Object>) first.getOrDefault("log", new ArrayList<>()));
                    log.addAll((List<Object>) oldLog);
                    first.put("log", log);
                    list.add(0, first);
                }
                activities = list;
            } else activities = data.getOrDefault("activities", new ArrayList<>());
        }
        if (!(activities instanceof List)) throw new IllegalArgumentException("Invalid activity file");
        records = new ArrayList<>();
        for (Object item : (List<?>) activities) {
            if (!(item instanceof Map)) throw new IllegalArgumentException("Invalid activity record");
            Map<String, Object> record = (Map<String, Object>) item;
            if (!(record.get("activity") instanceof String) || !(record.get("log") instanceof List) ||
                ((List<?>) record.get("log")).isEmpty()) throw new IllegalArgumentException("Invalid activity record");
            for (Object log : (List<?>) record.get("log"))
                if (!(log instanceof Map) || !(((Map<?, ?>) log).get("start") instanceof String))
                    throw new IllegalArgumentException("Invalid activity log");
            records.add(record);
        }
    }

    static Object load(String contents) {
        return new Load(LoadSettings.builder().setSchema(new JsonSchema()).build()).loadFromString(contents);
    }

    static String pathFromId(String id) {
        List<?> reference = reference(id);
        String path = (String) reference.get(0);
        if (!path.startsWith("_Planner/activities/") || !path.endsWith(".yaml"))
            throw new IllegalArgumentException("Invalid activity file reference");
        return path;
    }

    private static List<?> reference(String id) {
        Object data = load(id);
        if (!(data instanceof List) || ((List<?>) data).size() != 3 || !(((List<?>) data).get(0) instanceof String) ||
            !(((List<?>) data).get(1) instanceof String) || !(((List<?>) data).get(2) instanceof List))
            throw new IllegalArgumentException("Invalid activity reference");
        return (List<?>) data;
    }

    Map<String, Object> findOpen(String id) {
        List<?> reference = reference(id);
        Map<String, Object> found = null;
        for (Map<String, Object> record : records) {
            List<Object> starts = new ArrayList<>();
            for (Object entry : (List<?>) record.get("log")) starts.add(((Map<?, ?>) entry).get("start"));
            if (record.get("activity").equals(reference.get(1)) && starts.equals(reference.get(2))) {
                if (found != null) throw new IllegalArgumentException("The activity reference is ambiguous");
                found = record;
            }
        }
        if (found == null) throw new IllegalArgumentException("The activity was changed or removed");
        boolean open = false;
        for (Object entry : (List<?>) found.get("log")) if (!((Map<?, ?>) entry).containsKey("end")) open = true;
        if (!open) throw new IllegalArgumentException("There is no open clock");
        return found;
    }

    String appendNote(String id, String note) {
        Map<String, Object> record = findOpen(id);
        String trimmed = note.replaceAll("^[\\s\\p{Z}\\uFEFF]+|[\\s\\p{Z}\\uFEFF]+$", "");
        if (trimmed.isEmpty()) throw new IllegalArgumentException("Note is empty");
        Object previous = record.getOrDefault("notes", "");
        if (!(previous instanceof String)) throw new IllegalArgumentException("Invalid activity notes");
        record.put("notes", ((String) previous).isEmpty() ? trimmed : previous + "\n" + trimmed);
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("activities", records);
        return new Dump(DumpSettings.builder().setSchema(new JsonSchema()).setDefaultFlowStyle(FlowStyle.BLOCK)
            // Obsidian's YAML codec also recognizes implicit dates; quote strings to
            // preserve timestamp strings and values such as "yes" or "001".
            .setDefaultScalarStyle(ScalarStyle.DOUBLE_QUOTED)
            .setSplitLines(false).build()).dumpToString(root);
    }
}
