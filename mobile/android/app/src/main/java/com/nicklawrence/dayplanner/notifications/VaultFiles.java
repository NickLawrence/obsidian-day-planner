package com.nicklawrence.dayplanner.notifications;

import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/** Storage Access Framework adapter. No activity records are kept in preferences. */
final class VaultFiles {
    static final Object LOCK = new Object();
    private final Context context;
    private final SharedPreferences preferences;

    VaultFiles(Context context) {
        this.context = context;
        preferences = context.getSharedPreferences("vault_connection", Context.MODE_PRIVATE);
    }

    String connectionId() { return preferences.getString("tree_uri", ""); }
    boolean connected() { return !connectionId().isEmpty(); }
    String name() { return preferences.getString("name", "Obsidian vault"); }

    void connect(Uri tree) throws IOException {
        Uri root = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        String name = null;
        try (Cursor cursor = context.getContentResolver().query(root,
            new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
        }
        if (name == null) throw new IOException("Unable to read the vault folder");
        if (name.equals("_Planner")) throw new IOException("Select the vault root containing _Planner, not _Planner itself");
        preferences.edit().putString("tree_uri", tree.toString()).putString("name", name).commit();
    }

    private Uri root() throws IOException {
        if (!connected()) throw new IOException("Choose your Obsidian vault folder first");
        Uri tree = Uri.parse(connectionId());
        return DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
    }

    private List<Document> children(Uri parent) throws IOException {
        Uri tree = Uri.parse(connectionId());
        Uri uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getDocumentId(parent));
        List<Document> result = new ArrayList<>();
        try (Cursor cursor = context.getContentResolver().query(uri, new String[] {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE }, null, null, null)) {
            if (cursor == null) throw new IOException("Unable to read the vault folder. Reconnect it.");
            while (cursor.moveToNext()) result.add(new Document(
                DocumentsContract.buildDocumentUriUsingTree(tree, cursor.getString(0)), cursor.getString(1),
                DocumentsContract.Document.MIME_TYPE_DIR.equals(cursor.getString(2))));
        }
        return result;
    }

    List<String> listFiles(String folder, String extension) throws IOException {
        if (extension != null && !extension.equals(".md") && !extension.equals(".yaml"))
            throw new IOException("Unsupported vault file extension");
        List<String> result = new ArrayList<>();
        Uri directory = folder.isEmpty() ? root() : find(folder, false, true);
        if (directory != null) visit(directory, folder.isEmpty() ? "" : folder + "/", extension, result);
        return result;
    }

    private void visit(Uri folder, String prefix, String extension, List<String> result) throws IOException {
        if (Thread.currentThread().isInterrupted()) throw new IOException("Vault scan cancelled");
        for (Document child : children(folder)) {
            if (Thread.currentThread().isInterrupted()) throw new IOException("Vault scan cancelled");
            if (child.name.startsWith(".")) continue;
            String path = prefix + child.name;
            if (child.directory) visit(child.uri, path + "/", extension, result);
            else if (extension == null ? path.endsWith(".md") || path.endsWith(".yaml") : path.endsWith(extension)) result.add(path);
        }
    }

    private Uri find(String path, boolean create) throws IOException {
        return find(path, create, false);
    }

    private Uri find(String path, boolean create, boolean directoryPath) throws IOException {
        String[] parts = path.split("/", -1);
        for (String part : parts)
            if (part.isEmpty() || part.equals(".") || part.equals("..") || part.contains("\\"))
                throw new IOException("Invalid vault path");
        Uri parent = root();
        for (int i = 0; i < parts.length; i++) {
            Uri found = null;
            boolean directory = directoryPath || i < parts.length - 1;
            for (Document child : children(parent)) {
                if (child.name.equals(parts[i])) {
                    if (child.directory != directory) throw new IOException("Unexpected file type at " + path);
                    if (found != null) throw new IOException("Ambiguous vault path: " + path);
                    found = child.uri;
                }
            }
            if (found == null && create) found = DocumentsContract.createDocument(context.getContentResolver(), parent,
                directory ? DocumentsContract.Document.MIME_TYPE_DIR : "application/yaml", parts[i]);
            if (found == null) {
                if (create) throw new IOException("Unable to create " + path);
                return null;
            }
            parent = found;
        }
        return parent;
    }

    String readFile(String path) throws IOException {
        Uri file = find(path, false);
        if (file == null) return null;
        try (InputStream input = context.getContentResolver().openInputStream(file)) {
            if (input == null) throw new IOException("Unable to read " + path);
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
            return bytes.toString(StandardCharsets.UTF_8.name());
        }
    }

    void writeFile(String path, String contents, String expected) throws IOException {
        synchronized (LOCK) {
            if (!path.startsWith("_Planner/activities/") || !path.endsWith(".yaml"))
                throw new IOException("Only activity YAML files can be written");
            if (!Objects.equals(readFile(path), expected))
                throw new IOException("The activity file changed. Refresh and try again.");
            Uri file = find(path, true);
            try (OutputStream output = context.getContentResolver().openOutputStream(file, "wt")) {
                if (output == null) throw new IOException("Unable to write " + path);
                output.write(contents.getBytes(StandardCharsets.UTF_8));
            }
        }
    }

    private static final class Document {
        final Uri uri;
        final String name;
        final boolean directory;
        Document(Uri uri, String name, boolean directory) { this.uri = uri; this.name = name; this.directory = directory; }
    }
}
